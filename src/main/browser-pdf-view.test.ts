// @vitest-environment node
import { EventEmitter } from "node:events";
import type { BrowserWindow, IpcMainEvent } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ views: [] as unknown[], ipc: undefined as unknown, handler: undefined as unknown, menu: [] as Array<{ label: string; click: () => void }> }));
vi.mock("electron", async () => {
  // vi.mock 工厂会提升到静态导入之前，必须在工厂内取得 EventEmitter。
  const { EventEmitter } = await import("node:events");
  const ipc = Object.assign(new EventEmitter(), { handle: vi.fn((_name, handler) => { fake.handler = handler; }), removeHandler: vi.fn() });
  fake.ipc = ipc;
  return {
    app: { isPackaged: true }, ipcMain: ipc,
    Menu: { buildFromTemplate: (items: typeof fake.menu) => { fake.menu = items; return { popup: vi.fn(), closePopup: vi.fn() }; } },
    session: { fromPartition: () => Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn() }) },
    WebContentsView: class {
      url = "";
      webContents = Object.assign(new EventEmitter(), {
        isDestroyed: () => false, mainFrame: { url: "" },
        getURL: () => this.url,
        loadURL: vi.fn(async (url: string) => { this.url = url; this.webContents.mainFrame.url = url; }),
        send: vi.fn(), setWindowOpenHandler: vi.fn(), setZoomFactor: vi.fn(), close: vi.fn(), copy: vi.fn(), focus: vi.fn(),
      });
      setBounds = vi.fn(); setVisible = vi.fn();
      constructor(public options: unknown) { fake.views.push(this); }
    },
  };
});
import { createBrowserPdfView, registerPdfViewerIPC } from "./browser-pdf-view";
import { pdfViewerChannels } from "../shared/pdf-viewer";
type View = { webContents: EventEmitter & { mainFrame: { url: string }; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }; setVisible: ReturnType<typeof vi.fn>; options: { webPreferences: Record<string, unknown> } };
let unregister: () => void;
const controllers: ReturnType<typeof createBrowserPdfView>[] = [];
beforeEach(() => { fake.views.length = 0; fake.menu = []; unregister = registerPdfViewerIPC(); });
afterEach(() => { for (const controller of controllers) controller.dispose(); controllers.length = 0; unregister(); vi.clearAllMocks(); });
function fixture() {
  const callbacks = { onLoaded: vi.fn(), onReady: vi.fn(), onPassword: vi.fn(), onError: vi.fn(), onGeometry: vi.fn(), onMarker: vi.fn(), onLink: vi.fn(), onTextComment: vi.fn() };
  const owner = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, webContents: { getZoomFactor: () => 1 }, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } };
  const controller = createBrowserPdfView(owner as unknown as BrowserWindow, callbacks); controllers.push(controller);
  controller.setBounds({ x: 0, y: 0, width: 600, height: 800 }); controller.setVisible(true);
  controller.load({ documentId: "doc1", url: "https://a.test/doc.pdf", title: "PDF", bytes: new Uint8Array([37, 80, 68, 70, 45]) });
  const view = fake.views.at(-1) as View; view.webContents.emit("did-finish-load");
  const sender = { sender: view.webContents, senderFrame: view.webContents.mainFrame } as unknown as IpcMainEvent;
  const event = (payload: object, source = sender) => (fake.ipc as EventEmitter).emit(pdfViewerChannels.event, source, { documentId: "doc1", ...payload });
  const getDocument = (id: string, source = sender) => (fake.handler as (event: IpcMainEvent, id: string) => unknown)(source, id);
  return { controller, callbacks, owner, view, sender, event, getDocument };
}
const rect = { x: 12, y: 34, width: 100, height: 40 };
const pageRect: [number, number, number, number] = [10, 20, 110, 60];
const selection = { type: "selection", requestId: "request1", anchorId: "anchor1", page: 1, pageRect, selection: "paragraph", text: "selected paragraph", rect };
function pick(f: ReturnType<typeof fixture>) {
  f.event({ type: "ready", pages: 2 });
  return f.controller.pick({ documentId: "doc1", requestId: "request1", anchorId: "anchor1", mode: "element" });
}
it("只向精确主 frame 当前文档授予内存字节，dispose 撤销路由", () => {
  const f = fixture();
  expect(f.getDocument("doc1")).toMatchObject({ url: "https://a.test/doc.pdf" });
  expect(() => f.getDocument("old")).toThrow();
  expect(() => f.getDocument("doc1", { ...f.sender, senderFrame: { url: f.view.webContents.mainFrame.url } } as IpcMainEvent)).toThrow();
  expect(() => f.getDocument("doc1", { ...f.sender, sender: {} } as IpcMainEvent)).toThrow();
  f.controller.dispose(); expect(() => f.getDocument("doc1")).toThrow();
});
it("隐藏 reader 可离屏完成 ready，只有显式正文接管才显示", () => {
  const f = fixture(); f.event({ type: "ready", pages: 2 });
  expect(f.callbacks.onReady).toHaveBeenCalledWith(2);
  expect(f.view.setVisible).toHaveBeenLastCalledWith(false);
  f.controller.setBodyVisible(true); expect(f.view.setVisible).toHaveBeenLastCalledWith(true);
  expect(f.view.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, backgroundThrottling: false, nodeIntegration: false });
});
it("拒绝错误请求、子frame、旧文档、非法页码及非有限几何；只消费一次授权结果", async () => {
  const f = fixture(); const pending = pick(f); const finish = vi.fn(); void pending.result.then(finish);
  for (const extra of [{ requestId: "wrong" }, { documentId: "old" }, { page: 3 }, { rect: { ...rect, x: NaN } }, { pageRect: [4, 2, 1, 9] }]) f.event({ ...selection, ...extra });
  f.event(selection, { ...f.sender, senderFrame: {} } as IpcMainEvent);
  await Promise.resolve(); expect(finish).not.toHaveBeenCalled();
  f.event(selection); expect(await pending.result).toMatchObject({ text: "selected paragraph", anchorId: "anchor1" });
  f.event(selection); expect(finish).toHaveBeenCalledTimes(1);
});
it("伪造 PNG 和空图块不能创建锚点", async () => {
  const f = fixture(); const pending = pick(f); const finish = vi.fn(); void pending.result.then(finish);
  f.event({ ...selection, selection: "figure", text: "" });
  f.event({ ...selection, selection: "figure", text: "", image: { mimeType: "image/png", data: "not-png", width: 1, height: 1 } });
  await Promise.resolve(); expect(finish).not.toHaveBeenCalled(); pending.cancel(); expect(await pending.result).toBeNull();
});
it("只有已授权锚点能同步或点击，删除标记后旧revision和ID均无效", async () => {
  const f = fixture(); const pending = pick(f); f.event(selection); await pending.result;
  f.controller.syncMarkers([{ anchorId: "anchor1", number: 1, page: 1, pageRect }, { anchorId: "forged", number: 2, page: 1, pageRect }], 1);
  f.event({ type: "marker", revision: 1, anchorId: "forged" }); expect(f.callbacks.onMarker).not.toHaveBeenCalled();
  f.event({ type: "marker", revision: 1, anchorId: "anchor1" }); expect(f.callbacks.onMarker).toHaveBeenCalledWith("anchor1", 1);
  f.controller.syncMarkers([], 2);
  f.event({ type: "marker", revision: 1, anchorId: "anchor1" });
  f.event({ type: "marker", revision: 2, anchorId: "anchor1" }); expect(f.callbacks.onMarker).toHaveBeenCalledTimes(1);
});
it("reveal 返回实际 rect，伪造几何不授权，隐藏取消正在定位", async () => {
  const f = fixture(); const pending = pick(f); f.event(selection); await pending.result;
  const located = f.controller.reveal({ documentId: "doc1", requestId: "reveal1", anchorId: "anchor1", page: 1, pageRect });
  f.event({ type: "revealed", requestId: "reveal1", anchorId: "anchor1", rect });
  expect(await located).toEqual({ anchorId: "anchor1", rect });
  const waiting = f.controller.reveal({ documentId: "doc1", requestId: "reveal2", anchorId: "anchor1", page: 1, pageRect });
  f.controller.setVisible(false); expect(await waiting).toMatchObject({ unavailable: expect.any(String) });
});
it("新文档和隐藏取消 pending；迟到结果不登记，reader 崩溃撤销字节", async () => {
  const f = fixture(); const pending = pick(f); f.controller.setVisible(false); expect(await pending.result).toBeNull();
  f.event(selection); f.controller.setVisible(true);
  f.controller.load({ documentId: "doc2", url: "https://a.test/next", title: "next", bytes: new Uint8Array([37]) });
  expect(() => f.getDocument("doc1")).toThrow();
  f.event(selection); expect(f.callbacks.onGeometry).not.toHaveBeenCalled();
  f.view.webContents.emit("render-process-gone"); expect(f.callbacks.onError).toHaveBeenCalled(); expect(() => f.getDocument("doc2")).toThrow();
});
it("native 评论菜单回调在隐藏或文档替换后失效", () => {
  const f = fixture(); f.event({ type: "ready", pages: 2 });
  f.view.webContents.emit("context-menu", {}, { selectionText: "text", frame: f.view.webContents.mainFrame });
  const item = fake.menu.find(item => item.label === "评论所选内容")!;
  f.controller.setVisible(false); item.click(); expect(f.callbacks.onTextComment).not.toHaveBeenCalled();
});
it("scope 取消交互撤销旧菜单但保留文档，新菜单仍能评论", () => {
  const f = fixture(); f.event({ type: "ready", pages: 2 });
  f.view.webContents.emit("context-menu", {}, { selectionText: "old scope text", frame: f.view.webContents.mainFrame });
  const staleClick = fake.menu.find(item => item.label === "评论所选内容")!.click;
  f.controller.cancelInteractions();
  staleClick();
  expect(f.callbacks.onTextComment).not.toHaveBeenCalled();
  expect(f.getDocument("doc1")).toMatchObject({ url: "https://a.test/doc.pdf", title: "PDF" });
  f.view.webContents.emit("context-menu", {}, { selectionText: "new scope text", frame: f.view.webContents.mainFrame });
  fake.menu.find(item => item.label === "评论所选内容")!.click();
  expect(f.callbacks.onTextComment).toHaveBeenCalledTimes(1);
});
it("搜索框的可编辑选区不进入 PDF 文本评论，页面文本仍可评论", () => {
  const f = fixture(); f.event({ type: "ready", pages: 2 });
  f.view.webContents.emit("context-menu", {}, { selectionText: "typed search query", isEditable: true, frame: f.view.webContents.mainFrame });
  expect(fake.menu.some(item => item.label === "评论所选内容")).toBe(false);
  f.view.webContents.emit("context-menu", {}, { selectionText: "actual paper paragraph", isEditable: false, frame: f.view.webContents.mainFrame });
  fake.menu.find(item => item.label === "评论所选内容")!.click();
  expect(f.callbacks.onTextComment).toHaveBeenCalledOnce();
});
it("两 reader 路由隔离，同一 handler 不泄漏其他 document", () => {
  const a = fixture(); const b = fixture();
  b.controller.load({ documentId: "doc2", url: "https://b.test/doc", title: "B", bytes: new Uint8Array([1]) });
  expect(() => a.getDocument("doc2")).toThrow();
  expect(() => b.getDocument("doc1")).toThrow();
  expect(b.getDocument("doc2")).toMatchObject({ url: "https://b.test/doc" });
  a.controller.dispose(); expect(() => a.getDocument("doc1")).toThrow();
  expect(b.getDocument("doc2")).toMatchObject({ title: "B" });
});
it("unsaved selection 几何可更新，未知 ID 或非有限矩形拒绝整批", async () => {
  const f = fixture(); const pending = pick(f); f.event(selection); await pending.result;
  f.event({ type: "geometry", revision: 0, anchors: [{ anchorId: "anchor1", rect }] });
  expect(f.callbacks.onGeometry).toHaveBeenCalledWith([{ anchorId: "anchor1", rect }], 0);
  f.event({ type: "geometry", revision: 0, anchors: [{ anchorId: "forged", rect }] });
  f.event({ type: "geometry", revision: 0, anchors: [{ anchorId: "anchor1", rect: { ...rect, width: Infinity } }] });
  expect(f.callbacks.onGeometry).toHaveBeenCalledTimes(1);
});
it("初始 hash 在可信页面完成加载后重放；布局无变化不取消 picker", async () => {
  const f = fixture(); f.controller.setHash("#page=2");
  f.view.webContents.emit("did-finish-load");
  expect(f.view.webContents.send).toHaveBeenCalledWith(pdfViewerChannels.command, { type: "hash", documentId: "doc1", hash: "#page=2" });
  const pending = pick(f);
  f.controller.setBounds({ x: 0, y: 0, width: 600, height: 800 });
  f.event(selection); expect(await pending.result).toMatchObject({ anchorId: "anchor1" });
});
