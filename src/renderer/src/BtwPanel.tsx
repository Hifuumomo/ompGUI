import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { BtwRecord } from "../../shared/protocol";
import { getBtwCopyText, type BtwDraft, type BtwScopeState, type BtwSelection } from "./btw-state";
import { RichContent } from "./RichContent";
import "./btw-panel.css";

export interface BtwPanelProps {
  records: readonly BtwRecord[];
  selectedId?: string;
  mode: "compose" | "history";
  surface: "inline" | "history";
  historyDetail: boolean;
  draft: BtwDraft;
  history: BtwScopeState["history"];
  error?: string;
  storageError?: string;
  connected: boolean;
  submitting: boolean;
  runningId?: string;
  stopping: boolean;
  blocked: boolean;
  focusRequest: number;
  focusTarget: "panel" | "editor" | "list" | "reader";
  scroll: { top: number; follow: boolean };
  onScroll(value: { top: number; follow: boolean }): void;
  onDraft(text: string, selection: BtwSelection): void;
  onSelection(selection: BtwSelection): void;
  onSelect(id: string): void;
  onHistoryDetail(value: boolean): void;
  onNew(): void;
  onHistory(): void;
  onRefresh(): void;
  onSubmit(): void;
  onClose(): void;
  onStop(): void;
  onCopy(): void;
  onInsert(): void;
  onSendMain(): void;
  onMenuOpenChange(open: boolean): void;
  onCompose(): void;
  onBrowse(): void;
  copyLabel?: string;
  transferDisabled?: boolean;
}

/** 选区单独保存，移动光标不应增加草稿版本。 */
function selectionOf(editor: HTMLTextAreaElement): BtwSelection {
  return { start: editor.selectionStart, end: editor.selectionEnd, direction: editor.selectionDirection };
}

const statusLabels = { running: "回答中", complete: "已完成", cancelled: "已停止", error: "失败", interrupted: "进程中断" };


