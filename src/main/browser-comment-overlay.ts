import { app, ipcMain, session, WebContentsView, type BrowserWindow, type IpcMainEvent } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { commentOverlayChannels, type BrowserCommentEditor, type BrowserCommentEvent } from "../shared/comment-overlay";

type Bounds = { x: number; y: number; width: number; height: number };

/** A trusted, nonmodal editor above the untrusted browser view. */
export function createBrowserCommentOverlay(owner: BrowserWindow, publishEvent: (event: BrowserCommentEvent) => void) {
  let view: WebContentsView | undefined;
  let editor: BrowserCommentEditor | null = null;
  let bounds: Bounds | null = null;
  let unavailable: string | undefined;
  let requestId = "";
  let focusedRequest = "";
  let loaded = false;
  let visible = false;
  let disposed = false;
  let trustedURL = "";

  const trustedSender = (event: IpcMainEvent) => Boolean(
    !disposed && loaded && view && !view.webContents.isDestroyed() &&
    event.sender === view.webContents && event.senderFrame === view.webContents.mainFrame &&
    event.senderFrame?.url === trustedURL && view.webContents.getURL() === trustedURL
  );
  const sendState = () => {
    if (!loaded || !view || view.webContents.isDestroyed()) return;
    view.webContents.send(commentOverlayChannels.state, editor ? { requestId, editor, unavailable } : null);
  };
  const updateVisibility = () => {
    if (!view || view.webContents.isDestroyed() || owner.isDestroyed()) return;
    const show = Boolean(editor && bounds && loaded);
    if (show && bounds) {
      view.webContents.setZoomFactor(owner.webContents.getZoomFactor());
      const area = owner.getContentBounds();
      const zoom = owner.webContents.getZoomFactor();
      const width = Math.max(1, Math.min(Math.round(bounds.width), Math.round(420 * zoom), area.width));
      const height = Math.max(1, Math.min(Math.round(bounds.height), Math.round(560 * zoom), area.height));
      view.setBounds({
        x: Math.max(0, Math.min(Math.round(bounds.x), area.width - width)),
        y: Math.max(0, Math.min(Math.round(bounds.y), area.height - height)),
        width, height,
      });
      if (!visible) {
        // Re-append only on reveal: the remote browser may have been created later.
        owner.contentView.removeChildView(view);
        owner.contentView.addChildView(view);
      }
    }
    view.setVisible(show);
    visible = show;
  };
  const onReady = (event: IpcMainEvent, identity: unknown) => {
    if (!trustedSender(event) || !editor || identity !== requestId || !visible || focusedRequest === requestId) return;
    focusedRequest = requestId;
    view!.webContents.focus();
  };
  const onEvent = (event: IpcMainEvent, payload: unknown) => {
    if (!trustedSender(event) || !visible || !editor || !payload || typeof payload !== "object") return;
    const envelope = payload as { requestId?: unknown; event?: unknown };
    if (envelope.requestId !== requestId || !envelope.event || typeof envelope.event !== "object") return;
    const value = envelope.event as Record<string, unknown>;
    if (value.scope !== editor.scope || value.editorId !== editor.editorId) return;
    if (value.type === "cancel") {
      publishEvent({ type: "cancel", scope: editor.scope, editorId: editor.editorId });
    } else if ((value.type === "change" || value.type === "confirm") && typeof value.comment === "string") {
      if (value.comment.length > 16_000 || (value.type === "confirm" && !value.comment.trim())) return;
      editor = { ...editor, comment: value.comment };
      publishEvent({ type: value.type, scope: editor.scope, editorId: editor.editorId, comment: value.comment });
    }
  };

  const ensureView = () => {
    if (view || disposed || owner.isDestroyed()) return;
    trustedURL = pathToFileURL(join(__dirname, "../renderer/comment-overlay.html")).href;
    const devURL = process.env.ELECTRON_RENDERER_URL;
    if (!app.isPackaged && devURL) {
      const url = new URL(devURL);
      if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) {
        throw new Error("Comment overlay requires a loopback development server");
      }
      trustedURL = new URL("comment-overlay.html", url.href.endsWith("/") ? url : `${url.href}/`).href;
    }
    const isolated = session.fromPartition(`comment-overlay-${randomUUID()}`, { cache: false });
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.setDevicePermissionHandler(() => false);
    isolated.on("will-download", (event) => event.preventDefault());
    view = new WebContentsView({ webPreferences: {
      preload: join(__dirname, "../preload/comment-overlay.js"),
      session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, webviewTag: false, allowRunningInsecureContent: false, navigateOnDragDrop: false,
    } });
    const contents = view.webContents;
    ipcMain.on(commentOverlayChannels.ready, onReady);
    ipcMain.on(commentOverlayChannels.event, onEvent);
    view.setBackgroundColor(editor?.theme === "light" ? "#ffffff" : "#202127");
    view.setVisible(false);
    owner.contentView.addChildView(view);
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-frame-navigate", (event) => event.preventDefault());
    contents.on("will-redirect", (event) => event.preventDefault());
    contents.on("did-start-navigation", (_event, _url, _inPlace, mainFrame) => {
      if (mainFrame) { loaded = false; updateVisibility(); }
    });
    contents.on("did-finish-load", () => {
      loaded = contents.getURL() === trustedURL;
      updateVisibility();
      sendState();
    });
    contents.on("render-process-gone", () => { loaded = false; updateVisibility(); });
    void contents.loadURL(trustedURL).catch(() => { loaded = false; updateVisibility(); });
  };

  return {
    /** 正文 sibling 切换后，即便编辑器未隐藏也必须重新置顶。 */
    raise() {
      if (!visible || !view || disposed || owner.isDestroyed()) return;
      owner.contentView.removeChildView(view);
      owner.contentView.addChildView(view);
    },
    setEditor(next: BrowserCommentEditor | null) {
      if (disposed) return;
      if (!next || !editor || next.scope !== editor.scope || next.editorId !== editor.editorId ||
          next.sourceAnchor.documentId !== editor.sourceAnchor.documentId || next.sourceAnchor.anchorId !== editor.sourceAnchor.anchorId) {
        requestId = next ? randomUUID() : "";
        focusedRequest = "";
      }
      editor = next ? { ...next, sourceAnchor: { ...next.sourceAnchor } } : null;
      if (editor) ensureView();
      if (view) view.setBackgroundColor(editor?.theme === "light" ? "#ffffff" : "#202127");
      updateVisibility();
      sendState();
    },
    setGeometry(next: Bounds | null, reason?: string) {
      if (disposed) return;
      const previousUnavailable = unavailable;
      const wasVisible = visible;
      bounds = next && [next.x, next.y, next.width, next.height].every(Number.isFinite) && next.width > 0 && next.height > 0 ? { ...next } : null;
      unavailable = reason;
      updateVisibility();
      if (previousUnavailable !== unavailable || (!wasVisible && visible)) sendState();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (view) {
        ipcMain.removeListener(commentOverlayChannels.ready, onReady);
        ipcMain.removeListener(commentOverlayChannels.event, onEvent);
        if (!owner.isDestroyed()) owner.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
      }
      view = undefined;
      editor = null;
    },
  };
}
