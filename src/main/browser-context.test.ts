// @vitest-environment jsdom
import type { WebContents } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginElementPick, beginRegionPick, capturePageSelection, clearPageAnchors, readPageAnchors, readPageSelection, syncPageMarkers, revealPageAnchor, prepareRegionCapture, finishRegionCapture, invalidatePageRegions } from "./browser-context";

const picks: ReturnType<typeof beginElementPick>[] = [];
const clicks = new WeakMap<EventTarget, EventListener>();
const roots = new Map<Element, ShadowRoot>();
const regionHandlers = new WeakMap<EventTarget, Map<string, EventListener>>();
beforeEach(() => {
  const attach = Element.prototype.attachShadow;
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, options) {
    const root = attach.call(this, options);
    roots.set(this, root);
    return root;
  });
  const add = EventTarget.prototype.addEventListener;
  vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(function (this: EventTarget, type, listener, options) {
    if (type === "click" && this instanceof HTMLElement && (this.getAttribute("aria-label") === "点击页面元素以评论，Esc 取消" || this.getAttribute("aria-label")?.startsWith("评论 "))) clicks.set(this, listener as EventListener);
    if (this instanceof HTMLElement && this.getAttribute("aria-label") === "拖动框选可见区域，Esc 取消") {
      let handlers = regionHandlers.get(this);
      if (!handlers) regionHandlers.set(this, handlers = new Map());
      handlers.set(type, listener as EventListener);
    }
    add.call(this, type, listener, options);
  });
});

/** jsdom 不可伪造 isTrusted；只在原生事件边界调用已注册的真实处理器。 */
function trustedClick(layer: HTMLElement) {
  const event = { isTrusted: true, clientX: 4, clientY: 4, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
  clicks.get(layer)!.call(layer, event as unknown as Event);
  return event;
}
afterEach(async () => {
  for (const pick of picks.splice(0)) pick.cancel();
  await Promise.resolve();
  await clearPageAnchors(contents() as unknown as WebContents);
  roots.clear();
  Reflect.deleteProperty(globalThis, "__ompPageAnchors");
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  Reflect.deleteProperty(document, "elementsFromPoint");
  vi.restoreAllMocks();
});

/** 在测试 DOM 执行实现生成的固定脚本，不用预置结果代替隐私过滤断言。 */
function contents() {
  const mainFrame = { frames: [] as Array<{ url: string; parent: unknown; detached: boolean }> };
  return {
    focus: vi.fn(), isDestroyed: vi.fn(() => false),
    mainFrame,
    executeJavaScriptInIsolatedWorld: vi.fn(async (world: number, scripts: { code: string }[]) => {
      expect(world).toBe(1001);
      return Function(`return ${scripts[0].code}`)();
    }),
  };
}

it("选区与任何表单节点相交时拒绝，不只检查两端", async () => {
  document.body.innerHTML = '<p>公开甲</p><input value="秘密"><p>公开乙</p>';
  const range = document.createRange();
  range.setStart(document.querySelectorAll("p")[0].firstChild!, 0);
  range.setEnd(document.querySelectorAll("p")[1].firstChild!, 3);
  window.getSelection()!.addRange(range);
  expect(await readPageSelection(contents() as unknown as WebContents)).toBeNull();
  document.querySelector("input")!.remove();
  expect(await readPageSelection(contents() as unknown as WebContents)).toBe("公开甲公开乙");
});

it("无选区返回 null，长选区明确报错而不是截断", async () => {
  const page = contents() as unknown as WebContents;
  expect(await readPageSelection(page)).toBeNull();
  const text = document.createTextNode("中".repeat(65537));
  document.body.append(text);
  const range = document.createRange(); range.selectNodeContents(text);
  window.getSelection()!.addRange(range);
  await expect(readPageSelection(page)).rejects.toThrow("所选内容过长");
});

it("picker 抑制网页点击，使用 alt 描述图像，清理覆盖层与监听", async () => {
  const image = document.createElement("img"); image.alt = "示意图"; document.body.append(image);
  const clicked = vi.fn(); image.addEventListener("click", clicked);
  const page = contents();
  const hit = vi.fn(() => [document.querySelector('[aria-label="点击页面元素以评论，Esc 取消"]')!, image]);
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: hit });
  const pick = beginElementPick(page as unknown as WebContents, "image_anchor"); picks.push(pick);
  await Promise.resolve();
  const layer = document.querySelector<HTMLElement>('[aria-label="点击页面元素以评论，Esc 取消"]')!;
  expect(document.activeElement).toBe(layer);
  layer.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(layer.isConnected).toBe(true);
  const event = trustedClick(layer);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  expect(await pick.result).toEqual({ tag: "img", label: "示意图", text: "示意图" });
  expect(clicked).not.toHaveBeenCalled();
  expect(layer.isConnected).toBe(false);
  expect((await readPageAnchors(page as unknown as WebContents, ["image_anchor"])).anchors[0].unavailable).toBe("not-visible");
  image.alt = "changed image";
  expect((await readPageAnchors(page as unknown as WebContents, ["image_anchor"])).anchors[0].unavailable).toBe("changed");
});

