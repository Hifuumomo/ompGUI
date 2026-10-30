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
async function selectMode(mode: string) {
  const button =
    container.querySelector<HTMLButtonElement>("[data-diff-mode]")!;
  if (button.getAttribute("aria-disabled") === "true") {
    await act(() => button.click());
    return;
  }
  for (let step = 0; step < 3 && button.dataset.diffMode !== mode; step++) {
    await act(() => button.click());
  }
  expect(button.dataset.diffMode).toBe(mode);
}

async function scope(label: string) {
  await act(() =>
    [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".project-tree-modes button",
      ),
    ]
      .find((button) => button.getAttribute("aria-label") === label)!
      .click(),
  );
}

it("显示模式图标按并排、单栏、全部源码循环，聚焦提示随状态更新", async () => {
  await render(<CodeReviewPanel {...fixture()} />);
  await click("查看文件 main.py");
  const button =
    container.querySelector<HTMLButtonElement>("[data-diff-mode]")!;
  await act(() => button.focus());
  for (const [mode, label, next] of [
    ["split", "并排 Diff", "单栏 Diff"],
    ["unified", "单栏 Diff", "全部源码"],
    ["source", "全部源码", "并排 Diff"],
  ]) {
    expect(button.dataset.diffMode).toBe(mode);
    expect(button.getAttribute("aria-label")).toBe(`差异显示方式：${label}`);
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
      `${label}；点击切换为${next}`,
    );
    await act(() => button.click());
  }
  expect(button.dataset.diffMode).toBe("split");
  expect(container.querySelector("select")).toBeNull();
});

it("全部文件默认源码，切回变更清除范围外选择，不能对未变更文件启动 Diff", async () => {
  const props = fixture();
  vi.mocked(props.browser.listProjectDirectory).mockResolvedValue([
    { name: "clean.ts", path: "/project/clean.ts", kind: "file" },
  ]);
  await render(<CodeReviewPanel {...props} />);
  await click("查看文件 main.py");
  await scope("全部文件");
  expect(
    container.querySelector<HTMLElement>("[data-diff-mode]")?.dataset.diffMode,
  ).toBe("source");
  await click("查看文件 clean.ts");
  expect(
    container.querySelector("[data-diff-mode]")?.getAttribute("aria-disabled"),
  ).toBe("true");
  await selectMode("split");
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(1);
  await scope("已更改");
  expect(
    container.querySelector(".code-review-toolbar")?.textContent,
  ).not.toContain("clean.ts");
  expect(container.querySelector(".file-code-view")).toBeNull();
});

it("已删除文件源码模式显示说明而不读取不存在的文件", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await click("查看文件 app.js");
  await selectMode("source");
  expect(container.textContent).toContain("此文件已删除，没有当前源码");
  expect(props.browser.readProjectFile).not.toHaveBeenCalled();
  await selectMode("unified");
  expect(container.querySelector('[aria-label="单栏差异"]')).not.toBeNull();
  await scope("全部文件");
  expect(
    container.querySelector(".code-review-toolbar")?.textContent,
  ).not.toContain("app.js");
});

it("外部目录和项目范围分离，外部文件不可使用项目 Diff", async () => {
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
  await click("查看文件 item.ts");
  expect(props.browser.readProjectFile).toHaveBeenLastCalledWith(
    "/outside/item.ts",
  );
  await selectMode("split");
  expect(props.browser.readProjectDiff).not.toHaveBeenCalled();
  await scope("全部文件");
  expect(props.browser.listProjectDirectory).toHaveBeenLastCalledWith(
    "/project",
  );
  expect(
    container.querySelector(".code-review-toolbar")?.textContent,
  ).not.toContain("item.ts");
  await scope("已更改");
  await click("查看文件 main.py");
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(1);
  await scope("指定目录");
  expect(
    container.querySelector('[aria-label="展开或折叠目录 outside"]'),
  ).not.toBeNull();
  expect(
    container.querySelector(".code-review-toolbar")?.textContent,
  ).not.toContain("main.py");
});

