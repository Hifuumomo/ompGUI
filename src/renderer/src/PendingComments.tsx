import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PromptContext } from "../../shared/prompt-context";
import type { DraftComment } from "./comment-draft";
import { formatPromptContext } from "./prompt-context";
import "./pending-comments.css";

/** 卡片摘要仅来自登记快照，绝不以当前网页或文件替换引用。 */
function sourceSummary(context: PromptContext) {
  if (context.kind === "web") return { source: context.title || context.url, excerpt: context.text };
  if (context.kind === "pdf") return { source: `${context.title || context.url} · 第${context.page}页 · ${({ paragraph: "段落", figure: "图块", region: "区域", text: "文本" })[context.selection]}`, excerpt: context.text };
  if (context.kind === "web-region") return { source: `${context.title || context.url} · 网页区域截图`, excerpt: "网页可见区域截图" };
  const name = context.path.split(/[\\/]/).at(-1) || context.path;
  if (context.kind === "file") {
    const lines = context.startLine === undefined ? "" : ` · L${context.startLine}${context.endLine !== undefined && context.endLine !== context.startLine ? `–${context.endLine}` : ""}`;
    return { source: `${name}${lines}${context.representation === "reference" ? " · 仅文件路径" : ""}`, excerpt: context.text || context.path };
  }
  return { source: `${name} · ${context.side === "old" ? "修改前" : context.side === "new" ? "修改后" : "差异"}`, excerpt: context.rows.map((row) => row.text).join("\n") };
}
interface HoveredComment { id: string; anchor: HTMLElement }

