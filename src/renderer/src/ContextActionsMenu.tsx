import { useContext, useLayoutEffect, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { type PromptContext, validatePromptContext } from "../../shared/prompt-context";
import { PromptContexts } from "./PromptContexts";
import type { CommentSourceAnchor } from "../../shared/comment-anchor";
import "./session-menu.css";
import "./file-context-menu.css";
import "./context-actions-menu.css";

export interface ContextActionsMenuProps {
  x: number; y: number; copyText: string; context?: PromptContext;
  onClose: () => void; trigger?: HTMLElement; allowAppend?: boolean; sourceAnchor?: CommentSourceAnchor;
}

/** 正文菜单只保存用户选择时的快照；所有引用由宿主草稿 provider 处理。 */
export function ContextActionsMenu({ x, y, copyText, context, onClose, trigger, allowAppend, sourceAnchor }: ContextActionsMenuProps) {
  const actions = useContext(PromptContexts);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [error, setError] = useState("");
  const close = () => { onClose(); if (menu.current?.contains(document.activeElement)) trigger?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition({ left: Math.max(4, Math.min(x, innerWidth - rect.width - 4)), top: Math.max(4, Math.min(y, innerHeight - rect.height - 4)) });
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) onClose(); };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("blur", onClose); window.removeEventListener("resize", onClose); window.removeEventListener("wheel", onClose); };
  }, [onClose]);
  async function perform(operation: () => void | Promise<void>) {
    try { setError(""); await operation(); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }
  const title = context?.kind === "diff"
    ? trigger?.closest(".project-diff-summary") ? "整个文件差异" : `已选 ${context.rows.length} 行`
    : context?.kind === "file" && context.representation === "reference" ? "文件引用（不包含文件内容）" : "所选内容";
  return createPortal(<div ref={menu} className="session-menu file-context-menu context-actions-menu" role="menu" aria-label="正文操作" style={position}
    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); close(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const index = items.findIndex((item) => item === document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
    <p className="context-actions-title">{title}</p>
    <button type="button" role="menuitem" disabled={!copyText.length} onClick={() => void perform(() => window.desktop.copyText(copyText))}>{context ? "复制" : "复制选中的文本"}</button>
    {actions && context && <button type="button" role="menuitem" onClick={() => void perform(() => { validatePromptContext(context); actions.comment(context, { x, y }, trigger, sourceAnchor); })}>评论</button>}
    {actions && context && allowAppend && <button type="button" role="menuitem" onClick={() => void perform(() => { validatePromptContext(context); actions.append(context); })}>添加到提示词</button>}
    {error && <p className="file-context-error" role="alert">{error}</p>}
  </div>, document.body);
}
