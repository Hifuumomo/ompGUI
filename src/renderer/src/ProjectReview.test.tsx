import { act } from "react";
import { expect, it, vi } from "vitest";
import { container, render } from "./transcript-test-harness";
import { CodeReviewPanel } from "./CodeReviewPanel";
import type {
  ProjectBrowser,
  ProjectChanges,
  ProjectDiff,
  ProjectReview,
} from "../../shared/project-browser";

const changes: ProjectChanges = {
  kind: "git",
  root: "/project",
  base: "a".repeat(40),
  files: [
    {
      name: "main.py",
      path: "/project/src/nested/main.py",
      kind: "file",
      change: "modified",
    },
    {
      name: "view.tsx",
      path: "/project/src/view.tsx",
      kind: "file",
      change: "untracked",
    },
    {
      name: "app.js",
      path: "/project/app.js",
      kind: "file",
      change: "deleted",
    },
  ],
};
const diff: ProjectDiff = {
  before: "keep\nold\nend\n",
  after: "keep\nnew\nadded\nend\n",
  rows: [
    { kind: "context", text: "keep", ending: "\n", oldLine: 1, newLine: 1 },
    { kind: "deletion", text: "old", ending: "\n", oldLine: 2 },
    { kind: "addition", text: "new", ending: "\n", newLine: 2 },
    { kind: "addition", text: "added", ending: "\n", newLine: 3 },
    { kind: "context", text: "end", ending: "\n", oldLine: 3, newLine: 4 },
  ],
};
function fixture() {
  const browser: ProjectBrowser & ProjectReview = {
    listProjectChanges: vi.fn(async () => changes),
    readProjectDiff: vi.fn(async () => diff),
    listProjectDirectory: vi.fn(async () => []),
    readProjectFile: vi.fn(async () => diff.after),
    readProjectImage: vi.fn(),
  };
  return { cwd: "/project", browser, suspended: false, onClose: vi.fn() };
}
async function click(label: string) {
  await act(() =>
    container
      .querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
      .click(),
  );
}
/** 点击标题行的标签页（文件 / 变更）。 */
async function openTab(name: string) {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((item) => item.textContent?.startsWith(name))!;
  expect(button).toBeDefined();
  await act(() => button.click());
}
function section(path: string) {
  return container.querySelector<HTMLElement>(`[data-change-path="${path}"]`)!;
}
/** 文件页工具行：它是 DOM 里的第一个工具行。 */
function filesToolbar() {
  return container.querySelector(".code-review-toolbar")!.textContent;
}

it("差异布局图标在并排与单栏两态间切换，聚焦提示随状态更新", async () => {
  await render(<CodeReviewPanel {...fixture()} />);
  await openTab("变更");
  const button =
    container.querySelector<HTMLButtonElement>("[data-diff-layout]")!;
  await act(() => button.focus());
  for (const [layout, label, next] of [
    ["split", "并排 Diff", "单栏 Diff"],
    ["unified", "单栏 Diff", "并排 Diff"],
  ]) {
    expect(button.dataset.diffLayout).toBe(layout);
    expect(button.getAttribute("aria-label")).toBe(
      `差异布局：${layout === "split" ? "并排" : "单栏"}`,
    );
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
      `${label}；点击切换为${next}`,
    );
    await act(() => button.click());
  }
  expect(button.dataset.diffLayout).toBe("split");
  expect(container.querySelector("select")).toBeNull();
});

it("两页各自保留状态：文件页选中未变更文件，切到变更页再切回仍保留，且不对它启动 Diff", async () => {
  const props = fixture();
  vi.mocked(props.browser.listProjectDirectory).mockResolvedValue([
    { name: "clean.ts", path: "/project/clean.ts", kind: "file" },
  ]);
  await render(<CodeReviewPanel {...props} />);
  await click("查看文件 clean.ts");
  expect(filesToolbar()).toContain("clean.ts");
  expect(props.browser.readProjectDiff).not.toHaveBeenCalled();
  await openTab("变更");
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(3);
  for (const [request] of vi.mocked(props.browser.readProjectDiff).mock.calls)
    expect(request.file.path).not.toBe("/project/clean.ts");
  await openTab("文件");
  expect(filesToolbar()).toContain("clean.ts");
  expect(container.querySelector(".file-code-view")?.textContent).toContain(
    "added",
  );
});