it("picker 不穿透 iframe，不引用输入控件及包含表单的祖先，Esc 结束", async () => {
  document.body.innerHTML = '<section><input value="绝密"></section><iframe></iframe><p>公开</p>';
  let target: Element = document.querySelector("section")!;
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [document.querySelector('[aria-label="点击页面元素以评论，Esc 取消"]')!, target] });
  const pick = beginElementPick(contents() as unknown as WebContents); picks.push(pick);
  await Promise.resolve();
  const layer = document.querySelector<HTMLElement>('[aria-label="点击页面元素以评论，Esc 取消"]')!;
  for (const selector of ["section", "input", "iframe"]) {
    target = document.querySelector(selector)!;
    trustedClick(layer);
    expect(layer.isConnected).toBe(true);
  }
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  layer.dispatchEvent(tab); expect(tab.defaultPrevented).toBe(true);
  layer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(await pick.result).toBeNull();
  expect(layer.isConnected).toBe(false);
  expect(document.activeElement).not.toBe(document.querySelector("input"));
});

it("picker 有界读取可见文本，标明截断，移除覆盖层主动取消", async () => {
  const paragraph = document.createElement("p"); paragraph.textContent = "字".repeat(5000); document.body.append(paragraph);
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{ width: 1, height: 1 }] as unknown as DOMRectList);
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [document.querySelector('[aria-label="点击页面元素以评论，Esc 取消"]')!, paragraph] });
  const pick = beginElementPick(contents() as unknown as WebContents); picks.push(pick);
  await Promise.resolve();
  trustedClick(document.querySelector<HTMLElement>('[aria-label="点击页面元素以评论，Esc 取消"]')!);
  expect((await pick.result)?.text).toBe("字".repeat(4000) + "（元素文本已截断）");
  const second = beginElementPick(contents() as unknown as WebContents); picks.push(second);
  await Promise.resolve();
  document.querySelector('[aria-label="点击页面元素以评论，Esc 取消"]')!.remove();
  expect(await second.result).toBeNull();
});

it("网页 top-layer 遮住捕获层时明确失败并清理，而不是伪装进入选择状态", async () => {
  const dialog = document.createElement("dialog"); document.body.append(dialog);
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [dialog] });
  const pick = beginElementPick(contents() as unknown as WebContents); picks.push(pick);
  await expect(pick.result).rejects.toThrow("请先关闭网页内对话框");
  expect(document.querySelector('[aria-label="点击页面元素以评论，Esc 取消"]')).toBeNull();
});

it("开放 shadow root 选择真实元素，取消不恢复 shadow 内密码输入焦点", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  const button = document.createElement("button"); button.setAttribute("aria-label", "图形操作"); root.append(button);
  Object.defineProperty(root, "elementFromPoint", { configurable: true, value: () => button });
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [document.querySelector('[aria-label="点击页面元素以评论，Esc 取消"]')!, host] });
  const pick = beginElementPick(contents() as unknown as WebContents); picks.push(pick);
  await Promise.resolve();
  trustedClick(document.querySelector<HTMLElement>('[aria-label="点击页面元素以评论，Esc 取消"]')!);
  expect(await pick.result).toEqual({ tag: "button", label: "图形操作", text: "图形操作" });
  const input = document.createElement("input"); input.type = "password"; root.append(input); input.focus();
  const second = beginElementPick(contents() as unknown as WebContents); picks.push(second);
  await Promise.resolve();
  expect(root.activeElement).not.toBe(input);
  second.cancel();
  expect(await second.result).toBeNull();
  expect(root.activeElement).not.toBe(input);
});

