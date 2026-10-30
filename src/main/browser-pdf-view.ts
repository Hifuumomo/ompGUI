import { app, ipcMain, Menu, session, WebContentsView, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { pdfViewerChannels, type PdfViewerCommand, type PdfPickRequest, type PdfSelectionResult, type PdfMarker, type PdfPageRect } from "../shared/pdf-viewer";
import { validatePromptContext, validatePromptContextImage } from "../shared/prompt-context";
import type { PageAnchorRect, PageAnchorState } from "./browser-context";
import { browserURL } from "./browser-url";

type Bounds = { x: number; y: number; width: number; height: number };
type Document = { documentId: string; url: string; title: string; bytes: Uint8Array };
type IPCEvent = IpcMainEvent | IpcMainInvokeEvent;
interface Route { document(event: IPCEvent, id: unknown): { bytes: Uint8Array; url: string; title: string }; event(event: IPCEvent, payload: unknown): void }
const routes = new Map<WebContents, Route>();
let registered = false;
/** 全局只安装一份 handler，窗口之间仅按已登记的 webContents 身份路由。 */
export function registerPdfViewerIPC(): () => void {
  if (registered) throw new Error("PDF viewer IPC already registered");
  registered = true;
  ipcMain.handle(pdfViewerChannels.document, (event, id: unknown) => {
    const route = routes.get(event.sender);
    if (!route) throw new Error("PDF reader is not authorized");
    return route.document(event, id);
  });
  const receive = (event: IpcMainEvent, payload: unknown) => routes.get(event.sender)?.event(event, payload);
  ipcMain.on(pdfViewerChannels.event, receive);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    registered = false;
    ipcMain.removeHandler(pdfViewerChannels.document);
    ipcMain.removeListener(pdfViewerChannels.event, receive);
  };
}

export interface BrowserPdfCallbacks {
  onLoaded(): void;
  onReady(pages: number): void;
  onPassword(incorrect: boolean): void;
  onError(message: string): void;
  onGeometry(anchors: PageAnchorState[], revision: number): void;
  onMarker(anchorId: string, revision: number): void;
  onLink(url: string): void;
  onTextComment(): void;
}
const idOK = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const rectOK = (value: unknown): value is PageAnchorRect => object(value) && [value.x, value.y, value.width, value.height].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 10_000_000) && (value.width as number) > 0 && (value.height as number) > 0;
const pageRectOK = (value: unknown): value is PdfPageRect => Array.isArray(value) && value.length === 4 && value.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 10_000_000) && value[0] < value[2] && value[1] < value[3];
const sameRect = (a: PdfPageRect, b: PdfPageRect) => a.every((v, i) => v === b[i]);