it("已删除文件只在变更页出现：区块显示差异且没有“在文件中打开”；文件页显示指向变更的说明", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  expect(section("/project/app.js").querySelector(".project-diff-view")).not.toBeNull();
  expect(container.querySelector('[aria-label="在文件中打开 app.js"]')).toBeNull();
  expect(container.querySelector('[aria-label="在文件中打开 main.py"]')).not.toBeNull();
  expect(props.browser.readProjectFile).not.toHaveBeenCalled();
  await render(
    <CodeReviewPanel
      {...props}
      requestedFile={{ name: "app.js", path: "/project/app.js", kind: "file" }}
    />,
  );
  expect(container.textContent).toContain("此文件已删除，没有当前源码");
  expect(container.textContent).toContain("请在「变更」中查看删除内容");
});

it("指定目录视图与项目文件分离：点 × 回到项目文件，外部文件不属于变更", async () => {
  const props = fixture();
  vi.mocked(props.browser.listProjectDirectory).mockImplementation(
    async (path) => [
      { name: "item.ts", path: `${path}/item.ts`, kind: "file" },
    ],
  );
  await render(
    <CodeReviewPanel
      {...props}
      requestedFile={{ name: "outside", path: "/outside", kind: "directory" }}
    />,
  );
  expect(container.textContent).toContain("指定目录 · /outside");
  await click("查看文件 item.ts");
  expect(props.browser.readProjectFile).toHaveBeenLastCalledWith(
    "/outside/item.ts",
  );
  await click("返回项目文件");
  expect(props.browser.listProjectDirectory).toHaveBeenLastCalledWith(
    "/project",
  );
  expect(filesToolbar()).not.toContain("item.ts");
  expect(container.textContent).not.toContain("指定目录 ·");
  await openTab("变更");
  expect(section("/project/src/nested/main.py")).not.toBeNull();
  for (const [request] of vi.mocked(props.browser.readProjectDiff).mock.calls)
    expect(request.file.path).not.toBe("/outside/item.ts");
});

it("消息中的项目文件落在文件页并展开父目录，不挂载也不读取变更页", async () => {
  const props = fixture();
  vi.mocked(props.browser.listProjectDirectory).mockImplementation(
    async (path) =>
      path === "/project"
        ? [{ name: "src", path: "/project/src", kind: "directory" }]
        : [{ name: "clean.ts", path: "/project/src/clean.ts", kind: "file" }],
  );
  await render(
    <CodeReviewPanel
      {...props}
      requestedFile={{
        name: "clean.ts",
        path: "/project/src/clean.ts",
        kind: "file",
      }}
    />,
  );
  expect(
    container
      .querySelector('[aria-label="查看文件 clean.ts"]')
      ?.getAttribute("aria-current"),
  ).toBe("true");
  expect(
    container
      .querySelector('[role="tab"][aria-selected="true"]')
      ?.textContent,
  ).toContain("文件");
  expect(container.querySelector(".code-review-changes")).toBeNull();
  expect(props.browser.readProjectDiff).not.toHaveBeenCalled();
});

it("消息指定文件切到文件页的当前源码，覆盖已打开的变更页", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(3);
  await render(
    <CodeReviewPanel
      {...props}
      requestedFile={{
        name: "outside.cpp",
        path: "/other/outside.cpp",
        kind: "file",
      }}
    />,
  );
  expect(
    container
      .querySelector('[role="tab"][aria-selected="true"]')
      ?.textContent,
  ).toContain("文件");
  expect(props.browser.readProjectFile).toHaveBeenLastCalledWith(
    "/other/outside.cpp",
  );
  // 变更页被隐藏后不再为刷新发起新的差异读取。
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(3);
  expect(container.querySelector(".file-code-view")?.textContent).toContain(
    "added",
  );
});

it("变更树保留多级父目录和兄弟文件，折叠再展开恢复子树，提供类型与状态图标", async () => {
  await render(<CodeReviewPanel {...fixture()} />);
  await openTab("变更");
  expect(container.querySelector('[aria-label="Python 文件"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="React 文件"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="修改"]')).not.toBeNull();
  expect(
    container.querySelector('[aria-label="未跟踪（新增）"]'),
  ).not.toBeNull();
  expect(container.querySelector('[aria-label="删除"]')).not.toBeNull();
  await click("展开或折叠目录 nested");
  expect(container.querySelector('[aria-label="查看文件 main.py"]')).toBeNull();
  expect(
    container.querySelector('[aria-label="查看文件 view.tsx"]'),
  ).not.toBeNull();
  await click("展开或折叠目录 src");
  expect(
    container.querySelector('[aria-label="查看文件 view.tsx"]'),
  ).toBeNull();
  expect(
    container.querySelector('[aria-label="查看文件 app.js"]'),
  ).not.toBeNull();
  await click("展开或折叠目录 src");
  expect(container.querySelector('[aria-label="查看文件 main.py"]')).toBeNull();
  await click("展开或折叠目录 nested");
  expect(
    container.querySelector('[aria-label="查看文件 main.py"]'),
  ).not.toBeNull();
});