/** Give jsdom deterministic layout while executing the actual isolated program. */
function selectedParagraph(text = "only-this-selected-text") {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  document.body.append(paragraph);
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  window.getSelection()!.addRange(range);
  const rect = new DOMRect(64, 96, 120, 24);
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([rect] as unknown as DOMRectList);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(rect);
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => rect });
  return paragraph;
}

it("captures the actual Range synchronously, keeps expected text in main, and rejects stale snapshots", async () => {
  const paragraph = selectedParagraph();
  const page = contents();
  const native = page as unknown as WebContents;
  expect(await capturePageSelection(native, "anchor_one", paragraph.textContent!)).toEqual({
    text: paragraph.textContent, rect: { x: 64, y: 96, width: 120, height: 24 },
  });
  expect(page.executeJavaScriptInIsolatedWorld.mock.calls.every(([, scripts]) => !scripts[0].code.includes("only-this-selected-text"))).toBe(true);
  await expect(capturePageSelection(native, "stale", "different expected text")).rejects.toThrow("网页选区已变化");
  expect((await readPageAnchors(native, ["stale"])).anchors).toEqual([{ anchorId: "stale", unavailable: "missing" }]);
  paragraph.firstChild!.textContent = "changed text";
  expect((await readPageAnchors(native, ["anchor_one"])).anchors[0].unavailable).toBe("changed");
});

it("closed-shadow numbered markers separate coincident anchors and accept only trusted clicks", async () => {
  const paragraph = selectedParagraph();
  const native = contents() as unknown as WebContents;
  await capturePageSelection(native, "first", paragraph.textContent!);
  await capturePageSelection(native, "second", paragraph.textContent!);
  await syncPageMarkers(native, [{ anchorId: "first", number: 1 }, { anchorId: "first", number: 2 }, { anchorId: "second", number: 3 }]);
  const [host, root] = [...roots.entries()].find(([, root]) => root.querySelector('button[aria-label="评论 1"]'))!;
  expect(host.shadowRoot).toBeNull();
  const buttons = Array.from(root.querySelectorAll("button"));
  expect(buttons.map(button => button.textContent)).toEqual(["1", "2", "3"]);
  expect(buttons[0].style.left + "/" + buttons[0].style.top).not.toBe(buttons[1].style.left + "/" + buttons[1].style.top);
  expect(new Set(buttons.map(button => button.style.left + "/" + button.style.top)).size).toBe(3);
  const outlines = root.querySelectorAll<HTMLElement>(".outline");
  expect(outlines).toHaveLength(3);
  expect(outlines[0].style.width).toBe("120px");
  expect(outlines[0].getAttribute("aria-hidden")).toBe("true");
  expect(window.getSelection()!.toString()).toBe(paragraph.textContent);
  buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect((await readPageAnchors(native, ["first", "second"])).clicked).toBeUndefined();
  trustedClick(buttons[2]);
  expect((await readPageAnchors(native, ["first", "second"])).clicked).toBe("second");
  expect((await readPageAnchors(native, ["first", "second"])).clicked).toBeUndefined();
  await clearPageAnchors(native);
  expect(host.isConnected).toBe(false);
  expect((await readPageAnchors(native, ["first"])).anchors[0].unavailable).toBe("missing");
});