/** 独立可信 sibling reader，不向远程 PDF 插件或网页授予任何桥接能力。 */
export function createBrowserPdfView(owner: BrowserWindow, callbacks: BrowserPdfCallbacks) {
  let view: WebContentsView | undefined;
  let document: Document | undefined;
  let trustedURL = "";
  let loaded = false;
  let disposed = false;
  let hostVisible = false;
  let bodyVisible = false;
  let bounds: Bounds | null = null;
  let pages = 0;
  let revision = 0;
  let hash = "";
  let menuEpoch = 0;
  let menu: ReturnType<typeof Menu.buildFromTemplate> | undefined;
  const authorized = new Map<string, { page: number; pageRect: PdfPageRect }>();
  let markers = new Set<string>();
  let latestSelection = "";
  let pending: { request: PdfPickRequest; finish(value: PdfSelectionResult | null): void; timer: ReturnType<typeof setTimeout> } | undefined;
  let revealing: { requestId: string; anchorId: string; finish(value: PageAnchorState): void; timer: ReturnType<typeof setTimeout> } | undefined;
  const trusted = (event: IPCEvent) => Boolean(!disposed && loaded && view && !view.webContents.isDestroyed() && event.sender === view.webContents && event.senderFrame === view.webContents.mainFrame && event.senderFrame?.url === trustedURL && view.webContents.getURL() === trustedURL);
  const send = (command: PdfViewerCommand) => { if (loaded && view && !view.webContents.isDestroyed()) view.webContents.send(pdfViewerChannels.command, command); };
  const cancelPick = () => {
    const old = pending;
    pending = undefined;
    if (!old) return;
    clearTimeout(old.timer);
    send({ type: "cancel", documentId: old.request.documentId, requestId: old.request.requestId });
    old.finish(null);
  };
  const cancelReveal = () => {
    const old = revealing;
    revealing = undefined;
    if (!old) return;
    clearTimeout(old.timer);
    old.finish({ anchorId: old.anchorId, unavailable: "来源当前不可定位" });
  };
  const closeMenu = () => { menuEpoch++; menu?.closePopup(); menu = undefined; };
  const updateVisibility = () => {
    if (!view || view.webContents.isDestroyed()) return;
    view.setVisible(Boolean(loaded && bounds && hostVisible && bodyVisible && !owner.isDestroyed() && owner.isVisible() && !owner.isMinimized()));
  };
  const fail = (message: string) => {
    cancelPick(); cancelReveal(); closeMenu();
    pages = 0; authorized.clear(); markers.clear(); document = undefined;
    bodyVisible = false; updateVisibility();
    callbacks.onError(message);
  };
  const validPage = (page: unknown): page is number => Number.isSafeInteger(page) && (page as number) >= 1 && (page as number) <= pages;
  const route: Route = {
    document(event, id) {
      if (!trusted(event) || !document || id !== document.documentId) throw new Error("PDF document is not authorized");
      return { bytes: document.bytes, url: document.url, title: document.title };
    },
    event(event, payload) {
      if (!trusted(event) || !document || !object(payload) || payload.documentId !== document.documentId) return;
      const value = payload;
      if (value.type === "ready") {
        if (!Number.isSafeInteger(value.pages) || (value.pages as number) < 1 || (value.pages as number) > 1_000_000 || pages) return;
        pages = value.pages as number;
        callbacks.onReady(pages);
      } else if (value.type === "password") {
        if (typeof value.incorrect === "boolean" && !pages) callbacks.onPassword(value.incorrect);
      } else if (value.type === "error") {
        if (typeof value.message === "string" && value.message.length > 0 && value.message.length <= 4096) fail(value.message);
      } else if (value.type === "selection") {
        const active = pending;
        if (!hostVisible || !pages || !active || value.requestId !== active.request.requestId || value.anchorId !== active.request.anchorId || !validPage(value.page) || !pageRectOK(value.pageRect) || !rectOK(value.rect) || typeof value.text !== "string") return;
        if (active.request.mode === "region" && value.selection !== "region" || active.request.mode === "text" && value.selection !== "text" || active.request.mode === "element" && value.selection !== "paragraph" && value.selection !== "figure") return;
        try {
          if (value.image !== undefined) validatePromptContextImage(value.image);
          const selection = value as unknown as PdfSelectionResult;
          validatePromptContext({ kind: "pdf", url: document.url, title: document.title, page: selection.page, selection: selection.selection, text: selection.text, ...(selection.image ? { image: selection.image } : {}) });
          const result: PdfSelectionResult = { requestId: selection.requestId, anchorId: selection.anchorId, page: selection.page, pageRect: [...selection.pageRect], selection: selection.selection, text: selection.text, rect: { ...selection.rect }, ...(selection.image ? { image: { ...selection.image } } : {}) };
          authorized.set(result.anchorId, { page: result.page, pageRect: [...result.pageRect] });
          latestSelection = result.anchorId;
          pending = undefined; clearTimeout(active.timer); active.finish(result);
        } catch { /* 不信任 renderer 声明的 MIME、尺寸或无效选区。 */ }
      } else if (value.type === "cancelled") {
        if (pending && value.requestId === pending.request.requestId) cancelPick();
      } else if (value.type === "geometry") {
        if (!hostVisible || value.revision !== revision || !Array.isArray(value.anchors) || value.anchors.length > 1025) return;
        const seen = new Set<string>();
        const anchors: PageAnchorState[] = [];
        for (const anchor of value.anchors) {
          if (!object(anchor) || !idOK(anchor.anchorId) || !authorized.has(anchor.anchorId) || !markers.has(anchor.anchorId) && anchor.anchorId !== latestSelection || seen.has(anchor.anchorId) || anchor.rect !== undefined && !rectOK(anchor.rect)) return;
          seen.add(anchor.anchorId);
          anchors.push({ anchorId: anchor.anchorId, ...(anchor.rect ? { rect: { ...anchor.rect as PageAnchorRect } } : { unavailable: "来源当前不可定位" }) });
        }
        callbacks.onGeometry(anchors, revision);
      } else if (value.type === "marker") {
        if (hostVisible && value.revision === revision && idOK(value.anchorId) && markers.has(value.anchorId)) callbacks.onMarker(value.anchorId, revision);
      } else if (value.type === "revealed") {
        if (!hostVisible || !revealing || value.requestId !== revealing.requestId || value.anchorId !== revealing.anchorId || !authorized.has(revealing.anchorId) || value.rect !== undefined && !rectOK(value.rect)) return;
        const active = revealing; revealing = undefined; clearTimeout(active.timer);
        active.finish({ anchorId: active.anchorId, ...(value.rect ? { rect: { ...value.rect as PageAnchorRect } } : { unavailable: "来源当前不可定位" }) });
      } else if (value.type === "link") {
        if (!hostVisible || typeof value.url !== "string" || value.url.length > 8192) return;
        try { callbacks.onLink(browserURL(value.url)); } catch { /* 非 HTTP(S) 动作永不离开 reader。 */ }
      }
    },
  };
  const ensureView = () => {
    if (view || disposed || owner.isDestroyed()) return;
    trustedURL = pathToFileURL(join(__dirname, "../renderer/pdf-viewer.html")).href;
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      const url = new URL(process.env.ELECTRON_RENDERER_URL);
      if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) throw new Error("PDF reader requires a loopback development server");
      trustedURL = new URL("pdf-viewer.html", url.href.endsWith("/") ? url : `${url.href}/`).href;
    }
    const isolated = session.fromPartition(`pdf-viewer-${randomUUID()}`, { cache: false });
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.setDevicePermissionHandler(() => false);
    isolated.on("will-download", event => event.preventDefault());
    view = new WebContentsView({ webPreferences: { preload: join(__dirname, "../preload/pdf-viewer.js"), session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false, navigateOnDragDrop: false, backgroundThrottling: false } });
    view.setVisible(false);
    if (bounds) view.setBounds(bounds);
    owner.contentView.addChildView(view);
    const contents = view.webContents;
    contents.setZoomFactor(1);
    routes.set(contents, route);
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", event => event.preventDefault());
    contents.on("will-navigate", event => event.preventDefault());
    contents.on("will-frame-navigate", event => event.preventDefault());
    contents.on("will-redirect", event => event.preventDefault());
    contents.on("did-start-navigation", (_event, _url, _inPlace, mainFrame) => { if (mainFrame) { loaded = false; updateVisibility(); } });
    contents.on("did-finish-load", () => {
      loaded = contents.getURL() === trustedURL;
      if (!loaded) { fail("PDF reader 入口不可信"); return; }
      updateVisibility();
      if (document) {
        send({ type: "load", documentId: document.documentId });
        send({ type: "visibility", documentId: document.documentId, visible: hostVisible, fontScale: owner.webContents.getZoomFactor() });
        if (hash) send({ type: "hash", documentId: document.documentId, hash });
      }
      callbacks.onLoaded();
    });
    contents.on("context-menu", (_event, params) => {
      closeMenu();
      if (!hostVisible || !pages || !document || !loaded || params.isEditable || !params.selectionText.trim() || params.selectionText.length > 65536 || params.frame !== contents.mainFrame) return;
      const epoch = menuEpoch;
      const documentId = document.documentId;
      const active = () => epoch === menuEpoch && hostVisible && document?.documentId === documentId && loaded && contents.getURL() === trustedURL && !disposed;
      menu = Menu.buildFromTemplate([
        { label: "复制", click: () => { if (active()) contents.copy(); } },
        { label: "评论所选内容", click: () => { if (active()) { cancelPick(); callbacks.onTextComment(); } } },
      ]);
      menu.popup({ window: owner });
    });
    contents.on("render-process-gone", () => { loaded = false; fail("PDF reader 进程已退出"); });
    void contents.loadURL(trustedURL).catch(error => { if (!disposed) { loaded = false; fail(error instanceof Error ? error.message : "PDF reader 加载失败"); } });
  };
  return {
    load(next: Document) {
      if (disposed) return;
      if (!idOK(next.documentId) || next.title.length > 512 || next.url.length > 8192 || !(next.bytes instanceof Uint8Array) || !next.bytes.length || next.bytes.length > 128 * 1024 * 1024) throw new Error("PDF document is invalid");
      browserURL(next.url);
      cancelPick(); cancelReveal(); closeMenu(); authorized.clear(); markers.clear(); pages = 0; revision = 0;
      document = { ...next }; bodyVisible = false; hash = "";
      ensureView(); updateVisibility();
      if (loaded) { send({ type: "load", documentId: next.documentId }); send({ type: "visibility", documentId: next.documentId, visible: hostVisible, fontScale: owner.webContents.getZoomFactor() }); }
    },
    setBounds(next: Bounds | null) {
      const checked = next && [next.x, next.y, next.width, next.height].every(Number.isFinite) && next.width > 0 && next.height > 0 ? { ...next } : null;
      const changed = Boolean(bounds) !== Boolean(checked) || Boolean(bounds && checked && (bounds.x !== checked.x || bounds.y !== checked.y || bounds.width !== checked.width || bounds.height !== checked.height));
      bounds = checked;
      if (changed) { cancelPick(); cancelReveal(); closeMenu(); }
      if (view && bounds) view.setBounds(bounds);
      if (document) send({ type: "visibility", documentId: document.documentId, visible: hostVisible && Boolean(bounds), fontScale: owner.webContents.getZoomFactor() });
      updateVisibility();
    },
    getBounds() { return bounds ? { ...bounds } : null; },
    getZoomFactor() { return 1; },
    setVisible(visible: boolean) {
      hostVisible = visible;
      if (!visible) { cancelPick(); cancelReveal(); closeMenu(); }
      if (document) send({ type: "visibility", documentId: document.documentId, visible: visible && Boolean(bounds), fontScale: owner.webContents.getZoomFactor() });
      updateVisibility();
    },
    setBodyVisible(visible: boolean) { bodyVisible = visible; updateVisibility(); },
    pick(request: PdfPickRequest) {
      cancelPick(); closeMenu();
      let cancel = () => {};
      const result = new Promise<PdfSelectionResult | null>(finish => {
        if (!document || request.documentId !== document.documentId || !idOK(request.requestId) || !idOK(request.anchorId) || !["element", "region", "text"].includes(request.mode) || !hostVisible || !bounds || !pages || authorized.has(request.anchorId)) { finish(null); return; }
        pending = { request: { ...request }, finish, timer: setTimeout(cancelPick, 60_000) };
        const active = pending;
        cancel = () => { if (pending === active) cancelPick(); };
        view!.webContents.focus();
        send({ type: "pick", ...request });
      });
      return { result, cancel: () => cancel() };
    },
    syncMarkers(next: PdfMarker[], nextRevision: number) {
      if (!document || !Number.isSafeInteger(nextRevision) || nextRevision < 0 || next.length > 1024) return;
      const checked: PdfMarker[] = [];
      const ids = new Set<string>();
      for (const marker of next) {
        const known = authorized.get(marker.anchorId);
        if (!known || ids.has(marker.anchorId) || marker.page !== known.page || !pageRectOK(marker.pageRect) || !sameRect(marker.pageRect, known.pageRect) || !Number.isSafeInteger(marker.number) || marker.number < 1) continue;
        checked.push({ ...marker, pageRect: [...known.pageRect] }); ids.add(marker.anchorId);
      }
      revision = nextRevision; markers = ids;
      send({ type: "markers", documentId: document.documentId, revision, markers: checked });
    },
    reveal(request: { documentId: string; requestId: string; anchorId: string; page: number; pageRect: PdfPageRect }): Promise<PageAnchorState> {
      cancelReveal();
      const known = authorized.get(request.anchorId);
      if (!document || document.documentId !== request.documentId || !hostVisible || !bounds || !known || !idOK(request.requestId) || request.page !== known.page || !pageRectOK(request.pageRect) || !sameRect(request.pageRect, known.pageRect)) return Promise.resolve({ anchorId: request.anchorId, unavailable: "来源当前不可定位" });
      return new Promise(finish => {
        revealing = { requestId: request.requestId, anchorId: request.anchorId, finish, timer: setTimeout(cancelReveal, 2000) };
        send({ type: "reveal", ...request });
      });
    },
    cancelReveal,
    cancelInteractions() { cancelPick(); cancelReveal(); closeMenu(); },
    stop() { cancelPick(); cancelReveal(); closeMenu(); if (document) send({ type: "stop", documentId: document.documentId }); },
    setHash(next: string) {
      if (!document || typeof next !== "string" || next.length > 8192) return;
      hash = next;
      send({ type: "hash", documentId: document.documentId, hash });
    },
    dispose() {
      if (disposed) return;
      cancelPick(); cancelReveal(); closeMenu(); disposed = true; document = undefined; authorized.clear(); markers.clear();
      if (view) {
        routes.delete(view.webContents);
        if (!owner.isDestroyed()) owner.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
      }
      view = undefined;
    },
  };
}
