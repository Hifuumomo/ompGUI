import { act } from "react";
import { expect, it, vi } from "vitest";
import { container, render } from "./transcript-test-harness";
import { CodeReviewPanel } from "./CodeReviewPanel";
import type {
  ProjectBrowser,
  ProjectReview,
} from "../../shared/project-browser";

function fixture() {
  const browser: ProjectBrowser & ProjectReview = {
    listProjectChanges: async (cwd) => ({
      kind: "plain",
      root: cwd,
      base: null,
      files: [],
    }),
    readProjectDiff: vi.fn(),
    listProjectDirectory: vi.fn<ProjectBrowser["listProjectDirectory"]>(
      async (path) =>
        path === "/project"
          ? [
              { name: "src", path: "/project/src", kind: "directory" },
              { name: "other.ts", path: "/project/other.ts", kind: "file" },
            ]
          : [{ name: "main.ts", path: "/project/src/main.ts", kind: "file" }],
    ),
    readProjectFile: vi.fn(
      async (path) => `// ${path}\nconst hello = '你好';\n`,
    ),
    readProjectImage: vi.fn(),
  };
  const props = {
    cwd: "/project",
    browser,
    suspended: false,
    onClose: vi.fn(),
  };
  return props;
}

it("定位项目外目录，展开并高亮，重复请求恢复文件栏且不读取目录源码", async () => {
  const props = fixture();
  props.browser.listProjectChanges = vi.fn(async () => {
    throw new Error("项目不可用");
  });
  const directory = {
    name: "教程",
    path: "D:\\Game\\教程",
    kind: "directory" as const,
  };
  await render(<CodeReviewPanel {...props} requestedFile={directory} />);
  const row = () =>
    container.querySelector('[aria-label="展开或折叠目录 教程"]');
  expect(row()?.getAttribute("aria-current")).toBe("true");
  expect(row()?.getAttribute("aria-expanded")).toBe("true");
  expect(row()?.classList.contains("project-tree-reveal")).toBe(true);
  expect(props.browser.listProjectDirectory).toHaveBeenCalledWith(
    directory.path,
  );
  expect(props.browser.readProjectFile).not.toHaveBeenCalled();
  await click("展开或折叠目录 教程");
  await click("显示项目文件");
  await render(<CodeReviewPanel {...props} requestedFile={{ ...directory }} />);
  expect(row()?.getAttribute("aria-expanded")).toBe("true");
  expect(
    container.querySelector<HTMLElement>(".code-review-files")?.hidden,
  ).toBe(false);
  expect(props.browser.readProjectFile).not.toHaveBeenCalled();
});

async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(
    `[aria-label="${label}"]`,
  );
  expect(button).not.toBeNull();
  await act(() => button!.click());
}

it("标准操作使用图标，并在悬停和聚焦时显示状态说明与已有快捷键", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  const buttons = container.querySelectorAll<HTMLButtonElement>(
    ".code-review-header .review-icon-button, .code-review-toolbar .review-icon-button",
  );
  expect(buttons).toHaveLength(5);
  for (const button of buttons) {
    expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(button.textContent).toBe("");
    await act(() => button.focus());
    const tooltip = container.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe(tooltip?.id);
    await act(() => button.blur());
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  }
  const refresh = buttons[0];
  await act(() =>
    refresh.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
    "刷新目录与当前文件",
  );
  await act(() => refresh.focus());
  await act(() =>
    refresh.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })),
  );
  expect(container.querySelector('[role="tooltip"]')).not.toBeNull();
  await act(() => buttons[1].focus());
  await click("全屏显示文件与变更");
  expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
    "退出全屏",
  );
  await act(() => buttons[2].focus());
  expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
    "关闭文件与变更（Esc）",
  );
  await act(() => buttons[3].focus());
  await click("显示项目文件");
  expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
    "展开项目文件栏",
  );
  expect(
    container.querySelector<HTMLElement>(".code-review-files")?.hidden,
  ).toBe(true);
  await act(() => buttons[4].focus());
  await click("自动换行");
  expect(buttons[4].getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector('[role="tooltip"]')?.textContent).toBe(
    "关闭自动换行",
  );
});