it("expires abandoned captures but retains confirmed anchors across marker removal for undo", async () => {
  const paragraph = selectedParagraph();
  const native = contents() as unknown as WebContents;
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  await capturePageSelection(native, "active", paragraph.textContent!);
  await capturePageSelection(native, "abandoned", paragraph.textContent!);
  await syncPageMarkers(native, [{ anchorId: "active", number: 1 }]);
  await syncPageMarkers(native, []);
  clock.mockReturnValue(62000);
  const result = await readPageAnchors(native, ["active", "abandoned"]);
  expect(result.anchors[0].rect).toEqual({ x: 64, y: 96, width: 120, height: 24 });
  expect(result.anchors[1]).toEqual({ anchorId: "abandoned", unavailable: "missing" });
});

it("rejects malformed IDs, marker numbers and unbounded or nonfinite geometry", async () => {
  const native = contents() as unknown as WebContents;
  await expect(syncPageMarkers(native, [{ anchorId: "bad/id", number: 1 }])).rejects.toThrow("网页评论标记无效");
  await expect(syncPageMarkers(native, [{ anchorId: "valid", number: Infinity }])).rejects.toThrow("网页评论标记无效");
  await expect(readPageAnchors(native, Array.from({ length: 1025 }, (_, index) => String(index)))).rejects.toThrow("网页引用无效");
  const forged = { ...contents(), executeJavaScriptInIsolatedWorld: vi.fn(async () => ({ anchors: [{ anchorId: "valid", rect: { x: 0, y: 0, width: NaN, height: 20 } }] })) } as unknown as WebContents;
  await expect(readPageAnchors(forged, ["valid"])).rejects.toThrow("网页引用位置无效");
});

it("tracks target resizes through rAF and disconnects observers on clear", async () => {
  const paragraph = selectedParagraph();
  const observe = vi.fn(), disconnect = vi.fn();
  let resized: ResizeObserverCallback | undefined;
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("ResizeObserver", class {
    observe = observe;
    disconnect = disconnect;
    constructor(callback: ResizeObserverCallback) { resized = callback; }
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const native = contents() as unknown as WebContents;
  await capturePageSelection(native, "sized", paragraph.textContent!);
  await syncPageMarkers(native, [{ anchorId: "sized", number: 1 }]);
  expect(observe).toHaveBeenCalledWith(document.documentElement);
  expect(observe).toHaveBeenCalledWith(paragraph);
  const root = [...roots.values()].find(root => root.querySelector(".outline"))!;
  expect(root.querySelector<HTMLElement>(".outline")!.style.left).toBe("64px");
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect(160, 120, 100, 20) });
  resized!([], {} as ResizeObserver);
  expect(frames).toHaveLength(1);
  frames.pop()!(0);
  expect(root.querySelector<HTMLElement>(".outline")!.style.left).toBe("160px");
  await clearPageAnchors(native);
  expect(disconnect).toHaveBeenCalledTimes(2);
});

it("never falls back to extracting HTML or PDF content for unsupported documents", async () => {
  selectedParagraph("PDF must not be captured");
  vi.spyOn(document, "contentType", "get").mockReturnValue("application/pdf");
  const native = contents() as unknown as WebContents;
  expect(await readPageSelection(native)).toBeNull();
  await expect(capturePageSelection(native, "pdf", "PDF must not be captured")).rejects.toThrow("网页选区无效");
  const pick = beginElementPick(native, "pdf_pick"); picks.push(pick);
  await expect(pick.result).rejects.toThrow("此文档不支持选择页面元素");
});

