import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { container, render } from "./transcript-test-harness";
import { CodeReviewPanel } from "./CodeReviewPanel";
import { PromptContexts, type PromptContextActions } from "./PromptContexts";
import type {
  ProjectBrowser,
  ProjectChanges,
  ProjectDiff,
  ProjectEntry,
  ProjectReview,
} from "../../shared/project-browser";

function file(path: string, change: ProjectEntry["change"] = "modified"): ProjectEntry {
  return { name: path.split("/").pop()!, path, kind: "file", change };
}
const A = "/project/a.ts";
const B = "/project/src/b.ts";
const C = "/project/src/c.ts";
// 目录在前、文件在后：目录栏与区块的顺序是 b、c、a。
const three = [file(A), file(B), file(C)];
const diff: ProjectDiff = {
  before: "old\n",
  after: "new\n",
  rows: [
    { kind: "deletion", text: "old", ending: "\n", oldLine: 1 },
    { kind: "addition", text: "new", ending: "\n", newLine: 1 },
  ],
};
function gitChanges(files: readonly ProjectEntry[]): ProjectChanges {
  return { kind: "git", root: "/project", base: "base", files };
}
function fixture(files: readonly ProjectEntry[] = three) {
  const browser: ProjectBrowser & ProjectReview = {
    listProjectChanges: vi.fn(async () => gitChanges(files)),
    readProjectDiff: vi.fn(async () => diff),
    listProjectDirectory: vi.fn(async () => []),
    readProjectFile: vi.fn(async () => "text\n"),
    readProjectImage: vi.fn(),
  };
  return { cwd: "/project", browser, suspended: false, onClose: vi.fn() };
}

/** 可手动触发的 IntersectionObserver；用 rootMargin 区分预读观察器与当前文件观察器。 */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this);
  }
  observe(element: Element) { this.targets.add(element); }
  unobserve(element: Element) { this.targets.delete(element); }
  disconnect() { this.targets.clear(); }
}
beforeEach(() => { FakeObserver.instances = []; });
afterEach(() => vi.unstubAllGlobals());
function useFakeObserver() {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
}
async function intersect(kind: "near" | "current", path: string, isIntersecting = true) {
  const margin = kind === "near" ? "100% 0px" : "0px 0px -80% 0px";
  const observer = FakeObserver.instances.filter((item) => item.options?.rootMargin === margin).at(-1)!;
  expect(observer).toBeDefined();
  await act(() => observer.callback(
    [{ target: section(path), isIntersecting } as unknown as IntersectionObserverEntry],
    observer as unknown as IntersectionObserver,
  ));
}

async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  expect(button, label).not.toBeNull();
  await act(() => button!.click());
}
function tabs() {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}
async function openTab(name: string) {
  await act(() => tabs().find((item) => item.textContent?.startsWith(name))!.click());
}
function selectedTab() {
  return container.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";
}
function section(path: string) {
  return container.querySelector<HTMLElement>(`[data-change-path="${path}"]`)!;
}
function row(name: string) {
  return container.querySelector(`[aria-label="查看文件 ${name}"]`);
}
function filesToolbar() {
  return container.querySelector(".code-review-toolbar")!.textContent;
}

it("默认打开文件页，变更标签的徽标显示数量，超过 99 显示 99+，加载中不显示", async () => {
  const props = fixture();
  const pending = Promise.withResolvers<ProjectChanges>();
  vi.mocked(props.browser.listProjectChanges).mockImplementationOnce(() => pending.promise);
  await render(<CodeReviewPanel {...props} />);
  expect(selectedTab()).toContain("文件");
  expect(container.querySelector(".review-tab-count")).toBeNull();
  await act(() => pending.resolve(gitChanges(three)));
  expect(container.querySelector(".review-tab-count")?.textContent).toBe("3");
  const many = Array.from({ length: 100 }, (_, index) => file(`/project/f${index}.ts`));
  vi.mocked(props.browser.listProjectChanges).mockResolvedValue(gitChanges(many));
  await click("刷新项目代码");
  expect(container.querySelector(".review-tab-count")?.textContent).toBe("99+");
});

