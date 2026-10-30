// @vitest-environment node
import { EventEmitter } from "node:events";
import type { BrowserWindow, Session, WebContents } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { BrowserPdfCallbacks } from "./browser-pdf-view";
import type { PdfPickRequest } from "../shared/pdf-viewer";

const fake = vi.hoisted(() => ({ views: [] as unknown[], readers: [] as FakePdfReader[], loadPdf: vi.fn(), fromPartition: vi.fn(), templates: [] as Electron.MenuItemConstructorOptions[][], closeMenu: vi.fn(), popup: vi.fn(), clipboard: vi.fn().mockResolvedValue(undefined) }));
vi.mock("electron", async () => {
  // vi.mock 被提升到静态导入之前，工厂内必须延后获取 EventEmitter。
  const { EventEmitter } = await import("node:events");
  return {
    session: { fromPartition: fake.fromPartition },
    clipboard: { writeText: fake.clipboard },
    Menu: { buildFromTemplate: vi.fn((items: Electron.MenuItemConstructorOptions[]) => {
      fake.templates.push(items);
      return { closePopup: fake.closeMenu, popup: fake.popup };
    }) },
    WebContentsView: class {
      webContents = Object.assign(new EventEmitter(), {
        loadURL: vi.fn().mockResolvedValue(undefined),
        setZoomFactor: vi.fn(),
        getZoomFactor: vi.fn(() => 1),
        setWindowOpenHandler: vi.fn(),
        isDestroyed: vi.fn(() => false),
        isFocused: vi.fn(() => false),
        isLoading: vi.fn(() => false),
        getURL: vi.fn(() => "https://a.test/"),
        getTitle: vi.fn(() => "测试网页"),
        copy: vi.fn(), focus: vi.fn(),
        executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValue(null),
        mainFrame: { url: "https://a.test/", frames: [] },
        close: vi.fn(), reload: vi.fn(), stop: vi.fn(),
        navigationHistory: {
          canGoBack: vi.fn(() => false), canGoForward: vi.fn(() => false),
          goBack: vi.fn(), goForward: vi.fn(),
        },
      });
      setBounds = vi.fn();
      getBounds = vi.fn(() => ({ x: 150, y: 100, width: 500, height: 500 }));
      setVisible = vi.fn();
      constructor(public options: unknown) { fake.views.push(this); }
    },
  };
});
vi.mock("./browser-pdf-loader", () => ({ loadBrowserPdf: fake.loadPdf }));
vi.mock("./browser-pdf-view", () => ({
  createBrowserPdfView: vi.fn((_owner: BrowserWindow, callbacks: BrowserPdfCallbacks) => {
    const reader: FakePdfReader = {
      callbacks, load: vi.fn(), setBounds: vi.fn(), setVisible: vi.fn(), setBodyVisible: vi.fn(),
      setHash: vi.fn(), stop: vi.fn(), focus: vi.fn(), dispose: vi.fn(), syncMarkers: vi.fn(),
      reveal: vi.fn().mockResolvedValue({ anchorId: "unused" }),
      cancelReveal: vi.fn(),
      cancelInteractions: vi.fn(() => {
        const active = reader.pick.mock.results.at(-1);
        if (active?.type === "return") active.value.cancel();
        reader.cancelReveal();
      }),
      pick: vi.fn((_request: PdfPickRequest) => ({
        result: Promise.resolve({ page: 1, pageRect: [10, 20, 100, 60], selection: "paragraph", text: "PDF 独立段落", rect: { x: 10, y: 20, width: 90, height: 40 } }),
        cancel: vi.fn(),
      })),
    };
    fake.readers.push(reader);
    return reader;
  }),
}));
import { createBrowserPanel, createBrowserSession, type BrowserPanelController } from "./browser-panel";
import { browserURL } from "./browser-url";

type FakePdfReader = {
  callbacks: BrowserPdfCallbacks;
  load: Mock; setBounds: Mock; setVisible: Mock; setBodyVisible: Mock; setHash: Mock; stop: Mock;
  focus: Mock; dispose: Mock; syncMarkers: Mock; reveal: Mock; cancelReveal: Mock; cancelInteractions: Mock; pick: Mock;
};

type FakeView = {
  webContents: EventEmitter & {
    loadURL: Mock;
    setWindowOpenHandler: Mock;
    setZoomFactor: Mock;
    mainFrame: { url: string; frames: unknown[] };
    getTitle: Mock; getURL: Mock; copy: Mock; focus: Mock; executeJavaScriptInIsolatedWorld: Mock;
    isFocused: Mock;
    navigationHistory: { canGoBack: Mock; canGoForward: Mock; goBack: Mock; goForward: Mock };
    close: Mock; reload: Mock; stop: Mock;
  };
  options: { webPreferences: Record<string, unknown> };
  setBounds: Mock; setVisible: Mock;
};

function fixture() {
  const browserSession = Object.assign(new EventEmitter(), {
    setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
  });
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => true,
    getContentSize: () => [1000, 680],
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => 1.5, focus: vi.fn() }),
  });
  const publish = vi.fn();
  const publishContext = vi.fn();
  // 测试仅替换 Electron 边界，控制器策略使用真实实现。
  const panel = createBrowserPanel(owner as unknown as BrowserWindow, browserSession as unknown as Session, publish, publishContext);
  return { panel, owner, browserSession, publish, publishContext, view: () => fake.views.at(-1) as FakeView };
}