it("reveals the exact offscreen Range fragment through nested scrolling without rebinding changed text", async () => {
  const paragraph = selectedParagraph("precise retained source");
  const outer = document.createElement("section");
  const inner = document.createElement("div");
  outer.style.overflow = "auto"; inner.style.overflow = "auto";
  document.body.append(outer); outer.append(inner); inner.append(paragraph);
  const selection = window.getSelection()!;
  const selectedRange = document.createRange();
  selectedRange.selectNodeContents(paragraph);
  selection.removeAllRanges(); selection.addRange(selectedRange);
  let innerTop = 0, outerTop = 0, pageTop = 0, rangeTop = 150;
  for (const element of [outer, inner]) {
    Object.defineProperties(element, {
      clientWidth: { configurable: true, value: 300 }, clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 6000 }, scrollWidth: { configurable: true, value: 300 },
    });
  }
  inner.getBoundingClientRect = () => new DOMRect(20, 100 - outerTop - pageTop, 300, 100);
  outer.getBoundingClientRect = () => new DOMRect(20, 100 - pageTop, 300, 100);
  const innerScroll = vi.fn((options?: ScrollToOptions | number, y?: number) => { innerTop = typeof options === "object" ? options.top ?? innerTop : y ?? innerTop; });
  const outerScroll = vi.fn((options?: ScrollToOptions | number, y?: number) => { outerTop = typeof options === "object" ? options.top ?? outerTop : y ?? outerTop; });
  inner.scrollTo = innerScroll; outer.scrollTo = outerScroll;
  vi.spyOn(window, "scrollTo").mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === "object") pageTop = options.top!;
  });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true,
    value: () => [new DOMRect(64, rangeTop - innerTop - outerTop - pageTop, 120, 24)] });
  const page = contents();
  const native = page as unknown as WebContents;
  await capturePageSelection(native, "exact_range", paragraph.textContent!);
  rangeTop = 5000;
  expect((await readPageAnchors(native, ["exact_range"])).anchors[0].unavailable).toBe("offscreen");
  expect((await revealPageAnchor(native, "exact_range")).rect).toBeDefined();
  expect(innerScroll).toHaveBeenCalled();
  expect(outerScroll).toHaveBeenCalled();
  expect(window.getSelection()!.toString()).toBe("precise retained source");
  paragraph.textContent = "changed source";
  innerScroll.mockClear(); outerScroll.mockClear();
  expect((await revealPageAnchor(native, "exact_range")).unavailable).toBe("changed");
  expect(innerScroll).not.toHaveBeenCalled();
  expect(outerScroll).not.toHaveBeenCalled();
  expect((await revealPageAnchor(native, "unknown")).unavailable).toBe("missing");
  await expect(revealPageAnchor(native, "arbitrary selector > p")).rejects.toBeInstanceOf(Error);
});

function regionPointer(layer: HTMLElement, type: string, x: number, y: number) {
  const event = { isTrusted: true, button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
  regionHandlers.get(layer)!.get(type)!.call(layer, event as unknown as Event);
  return event;
}

async function regionDrag(page: object, anchorId = "region_anchor", requestId = "region_request") {
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [document.querySelector('[aria-label="拖动框选可见区域，Esc 取消"]')!] });
  const pick = beginRegionPick(page as WebContents, anchorId, requestId);
  await Promise.resolve();
  const layer = document.querySelector<HTMLElement>('[aria-label="拖动框选可见区域，Esc 取消"]')!;
  regionPointer(layer, "pointerdown", 10, 10);
  regionPointer(layer, "pointermove", 110, 90);
  return { pick, layer };
}

it("区域保留实际根文档矩形，准备和完成捕获只接受同一请求及 revision", async () => {
  document.body.innerHTML = "<p>正文</p>";
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 200));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  const page = contents(), native = page as unknown as WebContents;
  const { pick, layer } = await regionDrag(page);
  const event = regionPointer(layer, "pointerup", 110, 90);
  const selection = (await pick.result)!;
  expect(event.preventDefault).toHaveBeenCalled();
  expect(selection.rect).toEqual({ x: 10, y: 10, width: 100, height: 80 });
  await expect(prepareRegionCapture(native, { ...selection, captureRevision: selection.captureRevision + 1 })).rejects.toThrow();
  expect(await prepareRegionCapture(native, selection)).toEqual(selection);
  expect(layer.style.visibility).toBe("hidden");
  expect(await finishRegionCapture(native, { ...selection, requestId: "old_request" })).toBe(false);
  expect(layer.isConnected).toBe(true);
  expect(await finishRegionCapture(native, selection)).toBe(true);
  expect(layer.isConnected).toBe(false);
  expect((await readPageAnchors(native, ["region_anchor"])).anchors[0].rect).toEqual(selection.rect);
  expect(await finishRegionCapture(native, selection)).toBe(false);
});