export function PendingComments({ entries, revealingId, onEdit, onDelete }: {
  entries: readonly DraftComment[];
  revealingId?: string;
  onEdit: (entry: DraftComment, anchor: { x: number; y: number }, trigger?: HTMLElement) => void;
  onDelete: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<HoveredComment>();
  const currentHover = useRef(hovered);
  const closeTimer = useRef<number | undefined>(undefined);
  const popup = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const [position, setPosition] = useState({ left: 8, top: 8, width: 360, maxHeight: 320 });
  const entry = hovered && entries.find((item) => item.id === hovered.id);
  const summary = useMemo(() => entry && sourceSummary(entry.context), [entry]);
  const cancelClose = useCallback(() => { window.clearTimeout(closeTimer.current); closeTimer.current = undefined; }, []);
  const close = useCallback(() => { cancelClose(); currentHover.current = undefined; setHovered(undefined); }, [cancelClose]);
  const open = (id: string, anchor: HTMLElement) => {
    cancelClose();
    if (currentHover.current?.id === id && currentHover.current.anchor === anchor) return;
    const next = { id, anchor };
    currentHover.current = next;
    setHovered(next);
  };
  /** 留出跨越浮层间隙的时间；键盘仍聚焦在条目或详情时不提前关闭。 */
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.matches(":focus-visible") &&
        (currentHover.current?.anchor.contains(focused) || popup.current?.contains(focused))) return;
      close();
    }, 180);
  };
  useEffect(() => () => cancelClose(), [cancelClose]);
  useEffect(() => { if (hovered && !entry) close(); }, [hovered, entry, close]);
  const place = useCallback(() => {
    const anchor = currentHover.current?.anchor;
    const panel = popup.current;
    if (!anchor?.isConnected || !panel) return;
    const rect = anchor.getBoundingClientRect();
    const conversation = anchor.closest(".conversation")?.getBoundingClientRect();
    // 浮层留在聊天区域，不能越过边界被右侧原生网页遮住。
    const leftEdge = Math.max(8, (conversation?.left ?? 0) + 8);
    const rightEdge = Math.min(innerWidth - 8, (conversation?.right ?? innerWidth) - 8);
    const topEdge = Math.max(8, (conversation?.top ?? 0) + 8);
    const bottomEdge = Math.min(innerHeight - 8, (conversation?.bottom ?? innerHeight) - 8);
    const width = Math.min(360, Math.max(1, rightEdge - leftEdge));
    const maxHeight = Math.max(1, bottomEdge - topEdge);
    const height = Math.min(panel.getBoundingClientRect().height, maxHeight);
    const above = rect.top - height - 8;
    const top = above >= topEdge ? above : rect.bottom + 8;
    const next = { left: Math.max(leftEdge, Math.min(rect.left, rightEdge - width)), top: Math.max(topEdge, Math.min(top, bottomEdge - height)), width, maxHeight };
    setPosition((previous) => previous.left === next.left && previous.top === next.top && previous.width === next.width && previous.maxHeight === next.maxHeight ? previous : next);
  }, []);
  useLayoutEffect(() => {
    if (!entry) return;
    place();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    if (popup.current) observer?.observe(popup.current);
    return () => observer?.disconnect();
  }, [entry, hovered, place]);
  useEffect(() => {
    if (!entry) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || currentHover.current?.anchor.contains(event.target) || popup.current?.contains(event.target)) return;
      close();
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) close(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault(); event.stopPropagation();
      if (popup.current?.contains(document.activeElement)) currentHover.current?.anchor.querySelector<HTMLButtonElement>(".pending-comment-label")?.focus();
      close();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [entry, close]);
  if (!entries.length) return null;
  return <>
    <section className="pending-comments" aria-label="待发送评论">
      {entries.map((item) => <article className="pending-comment-card" key={item.id} data-comment-id={item.id} aria-label={`评论${item.number}`}
        onMouseEnter={(event) => open(item.id, event.currentTarget)} onMouseLeave={scheduleClose}
        onFocusCapture={(event) => { if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) open(item.id, event.currentTarget); }} onBlurCapture={scheduleClose}>
        <header><button type="button" className="pending-comment-label" aria-label={`查看评论${item.number}`} aria-expanded={entry?.id === item.id} aria-controls={entry?.id === item.id ? popupId : undefined} onClick={(event) => open(item.id, event.currentTarget.closest<HTMLElement>(".pending-comment-card")!)}>评论{item.number}</button>
          <div className="pending-comment-actions">
            <button type="button" data-comment-edit={item.id} aria-label={`定位并编辑评论${item.number}`} title={`定位并编辑评论${item.number}`} onClick={(event) => { close(); const rect = event.currentTarget.getBoundingClientRect(); onEdit(item, { x: rect.left, y: rect.top }, event.currentTarget); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z" /></svg>
            </button>
            <button type="button" aria-label={`删除评论${item.number}`} title={`删除评论${item.number}`} onClick={() => { close(); onDelete(item.id); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
            </button>
          </div>
        </header>
        {revealingId === item.id && <small role="status">正在定位…</small>}
      </article>)}
    </section>
    {entry && summary && createPortal(<div ref={popup} id={popupId} className="pending-comment-popover" role="region" aria-label={`评论${entry.number}详情`} style={position}
      onMouseEnter={cancelClose} onMouseLeave={scheduleClose} onFocusCapture={cancelClose} onBlurCapture={scheduleClose}>
      <strong>评论{entry.number}</strong>
      <small className="pending-comment-source" title={"url" in entry.context ? entry.context.url : entry.context.path}>{summary.source}</small>
      <p className="pending-comment-excerpt">{summary.excerpt}</p>
      {"image" in entry.context && entry.context.image && <img className="pending-comment-image" src={`data:image/png;base64,${entry.context.image.data}`} width={entry.context.image.width} height={entry.context.image.height} alt={`评论${entry.number}的选区截图`} onLoad={place} />}
      <p className="pending-comment-body">{entry.comment}</p>
      <details key={entry.id} onToggle={place}><summary>查看引用快照</summary><pre>{formatPromptContext(entry.context)}</pre></details>
    </div>, document.body)}
  </>;
}
