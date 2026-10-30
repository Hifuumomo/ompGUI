import { randomUUID } from "node:crypto";
import type { BrowserCommentAnchor, PdfCommentAnchor, WebCommentAnchor } from "../shared/comment-anchor";
import type { BrowserCommentEditor, BrowserCommentMarker, BrowserCommentEvent, BrowserCommentRevealRequest, BrowserCommentRevealResult } from "../shared/comment-overlay";
import { createBrowserCommentOverlay } from "./browser-comment-overlay";
import { session, WebContentsView, Menu, clipboard, type BrowserWindow, type Session, type WebContents } from "electron";
import type { BrowserPanelLayout, BrowserPanelState } from "../shared/browser";
import { validatePromptContext, validatePromptContextImage, type BrowserPromptContext } from "../shared/prompt-context";
import { beginElementPick, beginRegionPick, invalidatePageRegions, capturePageSelection, readPageAnchors, syncPageMarkers, revealPageAnchor } from "./browser-context";
import { captureBrowserRegion, cancelRegionCapture } from "./browser-region-capture";
import type { PageRegionSelection, BrowserElementSelection } from "./browser-context";
import { browserURL } from "./browser-url";
import { loadBrowserPdf } from "./browser-pdf-loader";
import { createBrowserPdfView } from "./browser-pdf-view";
import type { PdfPickMode } from "../shared/pdf-viewer";

const navigationError = "侧栏仅支持不含凭据的 HTTP/HTTPS 网页";
const permissionError = "侧栏浏览器不允许此站点权限，请在系统浏览器中打开";

const withoutHash = (value: string) => { const parsed = new URL(value); parsed.hash = ""; return parsed.href; };


type SessionTarget = { error: (message: string) => void };
const sessions = new WeakMap<Session, Map<WebContents, SessionTarget>>();

/** session 策略只安装一次，销毁窗口时仅移除所属页面。 */
function sessionTargets(browserSession: Session): Map<WebContents, SessionTarget> {
  const existing = sessions.get(browserSession);
  if (existing) return existing;
  const targets = new Map<WebContents, SessionTarget>();
  sessions.set(browserSession, targets);
  browserSession.setPermissionRequestHandler((contents, _permission, callback) => {
    callback(false);
    targets.get(contents)?.error(permissionError);
  });
  browserSession.setPermissionCheckHandler((contents) => {
    if (contents) targets.get(contents)?.error(permissionError);
    return false;
  });
  browserSession.setDevicePermissionHandler((details) => {
    // Electron 此回调没有 webContents，只通知同源的当前网页。
    for (const [contents, target] of targets) {
      try {
        if (!contents.isDestroyed() && new URL(contents.getURL()).origin === details.origin) target.error(permissionError);
      } catch { /* 空页面没有站点来源。 */ }
    }
    return false;
  });
  browserSession.on("will-download", (event, _item, contents) => {
    event.preventDefault();
    targets.get(contents)?.error("侧栏不下载文件，请在系统浏览器中打开");
  });
  return targets;
}

/** 非持久分区仅在本次应用运行期间共享登录状态。 */
export function createBrowserSession(): Session {
  const browserSession = session.fromPartition("omp-browser", { cache: false });
  sessionTargets(browserSession);
  return browserSession;
}

export interface BrowserPanelController {
  open(url: unknown): void;
  setLayout(layout: unknown): void;
  action(action: unknown): void;
  getState(): BrowserPanelState;
  setContextScope(scope: unknown): void;
  pickElement(scope: unknown, mode: unknown): Promise<BrowserPromptContext | null>;
  cancelElementPick(): void;
  setCommentEditor(editor: unknown): void;
  syncCommentMarkers(markers: unknown): void;
  revealComment(request: unknown): Promise<BrowserCommentRevealResult>;
  cancelCommentReveal(requestId: unknown): void;
  dispose(): void;
}

function emptyState(revision: number): BrowserPanelState {
  return { revision, url: "", title: "", loading: false, selectingElement: false, canGoBack: false, canGoForward: false };
}

/** 子 frame 可用浏览器内部文档，但不能跨入桌面协议。 */
function allowedFrame(url: string): boolean {
  try {
    browserURL(url);
    return true;
  } catch {
    try {
      const parsed = new URL(url);
      return !parsed.username && !parsed.password && (
        (parsed.protocol === "about:" && ["blank", "srcdoc"].includes(parsed.pathname)) ||
        ["data:", "blob:"].includes(parsed.protocol)
      );
    } catch { return false; }
  }
}

/** 仅放行 Chromium 内置 PDF 查看器发起的私有渲染子框架，不开放扩展导航。 */
function allowedPDFFrame(
  event: { url: string; frame?: Electron.WebFrameMain | null; initiator?: Electron.WebFrameMain | null },
  contents: WebContents,
): boolean {
  const viewer = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";
  const parent = event.frame?.parent;
  return Boolean(
    parent && parent.url === `${viewer}index.html` &&
    parent.parent === contents.mainFrame && event.initiator === parent &&
    event.url.startsWith(viewer) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(event.url.slice(viewer.length))
  );
}

