// @vitest-environment jsdom
import { act, useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserPanelLayout } from "../../shared/browser";
import { render, container } from "./transcript-test-harness";
import { useBrowserViewport } from "./useBrowserViewport";

const setLayout = vi.fn(async (_layout: BrowserPanelLayout) => {});
const onError = vi.fn();
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let observedResize: ResizeObserverCallback;
let bounds: DOMRect;

/** 保留真实 React effect，仅替代浏览器测量与 Electron 边界。 */
function Viewport({ active = true, suspended = false, zoomFactor = 1 }: { active?: boolean; suspended?: boolean; zoomFactor?: number }) {
  const content = useRef<HTMLDivElement>(null);
  useBrowserViewport({ active, suspended, zoomFactor, content, onError });
  return <div className="workspace-columns"><div ref={content} className="browser-panel-content" /><button className="pane-resize-handle" /></div>;
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  bounds = new DOMRect(400, 120, 500, 400);
  setLayout.mockReset();
  setLayout.mockResolvedValue(undefined);
  onError.mockReset();
  vi.stubGlobal("desktop", { setBrowserLayout: setLayout });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { observedResize = callback; }
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.matches(".browser-panel-content, .file-reference-preview, [role=dialog], [role=menu]") ? bounds : new DOMRect();
  });
});
afterEach(async () => {
  // 布局 effect 清理仍需桥接和 RAF，不能先撤销环境。
  await render(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** 合并并执行一帧，保留真实 MutationObserver 微任务。 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(0);
  });
}

it("发送 CSS 坐标不乘 DPI，观察通知去重而窗口缩放强制恢复", async () => {
  await render(<Viewport zoomFactor={2} />);
  expect(setLayout).toHaveBeenLastCalledWith({ visible: true, bounds: { x: 400, y: 120, width: 500, height: 400 } });
  const count = setLayout.mock.calls.length;
  await act(() => { observedResize([], {} as ResizeObserver); });
  await flush();
  expect(setLayout).toHaveBeenCalledTimes(count);
  await act(() => { window.dispatchEvent(new Event("resize")); });
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(false);
  await flush();
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(true);
  await render(<Viewport zoomFactor={1.5} />);
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(true);
  expect(setLayout.mock.calls.length).toBeGreaterThan(count + 2);
});

it("暂停、隐藏再显示均重新提交，不需要尺寸变化", async () => {
  await render(<Viewport />);
  await render(<Viewport suspended />);
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(false);
  await render(<Viewport />);
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(true);
  await render(<Viewport active={false} />);
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(false);
  await render(<Viewport />);
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(true);
});

it("拖动立即隐藏，指针结束或失焦后重新测量", async () => {
  await render(<Viewport />);
  const handle = container.querySelector("button")!;
  await act(() => { handle.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true })); });
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(false);
  bounds = new DOMRect(450, 120, 450, 400);
  await act(() => { document.dispatchEvent(new Event("pointerup", { bubbles: true })); });
  await flush();
  expect(setLayout).toHaveBeenLastCalledWith({ visible: true, bounds: { x: 450, y: 120, width: 450, height: 400 } });
  await act(() => { handle.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true })); });
  await act(() => { window.dispatchEvent(new Event("blur")); });
  await flush();
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(true);
});

it("相交图片浮层和漏报模态遮挡原生 view，移除后恢复", async () => {
  await render(<Viewport />);
  const portal = document.createElement("div");
  portal.className = "file-reference-preview";
  document.body.append(portal);
  await flush();
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(false);
  portal.remove();
  await flush();
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(true);
  const modal = document.createElement("div");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  document.body.append(modal);
  await flush();
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(false);
  modal.hidden = true;
  await flush();
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(true);
  modal.remove();
});

it("零面积隐藏，IPC 错误可见且卸载取消待测量帧", async () => {
  bounds = new DOMRect(0, 0, 0, 0);
  setLayout.mockRejectedValueOnce(new Error("布局失败"));
  await render(<Viewport />);
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(false);
  expect(onError).toHaveBeenCalledWith("布局失败");
  await act(() => { window.dispatchEvent(new Event("resize")); });
  expect(frames.size).toBe(1);
  await render(null);
  expect(frames.size).toBe(0);
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(false);
});

it("评论 dialog 挂载隐藏原生网页，关闭并解除暂停后强制恢复布局", async () => {
  await render(<Viewport />);
  const dialog = document.createElement("section");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.className = "context-comment-popover";
  document.body.append(dialog);
  await render(<Viewport suspended />);
  await flush();
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(false);
  const before = setLayout.mock.calls.length;
  dialog.remove();
  await render(<Viewport />);
  await flush();
  expect(setLayout.mock.calls.length).toBeGreaterThan(before);
  expect(setLayout.mock.calls.at(-1)?.[0].visible).toBe(true);
});