function navigation(url: string, isMainFrame = true) {
  return { url, isMainFrame, isSameDocument: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

beforeEach(() => {
  fake.views.length = 0; fake.readers.length = 0; fake.templates.length = 0; vi.clearAllMocks();
  // 未完成加载不会意外触发 reader；专用测试显式安排成功、失败或迟到。
  fake.loadPdf.mockReset().mockImplementation(() => Promise.withResolvers<unknown>().promise);
});

it("使用非持久独立 session，拒绝非法程序导航且保留旧页面", () => {
  const f = fixture();
  fake.fromPartition.mockReturnValue(f.browserSession);
  expect(createBrowserSession()).toBe(f.browserSession);
  expect(fake.fromPartition).toHaveBeenCalledWith("omp-browser", { cache: false });
  f.panel.open("https://a.test");
  expect(f.panel.getState().url).toBe("https://a.test/");
  for (const url of [null, 4, "relative", "file:///a", "javascript:alert(1)", "omp:hello", "https://user:pass@a.test/"]) {
    expect(() => browserURL(url)).toThrow("仅允许不含凭据的 HTTP/HTTPS 外链");
    expect(() => f.panel.open(url)).toThrow();
    expect(f.panel.getState().url).toBe("https://a.test/");
  }
  expect(f.view().webContents.loadURL).toHaveBeenCalledTimes(1);
  expect(f.view().options.webPreferences).toMatchObject({ session: f.browserSession, nodeIntegration: false, sandbox: true, contextIsolation: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false, navigateOnDragDrop: false });
  expect(f.view().options.webPreferences).not.toHaveProperty("preload");
  expect(f.view().webContents.setZoomFactor).toHaveBeenCalledWith(1);
  f.panel.dispose();
});

it("点击、重定向、新窗均拒绝桌面协议，普通跨域和子 frame 内部文档正常", () => {
  const f = fixture(); f.panel.open("https://a.test/");
  const contents = f.view().webContents;
  for (const event of ["will-frame-navigate", "will-redirect"]) {
    for (const url of ["file:///a", "javascript:alert(1)", "omp:hello", "https://u@a.test/"]) {
      const details = navigation(url);
      contents.emit(event, details);
      expect(details.defaultPrevented).toBe(true);
      expect(f.panel.getState().error).toContain("HTTP/HTTPS");
    }
    for (const url of ["http://other.test/", "https://b.test/"]) {
      const details = navigation(url); contents.emit(event, details);
      expect(details.defaultPrevented).toBe(false);
    }
    for (const url of ["about:blank", "about:srcdoc", "blob:https://a.test/id", "data:text/html,hi"]) {
      const details = navigation(url, false); contents.emit(event, details);
      expect(details.defaultPrevented).toBe(false);
    }
    const child = navigation("file:///a", false); contents.emit(event, child);
    expect(child.defaultPrevented).toBe(true);
  }
  const popup = contents.setWindowOpenHandler.mock.calls[0][0];
  for (const url of ["file:///a", "javascript:alert(1)", "omp:hello", "https://u@a.test/"]) expect(popup({ url })).toEqual({ action: "deny" });
  expect(popup({ url: "https://popup.test/" })).toEqual({ action: "deny" });
  expect(fake.views).toHaveLength(1);
  expect(contents.loadURL).toHaveBeenLastCalledWith("https://popup.test/");
  contents.emit("did-start-navigation", { ...navigation("https://popup.test/#hash"), isSameDocument: true });
  contents.emit("did-navigate-in-page", {}, "https://popup.test/#hash", true);
  expect(f.panel.getState().url).toBe("https://popup.test/#hash");
  contents.emit("will-redirect", navigation("https://redirected.test/"));
  contents.emit("did-navigate", {}, "https://redirected.test/");
  expect(f.panel.getState().url).toBe("https://redirected.test/");
  f.panel.dispose();
});

it("PDF 私有渲染只允许内置查看器自身的直接子框架，网页不能借机导航扩展", () => {
  const f = fixture(); f.panel.open("https://a.test/paper.pdf");
  const contents = f.view().webContents;
  const viewer = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";
  const url = `${viewer}6831be79-531f-45bc-afad-f4b4563a22a8`;
  const parent = { url: `${viewer}index.html`, parent: contents.mainFrame };
  const trusted = { ...navigation(url, false), frame: { parent }, initiator: parent };
  contents.emit("will-frame-navigate", trusted);
  expect(trusted.defaultPrevented).toBe(false);
  expect(f.panel.getState().error).toBeUndefined();
  for (const patch of [
    { isMainFrame: true },
    { frame: { parent: contents.mainFrame } },
    { initiator: contents.mainFrame },
    { frame: { parent: { ...parent, parent: { url: "https://attacker.test/" } } } },
    { url: `${viewer}index.html` },
    { url: "chrome-extension://other/6831be79-531f-45bc-afad-f4b4563a22a8" },
    { url: `${url}?other=1` },
    { url: "file:///C:/Windows/win.ini" },
  ]) {
    const denied = { ...navigation(url, false), frame: { parent }, initiator: parent, ...patch };
    contents.emit("will-frame-navigate", denied);
    expect(denied.defaultPrevented).toBe(true);
    expect(f.panel.getState().error).toContain("HTTP/HTTPS");
  }
  f.panel.dispose();
});

it("权限与下载只拒绝并提示当前网页，不产生外部副作用", () => {
  const f = fixture(); f.panel.open("https://a.test/");
  const contents = f.view().webContents;
  const request = f.browserSession.setPermissionRequestHandler.mock.calls[0][0];
  const callback = vi.fn(); request(contents, "geolocation", callback);
  expect(callback).toHaveBeenCalledWith(false);
  expect(f.panel.getState().error).toContain("权限");
  expect(f.browserSession.setPermissionCheckHandler.mock.calls[0][0](contents)).toBe(false);
  expect(f.browserSession.setDevicePermissionHandler.mock.calls[0][0]({ origin: "https://a.test" })).toBe(false);
  const event = { preventDefault: vi.fn() };
  f.browserSession.emit("will-download", event, {}, contents as unknown as WebContents);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(f.panel.getState().error).toContain("不下载");
  f.panel.dispose();
  const revision = f.publish.mock.calls.length;
  request(contents, "geolocation", callback);
  expect(f.publish).toHaveBeenCalledTimes(revision);
});

it("旧导航失败、停止取消、关闭后事件均不能覆盖新页面", async () => {
  const f = fixture(); f.panel.open("https://initial.test/");
  const contents = f.view().webContents;
  const old = Promise.withResolvers<void>();
  contents.loadURL.mockImplementationOnce(() => old.promise);
  f.panel.open("https://slow.test/");
  f.panel.open("https://b.test/");
  old.reject(new Error("old failure")); await Promise.resolve();
  contents.emit("did-fail-load", {}, -7, "old failure", "https://slow.test/", true);
  contents.emit("did-start-navigation", navigation("https://slow.test/"));
  contents.emit("did-navigate", {}, "https://slow.test/");
  expect(f.panel.getState()).toMatchObject({ url: "https://b.test/", error: undefined });
  contents.emit("did-fail-load", {}, -3, "aborted", "https://b.test/", true);
  expect(f.panel.getState().error).toBeUndefined();
  contents.emit("did-fail-load", {}, -105, "DNS failed", "https://b.test/", true);
  expect(f.panel.getState().error).toBe("DNS failed");
  f.panel.action("reload"); expect(contents.reload).toHaveBeenCalledOnce();
  expect(f.panel.getState().error).toBeUndefined();
  f.panel.action("stop"); expect(contents.stop).toHaveBeenCalledOnce();
  const before = f.panel.getState().revision;
  f.panel.action("close");
  expect(contents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
  expect(f.panel.getState()).toMatchObject({ url: "", title: "", loading: false, canGoBack: false });
  expect(f.panel.getState().revision).toBeGreaterThan(before);
  const count = f.publish.mock.calls.length;
  contents.emit("did-navigate", {}, "https://late.test/");
  f.panel.setLayout({ visible: true, bounds: { x: 0, y: 0, width: 400, height: 300 } });
  expect(f.publish).toHaveBeenCalledTimes(count); expect(fake.views).toHaveLength(1);
  f.panel.dispose(); f.panel.dispose();
});

it("宿主窗口已销毁后仍释放网页视图与监听，不阻断应用退出", () => {
  const f = fixture();
  f.panel.open("https://close.test/");
  const hostContents = f.owner.webContents;
  const contents = f.view().webContents;
  Object.defineProperty(f.owner, "isDestroyed", { value: () => true });
  Object.defineProperty(f.owner, "webContents", {
    get() { throw new Error("Object has been destroyed"); },
  });
  const updates = f.publish.mock.calls.length;
  f.panel.dispose();
  expect(contents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
  expect(hostContents.listenerCount("did-start-navigation")).toBe(0);
  contents.emit("did-navigate", {}, "https://late.test/");
  expect(f.publish).toHaveBeenCalledTimes(updates);
});

it("缩放使用宿主 zoom 并裁剪窗口，非法与零面积布局保持隐藏", () => {
  const f = fixture();
  f.panel.setLayout({ visible: true, bounds: { x: 1, y: 1, width: 100, height: 100 } });
  expect(fake.views).toHaveLength(0);
  f.panel.open("https://a.test/"); const view = f.view();
  expect(view.setVisible).toHaveBeenLastCalledWith(false);
  f.panel.setLayout({ visible: true, bounds: { x: -10, y: 20, width: 800, height: 500 } });
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 30, width: 1000, height: 650 });
  expect(view.setVisible).toHaveBeenLastCalledWith(true);
  view.webContents.isFocused.mockReturnValue(true);
  f.owner.emit("resize"); expect(view.setVisible).toHaveBeenLastCalledWith(false);
  expect(f.owner.webContents.focus).toHaveBeenCalledOnce();
  for (const bounds of [{ x: NaN, y: 0, width: 20, height: 20 }, { x: 0, y: 0, width: -1, height: 20 }, { x: 0, y: 0, width: 20, height: -1 }]) {
    expect(() => f.panel.setLayout({ visible: true, bounds })).toThrow("布局参数无效");
    expect(view.setVisible).toHaveBeenLastCalledWith(false);
  }
  f.panel.setLayout({ visible: true, bounds: { x: 10, y: 10, width: 0, height: 20 } });
  expect(view.setVisible).toHaveBeenLastCalledWith(false);
  f.panel.setLayout({ visible: true, bounds: { x: 10, y: 10, width: 300, height: 200 } });
  f.owner.webContents.emit("did-start-navigation", navigation("file:///host"));
  expect(view.setVisible).toHaveBeenLastCalledWith(false);
  f.panel.dispose();
});

it("历史来自真实 navigationHistory，崩溃后手动刷新重建视图", () => {
  const f = fixture(); f.panel.open("https://a.test/");
  const contents = f.view().webContents;
  f.panel.action("back"); expect(contents.navigationHistory.goBack).not.toHaveBeenCalled();
  contents.navigationHistory.canGoBack.mockReturnValue(true);
  contents.emit("did-stop-loading");
  expect(f.panel.getState().canGoBack).toBe(true);
  f.panel.action("back"); expect(contents.navigationHistory.goBack).toHaveBeenCalledOnce();
  contents.navigationHistory.canGoForward.mockReturnValue(true);
  f.panel.action("forward"); expect(contents.navigationHistory.goForward).toHaveBeenCalledOnce();
  contents.emit("render-process-gone");
  f.panel.setLayout({ visible: true, bounds: { x: 10, y: 10, width: 300, height: 200 } });
  expect(f.panel.getState().error).toContain("网页进程已退出");
  f.panel.action("reload"); expect(fake.views).toHaveLength(2);
  expect(f.view().webContents.loadURL).toHaveBeenLastCalledWith("https://a.test/");
  expect(f.view().setVisible).toHaveBeenLastCalledWith(true);
  f.panel.dispose();
});

function menuFor(f: ReturnType<typeof fixture>, patch: Record<string, unknown> = {}) {
  const contents = f.view().webContents;
  contents.emit("context-menu", {}, {
    frame: contents.mainFrame, selectionText: "页面引用甲", isEditable: false, formControlType: "none",
    editFlags: { canCopy: true }, linkURL: "", ...patch,
  });
  return fake.templates.at(-1)!;
}

it("原生复制不采集表单文本，密码和编辑区不会向宿主发送引用", async () => {
  const f = fixture(); f.panel.open("https://a.test/"); f.panel.setContextScope("s");
  const contents = f.view().webContents;
  for (const formControlType of ["input-text", "input-password", "none"]) {
    const items = menuFor(f, { formControlType, isEditable: true });
    expect(items[1].enabled).toBe(false);
    expect(items[0].enabled).toBe(formControlType !== "input-password");
    if (items[0].enabled) (items[0].click as () => void)();
  }
  expect(contents.copy).toHaveBeenCalledTimes(2);
  expect(contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  expect(f.publishContext).not.toHaveBeenCalled();
  f.panel.dispose();
});

it("普通网页评论重新过滤选区，并拒绝跨框架、变化及超限结果", async () => {
  const f = fixture(); f.panel.open("https://a.test/"); f.panel.setContextScope("scope-a");
  const contents = f.view().webContents;
  const frame = { url: "https://iframe.test/", parent: contents.mainFrame };
  expect(menuFor(f, { frame })[1]).toMatchObject({ enabled: false, label: "请在主页面选择内容" });
  contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce({ text: "页面引用甲", rect: { x: 12, y: 80, width: 140, height: 20 } });
  (menuFor(f)[1].click as () => void)();
  await vi.waitFor(() => expect(f.publishContext).toHaveBeenCalledWith({
    scope: "scope-a", context: { kind: "web", url: "https://a.test/", title: "测试网页", text: "页面引用甲" },
    sourceAnchor: { kind: "web", documentId: expect.any(String), anchorId: expect.any(String), rect: { x: 12, y: 80, width: 140, height: 20 } },
  }));
  expect(contents.executeJavaScriptInIsolatedWorld.mock.calls[0][0]).toBe(1001);
  for (const result of [null, { text: "已变化" }, { text: "x".repeat(65537) }]) {
    const revision = f.panel.getState().revision;
    contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce(result);
    (menuFor(f)[1].click as () => void)();
    await vi.waitFor(() => {
      expect(f.panel.getState().revision).toBeGreaterThan(revision);
      expect(f.panel.getState().error).toMatch(/选区已变化|所选内容过长|网页选区无效/);
    });
  }
  expect(f.publishContext).toHaveBeenCalledTimes(1);
  f.panel.dispose();
});

it("可信 PDF 只读选区保留原文，不执行 viewer 私有脚本", async () => {
  const f = fixture(); f.panel.open("https://a.test/paper.pdf"); f.panel.setContextScope("pdf");
  const contents = f.view().webContents;
  contents.getURL.mockReturnValue("https://a.test/paper.pdf");
  const viewer = { url: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html", parent: contents.mainFrame };
  for (const frame of [viewer, { url: "https://a.test/paper.pdf", parent: viewer }]) {
    const items = menuFor(f, { frame });
    expect(items[1].enabled).toBe(true);
    expect(items[2].enabled).toBe(false);
    (items[1].click as () => void)();
  }
  for (const frame of [{ ...viewer, parent: {} }, { url: "chrome-extension://other/index.html", parent: contents.mainFrame }, { url: "https://evil.test/", parent: viewer }]) {
    expect(menuFor(f, { frame })[1].enabled).toBe(false);
  }
  expect(f.publishContext).toHaveBeenCalledTimes(2);
  expect(contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  expect(f.publishContext.mock.calls[0][0].context.url).toBe("https://a.test/paper.pdf");
  f.panel.dispose();
});

it("Electron PDF plugin 主框架事件仅凭真实直属内置 viewer 分类，空选区明确提示平台限制", async () => {
  const f = fixture(); f.panel.open("https://a.test/paper.pdf"); f.panel.setContextScope("pdf-main");
  const contents = f.view().webContents;
  contents.getURL.mockReturnValue("https://a.test/paper.pdf");
  contents.mainFrame.url = "https://a.test/paper.pdf";
  const viewer = { url: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html", parent: contents.mainFrame };
  contents.mainFrame.frames = [viewer];
  const unavailable = menuFor(f, { selectionText: "" });
  expect(unavailable[1]).toMatchObject({ label: "不支持提取此 PDF 选区", enabled: false });
  expect(unavailable[2].enabled).toBe(false);
  const selected = menuFor(f);
  expect(selected[1].enabled).toBe(true);
  (selected[1].click as () => void)();
  expect(f.publishContext).toHaveBeenCalledWith({
    scope: "pdf-main", context: { kind: "web", url: "https://a.test/paper.pdf", title: "测试网页", text: "页面引用甲" },
    sourceAnchor: { kind: "web", documentId: expect.any(String), anchorId: expect.any(String), unavailable: "PDF 暂不支持原位标记" },
  });
  expect(contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  for (const child of [{ ...viewer, parent: {} }, { ...viewer, url: "chrome-extension://other/index.html" }, { ...viewer, detached: true }]) {
    contents.mainFrame.frames = [child];
    expect(menuFor(f, { selectionText: "" })[1].label).toBe("评论所选内容");
  }
  f.panel.dispose();
});

it("scope、导航、崩溃、隐藏和关闭主动取消菜单及迟到采集", async () => {
  for (const invalidate of [
    (f: ReturnType<typeof fixture>) => f.panel.setContextScope("new"),
    (f: ReturnType<typeof fixture>) => f.panel.open("https://new.test/"),
    (f: ReturnType<typeof fixture>) => f.view().webContents.emit("render-process-gone"),
    (f: ReturnType<typeof fixture>) => f.owner.emit("hide"),
    (f: ReturnType<typeof fixture>) => f.panel.action("close"),
  ]) {
    const f = fixture(); f.panel.open("https://a.test/"); f.panel.setContextScope("old");
    const pending = Promise.withResolvers<string>();
    f.view().webContents.executeJavaScriptInIsolatedWorld.mockReturnValueOnce(pending.promise);
    (menuFor(f)[1].click as () => void)();
    invalidate(f);
    pending.resolve("页面引用甲");
    await Promise.resolve(); await Promise.resolve();
    expect(f.publishContext).not.toHaveBeenCalled();
    expect(fake.closeMenu).toHaveBeenCalled();
    f.panel.dispose();
  }
});

it("picker 取消、超时和导航始终结束 IPC 并恢复 selectingElement", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); f.panel.open("https://a.test/"); f.panel.setContextScope("pick");
    const contents = f.view().webContents;
    contents.emit("did-stop-loading");
    f.panel.setLayout({ visible: true, bounds: { x: 0, y: 0, width: 300, height: 200 } });
    for (const action of ["cancel", "deadline", "navigate"]) {
      const pending = Promise.withResolvers<null>();
      contents.executeJavaScriptInIsolatedWorld.mockImplementation((_world, scripts) => scripts[0].code.includes("const {promise") ? pending.promise : Promise.resolve(null));
      const result = f.panel.pickElement("pick", "element");
      expect(f.panel.getState().selectingElement).toBe(true);
      await Promise.resolve();
      if (action === "cancel") f.panel.cancelElementPick();
      if (action === "deadline") await vi.advanceTimersByTimeAsync(60_000);
      if (action === "navigate") contents.emit("will-frame-navigate", navigation("https://next.test/"));
      expect(await result).toBeNull();
      expect(f.panel.getState().selectingElement).toBe(false);
    }
    f.panel.dispose();
  } finally { vi.useRealTimers(); }
});

it("picker 只返回有界纯数据，工具栏与原生菜单不会重复投递", async () => {
  const f = fixture(); f.panel.open("https://a.test/"); f.panel.setContextScope("pick");
  const contents = f.view().webContents;
  contents.emit("did-stop-loading");
  f.panel.setLayout({ visible: true, bounds: { x: 0, y: 0, width: 300, height: 200 } });
  const element = { tag: "h1", label: "", text: "标题" };
  contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce(element);
  expect(await f.panel.pickElement("pick", "element")).toMatchObject({ scope: "pick", context: { element: { tag: "h1", label: "" }, text: "标题" } });
  expect(f.publishContext).not.toHaveBeenCalled();
  contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce(element);
  const nativeItems = menuFor(f, { selectionText: "" });
  expect(nativeItems[2].enabled).toBe(true);
  (nativeItems[2].click as () => void)();
  await vi.waitFor(() => expect(f.publishContext).toHaveBeenCalledTimes(1));
  expect(f.publishContext.mock.calls[0][0]).toMatchObject({ scope: "pick", context: { text: "标题", element: { tag: "h1", label: "" } } });
  for (const value of [{ ...element, text: "x".repeat(65537) }, { ...element, tag: 42 }, { ...element, label: "x".repeat(513) }]) {
    contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce(value);
    await expect(f.panel.pickElement("pick", "element")).rejects.toBeInstanceOf(Error);
    expect(f.panel.getState().selectingElement).toBe(false);
  }
  f.panel.dispose();
});

it("复制链接只使用白名单 URL，空白与危险协议禁用复制", () => {
  const f = fixture(); f.panel.open("https://a.test/");
  expect(menuFor(f, { selectionText: "", editFlags: { canCopy: false } })[0].enabled).toBe(false);
  for (const linkURL of ["javascript:alert(1)", "file:///private", "https://user:secret@a.test/"]) {
    expect(menuFor(f, { selectionText: "", linkURL })[0]).toMatchObject({ label: "复制链接地址", enabled: false });
  }
  const item = menuFor(f, { selectionText: "", linkURL: "https://a.test/path?q=中文" })[0];
  expect(item.enabled).toBe(true);
  (item.click as () => void)();
  expect(fake.clipboard).toHaveBeenCalledWith(new URL("https://a.test/path?q=中文").href);
  expect(f.publishContext).not.toHaveBeenCalled();
  f.panel.dispose();
});

it("复制链接等待剪贴板失败并显示错误，过期菜单的失败不污染新页面", async () => {
  const f = fixture(); f.panel.open("https://a.test/");
  fake.clipboard.mockRejectedValueOnce(new Error("剪贴板不可用"));
  (menuFor(f, { selectionText: "", linkURL: "https://a.test/link" })[0].click as () => void)();
  await Promise.resolve();
  expect(f.panel.getState().error).toBe("剪贴板不可用");
  const pending = Promise.withResolvers<void>();
  fake.clipboard.mockReturnValueOnce(pending.promise);
  (menuFor(f, { selectionText: "", linkURL: "https://a.test/old" })[0].click as () => void)();
  f.panel.open("https://new.test/");
  pending.reject(new Error("旧复制失败"));
  await Promise.resolve();
  expect(f.panel.getState().error).toBeUndefined();
  f.panel.dispose();
});

it("网页评论 IPC 拒绝旧 scope、超限文本和无效编号，不授予远程页面本地桥接", () => {
  const f = fixture();
  f.panel.open("https://a.test/");
  f.panel.setContextScope("current");
  const sourceAnchor = { kind: "web", documentId: "previous-document", anchorId: "previous-anchor" };
  const editor = { scope: "current", editorId: "editor", sourceAnchor, source: "网页引用", comment: "评论", theme: "dark", fontSize: 14 };
  expect(() => f.panel.setCommentEditor({ ...editor, scope: "stale" })).toThrow("网页评论参数无效");
  expect(() => f.panel.setCommentEditor({ ...editor, comment: "x".repeat(16001) })).toThrow("网页评论参数无效");
  expect(() => f.panel.setCommentEditor({ ...editor, fontSize: Infinity })).toThrow("网页评论参数无效");
  expect(() => f.panel.setCommentEditor({ ...editor, editing: "yes" })).toThrow("网页评论参数无效");
  expect(() => f.panel.syncCommentMarkers([{ scope: "stale", id: "id", number: 1, sourceAnchor }])).toThrow("网页评论标记参数无效");
  expect(() => f.panel.syncCommentMarkers([{ scope: "current", id: "id", number: 0, sourceAnchor }])).toThrow("网页评论标记参数无效");
  expect(() => f.panel.syncCommentMarkers([{ scope: "current", id: "id", number: 1, sourceAnchor }])).not.toThrow();
  f.panel.setContextScope(null);
  f.panel.setContextScope("reauthorized");
  expect(() => f.panel.syncCommentMarkers([{ scope: "reauthorized", id: "id", number: 1, sourceAnchor }])).not.toThrow();
  expect(f.view().options.webPreferences).not.toHaveProperty("preload");
  f.panel.dispose();
});

/** 使用真实采集入口取得 main 颁发的锚点，只有 Electron 执行边界由测试接管。 */
async function revealFixture() {
  const f = fixture();
  f.panel.open("https://a.test/"); f.panel.setContextScope("reveal");
  const contents = f.view().webContents;
  contents.emit("did-stop-loading");
  f.panel.setLayout({ visible: true, bounds: { x: 0, y: 0, width: 300, height: 200 } });
  await Promise.resolve(); await Promise.resolve();
  contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce({ tag: "p", label: "", text: "retained source" });
  const captured = await f.panel.pickElement("reveal", "element");
  const sourceAnchor = captured!.sourceAnchor!;
  const request = { scope: "reveal", requestId: "request-one", entryId: "entry-one",
    documentId: sourceAnchor.documentId, anchorId: sourceAnchor.anchorId };
  const revealCommand = vi.fn().mockResolvedValue({ anchorId: sourceAnchor.anchorId, rect: { x: 60, y: 80, width: 100, height: 24 } });
  contents.executeJavaScriptInIsolatedWorld.mockImplementation((_world, scripts) => {
    const command = JSON.parse(scripts[0].code.match(/return globalThis.__ompPageAnchors\((.*)\);/)![1]);
    if (command.op === "reveal") return revealCommand(command);
    if (command.op === "read") return Promise.resolve({ anchors: command.ids.map((anchorId: string) => ({ anchorId, unavailable: "offscreen" })) });
    return Promise.resolve(null);
  });
  f.panel.syncCommentMarkers([{ scope: "reveal", id: "entry-one", number: 1, sourceAnchor }]);
  return { ...f, request, revealCommand, contents };
}

it("reveals only an active owned marker in the current document, never reopens its URL", async () => {
  const f = await revealFixture();
  try {
    for (const patch of [{ scope: "old" }, { entryId: "another-entry" }, { anchorId: "unknown" }, { documentId: "old-document" }]) {
      expect(await f.panel.revealComment({ ...f.request, ...patch })).toMatchObject({ status: "unavailable" });
    }
    expect(f.revealCommand).not.toHaveBeenCalled();
    await expect(f.panel.revealComment({ ...f.request, selector: "p" })).rejects.toBeInstanceOf(Error);
    expect(await f.panel.revealComment(f.request)).toEqual({ requestId: "request-one", status: "located" });
    expect(f.contents.loadURL).toHaveBeenCalledTimes(1);
  } finally { f.panel.dispose(); }
});

it("waits for sidebar layout and cancels pending work on newer requests, deletion, scope, navigation and close", async () => {
  vi.useFakeTimers();
  try {
    for (const invalidate of ["cancel", "delete", "scope", "navigate", "close"]) {
      const f = await revealFixture();
      try {
        f.panel.setLayout({ visible: false, bounds: { x: 0, y: 0, width: 300, height: 200 } });
        const pending = f.panel.revealComment(f.request);
        if (invalidate === "cancel") f.panel.cancelCommentReveal(f.request.requestId);
        if (invalidate === "delete") f.panel.syncCommentMarkers([]);
        if (invalidate === "scope") f.panel.setContextScope("other");
        if (invalidate === "navigate") {
          f.contents.emit("will-frame-navigate", navigation("https://new.test/"));
          f.contents.emit("did-start-navigation", navigation("https://new.test/"));
        }
        if (invalidate === "close") f.panel.action("close");
        expect(await pending).toMatchObject({ status: "unavailable" });
        expect(f.revealCommand).not.toHaveBeenCalled();
      } finally { f.panel.dispose(); }
    }
    const f = await revealFixture();
    try {
      f.panel.setLayout({ visible: false, bounds: { x: 0, y: 0, width: 300, height: 200 } });
      const old = f.panel.revealComment(f.request);
      const latest = f.panel.revealComment({ ...f.request, requestId: "latest" });
      f.panel.setCommentEditor(null);
      expect(await old).toMatchObject({ status: "unavailable" });
      f.panel.cancelCommentReveal("request-one");
      f.panel.setLayout({ visible: true, bounds: { x: 0, y: 0, width: 300, height: 200 } });
      await vi.advanceTimersByTimeAsync(25);
      expect(await latest).toEqual({ requestId: "latest", status: "located" });
      const deferred = Promise.withResolvers<unknown>();
      f.revealCommand.mockReturnValueOnce(deferred.promise);
      const stale = f.panel.revealComment({ ...f.request, requestId: "inflight" });
      f.panel.syncCommentMarkers([]);
      expect(await stale).toMatchObject({ status: "unavailable" });
      deferred.resolve({ anchorId: f.request.anchorId, rect: { x: 1, y: 1, width: 1, height: 1 } });
      await Promise.resolve();
      expect(f.contents.focus).toHaveBeenCalledTimes(1);
    } finally { f.panel.dispose(); }
  } finally { vi.useRealTimers(); }
});

it("reports PDF and stale documents as unavailable instead of navigating", async () => {
  vi.useFakeTimers();
  const f = await revealFixture();
  try {
    f.contents.mainFrame.frames = [{ url: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html", parent: f.contents.mainFrame }];
    await Promise.resolve();
    f.contents.executeJavaScriptInIsolatedWorld.mockClear();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    expect(await f.panel.revealComment(f.request)).toMatchObject({ status: "unavailable" });
    expect(f.revealCommand).not.toHaveBeenCalled();
    f.contents.mainFrame.frames = [];
    f.contents.emit("will-frame-navigate", navigation("https://new.test/"));
    f.contents.emit("did-start-navigation", navigation("https://new.test/"));
    expect(await f.panel.revealComment(f.request)).toMatchObject({ status: "unavailable" });
    await vi.advanceTimersByTimeAsync(300);
    expect(f.contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    expect(f.revealCommand).not.toHaveBeenCalled();
    expect(f.contents.loadURL).toHaveBeenCalledTimes(1);
  } finally { f.panel.dispose(); vi.useRealTimers(); }
});

/** 模拟 Chromium 已提交文档以及精确直属插件身份，不依据扩展名授权。 */
function commitPdf(f: { panel: BrowserPanelController; view(): FakeView }, url = "https://a.test/document") {
  f.panel.open(url);
  f.panel.setContextScope("pdf-scope");
  f.panel.setLayout({ visible: true, bounds: { x: 0, y: 0, width: 400, height: 300 } });
  const contents = f.view().webContents;
  contents.getURL.mockReturnValue(url);
  contents.mainFrame.url = url;
  contents.emit("did-start-navigation", navigation(url));
  const viewer = { url: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html", parent: contents.mainFrame };
  contents.mainFrame.frames = [viewer];
  contents.emit("did-navigate", {}, url);
  return { contents, viewer };
}

async function readyPdf() {
  fake.loadPdf.mockResolvedValueOnce({ bytes: new Uint8Array([37, 80, 68, 70, 45]), url: "https://cdn.test/authorized.pdf" });
  const f = fixture();
  const committed = commitPdf(f);
  await Promise.resolve(); await Promise.resolve();
  const reader = fake.readers.at(-1)!;
  reader.callbacks.onReady(2);
  return { ...f, ...committed, reader };
}

it("无扩展名PDF首屏完成后才接管正文，隐藏保留文档并恢复原有reader和原生历史", async () => {
  fake.loadPdf.mockResolvedValueOnce({ bytes: new Uint8Array([37, 80, 68, 70, 45]), url: "https://cdn.test/final.pdf" });
  const f = fixture();
  const { contents } = commitPdf(f);
  try {
    expect(f.panel.getState()).toMatchObject({ url: "https://a.test/document", isPDF: true, pdfStatus: "loading", loading: true });
    await expect(f.panel.pickElement("pdf-scope", "element")).rejects.toThrow();
    expect(f.view().setVisible).toHaveBeenLastCalledWith(true);
    const reader = fake.readers.at(-1)!;
    expect(reader.setVisible).toHaveBeenLastCalledWith(true);
    reader.callbacks.onReady(2);
    expect(f.panel.getState()).toMatchObject({ url: "https://a.test/document", pdfStatus: "ready", loading: false });
    expect(f.view().setVisible).toHaveBeenLastCalledWith(false);
    expect(reader.setBodyVisible).toHaveBeenLastCalledWith(true);
    const selected = await f.panel.pickElement("pdf-scope", "element");
    expect(selected).toMatchObject({ context: { kind: "pdf", url: "https://cdn.test/final.pdf", page: 1, selection: "paragraph", text: "PDF 独立段落" }, sourceAnchor: { kind: "pdf", page: 1, pageRect: [10, 20, 100, 60] } });
    expect(contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    f.panel.setLayout({ visible: false, bounds: { x: 0, y: 0, width: 400, height: 300 } });
    expect(reader.setVisible).toHaveBeenLastCalledWith(false);
    expect(reader.setBodyVisible).toHaveBeenLastCalledWith(false);
    expect(reader.dispose).not.toHaveBeenCalled();
    f.panel.setLayout({ visible: true, bounds: { x: 0, y: 0, width: 400, height: 300 } });
    expect(reader.setBodyVisible).toHaveBeenLastCalledWith(true);
    expect(fake.loadPdf).toHaveBeenCalledTimes(1);
    expect(contents.loadURL).toHaveBeenCalledTimes(1);
    contents.navigationHistory.canGoBack.mockReturnValue(true);
    f.panel.action("back");
    expect(contents.navigationHistory.goBack).toHaveBeenCalledOnce();
    contents.emit("did-start-navigation", navigation("https://a.test/html"));
    contents.mainFrame.frames = [];
    contents.getURL.mockReturnValue("https://a.test/html");
    contents.emit("did-navigate", {}, "https://a.test/html");
    contents.emit("did-stop-loading");
    expect(reader.dispose).toHaveBeenCalledOnce();
    expect(f.panel.getState()).toMatchObject({ url: "https://a.test/html", isPDF: false, pdfStatus: undefined });
    expect(f.view().setVisible).toHaveBeenLastCalledWith(true);
    contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce({ tag: "p", label: "", text: "HTML 原文" });
    expect(await f.panel.pickElement("pdf-scope", "element")).toMatchObject({ context: { kind: "web", text: "HTML 原文" } });
  } finally { f.panel.dispose(); }
});

it("PDF加载错误保留原生只读浏览且不循环重试，刷新才允许新加载", async () => {
  fake.loadPdf.mockRejectedValueOnce(new Error("登录页不是PDF"));
  const f = fixture();
  const { contents } = commitPdf(f);
  try {
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(f.panel.getState()).toMatchObject({ isPDF: true, pdfStatus: "error", loading: false });
    expect(f.panel.getState().error).toContain("登录页不是PDF");
    expect(f.view().setVisible).toHaveBeenLastCalledWith(true);
    await expect(f.panel.pickElement("pdf-scope", "region")).rejects.toThrow();
    contents.emit("did-stop-loading"); contents.emit("did-frame-finish-load");
    expect(fake.loadPdf).toHaveBeenCalledTimes(1);
    expect(menuFor(f, { selectionText: "" })[2].enabled).toBe(false);
    expect(contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    f.panel.action("reload");
    expect(contents.reload).toHaveBeenCalledOnce();
    contents.emit("did-navigate", {}, "https://a.test/document");
    expect(fake.loadPdf).toHaveBeenCalledTimes(2);
  } finally { f.panel.dispose(); }
});

it("导航、stop和直属viewer身份替换使迟到PDF字节失去授权", async () => {
  for (const invalidate of ["navigate", "stop", "replace-viewer", "detach-viewer"]) {
    const deferred = Promise.withResolvers<{ bytes: Uint8Array; url: string }>();
    fake.loadPdf.mockReturnValueOnce(deferred.promise);
    const f = fixture();
    const { contents, viewer } = commitPdf(f);
    const readersBefore = fake.readers.length;
    try {
      const signal = fake.loadPdf.mock.calls.at(-1)![2] as AbortSignal;
      if (invalidate === "navigate") {
        f.panel.open("https://new.test/");
        contents.mainFrame.frames = [];
        contents.emit("did-start-navigation", navigation("https://new.test/"));
        contents.emit("did-navigate", {}, "https://new.test/");
      }
      if (invalidate === "stop") f.panel.action("stop");
      if (invalidate === "replace-viewer") contents.mainFrame.frames = [{ ...viewer }];
      if (invalidate === "detach-viewer") contents.mainFrame.frames = [{ ...viewer, detached: true }];
      deferred.resolve({ bytes: new Uint8Array([37, 80, 68, 70, 45]), url: "https://old.test/document" });
      await Promise.resolve(); await Promise.resolve();
      expect(fake.readers).toHaveLength(readersBefore);
      if (invalidate === "navigate" || invalidate === "stop") expect(signal.aborted).toBe(true);
      expect(f.panel.getState().pdfStatus).not.toBe("ready");
    } finally { f.panel.dispose(); }
  }
});

it("PDF定位必须有当前授权标记的真实rect，缺失几何、删除和旧文档均不可定位", async () => {
  const f = await readyPdf();
  try {
    const captured = (await f.panel.pickElement("pdf-scope", "element"))!;
    const anchor = captured.sourceAnchor!;
    const request = { scope: "pdf-scope", requestId: "pdf-reveal", entryId: "entry", documentId: anchor.documentId, anchorId: anchor.anchorId };
    f.panel.syncCommentMarkers([{ scope: request.scope, id: request.entryId, number: 1, sourceAnchor: anchor }]);
    f.reader.reveal.mockResolvedValueOnce({ anchorId: anchor.anchorId });
    expect(await f.panel.revealComment(request)).toMatchObject({ status: "unavailable" });
    f.reader.reveal.mockResolvedValueOnce({ anchorId: anchor.anchorId, rect: { x: 10, y: 20, width: 90, height: 40 } });
    expect(await f.panel.revealComment({ ...request, requestId: "pdf-visible" })).toEqual({ requestId: "pdf-visible", status: "located" });
    f.panel.syncCommentMarkers([]);
    expect(await f.panel.revealComment(request)).toMatchObject({ status: "unavailable" });
    expect(f.reader.reveal).toHaveBeenCalledTimes(2);
    expect(f.contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    expect(f.contents.loadURL).toHaveBeenCalledTimes(1);
  } finally { f.panel.dispose(); }
});

it("PDF采集在隐藏或scope变化时取消，旧reader返回不能创建引用", async () => {
  for (const invalidate of ["hide", "scope", "navigate"]) {
    const f = await readyPdf();
    try {
      const deferred = Promise.withResolvers<unknown>();
      let active = true;
      const cancel = vi.fn(() => deferred.resolve(null));
      f.reader.pick.mockReturnValueOnce({ result: deferred.promise, cancel: () => {
        if (!active) return;
        active = false;
        cancel();
      } });
      const pending = f.panel.pickElement("pdf-scope", "region");
      expect(f.panel.getState()).toMatchObject({ selectingElement: true, selectionMode: "region" });
      if (invalidate === "hide") f.panel.setLayout({ visible: false, bounds: { x: 0, y: 0, width: 400, height: 300 } });
      if (invalidate === "scope") f.panel.setContextScope("other");
      if (invalidate === "navigate") {
        f.panel.open("https://new.test/");
        f.contents.emit("did-start-navigation", navigation("https://new.test/"));
      }
      expect(await pending).toBeNull();
      expect(cancel).toHaveBeenCalledOnce();
      expect(f.panel.getState().selectingElement).toBe(false);
      expect(f.publishContext).not.toHaveBeenCalled();
    } finally { f.panel.dispose(); }
  }
});

it("PDF纯hash定位保留字节与锚点，直属viewer被替换后新字节不得复用旧documentId", async () => {
  const f = await readyPdf();
  try {
    const selected = (await f.panel.pickElement("pdf-scope", "element"))!;
    const sourceAnchor = selected.sourceAnchor!;
    const request = { scope: "pdf-scope", requestId: "preserved-hash", entryId: "retained-entry", documentId: sourceAnchor.documentId, anchorId: sourceAnchor.anchorId };
    f.panel.syncCommentMarkers([{ scope: request.scope, id: request.entryId, number: 1, sourceAnchor }]);
    const url = "https://a.test/document#page=2&zoom=150";
    f.panel.open(url);
    f.contents.getURL.mockReturnValue(url);
    f.contents.emit("did-start-navigation", { ...navigation(url), isSameDocument: true });
    f.contents.emit("did-navigate-in-page", {}, url, true);
    expect(f.panel.getState()).toMatchObject({ url, isPDF: true, pdfStatus: "ready", loading: false });
    f.reader.reveal.mockResolvedValueOnce({ anchorId: sourceAnchor.anchorId, rect: { x: 20, y: 30, width: 90, height: 40 } });
    expect(await f.panel.revealComment(request)).toMatchObject({ status: "located" });
    expect(fake.loadPdf).toHaveBeenCalledTimes(1);
    expect(f.reader.dispose).not.toHaveBeenCalled();
    expect(f.reader.setHash).toHaveBeenLastCalledWith("#page=2&zoom=150");
    expect(f.contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
    fake.loadPdf.mockResolvedValueOnce({ bytes: new Uint8Array([37, 80, 68, 70, 45, 50]), url: "https://cdn.test/replaced.pdf" });
    f.contents.mainFrame.frames = [{ ...f.viewer }];
    f.contents.emit("did-frame-navigate");
    await Promise.resolve(); await Promise.resolve();
    const replacement = fake.readers.at(-1)!;
    replacement.callbacks.onReady(2);
    expect(f.reader.dispose).toHaveBeenCalledOnce();
    expect(await f.panel.revealComment(request)).toMatchObject({ status: "unavailable" });
    const fresh = (await f.panel.pickElement("pdf-scope", "element"))!;
    expect(fresh.sourceAnchor!.documentId).not.toBe(sourceAnchor.documentId);
    expect(fresh.context).toMatchObject({ kind: "pdf", url: "https://cdn.test/replaced.pdf" });
  } finally { f.panel.dispose(); }
});

it("可见但无有效面积的布局不允许迟到PDF首屏或密码事件重新显示旧正文，恢复有效布局才可交互", async () => {
  for (const bounds of [
    { x: 0, y: 0, width: 0, height: 300 },
    { x: 2000, y: 2000, width: 400, height: 300 },
  ]) {
    for (const event of ["ready", "password"]) {
      const deferred = Promise.withResolvers<{ bytes: Uint8Array; url: string }>();
      fake.loadPdf.mockReturnValueOnce(deferred.promise);
      const f = fixture();
      commitPdf(f);
      try {
        f.panel.setLayout({ visible: true, bounds });
        expect(f.view().setVisible).toHaveBeenLastCalledWith(false);
        deferred.resolve({ bytes: new Uint8Array([37, 80, 68, 70, 45]), url: "https://cdn.test/late.pdf" });
        await Promise.resolve(); await Promise.resolve();
        const reader = fake.readers.at(-1)!;
        expect(reader.setBounds).toHaveBeenLastCalledWith(null);
        if (event === "ready") reader.callbacks.onReady(2);
        else reader.callbacks.onPassword(false);
        expect(f.panel.getState().pdfStatus).toBe(event);
        expect(f.view().setVisible).toHaveBeenLastCalledWith(false);
        expect(reader.setVisible).toHaveBeenLastCalledWith(false);
        expect(reader.setBodyVisible).toHaveBeenLastCalledWith(false);
        await expect(f.panel.pickElement("pdf-scope", "element")).rejects.toThrow();
        expect(reader.pick).not.toHaveBeenCalled();
        f.panel.setLayout({ visible: true, bounds: { x: 0, y: 0, width: 400, height: 300 } });
        expect(reader.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 600, height: 450 });
        expect(reader.setVisible).toHaveBeenLastCalledWith(true);
        expect(reader.setBodyVisible).toHaveBeenLastCalledWith(true);
        if (event === "password") reader.callbacks.onReady(2);
        expect(await f.panel.pickElement("pdf-scope", "element")).toMatchObject({ context: { kind: "pdf", text: "PDF 独立段落" } });
        expect(reader.dispose).not.toHaveBeenCalled();
      } finally { f.panel.dispose(); }
    }
  }
});

it("scope变化通过reader撤销交互但保留PDF字节，旧来源锚点可在新scope重新授权", async () => {
  const f = await readyPdf();
  try {
    const captured = (await f.panel.pickElement("pdf-scope", "element"))!;
    const before = f.reader.cancelInteractions.mock.calls.length;
    f.panel.setContextScope("new-scope");
    expect(f.reader.cancelInteractions.mock.calls.length).toBeGreaterThan(before);
    expect(f.reader.cancelReveal).toHaveBeenCalled();
    expect(f.reader.dispose).not.toHaveBeenCalled();
    expect(f.reader.load).toHaveBeenCalledTimes(1);
    expect(fake.loadPdf).toHaveBeenCalledTimes(1);
    f.panel.syncCommentMarkers([{ scope: "new-scope", id: "entry", number: 1, sourceAnchor: captured.sourceAnchor! }]);
    f.reader.reveal.mockResolvedValueOnce({ anchorId: captured.sourceAnchor!.anchorId, rect: { x: 10, y: 20, width: 90, height: 40 } });
    expect(await f.panel.revealComment({ scope: "new-scope", requestId: "new-reveal", entryId: "entry", documentId: captured.sourceAnchor!.documentId, anchorId: captured.sourceAnchor!.anchorId })).toMatchObject({ status: "located" });
  } finally { f.panel.dispose(); }
});