/** 将远程页面限制在所属窗口的独立原生视图中。 */
export function createBrowserPanel(
  owner: BrowserWindow,
  browserSession: Session,
  publish: (state: BrowserPanelState) => void,
  publishContext: (value: BrowserPromptContext) => void,
  publishComment: (event: BrowserCommentEvent) => void = () => {},
): BrowserPanelController {
  // closed 触发时 BrowserWindow 的 getter 已不可用，保留监听器所属对象用于释放。
  const hostContents = owner.webContents;
  let state = emptyState(0);
  let view: WebContentsView | undefined;
  let effectiveLayout = false;
  let layout: BrowserPanelLayout | undefined;
  let disposed = false;
  let generation = 0;
  let navigation = 0;
  let pendingURL = "";
  let scope: string | null = null;
  let menu: Menu | undefined;
  let pick: { cancel(): void } | undefined;
  let contextEpoch = 0;
  let documentId = randomUUID();
  const anchors = new Map<string, BrowserCommentAnchor>();
  let editor: BrowserCommentEditor | null = null;
  let markers: BrowserCommentMarker[] = [];
  let polling = false;
  let markerRevision = 0;
  let appliedMarkerRevision = -1;
  let moving = false;
  let moveTimer: NodeJS.Timeout | undefined;
  let reveal: { request: BrowserCommentRevealRequest; cancel(): void } | undefined;
  let revealEpoch = 0;
  let committedURL = "";
  let committed = false;
  let pdfAbort: AbortController | undefined;
  let pdfIdentity: { documentId: string; navigation: number; url: string; frame: Electron.WebFrameMain } | undefined;
  let pdfSourceURL = "";
  let pdf: ReturnType<typeof createBrowserPdfView> | undefined;
  /** 取消会立即完成 host 请求；尚未返回的隔离世界结果不再修改几何。 */
  const cancelReveal = () => {
    revealEpoch++;
    reveal?.cancel();
    reveal = undefined;
    pdf?.cancelReveal();
  };
  const overlay = createBrowserCommentOverlay(owner, event => {
    if (!editor || event.scope !== scope || event.scope !== editor.scope || !("editorId" in event) || event.editorId !== editor.editorId) return;
    if (event.type === "change" || event.type === "confirm") editor = { ...editor, comment: event.comment };
    if (event.type === "cancel") view?.webContents.focus();
    publishComment(event);
  });
  /** 页面矩形只乘远端 zoom；视图 bounds 已是原生 DIP，不能再叠加 DPI。 */
  const positionEditor = () => {
    if (!editor || editor.scope !== scope || !view || !effectiveLayout || !layout?.visible || owner.isDestroyed() || owner.isMinimized() || !owner.isVisible() || crashed || moving) {
      overlay.setGeometry(null);
      return;
    }
    const bounds = editor.sourceAnchor.kind === "pdf" && pdf ? pdf.getBounds() : view.getBounds();
    if (!bounds) { overlay.setGeometry(null); return; }
    const [contentWidth, contentHeight] = owner.getContentSize();
    const hostZoom = owner.webContents.getZoomFactor();
    const pageZoom = editor.sourceAnchor.kind === "pdf" ? 1 : view.webContents.getZoomFactor();
    const width = Math.min(Math.round(420 * hostZoom), bounds.width, contentWidth);
    const height = Math.min(Math.round((editor.image ? 380 : 280) * hostZoom), Math.floor(bounds.height * (editor.image ? 0.85 : 1)), contentHeight);
    if (width <= 0 || height <= 0) { overlay.setGeometry(null); return; }
    const anchor = anchors.get(editor.sourceAnchor.anchorId);
    const rect = editor.sourceAnchor.documentId === documentId ? anchor?.rect : undefined;
    const left = Math.max(0, bounds.x);
    const top = Math.max(0, bounds.y);
    const right = Math.min(contentWidth, bounds.x + bounds.width);
    const bottom = Math.min(contentHeight, bounds.y + bounds.height);
    let x = rect ? bounds.x + rect.x * pageZoom : left;
    let y = rect ? bounds.y + rect.y * pageZoom - height - 8 * hostZoom : top;
    if (rect && y < top) y = bounds.y + (rect.y + rect.height) * pageZoom + 8 * hostZoom;
    x = Math.max(left, Math.min(x, right - width));
    y = Math.max(top, Math.min(y, bottom - height));
    overlay.setGeometry({ x: Math.round(x), y: Math.round(y), width, height }, rect ? undefined : editor.sourceAnchor.unavailable ?? anchor?.unavailable ?? "来源当前不可定位");
  };
  /** 活跃标记和编辑器才授权轮询；每次请求绑定文档和 scope，迟到结果全部丢弃。 */
  const pollAnchors = async () => {
    const contents = view?.webContents;
    if (polling || reveal || disposed || !contents || contents.isDestroyed() || !effectiveLayout || !layout?.visible || !scope || moving || owner.isMinimized() || !owner.isVisible() || crashed || state.loading || state.isPDF ||
      contents.mainFrame.frames.some(frame => frame.url === "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html")) return;
    // 新文档没有颁发过 HTML 锚点时，无 tracker 可同步；不能为清空旧标记向 PDF 注入脚本。
    if (!anchors.size) { appliedMarkerRevision = markerRevision; return; }
    const ids = [...new Set([...markers.filter(marker => marker.scope === scope && marker.sourceAnchor.documentId === documentId).map(marker => marker.sourceAnchor.anchorId),
      ...(editor?.scope === scope && editor.sourceAnchor.documentId === documentId ? [editor.sourceAnchor.anchorId] : [])])].filter(id => anchors.has(id));
    if (!ids.length && appliedMarkerRevision === markerRevision) return;
    const doc = documentId;
    const capturedScope = scope;
    const revision = markerRevision;
    const capturedRevealEpoch = revealEpoch;
    polling = true;
    try {
      if (appliedMarkerRevision !== revision) {
        await syncPageMarkers(contents, markers.filter(marker => marker.scope === capturedScope && marker.sourceAnchor.documentId === doc && anchors.has(marker.sourceAnchor.anchorId)).map(marker => ({ anchorId: marker.sourceAnchor.anchorId, number: marker.number })));
        if (doc !== documentId || scope !== capturedScope || disposed) return;
        appliedMarkerRevision = revision;
      }
      if (!ids.length) return;
      const result = await readPageAnchors(contents, ids);
      if (doc !== documentId || scope !== capturedScope || disposed || view?.webContents !== contents || reveal || capturedRevealEpoch !== revealEpoch) return;
      for (const value of result.anchors) {
        const anchor = anchors.get(value.anchorId);
        if (anchor && ids.includes(value.anchorId)) anchors.set(value.anchorId, { ...anchor, rect: value.rect, unavailable: value.unavailable ? "来源当前不可定位" : undefined });
      }
      positionEditor();
      if (result.clicked) {
        const marker = markers.find(item => item.scope === capturedScope && item.sourceAnchor.documentId === doc && item.sourceAnchor.anchorId === result.clicked);
        if (marker) publishComment({ type: "marker", scope: capturedScope, id: marker.id });
      }
    } catch {
      if (doc === documentId && scope === capturedScope && !disposed && !reveal && capturedRevealEpoch === revealEpoch) {
        for (const id of ids) { const anchor = anchors.get(id); if (anchor) anchors.set(id, { ...anchor, rect: undefined, unavailable: "来源当前不可定位" }); }
        positionEditor();
      }
    } finally { polling = false; }
  };
  const pollTimer = setInterval(() => { void pollAnchors(); }, 100);
  /** 每次新主文档都废弃几何权限，但保留 host 的不可变来源快照。 */
  const newDocument = () => {
    cancelReveal();
    revokePdf();
    committed = false;
    documentId = randomUUID();
    anchors.clear();
    appliedMarkerRevision = -1;
    markerRevision++;
    positionEditor();
  };
  const cancelContext = () => {
    contextEpoch++;
    menu?.closePopup(owner);
    menu = undefined;
    pdf?.cancelInteractions();
    if (view && !view.webContents.isDestroyed()) cancelRegionCapture(view.webContents);
    pick?.cancel();
    pick = undefined;
    if (state.selectingElement) emit({ selectingElement: false, selectionMode: undefined });
  };
  const webContext = (contents: WebContents, text: string, element?: { tag: string; label: string }, sourceAnchor?: WebCommentAnchor): BrowserPromptContext => {
    const context = { kind: "web" as const, url: browserURL(contents.getURL()), title: contents.getTitle(), text, ...(element ? { element } : {}) };
    validatePromptContext(context);
    return { scope: scope!, context, sourceAnchor };
  };
  // 崩溃后保留最后 URL，但不自动重试。
  let crashed = false;
  // 原生 history API 不触发 will-frame-navigate，单独等待一次实际导航。
  let awaitingHistory = false;
  const targets = sessionTargets(browserSession);
  const emit = (patch: Partial<BrowserPanelState>) => {
    if (disposed) return;
    state = { ...state, ...patch, revision: state.revision + 1 };
    publish({ ...state });
  };
  const revokePdf = () => {
    // 即使 URL 未变，替换直属 viewer 也代表新的字节授权，旧锚点不得重绑。
    if (pdfIdentity) {
      documentId = randomUUID();
      anchors.clear();
      markerRevision++;
      appliedMarkerRevision = -1;
    }
    pdfAbort?.abort();
    pdfAbort = undefined;
    pdfIdentity = undefined;
    pdfSourceURL = "";
    pdf?.dispose();
    pdf = undefined;
    if (state.pdfStatus) emit({ pdfStatus: undefined });
    syncBodyVisibility();
  };
  const hostVisible = () => Boolean(effectiveLayout && layout?.visible && view && !crashed && !moving && !owner.isDestroyed() && owner.isVisible() && !owner.isMinimized());
  /** 原生导航 view 始终保有历史；可信 reader 只接管正文。 */
  const syncBodyVisibility = () => {
    const visible = hostVisible();
    const readerActive = Boolean(pdf && (state.pdfStatus === "ready" || state.pdfStatus === "password"));
    view?.setVisible(visible && !readerActive);
    pdf?.setVisible(visible);
    const warming = Boolean(pdf && state.pdfStatus === "loading");
    // Windows 隐藏的原生 view 不产生动画帧；在原生阅读层背后完成首屏，成功后才交接。
    pdf?.setBodyVisible(visible && (readerActive || warming));
    if (visible && warming && view) {
      owner.contentView.removeChildView(view);
      owner.contentView.addChildView(view);
    }
    positionEditor();
    overlay.raise();
  };
  const syncPdfMarkers = () => {
    if (!pdf || !pdfIdentity) return;
    pdf.syncMarkers(markers.flatMap(marker => {
      const anchor = anchors.get(marker.sourceAnchor.anchorId);
      return marker.scope === scope && marker.sourceAnchor.documentId === documentId && anchor?.kind === "pdf"
        ? [{ anchorId: anchor.anchorId, number: marker.number, page: anchor.page, pageRect: anchor.pageRect }] : [];
    }), markerRevision);
  };
  const pdfViewerFrame = () => view?.webContents.mainFrame.frames.find(frame =>
    !frame.detached && frame.parent === view?.webContents.mainFrame &&
    frame.url === "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html");
  const pdfCurrent = () => Boolean(pdfIdentity && committed && pdfIdentity.documentId === documentId &&
    pdfIdentity.navigation === navigation && pdfIdentity.url === committedURL && pdfViewerFrame() === pdfIdentity.frame);
  const performPdfPick = async (mode: PdfPickMode): Promise<BrowserPromptContext | null> => {
    cancelContext();
    if (!scope || !pdf || !pdfCurrent() || state.pdfStatus !== "ready" || !hostVisible()) throw new Error("当前 PDF 不可选择");
    const capturedScope = scope;
    const epoch = contextEpoch;
    const capturedDocument = documentId;
    const requestId = randomUUID();
    const anchorId = randomUUID();
    const pending = pdf.pick({ documentId, requestId, anchorId, mode });
    pick = pending;
    emit({ selectingElement: true, selectionMode: mode === "text" ? "element" : mode, error: undefined });
    try {
      const value = await pending.result;
      if (!value || pick !== pending || epoch !== contextEpoch || capturedScope !== scope || capturedDocument !== documentId || !pdfCurrent() || !hostVisible()) return null;
      const anchor: PdfCommentAnchor = { kind: "pdf", documentId, anchorId, page: value.page, pageRect: value.pageRect, rect: value.rect };
      const context = { kind: "pdf" as const, url: pdfSourceURL, title: state.title, page: value.page, selection: value.selection, text: value.text, ...(value.image ? { image: value.image } : {}) };
      validatePromptContext(context);
      anchors.set(anchorId, anchor);
      return { scope: capturedScope, context, sourceAnchor: anchor };
    } finally {
      if (pick === pending) { pick = undefined; emit({ selectingElement: false, selectionMode: undefined }); }
    }
  };
  /** 仅当前已提交主文档的精确直属 Chromium viewer 可以授权重新 GET。 */
  const detectCurrentPdf = () => {
    if (disposed || !committed || !view || crashed) return;
    const frame = pdfViewerFrame();
    if (!frame) {
      if (pdfIdentity) { revokePdf(); syncBodyVisibility(); }
      return;
    }
    if (pdfCurrent()) return;
    revokePdf();
    const identity = { documentId, navigation, url: committedURL, frame };
    pdfIdentity = identity;
    const abort = new AbortController();
    pdfAbort = abort;
    emit({ isPDF: true, pdfStatus: "loading", loading: true, error: undefined });
    const fail = (message: string) => {
      if (pdfIdentity !== identity || !pdfCurrent()) return;
      cancelContext();
      cancelReveal();
      pdf?.setBodyVisible(false);
      emit({ pdfStatus: "error", loading: false, error: `PDF 元素解析失败：${message}；当前使用原生阅读，选择不可用` });
      syncBodyVisibility();
    };
    void loadBrowserPdf(browserSession, identity.url, abort.signal).then(document => {
      if (pdfIdentity !== identity || !pdfCurrent() || abort.signal.aborted) return;
      pdfSourceURL = document.url;
      pdf = createBrowserPdfView(owner, {
        onLoaded: () => { if (pdfIdentity === identity && pdfCurrent()) syncBodyVisibility(); },
        onReady: () => {
          if (!pdfCurrent() || pdfIdentity !== identity) return;
          emit({ pdfStatus: "ready", loading: false, error: undefined });
          syncPdfMarkers();
          syncBodyVisibility();
        },
        onPassword: () => {
          if (!pdfCurrent() || pdfIdentity !== identity) return;
          emit({ pdfStatus: "password", loading: false });
          syncBodyVisibility();
        },
        onError: fail,
        onGeometry: (values, revision) => {
          if (!pdfCurrent() || revision !== markerRevision) return;
          for (const value of values) {
            const anchor = anchors.get(value.anchorId);
            if (anchor?.kind === "pdf") anchors.set(value.anchorId, { ...anchor, rect: value.rect, unavailable: value.rect ? undefined : "来源当前不可定位" });
          }
          positionEditor();
        },
        onMarker: (anchorId, revision) => {
          if (!pdfCurrent() || revision !== markerRevision || !hostVisible()) return;
          const marker = markers.find(item => item.scope === scope && item.sourceAnchor.documentId === documentId && item.sourceAnchor.anchorId === anchorId);
          if (marker) publishComment({ type: "marker", scope: marker.scope, id: marker.id });
        },
        onLink: url => { if (pdfCurrent()) { try { controller.open(browserURL(url)); } catch { /* reader 不得打开非 HTTP(S) 链接。 */ } } },
        onTextComment: () => {
          void performPdfPick("text").then(value => { if (value) publishContext(value); }).catch(reason => {
            if (pdfCurrent()) emit({ error: reason instanceof Error ? reason.message : String(reason) });
          });
        },
      });
      pdf.setBounds(effectiveLayout ? view!.getBounds() : null);
      pdf.setVisible(hostVisible());
      pdf.load({ documentId, url: document.url, title: state.title, bytes: document.bytes });
      pdf.setHash(new URL(committedURL).hash);
      syncBodyVisibility();
    }).catch(reason => { if (!abort.signal.aborted) fail(reason instanceof Error ? reason.message : String(reason)); });
  };
  const hide = () => {
    effectiveLayout = false;
    pdf?.setBounds(null);
    overlay.setGeometry(null);
    cancelContext();
    pdf?.setVisible(false);
    pdf?.setBodyVisible(false);
    if (!view) return;
    view.setVisible(false);
    if (!view.webContents.isDestroyed() && view.webContents.isFocused() && !owner.isDestroyed()) owner.webContents.focus();
  };
  const invalidateLayout = () => {
    layout = undefined;
    hide();
  };
  const syncHistory = () => {
    const contents = view?.webContents;
    if (!contents || contents.isDestroyed() || crashed) return {};
    return {
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    };
  };
  const removeView = () => {
    cancelContext();
    generation++;
    newDocument();
    navigation++;
    pendingURL = "";
    awaitingHistory = false;
    layout = undefined;
    const previous = view;
    hide();
    view = undefined;
    if (!previous) return;
    targets.delete(previous.webContents);
    previous.webContents.removeAllListeners();
    if (!owner.isDestroyed()) owner.contentView.removeChildView(previous);
    if (!previous.webContents.isDestroyed()) previous.webContents.close({ waitForBeforeUnload: false });
  };
  const ensureView = () => {
    if (view) return view;
    const current = new WebContentsView({ webPreferences: {
      session: browserSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
    } });
    view = current;
    layout = undefined;
    crashed = false;
    const contents = current.webContents;
    const page = ++generation;
    const live = () => !disposed && view === current && generation === page;
    const error = (message: string) => { if (live()) emit({ error: message }); };
    targets.set(contents, { error });
    contents.setZoomFactor(1);
    const guard = (event: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>) => {
      const allowed = event.isMainFrame ? (() => { try { browserURL(event.url); return true; } catch { return false; } })() : allowedFrame(event.url) || allowedPDFFrame(event, contents);
      if (!allowed) {
        event.preventDefault();
        error(navigationError);
      } else if (event.isMainFrame && live()) {
        cancelContext();
        cancelReveal();
        const url = browserURL(event.url);
        if (url !== pendingURL) navigation++;
        pendingURL = url;
      }
      if (!event.isMainFrame && live()) cancelContext();
    };
    contents.on("will-frame-navigate", guard);
    contents.on("will-redirect", guard);
    contents.setWindowOpenHandler(({ url }) => {
      if (live()) {
        try { controller.open(browserURL(url)); } catch { error(navigationError); }
      }
      return { action: "deny" };
    });
    contents.on("did-start-navigation", (details) => {
      if (!live() || !details.isMainFrame) return;
      cancelContext();
      try {
        const url = browserURL(details.url);
        // loadURL 的旧 did-start 也可能迟到，不能把后接受的目标改回去。
        if (url !== pendingURL && !details.isSameDocument && !awaitingHistory) return;
        if (!details.isSameDocument) newDocument();
        awaitingHistory = false;
        if (url !== pendingURL && (!details.isSameDocument || !pdfIdentity)) navigation++;
        pendingURL = url;
        emit({ url, ...(details.isSameDocument && state.pdfStatus === "error" ? {} : { error: undefined }), ...syncHistory() });
      } catch { /* 非法目标由导航策略拒绝。 */ }
    });
    contents.on("will-redirect", (details) => {
      if (!live() || !details.isMainFrame || details.defaultPrevented) return;
      try { pendingURL = browserURL(details.url); } catch { /* 已拒绝。 */ }
    });
    const navigated = (url: string) => {
      if (!live()) return;
      try {
        const actual = browserURL(url);
        if (actual !== pendingURL) return;
        pendingURL = actual;
        committedURL = actual;
        committed = true;
        emit({ url: actual, ...(state.pdfStatus !== "error" ? { error: undefined } : {}), ...syncHistory() });
        detectCurrentPdf();
      } catch { /* 初始空白页不暴露为合法 URL。 */ }
    };
    contents.on("did-navigate", (_event, url) => navigated(url));
    contents.on("did-navigate-in-page", (_event, url, main) => {
      if (!main || !live()) return;
      if (anchors.size && !state.isPDF && !pdfViewerFrame()) void invalidatePageRegions(contents).catch(() => {});
      cancelContext();
      cancelReveal();
      if (pdfIdentity && withoutHash(url) !== withoutHash(committedURL)) newDocument();
      if (pdfIdentity) {
        committedURL = browserURL(url);
        pendingURL = committedURL;
        pdfIdentity.url = committedURL;
        pdfIdentity.navigation = navigation;
        pdf?.setHash(new URL(url).hash);
      }
      navigated(url);
    });
    contents.on("page-title-updated", (_event, title) => { if (live()) emit({ title }); });
    const loadingChanged = () => {
      if (!live() || crashed) return;
      detectCurrentPdf();
      emit({ loading: state.pdfStatus === "loading" || (state.pdfStatus !== "error" && state.pdfStatus !== "password" && contents.isLoading()), isPDF: Boolean(pdfViewerFrame()), ...syncHistory() });
    };
    contents.on("did-start-loading", loadingChanged);
    contents.on("did-stop-loading", loadingChanged);
    contents.on("did-frame-navigate", () => { if (live()) detectCurrentPdf(); });
    contents.on("did-frame-finish-load", () => { if (live()) detectCurrentPdf(); });
    contents.on("frame-created", () => { if (live()) detectCurrentPdf(); });
    contents.on("did-fail-load", (_event, code, description, url, main) => {
      if (live() && main && code !== -3 && url === pendingURL) emit({ loading: false, error: description || "网页加载失败", ...syncHistory() });
    });
    contents.on("render-process-gone", () => {
      if (!live()) return;
      crashed = true;
      revokePdf();
      cancelReveal();
      hide();
      emit({ loading: false, canGoBack: false, canGoForward: false, error: "网页进程已退出，请刷新或重新打开" });
    });
    contents.on("context-menu", (_event, params) => {
      cancelContext();
      if (!live()) return;
      const epoch = ++contextEpoch;
      const nav = navigation;
      const capturedScope = scope;
      const frame = params.frame;
      const capturedFrameURL = frame?.url;
      const viewer = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html";
      // Electron 的 PDF plugin 也会把事件归于 HTTP 主框架；只有真实直属 viewer 才能证明其身份。
      const pluginViewer = frame === contents.mainFrame && frame.url === contents.getURL()
        ? contents.mainFrame.frames.find(child => !child.detached && child.url === viewer && child.parent === contents.mainFrame)
        : undefined;
      const pdf = Boolean(frame && (
        (frame.url === viewer && frame.parent === contents.mainFrame) ||
        (frame.parent?.url === viewer && frame.parent.parent === contents.mainFrame && frame.url === contents.getURL()) ||
        pluginViewer
      ));
      const safeFrame = frame === contents.mainFrame || pdf;
      const valid = () => live() && nav === navigation && epoch === contextEpoch && capturedScope === scope && Boolean(scope) &&
        Boolean(frame && !frame.detached && frame.url === capturedFrameURL && params.frame === frame) &&
        (!pluginViewer || (!pluginViewer.detached && pluginViewer.url === viewer && pluginViewer.parent === contents.mainFrame && contents.mainFrame.frames.includes(pluginViewer)));
      const selection = params.selectionText;
      const canComment = Boolean(selection.trim() && !params.isEditable && params.formControlType === "none" && safeFrame && scope);
      const anchorId = randomUUID();
      const capturedDocument = documentId;
      // 菜单打开即捕获 Range，不能点击菜单后再读取另一份选区。
      const capturedSelection = canComment && !pdf ? capturePageSelection(contents, anchorId, selection).then(value => ({ value }), reason => ({ reason })) : null;
      const items: Electron.MenuItemConstructorOptions[] = [];
      const password = params.formControlType === "input-password";
      if (!selection && params.linkURL) {
        let link: string | undefined;
        try { link = browserURL(params.linkURL); } catch { /* 不复制危险协议。 */ }
        items.push({ label: "复制链接地址", enabled: !password && Boolean(link), click: () => {
          if (!live() || epoch !== contextEpoch || password || !link) return;
          void clipboard.writeText(link).catch((reason: unknown) => {
            if (live() && epoch === contextEpoch) error(reason instanceof Error ? reason.message : String(reason));
          });
        } });
      } else items.push({ label: "复制", enabled: !password && params.editFlags.canCopy, click: () => { if (live() && epoch === contextEpoch && !password && params.editFlags.canCopy) contents.copy(); } });
      items.push({
        label: !safeFrame && selection ? "请在主页面选择内容" : selection ? "评论" : pdf ? "不支持提取此 PDF 选区" : "评论所选内容",
        enabled: canComment,
        click: () => {
          void (async () => {
            if (!canComment || !valid()) return;
            if (capturedDocument !== documentId) return;
            let sourceAnchor: WebCommentAnchor;
            if (capturedSelection) {
              const captured = await capturedSelection;
              if (!valid() || capturedDocument !== documentId) return;
              if ("reason" in captured) throw captured.reason;
              sourceAnchor = { kind: "web", documentId, anchorId, rect: captured.value.rect };
              anchors.set(anchorId, sourceAnchor);
            } else sourceAnchor = { kind: "web", documentId, anchorId, unavailable: "PDF 暂不支持原位标记" };
            if (valid()) publishContext(webContext(contents, selection, undefined, sourceAnchor));
          })().catch((reason: unknown) => { if (valid()) error(reason instanceof Error ? reason.message : String(reason)); });
        },
      });
      items.push({ label: "选择页面元素", enabled: Boolean(scope && frame && !state.loading && !state.isPDF && !pdf), click: () => {
        if (!valid() || state.loading || state.isPDF || pdf) return;
        void controller.pickElement(capturedScope, "element").then(value => {
          if (value && live() && navigation === nav && scope === capturedScope && value.scope === scope) publishContext(value);
        }).catch(reason => {
          if (live() && navigation === nav && scope === capturedScope) error(reason instanceof Error ? reason.message : String(reason));
        });
      } });
      menu = Menu.buildFromTemplate(items);
      menu.popup({ window: owner });
    });
    // 策略先安装，再将原生视图挂到宿主；新页必须重新提交布局。
    current.setVisible(false);
    owner.contentView.addChildView(current);
    return current;
  };
  const applyLayout = () => {
    if (!view || !layout?.visible || !state.url || crashed || owner.isDestroyed()) { hide(); return; }
    const zoom = owner.webContents.getZoomFactor();
    const [width, height] = owner.getContentSize();
    const bounds = layout.bounds;
    const left = Math.max(0, Math.min(width, Math.round(bounds.x * zoom)));
    const top = Math.max(0, Math.min(height, Math.round(bounds.y * zoom)));
    const right = Math.max(left, Math.min(width, Math.round((bounds.x + bounds.width) * zoom)));
    const bottom = Math.max(top, Math.min(height, Math.round((bounds.y + bounds.height) * zoom)));
    if (right === left || bottom === top) { hide(); return; }
    const nextBounds = { x: left, y: top, width: right - left, height: bottom - top };
    const previousBounds = view.getBounds();
    if (previousBounds.x !== left || previousBounds.y !== top || previousBounds.width !== nextBounds.width || previousBounds.height !== nextBounds.height) cancelContext();
    view.setBounds(nextBounds);
    pdf?.setBounds(nextBounds);
    effectiveLayout = true;
    syncBodyVisibility();
    void pollAnchors();
  };
  const hostNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (details.isMainFrame && !details.isSameDocument) invalidateLayout();
  };
  owner.on("resize", invalidateLayout);
  const temporaryHide = () => { cancelContext(); cancelReveal(); overlay.setGeometry(null); pdf?.setVisible(false); pdf?.setBodyVisible(false); };
  const moved = () => {
    temporaryHide();
    moving = true;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { moving = false; syncBodyVisibility(); void pollAnchors(); }, 120);
  };
  owner.on("hide", temporaryHide);
  owner.on("move", moved);
  owner.on("minimize", temporaryHide);
  owner.on("show", applyLayout);
  owner.on("restore", applyLayout);
  hostContents.on("did-start-navigation", hostNavigation);
  const controller: BrowserPanelController = {
    setContextScope(input) {
      if (disposed) throw new Error("浏览器已关闭");
      if (input !== null && (typeof input !== "string" || !input.length || input.length > 128)) throw new Error("浏览器上下文范围无效");
      if (scope === input) return;
      cancelContext();
      cancelReveal();
      scope = input;
      // scope 轮换只撤回交互权限；保留文档 tracker，等待 host 用新 scope 重新授权。
      overlay.setGeometry(null);
      markerRevision++;
      syncPdfMarkers();
    },
    setCommentEditor(input) {
      if (disposed) throw new Error("浏览器已关闭");
      if (input === null) {
        editor = null;
        overlay.setEditor(null);
        return;
      }
      if (!input || typeof input !== "object") throw new Error("网页评论参数无效");
      const value = input as Record<string, unknown>;
      const anchor = value.sourceAnchor as Record<string, unknown> | undefined;
      if (typeof value.scope !== "string" || value.scope !== scope ||
        typeof value.editorId !== "string" || !value.editorId.length || value.editorId.length > 128 ||
        typeof value.source !== "string" || value.source.length > 8192 ||
        typeof value.comment !== "string" || value.comment.length > 16000 ||
        (value.theme !== "light" && value.theme !== "dark") ||
        typeof value.fontSize !== "number" || !Number.isFinite(value.fontSize) || value.fontSize < 8 || value.fontSize > 40 ||
        (value.error !== undefined && (typeof value.error !== "string" || value.error.length > 2048)) ||
        (value.editing !== undefined && typeof value.editing !== "boolean") ||
        !anchor || (anchor.kind !== "web" && anchor.kind !== "pdf") ||
        typeof anchor.documentId !== "string" || anchor.documentId.length > 128 ||
        typeof anchor.anchorId !== "string" || anchor.anchorId.length > 128 ||
        (anchor.unavailable !== undefined && (typeof anchor.unavailable !== "string" || anchor.unavailable.length > 512))) throw new Error("网页评论参数无效");
      // 不采信宿主回传的几何；仅使用本进程为当前文档颁发并测量的锚点。
      const known = anchor.documentId === documentId ? anchors.get(anchor.anchorId) : undefined;
      const sourceAnchor: BrowserCommentAnchor = known ?? { kind: "web", documentId: anchor.documentId, anchorId: anchor.anchorId, unavailable: typeof anchor.unavailable === "string" ? anchor.unavailable : "来源当前不可定位" };
      if (value.image !== undefined) validatePromptContextImage(value.image);
      editor = {
        scope: value.scope, editorId: value.editorId, source: value.source, comment: value.comment,
        theme: value.theme, fontSize: value.fontSize, sourceAnchor,
        ...(value.image !== undefined ? { image: value.image } : {}),
        ...(typeof value.error === "string" ? { error: value.error } : {}),
        ...(typeof value.editing === "boolean" ? { editing: value.editing } : {}),
      };
      overlay.setEditor(editor);
      positionEditor();
      void pollAnchors();
    },
    syncCommentMarkers(input) {
      if (!Array.isArray(input) || input.length > 1024) throw new Error("网页评论标记参数无效");
      const next: BrowserCommentMarker[] = [];
      for (const item of input as unknown[]) {
        if (!item || typeof item !== "object") throw new Error("网页评论标记参数无效");
        const value = item as Record<string, unknown>;
        const anchor = value.sourceAnchor as Record<string, unknown> | undefined;
        if (value.scope !== scope || typeof value.scope !== "string" ||
          typeof value.id !== "string" || !value.id.length || value.id.length > 128 ||
          typeof value.number !== "number" || !Number.isSafeInteger(value.number) || value.number < 1 ||
          !anchor || (anchor.kind !== "web" && anchor.kind !== "pdf") || typeof anchor.documentId !== "string" || anchor.documentId.length > 128 ||
          typeof anchor.anchorId !== "string" || anchor.anchorId.length > 128) throw new Error("网页评论标记参数无效");
        const sourceAnchor: BrowserCommentAnchor = (anchor.documentId === documentId ? anchors.get(anchor.anchorId) : undefined) ?? { kind: "web", documentId: anchor.documentId, anchorId: anchor.anchorId, unavailable: "来源当前不可定位" };
        next.push({ scope: value.scope, id: value.id, number: value.number, sourceAnchor });
      }
      markers = next;
      if (reveal && !markers.some(marker => marker.scope === reveal!.request.scope && marker.id === reveal!.request.entryId &&
        marker.sourceAnchor.documentId === reveal!.request.documentId && marker.sourceAnchor.anchorId === reveal!.request.anchorId)) cancelReveal();
      markerRevision++;
      syncPdfMarkers();
      void pollAnchors();
    },
    async revealComment(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("网页评论定位参数无效");
      const value = input as Record<string, unknown>;
      if (Object.keys(value).length !== 5 || ["scope", "requestId", "entryId", "documentId", "anchorId"].some(key =>
        typeof value[key] !== "string" || !(value[key] as string).length || (value[key] as string).length > 128) ||
        !/^[a-zA-Z0-9_-]+$/.test(value.anchorId as string)) throw new Error("网页评论定位参数无效");
      const request = value as unknown as BrowserCommentRevealRequest;
      cancelReveal();
      const unavailable = (reason: string): BrowserCommentRevealResult => ({ requestId: request.requestId, status: "unavailable", reason });
      const cancelled = Promise.withResolvers<BrowserCommentRevealResult>();
      const pending = { request, cancel: () => cancelled.resolve(unavailable("定位已取消")) };
      reveal = pending;
      const contents = view?.webContents;
      const current = () => reveal === pending && !disposed && !crashed && scope === request.scope &&
        documentId === request.documentId && contents === view?.webContents && Boolean(contents && !contents.isDestroyed()) &&
        markers.some(marker => marker.scope === request.scope && marker.id === request.entryId &&
          marker.sourceAnchor.documentId === request.documentId && marker.sourceAnchor.anchorId === request.anchorId) &&
        anchors.has(request.anchorId);
      let layoutTimer: NodeJS.Timeout | undefined;
      let layoutDeadline: NodeJS.Timeout | undefined;
      const visible = () => Boolean(hostVisible() && view?.getBounds().width && view?.getBounds().height);
      try {
        return await Promise.race([cancelled.promise, (async (): Promise<BrowserCommentRevealResult> => {
          if (!current()) return unavailable("来源当前不可定位：文档或评论标记已失效");
          // sidebar 展开和 IPC 到达顺序不固定；等待当前文档的真实 native layout，不重新导航。
          if (!visible()) {
            const layoutReady = Promise.withResolvers<void>();
            layoutTimer = setInterval(() => { if (!current() || visible()) layoutReady.resolve(); }, 25);
            layoutDeadline = setTimeout(layoutReady.resolve, 2000);
            await layoutReady.promise;
          }
          if (!current()) return unavailable("定位已取消");
          if (!visible()) return unavailable("来源当前不可定位：浏览器未显示");
          // 最后一次权限检查紧邻同步滚动命令，未授权 entry/旧 document 不进入隔离世界。
          const source = anchors.get(request.anchorId)!;
          if ((state.isPDF || pdfViewerFrame()) && (source.kind !== "pdf" || state.pdfStatus !== "ready" || !pdfCurrent())) return unavailable("PDF 选择当前不可用");
          const result = source.kind === "pdf"
            ? await pdf!.reveal({ documentId, requestId: request.requestId, anchorId: source.anchorId, page: source.page, pageRect: source.pageRect })
            : await revealPageAnchor(contents!, request.anchorId);
          if (!current()) return unavailable("定位已取消");
          if (!visible()) return unavailable("来源当前不可定位：浏览器已隐藏");
          const anchor = anchors.get(request.anchorId)!;
          anchors.set(request.anchorId, { ...anchor, rect: result.rect, unavailable: result.unavailable ? "来源当前不可定位" : undefined });
          positionEditor();
          return result.rect ? { requestId: request.requestId, status: "located" } : unavailable("来源当前不可定位：原内容已变化、隐藏或移除");
        })()]);
      } catch {
        return unavailable("来源当前不可定位");
      } finally {
        clearInterval(layoutTimer);
        clearTimeout(layoutDeadline);
        if (reveal === pending) reveal = undefined;
      }
    },
    cancelCommentReveal(input) {
      if (typeof input !== "string" || !input.length || input.length > 128) throw new Error("网页评论定位参数无效");
      if (reveal?.request.requestId === input) cancelReveal();
    },
    cancelElementPick() { cancelContext(); },
    async pickElement(input, mode) {
      if (typeof input !== "string" || input !== scope || !scope) throw new Error("浏览器上下文已失效");
      if (mode !== "element" && mode !== "region") throw new Error("浏览器选择模式无效");
      if (state.isPDF) return performPdfPick(mode);
      cancelContext();
      const contents = view?.webContents;
      if (disposed || !contents || contents.isDestroyed() || crashed || state.loading || !hostVisible()) throw new Error("当前网页不可选择元素");
      if (contents.mainFrame.frames.some(frame => frame.url === "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html")) throw new Error("PDF 不支持选择页面元素，请选择文字后评论");
      browserURL(contents.getURL());
      const epoch = contextEpoch;
      const page = generation;
      const nav = navigation;
      const anchorId = randomUUID();
      const capturedDocument = documentId;
      const requestId = randomUUID();
      const pending = mode === "region" ? beginRegionPick(contents, anchorId, requestId) : beginElementPick(contents, anchorId);
      pick = pending;
      emit({ selectingElement: true, selectionMode: mode, error: undefined });
      try {
        const value = await pending.result;
        if (!value || disposed || pick !== pending || epoch !== contextEpoch || page !== generation || nav !== navigation || scope !== input) return null;
        if (capturedDocument !== documentId) return null;
        if (mode === "region") {
          const current = () => !disposed && pick === pending && epoch === contextEpoch && page === generation && nav === navigation && scope === input && capturedDocument === documentId && hostVisible();
          const image = await captureBrowserRegion(contents, value as PageRegionSelection, current);
          if (!current()) return null;
          const sourceAnchor: WebCommentAnchor = { kind: "web", documentId, anchorId, rect: value.rect };
          const context = { kind: "web-region" as const, url: browserURL(contents.getURL()), title: contents.getTitle(), image };
          validatePromptContext(context);
          anchors.set(anchorId, sourceAnchor);
          return { scope: input, context, sourceAnchor };
        }
        const sourceAnchor: WebCommentAnchor = { kind: "web", documentId, anchorId, rect: value.rect };
        anchors.set(anchorId, sourceAnchor);
        const element = value as BrowserElementSelection;
        return webContext(contents, element.text, { tag: element.tag, label: element.label }, sourceAnchor);
      } finally {
        if (pick === pending) { pick = undefined; emit({ selectingElement: false, selectionMode: undefined }); }
      }
    },
    open(input) {
      if (disposed) throw new Error("浏览器已关闭");
      cancelContext();
      cancelReveal();
      const url = browserURL(input);
      awaitingHistory = false;
      const recoveryLayout = crashed ? layout : undefined;
      if (crashed) removeView();
      const current = ensureView();
      const page = generation;
      const fragmentOnly = pdfCurrent() && url !== committedURL && withoutHash(url) === withoutHash(committedURL);
      const request = ++navigation;
      if (fragmentOnly && pdfIdentity) pdfIdentity.navigation = request;
      pendingURL = url;
      emit({ url, ...(fragmentOnly ? {} : { title: "", loading: true, isPDF: false, error: undefined }), ...syncHistory() });
      if (recoveryLayout) {
        layout = recoveryLayout;
        applyLayout();
      }
      void current.webContents.loadURL(url).catch((error: unknown) => {
        if (disposed || generation !== page || navigation !== request) return;
        if (error && typeof error === "object" && "code" in error && error.code === "ERR_ABORTED") return;
        emit({ loading: false, error: error instanceof Error ? error.message : String(error), ...syncHistory() });
      });
    },
    setLayout(input) {
      if (disposed) return;
      // IPC 数据逐字段验证，非法布局先隐藏旧原生区域。
      if (!input || typeof input !== "object" || !("visible" in input) || typeof input.visible !== "boolean" ||
        !("bounds" in input) || !input.bounds || typeof input.bounds !== "object") {
        invalidateLayout();
        throw new Error("浏览器布局参数无效");
      }
      const bounds = input.bounds;
      if (!("x" in bounds) || typeof bounds.x !== "number" || !Number.isFinite(bounds.x) ||
        !("y" in bounds) || typeof bounds.y !== "number" || !Number.isFinite(bounds.y) ||
        !("width" in bounds) || typeof bounds.width !== "number" || !Number.isFinite(bounds.width) || bounds.width < 0 ||
        !("height" in bounds) || typeof bounds.height !== "number" || !Number.isFinite(bounds.height) || bounds.height < 0) {
        invalidateLayout();
        throw new Error("浏览器布局参数无效");
      }
      layout = { visible: input.visible, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
      if (!input.visible) cancelReveal();
      applyLayout();
    },
    action(input) {
      if (typeof input !== "string" || !["back", "forward", "reload", "stop", "close"].includes(input)) throw new Error("浏览器操作无效");
      if (disposed) throw new Error("浏览器已关闭");
      cancelContext();
      cancelReveal();
      if (input === "close") { removeView(); state = emptyState(state.revision); emit({}); return; }
      if (!state.url) return;
      if (input === "reload" && crashed) { controller.open(state.url); return; }
      const contents = view?.webContents;
      if (!contents || contents.isDestroyed()) return;
      if (input === "back" && contents.navigationHistory.canGoBack()) {
        awaitingHistory = true;
        contents.navigationHistory.goBack();
      }
      if (input === "forward" && contents.navigationHistory.canGoForward()) {
        awaitingHistory = true;
        contents.navigationHistory.goForward();
      }
      if (input === "reload") { newDocument(); emit({ error: undefined, pdfStatus: undefined }); contents.reload(); }
      if (input === "stop") {
        contents.stop();
        if (state.pdfStatus === "loading" || state.pdfStatus === "password") {
          pdfAbort?.abort();
          pdf?.dispose();
          pdf = undefined;
          emit({ pdfStatus: "error", error: "PDF 解析已停止；当前使用原生阅读，刷新后可重试" });
          syncBodyVisibility();
        }
        emit({ loading: false, ...syncHistory() });
        if (state.pdfStatus === "ready") pdf?.stop();
      }
    },
    getState: () => ({ ...state }),
    dispose() {
      if (disposed) return;
      cancelReveal();
      clearInterval(pollTimer);
      clearTimeout(moveTimer);
      overlay.dispose();
      disposed = true;
      owner.removeListener("resize", invalidateLayout);
      owner.removeListener("hide", temporaryHide);
      owner.removeListener("move", moved);
      owner.removeListener("minimize", temporaryHide);
      owner.removeListener("show", applyLayout);
      owner.removeListener("restore", applyLayout);
      hostContents.removeListener("did-start-navigation", hostNavigation);
      removeView();
    },
  };
  return controller;
}