it("消息中的项目文件自动切换全部文件并展开父目录", async () => {
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
    container.querySelector<HTMLElement>("[data-diff-mode]")?.dataset.diffMode,
  ).toBe("source");
  expect(props.browser.readProjectDiff).not.toHaveBeenCalled();
});

it("消息指定文件切到当前源码，覆盖已打开的 Git 差异选择", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await click("查看文件 main.py");
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(1);
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
    container.querySelector<HTMLElement>("[data-diff-mode]")?.dataset.diffMode,
  ).toBe("source");
  expect(props.browser.readProjectFile).toHaveBeenLastCalledWith(
    "/other/outside.cpp",
  );
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(1);
  expect(container.querySelector(".file-code-view")?.textContent).toContain(
    "added",
  );
});

it("变更树保留多级父目录和兄弟文件，折叠再展开恢复子树，提供类型与状态图标", async () => {
  await render(<CodeReviewPanel {...fixture()} />);
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
  await click("查看文件 main.py");
  const before = container.querySelector('[aria-label="修改前"]')!;
  const after = container.querySelector('[aria-label="修改后"]')!;
  expect(before.querySelectorAll(".deletion")).toHaveLength(1);
  expect(after.querySelectorAll(".addition")).toHaveLength(2);
  expect(before.querySelectorAll(".gap")).toHaveLength(1);
  expect(container.querySelector(".project-diff-added")?.textContent).toBe(
    "+2",
  );
  await selectMode("unified");
  const unified = container.querySelector('[aria-label="单栏差异"]')!;
  expect(unified.textContent).toContain("old");
  expect(unified.textContent).toContain("new");
  expect(unified.querySelector('[data-old-line="3"]')).not.toBeNull();
  expect(unified.querySelector('[data-new-line="4"]')).not.toBeNull();
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(1);
  await selectMode("source");
  expect(container.querySelector(".file-code-view")?.textContent).not.toContain(
    "old",
  );
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(1);
});

it("Git 失败明确显示错误，不假装没有修改", async () => {
  const props = fixture();
  vi.mocked(props.browser.listProjectChanges).mockRejectedValueOnce(
    new Error("Git 不可用"),
  );
  await render(<CodeReviewPanel {...props} />);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Git 不可用",
  );
  expect(container.textContent).not.toContain("工作区没有未提交变更");
});

it("源码模式直接读取文件，不等待或启动 Diff 计算", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await selectMode("source");
  await click("查看文件 main.py");
  expect(props.browser.readProjectFile).toHaveBeenCalledWith(
    changes.files[0].path,
  );
  expect(props.browser.readProjectDiff).not.toHaveBeenCalled();
  expect(container.querySelector(".file-code-view")?.textContent).toContain(
    "new",
  );
});

it("刷新保留折叠状态，并清除提交后过期的重命名基线", async () => {
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
  await click("查看文件 main.py");
  await click("展开或折叠目录 nested");
  vi.mocked(props.browser.listProjectChanges).mockResolvedValue({
    ...changes,
    base: "b".repeat(40),
    files: changes.files.slice(1),
  });
  await click("刷新项目代码");
  expect(container.querySelector(".project-diff")).toBeNull();
  expect(
    container.querySelector(".code-review-toolbar")?.textContent,
  ).not.toContain("main.py");
  vi.mocked(props.browser.listProjectChanges).mockResolvedValue(changes);
  await click("刷新项目代码");
  expect(container.querySelector('[aria-label="查看文件 main.py"]')).toBeNull();
  expect(
    container.querySelector('[aria-label="查看文件 view.tsx"]'),
  ).not.toBeNull();
});

it("刷新失败保留原目录并明确报错", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await click("展开或折叠目录 nested");
  vi.mocked(props.browser.listProjectChanges).mockRejectedValue(
    new Error("Git 读取失败"),
  );
  await click("刷新项目代码");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Git 读取失败",
  );
  expect(container.querySelector('[aria-label="查看文件 main.py"]')).toBeNull();
  expect(
    container.querySelector('[aria-label="查看文件 view.tsx"]'),
  ).not.toBeNull();
});