it("标签支持左右方向键与 Home，roving tabindex 随选中项移动", async () => {
  await render(<CodeReviewPanel {...fixture()} />);
  expect(tabs().map((item) => item.tabIndex)).toEqual([0, -1]);
  const press = (key: string) => act(() => document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
  await act(() => tabs()[0].focus());
  await press("ArrowRight");
  expect(selectedTab()).toContain("变更");
  expect(tabs().map((item) => item.tabIndex)).toEqual([-1, 0]);
  expect(document.activeElement).toBe(tabs()[1]);
  await press("Home");
  expect(selectedTab()).toContain("文件");
  expect(document.activeElement).toBe(tabs()[0]);
});

it("收起目录栏后仍能切换标签", async () => {
  await render(<CodeReviewPanel {...fixture()} />);
  await click("显示项目文件");
  expect(container.querySelector<HTMLElement>(".code-review-files")!.hidden).toBe(true);
  await openTab("变更");
  expect(selectedTab()).toContain("变更");
  await openTab("文件");
  expect(selectedTab()).toContain("文件");
});

it("变更读取中或失败时，文件页仍可浏览目录和源码，错误只出现在变更页", async () => {
  for (const mode of ["loading", "error"] as const) {
    const props = fixture();
    vi.mocked(props.browser.listProjectDirectory).mockResolvedValue([
      { name: "x.ts", path: "/project/x.ts", kind: "file" },
    ]);
    vi.mocked(props.browser.listProjectChanges).mockImplementation(() =>
      mode === "loading" ? new Promise(() => {}) : Promise.reject(new Error("坏了")));
    await render(<CodeReviewPanel {...props} />);
    await click("查看文件 x.ts");
    expect(container.querySelector(".file-code-view")?.textContent).toContain("text");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await openTab("变更");
    expect(container.querySelector(".code-review-changes")?.textContent).toContain(
      mode === "loading" ? "正在读取项目变更" : "坏了");
    await render(null);
  }
});

it("非 Git 项目的“变更”置灰并给出原因，打开时停在文件页", async () => {
  const props = fixture();
  vi.mocked(props.browser.listProjectChanges).mockResolvedValue({
    kind: "plain", root: "/project", base: null, files: [],
  });
  await render(<CodeReviewPanel {...props} />);
  const changesTab = tabs().find((item) => item.textContent?.startsWith("变更"))!;
  expect(changesTab.getAttribute("aria-disabled")).toBe("true");
  expect(changesTab.title).toBe("非 Git 项目，无 Git 差异");
  await act(() => changesTab.click());
  expect(selectedTab()).toContain("文件");
  expect(container.querySelector(".code-review-changes")).toBeNull();
});

it("当前来源下没有变更时显示空状态和“查看文件”按钮", async () => {
  await render(<CodeReviewPanel {...fixture([])} />);
  await openTab("变更");
  const page = container.querySelector(".code-review-changes")!;
  expect(page.textContent).toContain("没有变更");
  expect(page.textContent).toContain("未提交");
  const button = [...page.querySelectorAll<HTMLButtonElement>("button")]
    .find((item) => item.textContent === "查看文件")!;
  await act(() => button.click());
  expect(selectedTab()).toContain("文件");
});

it("离屏区块只渲染标题和占位（不使用 status），进入视口附近才读取差异", async () => {
  useFakeObserver();
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  expect(props.browser.readProjectDiff).not.toHaveBeenCalled();
  for (const path of [A, B, C]) {
    expect(section(path).querySelector(".change-section-placeholder")).not.toBeNull();
    expect(section(path).querySelector('[role="status"]')).toBeNull();
  }
  await intersect("near", C);
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(1);
  expect(vi.mocked(props.browser.readProjectDiff).mock.calls[0][0].file.path).toBe(C);
  expect(section(C).querySelector(".project-diff-view")).not.toBeNull();
  // 离开视口后保留已读取的结果，不重复读取。
  await intersect("near", C, false);
  await intersect("near", C, true);
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(1);
});

it("差异读取并发有上限，有空位后继续读取", async () => {
  const files = Array.from({ length: 6 }, (_, index) => file(`/project/f${index}.ts`));
  const props = fixture(files);
  const pending = files.map(() => Promise.withResolvers<ProjectDiff>());
  let calls = 0;
  vi.mocked(props.browser.readProjectDiff).mockImplementation(() => pending[calls++].promise);
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(3);
  await act(() => pending[0].resolve(diff));
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(4);
});

it("折叠区块保留已读取的结果，再展开不重新读取", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(3);
  await click("折叠文件差异 a.ts");
  expect(section(A).dataset.collapsed).toBe("true");
  expect(section(A).querySelector(".project-diff-view")).toBeNull();
  await click("展开文件差异 a.ts");
  expect(section(A).querySelector(".project-diff-view")).not.toBeNull();
  expect(props.browser.readProjectDiff).toHaveBeenCalledTimes(3);
});

it("点击目录栏的文件会展开已折叠的区块并滚动到它", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  const scroll = vi.fn();
  Object.defineProperty(section(A), "scrollIntoView", { configurable: true, value: scroll });
  await click("折叠文件差异 a.ts");
  expect(section(A).dataset.collapsed).toBe("true");
  await click("查看文件 a.ts");
  expect(scroll).toHaveBeenCalled();
  expect(section(A).dataset.collapsed).toBe("false");
  expect(row("a.ts")?.getAttribute("aria-current")).toBe("true");
});