/** 无 RPC 的受控旁问面板；记录、草稿和异步操作归 App 所有。 */
export function BtwPanel(props: BtwPanelProps) {
  const { records, selectedId, mode, surface, historyDetail, draft, history, error, storageError,
    connected, submitting, runningId, stopping, blocked, focusRequest, focusTarget,
    onSelect, onHistoryDetail, onNew, onHistory, onRefresh, onSubmit, onClose, onStop,
    onCopy, onInsert, onSendMain } = props;
  const panel = useRef<HTMLElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [narrow, setNarrow] = useState(false);
  const [short, setShort] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const record = records.find((item) => item.id === selectedId);
  const fullscreen = surface === "history";
  const editing = !fullscreen || focusTarget === "editor";
  const multiple = records.length > 1;
  const showList = mode === "history" && multiple && (!narrow || (!historyDetail && (!fullscreen || !editing)));
  const showReader = !showList || !narrow;
  const canSubmit = Boolean(draft.text.trim()) && !blocked && !submitting && !runningId;
  const latest = record?.followUps?.at(-1) ?? record;
  const canFollowUp = Boolean(record) && !blocked && !submitting && !runningId;
  const selectedRunning = Boolean(runningId && selectedId === runningId);

  useLayoutEffect(() => {
    const root = panel.current;
    const conversation = root?.closest<HTMLElement>(".conversation");
    const area = root?.closest<HTMLElement>(".composer-area");
    if (!root) return;
    const measure = () => {
      setNarrow(root.getBoundingClientRect().width < 640);
      const available = fullscreen ? window.innerHeight : (conversation?.getBoundingClientRect().height ?? window.innerHeight) * 0.65;
      setShort(available < 300);
      if (area) area.style.setProperty("--btw-available-height", `${available}px`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return () => area?.style.removeProperty("--btw-available-height");
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (conversation) observer.observe(conversation);
    return () => { observer.disconnect(); area?.style.removeProperty("--btw-available-height"); };
  }, [fullscreen]);

  // 只有显式焦点请求才定位，流式记录更新不抢用户焦点。
  useLayoutEffect(() => {
    const target = focusTarget === "panel" ? panel.current : focusTarget === "editor" && editing ? editor.current : focusTarget === "list" ? list.current : reader.current;
    (target ?? reader.current)?.focus({ preventScroll: true });
    if (focusTarget === "editor" && editor.current) {
      const { start, end, direction } = callbacks.current.draft.selection;
      editor.current.setSelectionRange(start, end, direction);
    }
    if (fullscreen && focusTarget === "editor" && reader.current) {
      reader.current.scrollTop = reader.current.scrollHeight;
      callbacks.current.onScroll({ top: reader.current.scrollTop, follow: true });
    }
  }, [focusRequest, focusTarget, editing, fullscreen]);


  useLayoutEffect(() => {
    const input = editor.current;
    if (!input) return;
    input.style.height = "0px";
    const style = getComputedStyle(input);
    const line = parseFloat(style.lineHeight) || 22;
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0) + 2;
    input.style.height = `${Math.min(input.scrollHeight, line * 4 + padding)}px`;
  }, [draft.text, editing]);

  // 保存位置与贴底开关均由作用域管理，不能复制或缓存答案快照。
  useLayoutEffect(() => {
    const node = reader.current;
    if (!node || !showReader) return;
    node.scrollTop = props.scroll.follow ? node.scrollHeight : props.scroll.top;
  }, [selectedId, record, props.scroll.top, props.scroll.follow, showReader]);

  // 只滚动列表，避免选题时浏览器将整个对话或全屏层带离原位。
  useLayoutEffect(() => {
    const node = list.current;
    const selected = node?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!node || !selected) return;
    const top = selected.getBoundingClientRect().top - node.getBoundingClientRect().top + node.scrollTop;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (top + selected.offsetHeight > node.scrollTop + node.clientHeight) node.scrollTop = top + selected.offsetHeight - node.clientHeight;
  }, [selectedId, showList]);

  // 原位全屏不能卸载主输入；只暂时隔离祖先路径旁的背景节点，关闭时还原。
  useLayoutEffect(() => {
    if (!fullscreen || !panel.current) return;
    const background: Array<{ node: HTMLElement; inert: boolean }> = [];
    let branch: HTMLElement = panel.current.parentElement ?? panel.current;
    while (branch.parentElement) {
      for (const node of branch.parentElement.children) {
        if (node instanceof HTMLElement && node !== branch) {
          background.push({ node, inert: node.inert });
          node.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    return () => { for (const { node, inert } of background) node.inert = inert; };
  }, [fullscreen]);

  // 窄屏切换会卸载另一窗格；仅修复因此丢失的焦点，不抢占仍有效的控件焦点。
  useLayoutEffect(() => {
    if (fullscreen && document.activeElement === document.body) {
      (showReader ? reader.current : list.current)?.focus({ preventScroll: true });
    }
  }, [fullscreen, showList, showReader]);

  useEffect(() => () => {
    clearTimeout(compositionTimer.current);
  }, []);

  function changeMenu(open: boolean, restore = false) {
    setMenuOpen(open);
    callbacks.current.onMenuOpenChange(open);
    if (restore) moreButton.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!menuOpen || !menu.current || !moreButton.current) return;
    const anchor = moreButton.current.getBoundingClientRect();
    const rect = menu.current.getBoundingClientRect();
    setMenuPosition({
      left: Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8)),
      top: Math.max(8, anchor.bottom + rect.height + 8 > window.innerHeight ? anchor.top - rect.height - 4 : anchor.bottom + 4),
    });
    (menu.current.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? menu.current).focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !moreButton.current?.contains(event.target)) changeMenu(false);
    };
    const close = () => changeMenu(false);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      callbacks.current.onMenuOpenChange(false);
    };
  }, [menuOpen]);

  function readingKeys(event: KeyboardEvent<HTMLElement>, source: "panel" | "list" | "reader") {
    if (event.target !== event.currentTarget || event.altKey || event.metaKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const pane = source === "panel" ? (fullscreen && (!multiple || mode !== "history" || historyDetail) ? "reader" : "list") : source;
    if (fullscreen && (event.key === "Tab" || (event.ctrlKey && event.key === "/")) && multiple && mode === "history") {
      event.preventDefault(); event.stopPropagation();
      onHistoryDetail(pane !== "reader");
      return;
    }
    if (event.ctrlKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === "c") { event.preventDefault(); event.stopPropagation(); if (record && getBtwCopyText(record)) onCopy(); return; }
    if (key === "f" || event.key === "Enter") {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && (!fullscreen || canFollowUp)) props.onCompose();
      return;
    }
    if (pane === "list" && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const index = records.findIndex((item) => item.id === selectedId);
      const page = Math.max(1, Math.floor((list.current?.clientHeight ?? 0) / 70));
      const step = event.key === "PageUp" ? -page : event.key === "PageDown" ? page : event.key === "ArrowDown" ? 1 : -1;
      const next = event.key === "Home" ? 0 : event.key === "End" ? records.length - 1 : index < 0 ? 0 : Math.max(0, Math.min(records.length - 1, index + step));
      if (records[next]) onSelect(records[next].id);
      return;
    }
    if (pane === "list" && event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); onHistoryDetail(true); return; }
    if (pane === "reader" && event.key === "ArrowLeft" && multiple && mode === "history") { event.preventDefault(); event.stopPropagation(); onHistoryDetail(false); return; }
    if (pane === "reader" && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const node = reader.current;
      if (!node) return;
      const line = parseFloat(getComputedStyle(node).lineHeight) || 24;
      node.scrollTop = event.key === "Home" ? 0 : event.key === "End" ? node.scrollHeight : node.scrollTop + (event.key === "ArrowUp" ? -line : event.key === "ArrowDown" ? line : event.key === "PageUp" ? -node.clientHeight : node.clientHeight);
      props.onScroll({ top: node.scrollTop, follow: node.scrollHeight - node.clientHeight - node.scrollTop <= 24 });
    }
  }

  const editorSurface =
    <div className="btw-panel-editor">
      <label htmlFor="btw-question">{record ? "追问" : "旁问问题"}</label>
      <textarea id="btw-question" ref={editor} rows={1} value={draft.text} placeholder={record ? "继续追问…" : "问一个不打断主线的问题…"} onChange={(event) => props.onDraft(event.currentTarget.value, selectionOf(event.currentTarget))} onSelect={(event) => props.onSelection(selectionOf(event.currentTarget))}
        onFocus={() => { if (focusTarget !== "editor") props.onCompose(); }}
        onCompositionStart={() => { clearTimeout(compositionTimer.current); composing.current = true; }}
        onCompositionEnd={() => { compositionTimer.current = setTimeout(() => { composing.current = false; }, 0); }}
        onKeyDown={(event) => {
          if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
            if (event.key === "Enter" || event.key === "Escape") event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.key === "Escape" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault(); event.stopPropagation();
            if (!event.repeat) props.onBrowse();
            return;
          }
          // 队列组合键只属于主输入，不允许从旁问向主任务穿透。
          if ((event.ctrlKey || event.metaKey) && (event.key === "Enter" || event.key.toLowerCase() === "q")) { event.preventDefault(); event.stopPropagation(); return; }
          if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault(); event.stopPropagation();
            if (!event.repeat && canSubmit) onSubmit();
          }
        }} />
    </div>;
  const content = <section ref={panel} tabIndex={0} role={fullscreen ? "dialog" : "region"} aria-modal={fullscreen || undefined} className={`btw-panel${fullscreen ? " btw-panel-history" : ""}${narrow ? " btw-panel-narrow" : ""}${short ? " btw-panel-short" : ""}${!fullscreen && mode === "compose" && !record ? " btw-panel-compact" : ""}`} aria-label={fullscreen ? "旁问历史" : "旁问"} aria-describedby="btw-browse-keys" onKeyDown={(event) => {
    readingKeys(event, "panel");
    if (fullscreen && event.key === "Tab" && !event.defaultPrevented && !menuOpen) {
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, [tabindex="0"], a[href]') ?? []);
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
    }
    // Esc 交由 App 处理停止/关闭，其余快捷键不能漏到主会话。
    if (fullscreen && (event.key !== "Escape" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.stopPropagation();
  }}>
    <header className="btw-panel-header">
      <strong title={record?.question}>{fullscreen ? "BTW history · 旁问历史" : mode === "history" ? "旁问历史" : record ? record.question : "旁问 · 新主题"}</strong>
      <div className="btw-panel-actions">
        {(fullscreen || selectedId || mode === "history") && <button type="button" onClick={onNew}>新主题</button>}
        {(mode !== "history" || (!record && records.length > 0)) && <button type="button" onClick={onHistory}>历史</button>}
        {(fullscreen || mode === "history") && <button type="button" onClick={onRefresh} disabled={history === "loading"}>刷新</button>}
        <button type="button" onClick={onClose} aria-label="收起旁问">收起 {(!fullscreen || (!editing && !selectedRunning)) && <kbd>Esc</kbd>}</button>
      </div>
    </header>
    {storageError && <div className="btw-panel-error" role="alert">旁问历史保存失败：{storageError}<button type="button" onClick={onRefresh}>刷新</button></div>}
    {error && <div className="btw-panel-error" role="alert">{error}<button type="button" onClick={onRefresh}>刷新</button></div>}
    <div className="btw-panel-body">
      {showList && <div ref={list} className="btw-panel-list" role="listbox" aria-label="旁问主题" tabIndex={0} aria-activedescendant={selectedId ? `btw-topic-${selectedId}` : undefined} onKeyDown={(event) => readingKeys(event, "list")}>
        {fullscreen && <h2 className="btw-pane-title">History ({records.length}) · 历史</h2>}
        {records.map((item) => <div key={item.id} id={`btw-topic-${item.id}`} role="option" aria-selected={item.id === selectedId} className="btw-panel-topic" onClick={() => { list.current?.focus({ preventScroll: true }); onSelect(item.id); if (narrow) onHistoryDetail(true); }}>
          {fullscreen && <small className="btw-topic-meta"><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString()}</time><span>{statusLabels[(item.followUps?.at(-1) ?? item).status]}</span></small>}
          <span title={item.question}>{item.question}</span>{!fullscreen && <small>{statusLabels[(item.followUps?.at(-1) ?? item).status]}</small>}
        </div>)}
      </div>}
      {showReader && <div className="btw-panel-detail">
        {narrow && multiple && mode === "history" && historyDetail && <button type="button" className="btw-panel-back" onClick={() => { onHistoryDetail(false); }}>← 返回历史</button>}
        {fullscreen && <h2 className="btw-pane-title">Details · 详情{record ? ` · ${statusLabels[latest!.status]}` : ""}</h2>}
        <div ref={reader} className="btw-panel-reader" tabIndex={0} aria-label="旁问阅读区" onKeyDown={(event) => readingKeys(event, "reader")} onScroll={(event) => {
          const node = event.currentTarget;
          props.onScroll({ top: node.scrollTop, follow: node.scrollHeight - node.clientHeight - node.scrollTop <= 24 });
        }}>
          {history === "loading" && <p className="btw-panel-hint" role="status">正在读取旁问历史…</p>}
          {history === "unavailable" && <p className="btw-panel-hint">连接后可读取旁问历史</p>}
          {history === "ready" && !records.length && mode === "history" && <p className="btw-panel-hint">暂无旁问{fullscreen ? "。使用 /btw 问题 或「新主题」开始。" : ""}</p>}
          {record && [record, ...(record.followUps ?? [])].map((turn, index) => <article className="btw-panel-turn" key={index}>
            {fullscreen && <div className="btw-turn-meta"><span className={turn.status === "error" ? "btw-panel-error" : ""}>{statusLabels[turn.status]}</span><time dateTime={new Date(turn.createdAt).toISOString()}>{new Date(turn.createdAt).toLocaleString()}</time></div>}
            {fullscreen && <h3 className="btw-turn-label">Question · 问题</h3>}
            <h3>{turn.question}</h3>
            {fullscreen && <h3 className="btw-turn-label">Answer · 回答</h3>}
            {turn.answer && <RichContent text={turn.answer} />}
            {fullscreen && !turn.answer.trim() && <p className="btw-panel-hint">{turn.status === "running" ? "等待回答…" : "暂无回答正文"}</p>}
            {(!fullscreen || turn.error) && <small className={turn.status === "error" ? "btw-panel-error" : "btw-panel-hint"}>{statusLabels[turn.status]}{turn.error ? `：${turn.error}` : ""}</small>}
          </article>)}
        </div>
        {record && !props.scroll.follow && <button type="button" className="btw-panel-latest" onClick={() => props.onScroll({ top: reader.current?.scrollHeight ?? 0, follow: true })}>回到最新</button>}
        {fullscreen && editing && editorSurface}
      </div>}
    </div>
    {record && <div className="btw-panel-transfer">
      <button type="button" onClick={onCopy} disabled={!getBtwCopyText(record)}>{props.copyLabel ?? "复制答案"}</button>
      {!fullscreen && <button type="button" onClick={onInsert} disabled={props.transferDisabled}>插入主聊天草稿</button>}
      <button ref={moreButton} type="button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => changeMenu(!menuOpen)} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); changeMenu(true); }
      }}>更多</button>
    </div>}
    {!fullscreen && editorSurface}
    <footer className="btw-panel-footer">
      {!fullscreen && <span>Enter 提交 · Shift+Enter 换行 · Esc 返回旁问</span>}
      <span id="btw-browse-keys">{fullscreen
        ? editing ? "Enter 提交 · Shift+Enter 换行 · Esc 返回阅读"
          : `${multiple ? "Tab / Ctrl+/ 切换窗格 · " : ""}↑↓ / PgUp/PgDn 浏览 · ${canFollowUp ? "F / Enter 追问 · " : ""}${record && getBtwCopyText(record) ? "C 复制 · " : ""}${selectedRunning ? "Esc 停止所选旁问" : "Esc 返回会话"}`
        : "↑↓ 切换历史 · F 追问 · C 复制 · Esc 返回会话"}</span>
      <div className="btw-panel-actions">
        {runningId && <><span role="status">{selectedRunning ? "回答中" : "其他主题回答中"}</span>{(!fullscreen || selectedRunning) && <button type="button" onClick={onStop} disabled={stopping}>{stopping ? "正在停止…" : "停止"}</button>}</>}
        {editing ? <button type="button" className="primary" onClick={() => {
          // 显式发送仍属于当前编辑交互；接受后按与 Enter 相同的规则返回阅读。
          if (fullscreen) editor.current?.focus({ preventScroll: true });
          onSubmit();
        }} disabled={!canSubmit}>{submitting ? "正在提交" : !connected ? "连接后提问" : selectedId ? "追问" : "提问"}</button>
          : record && <button type="button" className="primary" onClick={props.onCompose} disabled={!canFollowUp}>追问 <kbd>F</kbd></button>}
      </div>
    </footer>
    {menuOpen && createPortal(<div ref={menu} className="btw-panel-menu" role="menu" tabIndex={-1} aria-label="旁问更多操作" style={menuPosition as CSSProperties} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); changeMenu(false, true); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>{fullscreen && <button type="button" role="menuitem" disabled={props.transferDisabled} onClick={() => { changeMenu(false); onInsert(); }}>插入主聊天草稿</button>}<button type="button" role="menuitem" disabled={props.transferDisabled} onClick={() => { changeMenu(false); onSendMain(); }}>明确发送至主聊天</button></div>, document.body)}
  </section>;
  return fullscreen ? <div className="btw-history-layer">{content}</div> : content;
}

export interface BtwStatusBarProps {
  label: string;
  canStop: boolean;
  stopping: boolean;
  onOpen(): void;
  onStop(): void;
}

/** 收起只隐藏编辑面板，后台状态和独立停止入口仍然可达。 */
export function BtwStatusBar({ label, canStop, stopping, onOpen, onStop }: BtwStatusBarProps) {
  return <div className="btw-status-bar" role="region" aria-label="旁问状态">
    <button type="button" className="btw-status-open" onClick={onOpen}>{label}<span>展开</span></button>
    {canStop && <button type="button" onClick={onStop} disabled={stopping}>{stopping ? "正在停止…" : "停止"}</button>}
  </div>;
}
