import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { BrowserPanelAction, BrowserPanelState, BrowserSelectionMode } from "../../shared/browser";
import { PaneResizeHandle } from "./PaneResizeHandle";
import { ReviewIconButton } from "./ReviewIconButton";
import { useBrowserViewport } from "./useBrowserViewport";
import { PromptContexts } from "./PromptContexts";
import "./browser-panel.css";

const emptyState: BrowserPanelState = { revision: 0, url: "", title: "", loading: false, selectingElement: false, canGoBack: false, canGoForward: false };

/** 单页网页工具区；远程正文由隔离的原生 view 承载。 */
export function BrowserPanel({ active, suspended, contextScope, zoomFactor, onClose }: {
  active: boolean;
  suspended: boolean;
  contextScope: string | null;
  zoomFactor: number;
  onClose: () => Promise<void>;
}) {
  const [state, setState] = useState<BrowserPanelState>(emptyState);
  const [address, setAddress] = useState("");
  const [operationError, setOperationError] = useState("");
  const editing = useRef(false);
  const addressInput = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const currentState = useRef(state);
  currentState.current = state;
  const contexts = useContext(PromptContexts);
  const scopeRef = useRef(contextScope);
  scopeRef.current = contextScope;
  const pickRequest = useRef(0);
  const showError = useCallback((message: string) => setOperationError(message), []);

  useEffect(() => {
    let live = true;
    let revision = -1;
    const accept = (next: BrowserPanelState) => {
      if (!live || next.revision < revision) return;
      revision = next.revision;
      currentState.current = next;
      setState(next);
      if (!editing.current) setAddress(next.url);
    };
    // 先订阅，避免初始快照覆盖刚到达的新导航。
    const unsubscribe = window.desktop.onBrowserState(accept);
    void window.desktop.getBrowserState().then(accept).catch((error: unknown) => {
      if (live) showError(error instanceof Error ? error.message : String(error));
    });
    return () => { live = false; unsubscribe(); };
  }, [showError]);

  useEffect(() => {
    if (!active) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && !focused.closest("#web-browser-panel")) trigger.current = focused;
    if (!suspended) addressInput.current?.focus();
    return () => {
      const target = trigger.current?.isConnected ? trigger.current : document.querySelector<HTMLElement>('[aria-controls="web-browser-panel"]');
      target?.focus();
    };
    // 遮挡恢复不能抢焦点；仅用户重新打开面板时聚焦。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    const desktop = window.desktop;
    return () => {
      pickRequest.current++;
      void desktop.cancelBrowserElementPick().catch(() => {});
    };
  }, [active, suspended, contextScope]);

  useBrowserViewport({ active: active && Boolean(state.url), suspended, zoomFactor, content, onError: showError });

  const run = async (operation: () => Promise<void>) => {
    setOperationError("");
    try { await operation(); }
    catch (error) { showError(error instanceof Error ? error.message : String(error)); }
  };
  const action = (value: BrowserPanelAction) => { void run(() => window.desktop.browserAction(value)); };
  let externalAvailable = false;
  try {
    const url = new URL(state.url);
    externalAvailable = (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { /* 空页没有可外开的 URL。 */ }
  const pickElement = async (mode: BrowserSelectionMode) => {
    if (state.selectingElement) {
      pickRequest.current++;
      await window.desktop.cancelBrowserElementPick();
      if (state.selectionMode === mode) return;
    }
    if (!contextScope || !contexts) throw new Error("当前不可添加网页评论");
    const capturedScope = contextScope;
    const request = ++pickRequest.current;
    const value = await window.desktop.pickBrowserElement(capturedScope, mode);
    if (!value || request !== pickRequest.current || capturedScope !== scopeRef.current || value.scope !== capturedScope) return;
    const rect = value.sourceAnchor?.rect;
    contexts.comment(value.context, { x: rect?.x ?? 0, y: rect?.y ?? 0 }, document.querySelector<HTMLElement>('[aria-controls="web-browser-panel"]') ?? undefined, value.sourceAnchor);
  };

  return (
    <aside id="web-browser-panel" className="browser-panel" hidden={!active} aria-label="网页浏览器">
      <PaneResizeHandle storageKey="omp-desktop.browser-width" label="调整浏览器侧栏宽度" initialWidth={560} minWidth={280} reserve={260} />
      <div className="browser-panel-tools" onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (state.selectingElement) {
          pickRequest.current++;
          void run(() => window.desktop.cancelBrowserElementPick());
          return;
        }
        if (editing.current || event.target === addressInput.current) {
          editing.current = false;
          setAddress(state.url);
          addressInput.current?.blur();
        } else void run(onClose);
      }}>
        <div className="browser-panel-heading">
          <strong title={state.title || "浏览器"}>{state.title || "浏览器"}</strong>
          <ReviewIconButton icon="close" tooltip="关闭浏览器" aria-label="关闭浏览器" onClick={() => { void run(onClose); }} />
        </div>
        <form className="browser-panel-navigation" onSubmit={(event) => {
          event.preventDefault();
          const url = address;
          editing.current = false;
          addressInput.current?.blur();
          void run(() => window.desktop.openBrowser(url));
        }}>
          <ReviewIconButton icon={<path d="m14 6-6 6 6 6" />} tooltip="后退" aria-label="后退" disabled={!state.canGoBack} onClick={() => action("back")} />
          <ReviewIconButton icon={<path d="m10 6 6 6-6 6" />} tooltip="前进" aria-label="前进" disabled={!state.canGoForward} onClick={() => action("forward")} />
          <ReviewIconButton icon={state.loading ? <path d="M6 6h12v12H6Z" /> : "refresh"} tooltip={state.loading ? "停止加载" : "刷新网页"} aria-label={state.loading ? "停止加载" : "刷新网页"} disabled={!state.url} onClick={() => action(state.loading ? "stop" : "reload")} />
          <input ref={addressInput} type="text" inputMode="url" aria-label="网页地址" placeholder="输入完整的 HTTP(S) 网址" value={address} spellCheck={false} autoComplete="off" onChange={(event) => { editing.current = true; setAddress(event.target.value); }} onBlur={() => { editing.current = false; setAddress(currentState.current.url); }} />
          <ReviewIconButton icon={<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" />} tooltip="在系统浏览器打开" aria-label="在系统浏览器打开" disabled={!externalAvailable} onClick={() => { void run(() => window.desktop.openExternal(state.url)); }} />
          {contexts && (["element", "region"] as const).map(mode => {
            const selected = state.selectingElement && state.selectionMode === mode;
            const label = mode === "element" ? "选择页面元素" : "框选页面区域";
            return <ReviewIconButton key={mode} icon={mode === "element" ? <path d="M4 3v16l4-4 3 6 3-1-3-6h6L4 3Z" /> : <path d="M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5M8 8h8v8H8Z" />} tooltip={selected ? `取消${label}` : label} aria-label={selected ? `取消${label}` : label} disabled={!selected && (!active || suspended || !contextScope || !externalAvailable || state.loading || (state.isPDF && state.pdfStatus !== "ready"))} onClick={() => { void run(() => pickElement(mode)); }} />;
          })}
        </form>
        <p className={`browser-panel-picking${operationError || state.error ? " browser-panel-error" : ""}`} role={operationError || state.error ? "alert" : "status"}>{operationError || state.error || (!state.selectingElement ? "选择页面元素或框选区域以添加评论" : state.selectionMode === "region" ? "拖动框选可见区域，Esc 取消" : state.isPDF ? "点击段落、图片或流程图以评论，识别不准可框选，Esc 取消" : "点击页面元素以评论，Esc 取消")}</p>
      </div>
      <div ref={content} className="browser-panel-content">
        <p>{state.url ? "网页暂时隐藏" : "输入网址或点击会话中的网页链接"}</p>
      </div>
    </aside>
  );
}