it("右侧滚动时目录栏高亮跟随当前文件，程序化滚动期间不跳动", async () => {
  useFakeObserver();
  await render(<CodeReviewPanel {...fixture()} />);
  await openTab("变更");
  await intersect("current", C);
  expect(row("c.ts")?.getAttribute("aria-current")).toBe("true");
  await click("查看文件 a.ts");
  expect(row("a.ts")?.getAttribute("aria-current")).toBe("true");
  await intersect("current", B);
  expect(row("a.ts")?.getAttribute("aria-current")).toBe("true");
  expect(row("b.ts")?.getAttribute("aria-current")).toBeNull();
  // 滚动停止后恢复跟随：取顶部可见的第一个文件。
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
  expect(row("b.ts")?.getAttribute("aria-current")).toBe("true");
  expect(row("a.ts")?.getAttribute("aria-current")).toBeNull();
});

it("筛选只过滤目录树和区块；在筛选结果里点文件不会清掉筛选词", async () => {
  await render(<CodeReviewPanel {...fixture()} />);
  await openTab("变更");
  const filter = container.querySelector<HTMLInputElement>('[aria-label="筛选变更文件"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(filter, "c.ts");
    filter.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(section(C)).not.toBeNull();
  expect(section(A)).toBeNull();
  expect(section(B)).toBeNull();
  await click("查看文件 c.ts");
  expect(filter.value).toBe("c.ts");
  expect(section(C)).not.toBeNull();
});

it("标签切换后各页的展开状态和筛选词都保留", async () => {
  const props = fixture();
  vi.mocked(props.browser.listProjectDirectory).mockImplementation(async (path) =>
    path === "/project" ? [{ name: "src", path: "/project/src", kind: "directory" }] : []);
  await render(<CodeReviewPanel {...props} />);
  await click("展开或折叠目录 src");
  const filesTree = container.querySelector('.code-review-files [aria-label="展开或折叠目录 src"]')!;
  expect(filesTree.getAttribute("aria-expanded")).toBe("true");
  await openTab("变更");
  const filter = container.querySelector<HTMLInputElement>('[aria-label="筛选变更文件"]')!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(filter, "a.ts");
    filter.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await openTab("文件");
  expect(filesTree.isConnected).toBe(true);
  expect(filesTree.getAttribute("aria-expanded")).toBe("true");
  await openTab("变更");
  expect(filter.value).toBe("a.ts");
});

it("折叠所有文件是开关：全部折叠、全部展开，单独展开一个后图标恢复", async () => {
  await render(<CodeReviewPanel {...fixture()} />);
  await openTab("变更");
  const sections = () => [...container.querySelectorAll<HTMLElement>(".change-section")];
  expect(sections()).toHaveLength(3);
  await click("折叠所有文件");
  expect(sections().every((item) => item.dataset.collapsed === "true")).toBe(true);
  expect(container.querySelector('[aria-label="展开所有文件"]')).not.toBeNull();
  await click("展开所有文件");
  expect(sections().every((item) => item.dataset.collapsed === "false")).toBe(true);
  await click("折叠所有文件");
  await click("展开文件差异 a.ts");
  expect(container.querySelector('[aria-label="折叠所有文件"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="展开所有文件"]')).toBeNull();
});

it("单个文件读取失败只影响自己的区块，行数显示为 —", async () => {
  const props = fixture();
  vi.mocked(props.browser.readProjectDiff).mockImplementation(async ({ file: entry }) => {
    if (entry.path === B) throw new Error("读取坏了");
    return diff;
  });
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  expect(section(B).querySelector('[role="alert"]')?.textContent).toBe("读取坏了");
  expect(section(B).querySelector(".change-stats")?.textContent).toBe("—");
  expect(section(C).querySelector(".project-diff-view")).not.toBeNull();
  expect(section(A).querySelector(".project-diff-view")).not.toBeNull();
});

it("图片文件区块不读取文本差异，保留“在文件中打开”", async () => {
  const png = file("/project/logo.png");
  const props = fixture([png, file(A)]);
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  expect(section(png.path).textContent).toContain("图片文件，不显示文本差异");
  expect(section(png.path).querySelector(".change-stats")?.textContent).toBe("—");
  expect(container.querySelector('[aria-label="在文件中打开 logo.png"]')).not.toBeNull();
  for (const [request] of vi.mocked(props.browser.readProjectDiff).mock.calls)
    expect(request.file.path).not.toBe(png.path);
});

it("“在文件中打开”切到文件页并选中该文件", async () => {
  const props = fixture();
  await render(<CodeReviewPanel {...props} />);
  await openTab("变更");
  await click("在文件中打开 a.ts");
  expect(selectedTab()).toContain("文件");
  expect(filesToolbar()).toContain("a.ts");
  expect(props.browser.readProjectFile).toHaveBeenCalledWith(A);
});

it("折叠箭头的展开与折叠状态和 aria-expanded 一致", async () => {
  await render(<CodeReviewPanel {...fixture()} />);
  await openTab("变更");
  const chevron = (element: Element | null) =>
    element?.querySelector(".tree-chevron")?.getAttribute("data-open");
  const directory = () => container.querySelector('[aria-label="展开或折叠目录 src"]');
  expect(directory()?.getAttribute("aria-expanded")).toBe("true");
  expect(chevron(directory())).toBe("true");
  await click("展开或折叠目录 src");
  expect(directory()?.getAttribute("aria-expanded")).toBe("false");
  expect(chevron(directory())).toBe("false");
  const toggle = () => container.querySelector('[aria-label$="文件差异 a.ts"]');
  expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
  expect(chevron(toggle())).toBe("true");
  await click("折叠文件差异 a.ts");
  expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
  expect(chevron(toggle())).toBe("false");
});

// ---- 右键菜单 ----
function stubDesktop(entry: ProjectEntry = file(A)) {
  const desktop = {
    resolveProjectFileLink: vi.fn(async () => entry),
    listFileOpeners: vi.fn(async () => []),
    runFileAction: vi.fn(async () => {}),
  };
  vi.stubGlobal("desktop", desktop);
  return desktop;
}
function menuItems() {
  return [...document.body.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
}
async function renderWithActions(props: ReturnType<typeof fixture>) {
  const actions = { comment: vi.fn<PromptContextActions["comment"]>(), append: vi.fn<PromptContextActions["append"]>() };
  await render(<PromptContexts.Provider value={actions}><CodeReviewPanel {...props} /></PromptContexts.Provider>);
  return actions;
}
const contextMenu = () => new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

it("变更页目录栏右键、区块 ⋯ 与键盘都能打开同一个文件菜单，并按当前来源添加 diff", async () => {
  stubDesktop();
  const props = fixture();
  const actions = await renderWithActions(props);
  await openTab("变更");
  await act(() => row("a.ts")!.dispatchEvent(contextMenu()));
  expect(menuItems()).toEqual(expect.arrayContaining([
    "打开文件", "打开方式", "另存为…", "复制路径", "复制文件内容", "在资源管理器中打开", "评论文件", "添加 Git diff 到提示词",
  ]));
  await openTab("文件");
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
  await openTab("变更");
  await click("文件菜单 a.ts");
  expect(menuItems()).toContain("添加 Git diff 到提示词");
  await act(() => [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find((item) => item.textContent === "添加 Git diff 到提示词")!.click());
  expect(actions.append.mock.calls[0][0]).toMatchObject({ kind: "diff", path: A, base: "base", side: "unified" });
  await act(() => container.querySelector('[aria-label="折叠文件差异 a.ts"]')!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true })));
  expect(menuItems()).toContain("评论文件");
});