it("当前项目根目录不生成重复目录行或路径标题", async () => {
  const props = fixture();
  await render(
    <CodeReviewPanel
      {...props}
      requestedFile={{ name: "project", path: "/project/", kind: "directory" }}
    />,
  );
  expect(
    container.querySelector('[aria-label="展开或折叠目录 project"]'),
  ).toBeNull();
  expect(container.querySelector(".project-tree-root")?.textContent).toContain(
    "项目文件",
  );
  expect(
    container.querySelector(".project-tree-root")?.textContent,
  ).not.toContain("/project");
  expect(
    container.querySelector('[aria-label="展开或折叠目录 src"]'),
  ).not.toBeNull();
  expect(props.browser.readProjectFile).not.toHaveBeenCalled();
});

it("浏览子目录并展示真实行号，侧栏和全屏切换保留文件与滚动位置", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await click("展开或折叠目录 src");
  await click("查看文件 main.ts");
  const source = container.querySelector<HTMLElement>(".code-review-source")!;
  expect(source.textContent).toContain("const hello = '你好';");
  expect(source.querySelector('[data-line="2"]')).not.toBeNull();
  source.scrollTop = 120;
  await click("全屏显示文件与变更");
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.querySelector(".code-review-source")).toBe(source);
  expect(source.scrollTop).toBe(120);
  await click("侧栏显示文件与变更");
  expect(container.querySelector('[role="region"]')).not.toBeNull();
  expect(props.browser.readProjectFile).toHaveBeenCalledTimes(1);
  await click("展开或折叠目录 src");
  expect(container.querySelector('[aria-label="查看文件 main.ts"]')).toBeNull();
  expect(
    container.querySelector('[aria-label="查看文件 other.ts"]'),
  ).not.toBeNull();
});

it("文件加载失败明确显示，刷新后读取最新磁盘内容", async () => {
  const props = fixture();
  vi.mocked(props.browser.readProjectFile).mockRejectedValueOnce(
    new Error("文件已删除"),
  );
  await render(<CodeReviewPanel {...props} />);
  await click("查看文件 other.ts");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "文件已删除",
  );
  await click("刷新项目代码");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector(".file-code-view")?.textContent).toContain(
    "const hello",
  );
  expect(props.browser.listProjectDirectory).toHaveBeenCalledTimes(2);
});

it("项目状态读取失败仍能预览消息指定的绝对路径文件", async () => {
  const props = fixture();
  props.browser.listProjectChanges = vi.fn(async () => {
    throw new Error("原项目目录已移动");
  });
  await render(
    <CodeReviewPanel
      {...props}
      requestedFile={{
        name: "output.cpp",
        path: "/other/output.cpp",
        kind: "file",
      }}
    />,
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "原项目目录已移动",
  );
  expect(container.querySelector(".file-code-view")?.textContent).toContain(
    "/other/output.cpp",
  );
});

it("快速切换文件时忽略旧请求的延迟结果", async () => {
  const props = fixture();
  let resolveOld!: (value: string) => void;
  vi.mocked(props.browser.readProjectFile).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  await render(<CodeReviewPanel {...props} />);
  await click("查看文件 other.ts");
  await click("展开或折叠目录 src");
  await click("查看文件 main.ts");
  await act(() => resolveOld("不应覆盖的旧内容"));
  expect(container.querySelector(".file-code-view")?.textContent).toContain(
    "/project/src/main.ts",
  );
  expect(container.textContent).not.toContain("不应覆盖");
});

it("审核按键不冒泡到会话，Esc 关闭，关闭后焦点返回入口", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const listener = vi.fn();
  window.addEventListener("keydown", listener);
  const props = fixture();
  try {
    await render(<CodeReviewPanel {...props} />);
    await act(() =>
      container
        .querySelector(".code-review-panel")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
    await render(null);
    expect(document.activeElement).toBe(trigger);
  } finally {
    trigger.remove();
    window.removeEventListener("keydown", listener);
  }
});