it.each(["input", "iframe", "textarea", "select", "object", "embed", "private-widget"])("区域与 %s 相交时拒绝且保留页面原有内容", async tag => {
  document.body.innerHTML = `<p>正文</p><${tag}></${tag}>`;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 200));
  const { pick, layer } = await regionDrag(contents());
  regionPointer(layer, "pointerup", 110, 90);
  await expect(pick.result).rejects.toThrow("选区包含");
  expect(document.querySelector(tag)).not.toBeNull();
  expect(layer.isConnected).toBe(false);
});

it("递归检查开放 shadow 中的密码表单，不因外层宿主安全而放行", async () => {
  const host = document.createElement("div");
  host.attachShadow({ mode: "open" }).innerHTML = '<div><input type="password" value="secret"></div>';
  document.body.append(host);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 200));
  const { pick, layer } = await regionDrag(contents());
  regionPointer(layer, "pointerup", 110, 90);
  await expect(pick.result).rejects.toThrow("选区包含");
});

it("过小选区和滚动取消，不触发下层链接", async () => {
  document.body.innerHTML = '<a href="/private">链接</a>';
  const click = vi.fn(); document.querySelector("a")!.addEventListener("click", click);
  const page = contents();
  const first = await regionDrag(page);
  regionPointer(first.layer, "pointermove", 12, 12);
  regionPointer(first.layer, "pointerup", 12, 12);
  expect(await first.pick.result).toBeNull();
  const second = await regionDrag(page, "second_anchor", "second_request");
  window.dispatchEvent(new Event("scroll"));
  expect(await second.pick.result).toBeNull();
  expect(click).not.toHaveBeenCalled();
});

it("截图前 DOM 变化拒绝；旧请求取消不能移除新 picker", async () => {
  document.body.innerHTML = "<p>正文</p>";
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 200));
  const page = contents(), native = page as unknown as WebContents;
  const first = await regionDrag(page);
  regionPointer(first.layer, "pointerup", 110, 90);
  const selection = (await first.pick.result)!;
  document.querySelector("p")!.textContent = "已变化";
  await Promise.resolve();
  await expect(prepareRegionCapture(native, selection)).rejects.toThrow("页面已变化");
  const second = await regionDrag(page, "second_anchor", "second_request");
  first.pick.cancel();
  await Promise.resolve();
  expect(second.layer.isConnected).toBe(true);
  second.pick.cancel();
  expect(await second.pick.result).toBeNull();
});

it("URL 同文档变化只撤销区域，不破坏精确文本 Range", async () => {
  selectedParagraph("original");
  const page = contents(), native = page as unknown as WebContents;
  await capturePageSelection(native, "range_anchor", "original");
  const { pick, layer } = await regionDrag(page);
  regionPointer(layer, "pointerup", 110, 90);
  await pick.result;
  await invalidatePageRegions(native);
  const anchors = (await readPageAnchors(native, ["region_anchor", "range_anchor"])).anchors;
  expect(anchors[0].unavailable).toBeDefined();
  expect(anchors[1].rect).toBeDefined();
});

it("根页面滚动只重投影区域，嵌套容器滚动使截图锚点不可定位", async () => {
  document.body.innerHTML = "<section><p>正文</p></section>";
  // execute helper 的 Function 使用 globalThis；布局模拟也读取同一个滚动源。
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, -globalThis.scrollY, 300, 300));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  const page = contents(), native = page as unknown as WebContents;
  const { pick, layer } = await regionDrag(page);
  regionPointer(layer, "pointerup", 110, 90);
  const selection = (await pick.result)!;
  await prepareRegionCapture(native, selection);
  expect(await finishRegionCapture(native, selection)).toBe(true);
  vi.stubGlobal("scrollY", 20);
  window.dispatchEvent(new Event("scroll"));
  expect((await readPageAnchors(native, ["region_anchor"])).anchors[0].rect).toEqual({ x: 10, y: 0, width: 100, height: 70 });
  document.querySelector("section")!.dispatchEvent(new Event("scroll"));
  expect((await readPageAnchors(native, ["region_anchor"])).anchors[0].unavailable).toBe("changed");
});