it("文件页只有变更文件才有“添加 Git diff”，切换标签会关闭已打开的菜单", async () => {
  const desktop = stubDesktop();
  const props = fixture();
  vi.mocked(props.browser.listProjectDirectory).mockResolvedValue([
    file(A), { name: "clean.ts", path: "/project/clean.ts", kind: "file" },
  ]);
  await renderWithActions(props);
  desktop.resolveProjectFileLink.mockResolvedValueOnce({ name: "clean.ts", path: "/project/clean.ts", kind: "file" });
  await act(() => row("clean.ts")!.dispatchEvent(contextMenu()));
  expect(menuItems()).toContain("评论文件");
  expect(menuItems()).not.toContain("添加 Git diff 到提示词");
  await openTab("变更");
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
  await openTab("文件");
  await act(() => row("a.ts")!.dispatchEvent(contextMenu()));
  expect(menuItems()).toContain("添加 Git diff 到提示词");
});

it("全屏时 Tab 在可见控件内循环，不会落到隐藏的页面里", async () => {
  await render(<CodeReviewPanel {...fixture()} />);
  await click("全屏显示文件与变更");
  await openTab("变更");
  await openTab("文件");
  const selector = 'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), [tabindex="0"]';
  const targets = [...container.querySelectorAll<HTMLElement>(selector)].filter((item) => !item.closest("[hidden]"));
  expect(targets[0].getAttribute("role")).toBe("tab");
  expect(targets[0].getAttribute("aria-selected")).toBe("true");
  await act(() => targets.at(-1)!.focus());
  await act(() => targets.at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(targets[0]);
});
