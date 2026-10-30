// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import type { BrowserPanelState } from "../../shared/browser";
import { BrowserPanel } from "./BrowserPanel";
import { click, container, render } from "./transcript-test-harness";
import { PromptContexts } from "./PromptContexts";
import type { BrowserPromptContext } from "../../shared/prompt-context";

const initial: BrowserPanelState = { revision: 0, url: "", title: "", loading: false, selectingElement: false, canGoBack: false, canGoForward: false };
let emit: (state: BrowserPanelState) => void;
let resolveInitial: (state: BrowserPanelState) => void;
let bridge: {
  onBrowserState: Mock;
  getBrowserState: Mock;
  setBrowserLayout: Mock;
  browserAction: Mock;
  openBrowser: Mock;
  openExternal: Mock;
  pickBrowserElement: Mock;
  cancelBrowserElementPick: Mock;
};
const close = vi.fn(async () => {});

beforeEach(() => {
  bridge = {
    onBrowserState: vi.fn((listener: typeof emit) => { emit = listener; return vi.fn(); }),
    getBrowserState: vi.fn(() => new Promise<BrowserPanelState>((resolve) => { resolveInitial = resolve; })),
    setBrowserLayout: vi.fn(async () => {}),
    browserAction: vi.fn(async () => {}),
    openBrowser: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
    pickBrowserElement: vi.fn(async () => null),
    cancelBrowserElementPick: vi.fn(async () => {}),
  };
  vi.stubGlobal("desktop", bridge);
  close.mockClear();
  localStorage.clear();
});
afterEach(async () => {
  // 先卸载原生布局消费者，再撤销桌面桥接与 DOM mock。
  await render(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("订阅先于快照且旧 revision 不会回退网页状态", async () => {
  await render(<BrowserPanel contextScope={null} active suspended={false} zoomFactor={1} onClose={close} />);
  expect(bridge.onBrowserState.mock.invocationCallOrder[0]).toBeLessThan(bridge.getBrowserState.mock.invocationCallOrder[0]);
  await act(() => { emit({ ...initial, revision: 4, url: "https://example.com/new", title: "新网页", canGoBack: true }); });
  await act(() => { resolveInitial({ ...initial, revision: 1, url: "https://example.com/old" }); });
  expect(container.querySelector("strong")?.textContent).toBe("新网页");
  expect(container.querySelector<HTMLButtonElement>('[aria-label="后退"]')?.disabled).toBe(false);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="前进"]')?.disabled).toBe(true);
  await click(container.querySelector<HTMLElement>('[aria-label="后退"]')!);
  expect(bridge.browserAction).toHaveBeenCalledWith("back");
});

it("编辑地址不被状态覆盖，失焦和 Escape 恢复实际地址", async () => {
  await render(<BrowserPanel contextScope={null} active suspended={false} zoomFactor={1} onClose={close} />);
  await act(() => { emit({ ...initial, revision: 1, url: "https://example.com/a" }); });
  const input = container.querySelector<HTMLInputElement>("input")!;
  // React 通过原生 setter 收到真实输入变更。
  await act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://draft.example/");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => { emit({ ...initial, revision: 2, url: "https://example.com/b", loading: true }); });
  expect(input.value).toBe("https://draft.example/");
  await act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(input.value).toBe("https://example.com/b");
  expect(close).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="停止加载"]')).not.toBeNull();
  await click(container.querySelector<HTMLElement>('[aria-label="停止加载"]')!);
  expect(bridge.browserAction).toHaveBeenCalledWith("stop");
});

it("加载错误保留网页，支持手动刷新和显式系统打开", async () => {
  await render(<BrowserPanel contextScope={null} active suspended={false} zoomFactor={1} onClose={close} />);
  await act(() => { emit({ ...initial, revision: 1, url: "https://example.com/", error: "连接失败" }); });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("连接失败");
  await click(container.querySelector<HTMLElement>('[aria-label="刷新网页"]')!);
  expect(bridge.browserAction).toHaveBeenCalledWith("reload");
  await click(container.querySelector<HTMLElement>('[aria-label="在系统浏览器打开"]')!);
  expect(bridge.openExternal).toHaveBeenCalledWith("https://example.com/");
  await act(() => { emit({ ...initial, revision: 2, url: "https://example.com/", title: "已恢复" }); });
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("提交完整地址，关闭失败可见且工具栏 Escape 不冒泡", async () => {
  const failedClose = vi.fn(async () => { throw new Error("关闭失败"); });
  const bubbled = vi.fn();
  await render(<div onKeyDown={bubbled}><BrowserPanel contextScope={null} active suspended={false} zoomFactor={1} onClose={failedClose} /></div>);
  const input = container.querySelector<HTMLInputElement>("input")!;
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://example.com/path");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => { input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(bridge.openBrowser).toHaveBeenCalledWith("https://example.com/path");
  await act(async () => { container.querySelector("strong")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(failedClose).toHaveBeenCalledOnce();
  expect(bubbled).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("关闭失败");
});

it("空页不加载默认首页，隐藏保留订阅与页面并恢复触发焦点", async () => {
  const trigger = document.createElement("button");
  trigger.setAttribute("aria-controls", "web-browser-panel");
  document.body.append(trigger);
  trigger.focus();
  await render(<BrowserPanel contextScope={null} active suspended={false} zoomFactor={1} onClose={close} />);
  expect(container.textContent).toContain("输入网址或点击会话中的网页链接");
  expect(bridge.openBrowser).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(container.querySelector("input"));
  await render(<BrowserPanel contextScope={null} active={false} suspended={false} zoomFactor={1} onClose={close} />);
  expect(container.querySelector<HTMLElement>("aside")?.hidden).toBe(true);
  expect(bridge.onBrowserState).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});

it("浏览器宽度沿用拖动条限制并单独持久化", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  await render(<BrowserPanel contextScope={null} active suspended={false} zoomFactor={1} onClose={close} />);
  const pane = container.querySelector<HTMLElement>("aside")!;
  const handle = container.querySelector<HTMLButtonElement>('[aria-label="调整浏览器侧栏宽度"]')!;
  expect(pane.style.width).toBe("540px");
  await act(() => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); });
  expect(pane.style.width).toBe("280px");
  expect(localStorage.getItem("omp-desktop.browser-width")).toBe("280");
  await act(() => { handle.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); });
  expect(pane.style.width).toBe("540px");
});

it("选择器按主进程状态切换取消按钮，完成后只打开一次评论", async () => {
  const comment = vi.fn();
  const actions = { comment, append: vi.fn() };
  const value: BrowserPromptContext = { scope: "scope", context: { kind: "web", url: "https://a.test/", title: "页面", text: "标题", element: { tag: "h1", label: "" } } };
  bridge.pickBrowserElement.mockResolvedValueOnce(value);
  await render(<PromptContexts.Provider value={actions}><BrowserPanel active suspended={false} contextScope="scope" zoomFactor={1} onClose={close} /></PromptContexts.Provider>);
  await act(() => { emit({ ...initial, revision: 1, url: "https://a.test/" }); });
  await click(container.querySelector<HTMLElement>('[aria-label="选择页面元素"]')!);
  expect(comment).toHaveBeenCalledTimes(1);
  expect(comment.mock.calls[0][0]).toEqual(value.context);
  await act(() => { emit({ ...initial, revision: 2, url: "https://a.test/", selectingElement: true, selectionMode: "element" }); });
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Esc 取消");
  await click(container.querySelector<HTMLElement>('[aria-label="取消选择页面元素"]')!);
  expect(bridge.cancelBrowserElementPick).toHaveBeenCalled();
  expect(comment).toHaveBeenCalledTimes(1);
});

it("scope、隐藏或暂停使迟到 picker 无效，未就绪 PDF 和加载中禁用选择", async () => {
  const comment = vi.fn();
  const actions = { comment, append: vi.fn() };
  const pending = Promise.withResolvers<BrowserPromptContext | null>();
  bridge.pickBrowserElement.mockReturnValueOnce(pending.promise);
  const panel = (contextScope: string, suspended = false) => <PromptContexts.Provider value={actions}><BrowserPanel active suspended={suspended} contextScope={contextScope} zoomFactor={1} onClose={close} /></PromptContexts.Provider>;
  await render(panel("old"));
  await act(() => { emit({ ...initial, revision: 1, url: "https://a.test/" }); });
  await click(container.querySelector<HTMLElement>('[aria-label="选择页面元素"]')!);
  await render(panel("new", true));
  await act(async () => { pending.resolve({ scope: "old", context: { kind: "web", url: "https://a.test/", title: "", text: "旧元素" } }); });
  expect(comment).not.toHaveBeenCalled();
  expect(bridge.cancelBrowserElementPick).toHaveBeenCalled();
  await render(panel("new"));
  let revision = 1;
  for (const patch of [{ loading: true }, { isPDF: true }, { isPDF: true, pdfStatus: "loading" as const }, { isPDF: true, pdfStatus: "password" as const }, { isPDF: true, pdfStatus: "error" as const }]) {
    await act(() => { emit({ ...initial, revision: ++revision, url: "https://a.test/", ...patch }); });
    expect(container.querySelector<HTMLButtonElement>('[aria-label="选择页面元素"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="框选页面区域"]')?.disabled).toBe(true);
  }
});

it("无评论 Provider 隐藏选择入口，调用失败在既有 alert 中可见", async () => {
  await render(<BrowserPanel active suspended={false} contextScope="scope" zoomFactor={1} onClose={close} />);
  expect(container.querySelector('[aria-label="选择页面元素"]')).toBeNull();
  await render(<PromptContexts.Provider value={{ comment: vi.fn(), append: vi.fn() }}><BrowserPanel active suspended={false} contextScope="scope" zoomFactor={1} onClose={close} /></PromptContexts.Provider>);
  await act(() => { emit({ ...initial, revision: 1, url: "https://a.test/" }); });
  bridge.pickBrowserElement.mockRejectedValueOnce(new Error("请先关闭网页内对话框"));
  await click(container.querySelector<HTMLElement>('[aria-label="选择页面元素"]')!);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("请先关闭网页内对话框");
});

it("切换到框选后忽略旧元素结果，取消框选也不会打开迟到评论", async () => {
  const comment = vi.fn();
  const element = Promise.withResolvers<BrowserPromptContext | null>();
  const region = Promise.withResolvers<BrowserPromptContext | null>();
  bridge.pickBrowserElement.mockReturnValueOnce(element.promise).mockReturnValueOnce(region.promise);
  await render(<PromptContexts.Provider value={{ comment, append: vi.fn() }}><BrowserPanel active suspended={false} contextScope="scope" zoomFactor={1} onClose={close} /></PromptContexts.Provider>);
  await act(() => emit({ ...initial, revision: 1, url: "https://a.test/" }));
  await click(container.querySelector<HTMLElement>('[aria-label="选择页面元素"]')!);
  await act(() => emit({ ...initial, revision: 2, url: "https://a.test/", selectingElement: true, selectionMode: "element" }));
  await click(container.querySelector<HTMLElement>('[aria-label="框选页面区域"]')!);
  await act(async () => element.resolve({ scope: "scope", context: { kind: "web", url: "https://a.test/", title: "", text: "旧元素" } }));
  expect(comment).not.toHaveBeenCalled();
  await act(() => emit({ ...initial, revision: 3, url: "https://a.test/", selectingElement: true, selectionMode: "region" }));
  await click(container.querySelector<HTMLElement>('[aria-label="取消框选页面区域"]')!);
  await act(async () => region.resolve({ scope: "scope", context: { kind: "web", url: "https://a.test/", title: "", text: "已取消的区域" } }));
  expect(comment).not.toHaveBeenCalled();
});

it("ready PDF 开放两种选择，失去 scope 后两种入口均不可用", async () => {
  const actions = { comment: vi.fn(), append: vi.fn() };
  const panel = (scope: string | null) => <PromptContexts.Provider value={actions}><BrowserPanel active suspended={false} contextScope={scope} zoomFactor={1} onClose={close} /></PromptContexts.Provider>;
  await render(panel("scope"));
  await act(() => emit({ ...initial, revision: 1, url: "https://a.test/document", isPDF: true, pdfStatus: "ready" }));
  for (const label of ["选择页面元素", "框选页面区域"]) {
    expect(container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.disabled).toBe(false);
  }
  await render(panel(null));
  for (const label of ["选择页面元素", "框选页面区域"]) {
    const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    expect(button.disabled).toBe(true);
    await click(button);
  }
  expect(actions.comment).not.toHaveBeenCalled();
});