it("捕获隐藏层期间发生滚动时丢弃结果并恢复本事务绘制层", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  const page = contents(), native = page as unknown as WebContents;
  const { pick, layer } = await regionDrag(page);
  regionPointer(layer, "pointerup", 110, 90);
  const selection = (await pick.result)!;
  await prepareRegionCapture(native, selection);
  vi.stubGlobal("scrollY", 1);
  expect(await finishRegionCapture(native, selection)).toBe(false);
  expect(layer.isConnected).toBe(false);
  expect((await readPageAnchors(native, ["region_anchor"])).anchors[0].unavailable).toBe("missing");
});

it("捏合缩放明确拒绝，而非猜测 visual viewport 偏移", async () => {
  vi.stubGlobal("visualViewport", { scale: 1.25, offsetLeft: 0, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const pick = beginRegionPick(contents() as unknown as WebContents, "pinch_anchor", "pinch_request");
  await expect(pick.result).rejects.toThrow("请恢复页面捏合缩放后框选");
});

it("普通元素焦点交接不取消 picker，真正窗口失焦才取消", async () => {
  const button = document.createElement("button"); document.body.append(button); button.focus();
  const { pick, layer } = await regionDrag(contents());
  expect(document.activeElement).toBe(layer);
  expect(layer.isConnected).toBe(true);
  window.dispatchEvent(new FocusEvent("blur"));
  expect(await pick.result).toBeNull();
  expect(layer.isConnected).toBe(false);
  expect(document.activeElement).toBe(button);
});

it("HTML 区域捕获迟到的取消及 finish 在直属 PDF viewer 出现后不再执行脚本", async () => {
  const page = contents(), native = page as unknown as WebContents;
  const { pick, layer } = await regionDrag(page);
  regionPointer(layer, "pointerup", 110, 90);
  const selection = (await pick.result)!;
  page.mainFrame.frames.push({
    url: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html",
    parent: page.mainFrame, detached: false,
  });
  page.executeJavaScriptInIsolatedWorld.mockClear();
  pick.cancel();
  await expect(finishRegionCapture(native, selection, true)).rejects.toThrow("PDF");
  await expect(prepareRegionCapture(native, selection)).rejects.toThrow("PDF");
  expect(page.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
});

it("旧元素选择取消及 Range 捕获的失败清理也不能向 PDF viewer 注入 runtime", async () => {
  const page = contents(), native = page as unknown as WebContents;
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [document.querySelector('[aria-label="点击页面元素以评论，Esc 取消"]')!] });
  const pick = beginElementPick(native, "late_element");
  await Promise.resolve();
  page.mainFrame.frames.push({
    url: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html",
    parent: page.mainFrame, detached: false,
  });
  page.executeJavaScriptInIsolatedWorld.mockClear();
  pick.cancel();
  expect(await pick.result).toBeNull();
  await expect(capturePageSelection(native, "late_range", "text")).rejects.toThrow("PDF");
  expect(page.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
});

it.each(["display:contents", "height:0;overflow:visible"])("拒绝没有自身可见边框的编辑祖先（%s）内的可见正文", async style => {
  document.body.innerHTML = `<section contenteditable style="${style}"><p>不可捕获的编辑内容</p></section>`;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.matches("[contenteditable]") ? new DOMRect(0, 0, 0, 0) : new DOMRect(0, 0, 200, 200);
  });
  const { pick, layer } = await regionDrag(contents());
  regionPointer(layer, "pointerup", 110, 90);
  await expect(pick.result).rejects.toThrow("选区包含");
  expect(layer.isConnected).toBe(false);
});

it("选区外时钟更新不使区域失效；原元素 picker 插入及取消也不影响引用", async () => {
  document.body.innerHTML = '<p id="captured">选区正文</p><div id="clock">12:00</div>';
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.id === "clock" ? new DOMRect(400, 400, 100, 30) : new DOMRect(0, 0, 200, 200);
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const page = contents(), native = page as unknown as WebContents;
  const { pick, layer } = await regionDrag(page);
  regionPointer(layer, "pointerup", 110, 90);
  const selection = (await pick.result)!;
  await prepareRegionCapture(native, selection);
  expect(await finishRegionCapture(native, selection)).toBe(true);
  document.querySelector("#clock")!.textContent = "12:01";
  await Promise.resolve();
  expect((await revealPageAnchor(native, "region_anchor")).rect).toEqual(selection.rect);
  Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [document.querySelector('[aria-label="点击页面元素以评论，Esc 取消"]')!] });
  const elementPick = beginElementPick(native, "temporary_element");
  await Promise.resolve();
  elementPick.cancel();
  expect(await elementPick.result).toBeNull();
  await Promise.resolve();
  expect((await revealPageAnchor(native, "region_anchor")).rect).toEqual(selection.rect);
  document.querySelector("#captured")!.textContent = "原文改变";
  await Promise.resolve();
  expect((await readPageAnchors(native, ["region_anchor"])).anchors[0].unavailable).toBe("changed");
});

