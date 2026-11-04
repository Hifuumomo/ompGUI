import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { container, render } from "./transcript-test-harness";
import { CodeReviewPanel } from "./CodeReviewPanel";
import type {
  ProjectBrowser,
  ProjectEntry,
  ProjectReview,
} from "../../shared/project-browser";

const main: ProjectEntry = {
  name: "main.ts",
  path: "/project/src/main.ts",
  kind: "file",
};

/** 创建带 src/main.ts 的非 Git 项目面板属性。参数：无。返回值：面板属性。 */
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
          ? [{ name: "src", path: "/project/src", kind: "directory" }]
          : [main],
    ),
    readProjectFile: vi.fn(async () => "const a = 1;\n"),
    readProjectImage: vi.fn(),
  };
  return { cwd: "/project", browser, suspended: false, onClose: vi.fn() };
}

afterEach(() => vi.unstubAllGlobals());

it("点击内容区文件标题，目录栏展开祖先目录并定位高亮该文件", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} requestedFile={main} />);
  const directory = () =>
    container.querySelector('[aria-label="展开或折叠目录 src"]');
  await act(() => directory()!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(directory()?.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector('[aria-label="查看文件 main.ts"]')).toBeNull();

  const title = container.querySelector<HTMLButtonElement>(
    '[aria-label="在目录中定位 main.ts"]',
  );
  expect(title).not.toBeNull();
  await act(() => title!.click());
  await act(async () => {});
  expect(directory()?.getAttribute("aria-expanded")).toBe("true");
  expect(
    container
      .querySelector('[aria-label="查看文件 main.ts"]')
      ?.classList.contains("project-tree-reveal"),
  ).toBe(true);
});

it("右键文件标题打开与目录树文件行一致的菜单", async () => {
  const props = fixture();
  const desktop = {
    resolveProjectFileLink: vi.fn(async () => main),
    listFileOpeners: vi.fn(async () => []),
    runFileAction: vi.fn(async () => {}),
  };
  vi.stubGlobal("desktop", desktop);
  await render(<CodeReviewPanel {...props} requestedFile={main} />);
  const labels = () =>
    [...document.body.querySelectorAll('[role="menu"] > [role="menuitem"]')].map(
      (item) => item.textContent,
    );

  const row = container.querySelector('[aria-label="查看文件 main.ts"]')!;
  await act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  const fromTree = labels();
  expect(fromTree.length).toBeGreaterThan(0);
  await act(() => document.body.querySelector<HTMLElement>('[role="menu"]')!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  ));
  expect(document.body.querySelector('[role="menu"]')).toBeNull();

  const title = container.querySelector('[aria-label="在目录中定位 main.ts"]')!;
  await act(() => title.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  expect(labels()).toEqual(fromTree);
  expect(desktop.resolveProjectFileLink).toHaveBeenLastCalledWith(expect.any(String), "/project");
});

it("同一个变更文件重复点击标题，每次都重新滚动到目录条目", async () => {
  const props = fixture();
  const changed: ProjectEntry = { ...main, change: "modified" };
  props.browser.listProjectChanges = async (cwd) => ({
    kind: "git" as const,
    root: cwd,
    base: "base",
    files: [changed],
  });
  const calls: string[] = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    calls.push(this.getAttribute("aria-label") ?? "");
  };
  try {
    await render(<CodeReviewPanel {...props} requestedFile={main} />);
    const title = () =>
      container.querySelector<HTMLButtonElement>('[aria-label="在目录中定位 main.ts"]')!;
    await act(() => title().click());
    expect(calls).toContain("查看文件 main.ts");
    // 等第一次定位的逐帧校正结束，再确认第二次点击重新触发滚动。
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    calls.length = 0;
    await act(() => title().click());
    expect(calls).toContain("查看文件 main.ts");
  } finally {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});