it("并排对齐增删与空位，切换单栏后同时显示旧新内容和双行号，不重新读取", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  const main = section("/project/src/nested/main.py");
  const before = main.querySelector('[aria-label="修改前"]')!;
  const after = main.querySelector('[aria-label="修改后"]')!;
  expect(before.querySelectorAll(".deletion")).toHaveLength(1);
  expect(after.querySelectorAll(".addition")).toHaveLength(2);
  expect(before.querySelectorAll(".gap")).toHaveLength(1);
  expect(main.querySelector(".project-diff-added")?.textContent).toBe("+2");
  expect(main.querySelector(".change-stat-added")?.textContent).toBe("+2");
  await act(() =>
    container.querySelector<HTMLButtonElement>("[data-diff-layout]")!.click(),
  );
  const unified = main.querySelector('[aria-label="单栏差异"]')!;
  expect(unified.textContent).toContain("old");
  expect(unified.textContent).toContain("new");
  expect(unified.querySelector('[data-old-line="3"]')).not.toBeNull();
  expect(unified.querySelector('[data-new-line="4"]')).not.toBeNull();
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(3);
});

it("Git 失败明确显示错误，不假装没有修改；文件页不受影响", async () => {
  const props = fixture();
  vi.mocked(props.browser.listProjectChanges).mockRejectedValueOnce(
    new Error("Git 不可用"),
  );
  await render(<CodeReviewPanel {...props} />);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await openTab("变更");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Git 不可用",
  );
  expect(container.textContent).not.toContain("没有变更");
});

it("文件页直接读取文件，不挂载变更页也不启动 Diff 计算", async () => {
  const props = fixture();
  vi.mocked(props.browser.listProjectDirectory).mockResolvedValue([
    changes.files[0],
  ]);
  await render(<CodeReviewPanel {...props} />);
  await click("查看文件 main.py");
  expect(props.browser.readProjectFile).toHaveBeenCalledWith(
    changes.files[0].path,
  );
  expect(props.browser.readProjectDiff).not.toHaveBeenCalled();
  expect(container.querySelector(".file-code-view")?.textContent).toContain(
    "new",
  );
});

it("刷新保留目录折叠状态，并清除提交后过期的重命名基线", async () => {
  const props = fixture();
  const renamed = {
    ...changes.files[0],
    change: "renamed" as const,
    previousPath: "/project/old.py",
  };
  vi.mocked(props.browser.listProjectChanges).mockResolvedValueOnce({
    ...changes,
    files: [renamed, ...changes.files.slice(1)],
  });
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  expect(section(renamed.path)).not.toBeNull();
  await click("展开或折叠目录 nested");
  vi.mocked(props.browser.listProjectChanges).mockResolvedValue({
    ...changes,
    base: "b".repeat(40),
    files: changes.files.slice(1),
  });
  await click("刷新变更与差异");
  expect(container.querySelector(".project-diff")).toBeNull();
  expect(section("/project/src/nested/main.py")).toBeNull();
  vi.mocked(props.browser.listProjectChanges).mockResolvedValue(changes);
  await click("刷新变更与差异");
  expect(container.querySelector('[aria-label="查看文件 main.py"]')).toBeNull();
  expect(
    container.querySelector('[aria-label="查看文件 view.tsx"]'),
  ).not.toBeNull();
});

it("刷新失败保留原目录与区块并明确报错", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  await click("展开或折叠目录 nested");
  vi.mocked(props.browser.listProjectChanges).mockRejectedValue(
    new Error("Git 读取失败"),
  );
  await click("刷新变更与差异");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Git 读取失败",
  );
  expect(container.textContent).toContain("刷新失败");
  expect(container.querySelector('[aria-label="查看文件 main.py"]')).toBeNull();
  expect(
    container.querySelector('[aria-label="查看文件 view.tsx"]'),
  ).not.toBeNull();
  expect(section("/project/src/view.tsx")).not.toBeNull();
});