it("选区外图片加载不撤销快照锚点，选区内图片加载使原截图不可定位", async () => {
  document.body.innerHTML = '<img id="captured"><img id="outside">';
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.id === "outside" ? new DOMRect(400, 400, 100, 30) : new DOMRect(0, 0, 200, 200);
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  const page = contents(), native = page as unknown as WebContents;
  const { pick, layer } = await regionDrag(page);
  regionPointer(layer, "pointerup", 110, 90);
  const selection = (await pick.result)!;
  await prepareRegionCapture(native, selection);
  expect(await finishRegionCapture(native, selection)).toBe(true);
  document.querySelector("#outside")!.dispatchEvent(new Event("load"));
  expect((await readPageAnchors(native, ["region_anchor"])).anchors[0].rect).toEqual(selection.rect);
  document.querySelector("#captured")!.dispatchEvent(new Event("load"));
  expect((await readPageAnchors(native, ["region_anchor"])).anchors[0].unavailable).toBe("changed");
});

it.each(["Escape", "blur", "resize", "scroll"])("pointerup 后、准备截图前仍接受 %s 取消", async signal => {
  const page = contents(), native = page as unknown as WebContents;
  const { pick, layer } = await regionDrag(page);
  regionPointer(layer, "pointerup", 110, 90);
  const selection = (await pick.result)!;
  if (signal === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  else window.dispatchEvent(new Event(signal));
  await expect(prepareRegionCapture(native, selection)).rejects.toThrow("页面已变化");
  expect(await finishRegionCapture(native, selection)).toBe(false);
  expect(layer.isConnected).toBe(false);
  expect((await readPageAnchors(native, ["region_anchor"])).anchors[0].unavailable).toBe("missing");
});

it.each(["Escape", "blur"])("等待两帧绘制期间的 %s 撤销截图授权，不恢复已结束的层", async signal => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  const page = contents(), native = page as unknown as WebContents;
  const { pick, layer } = await regionDrag(page);
  regionPointer(layer, "pointerup", 110, 90);
  const selection = (await pick.result)!;
  const prepared = prepareRegionCapture(native, selection);
  const rejected = expect(prepared).rejects.toThrow("网页区域无效");
  expect(layer.style.visibility).toBe("hidden");
  if (signal === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  else window.dispatchEvent(new FocusEvent("blur"));
  while (frames.length) frames.shift()!(0);
  await rejected;
  expect(await finishRegionCapture(native, selection)).toBe(false);
  expect(layer.isConnected).toBe(false);
  expect((await readPageAnchors(native, ["region_anchor"])).anchors[0].unavailable).toBe("missing");
});

it("pointerup 后的普通元素 blur 不撤销捕获，finish 后监听释放", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  const button = document.createElement("button"); document.body.append(button);
  const page = contents(), native = page as unknown as WebContents;
  const { pick, layer } = await regionDrag(page);
  regionPointer(layer, "pointerup", 110, 90);
  const selection = (await pick.result)!;
  const prepared = prepareRegionCapture(native, selection);
  button.dispatchEvent(new FocusEvent("blur"));
  while (frames.length) frames.shift()!(0);
  expect(await prepared).toEqual(selection);
  expect(await finishRegionCapture(native, selection)).toBe(true);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  window.dispatchEvent(new FocusEvent("blur"));
  expect((await readPageAnchors(native, ["region_anchor"])).anchors[0].rect).toEqual(selection.rect);
});
