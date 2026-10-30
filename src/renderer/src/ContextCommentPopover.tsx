import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PromptContext } from "../../shared/prompt-context";
import { formatPromptContext } from "./prompt-context";
import "./context-comment.css";
import { ReviewIconButton } from "./ReviewIconButton";

export interface ContextCommentPopoverProps {
  context: PromptContext;
  anchor: { x: number; y: number };
  disabled: boolean;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
  initialValue?: string;
  value?: string;
  onChange?: (comment: string) => void;
  confirmLabel?: string;
  unavailableReason?: string;
}

/** 评论仅编辑本地快照；成功写入草稿后才由宿主关闭。 */
export function ContextCommentPopover({ context, anchor, disabled, onConfirm, onCancel, initialValue = "", value, onChange, confirmLabel = "添加到提示词", unavailableReason }: ContextCommentPopoverProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [localComment, setLocalComment] = useState(initialValue);
  const comment = value ?? localComment;
  const [error, setError] = useState("");
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const snapshotId = useId();
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const tooLong = comment.length > 16000;
  const canConfirm = !disabled && !tooLong && Boolean(comment.trim());
  const preview = !snapshotOpen ? undefined : context.kind === "file" && context.representation === "reference"
    ? `${context.path}\n文件引用（不包含文件内容）`
    : formatPromptContext(context);
  useLayoutEffect(() => { input.current?.focus(); }, []);
  useLayoutEffect(() => {
    const place = () => {
      const rect = dialog.current!.getBoundingClientRect();
      const left = anchor.x;
      const top = anchor.y - rect.height - 8 >= 8 ? anchor.y - rect.height - 8 : anchor.y + 8;
      setPosition({ left: Math.max(8, Math.min(left, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(top, window.innerHeight - rect.height - 8)) });
    };
    place();
    window.addEventListener("resize", place);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    if (dialog.current) observer?.observe(dialog.current);
    return () => { window.removeEventListener("resize", place); observer?.disconnect(); };
  }, [anchor.x, anchor.y, snapshotOpen]);
  const confirm = () => {
    if (!canConfirm) return;
    try { onConfirm(comment); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return createPortal(
      <div ref={dialog} className="context-comment context-comment-nonmodal" role="dialog" aria-label="评论" style={position}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) return;
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
          else if (event.target === input.current && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); confirm(); }
          else if (event.key === "Tab") {
            const controls = [...dialog.current!.querySelectorAll<HTMLElement>(":is(textarea, button):enabled")];
            const index = controls.indexOf(document.activeElement as HTMLElement);
            const next = (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
            event.preventDefault(); controls[next]?.focus();
          }
        }}>
        <div className="context-comment-heading">
          <strong>评论</strong>
          <ReviewIconButton icon="preview" aria-label={snapshotOpen ? "收起快照" : "查看快照"} tooltip={snapshotOpen ? "收起快照" : "查看快照"} aria-expanded={snapshotOpen} aria-controls={snapshotId} onClick={() => setSnapshotOpen((open) => !open)} />
        </div>
        {unavailableReason && <p role="status">{unavailableReason}；仍可修改评论，引用保持原快照。</p>}
        {snapshotOpen && <pre id={snapshotId} className="context-comment-preview">{preview}</pre>}
        <textarea ref={input} aria-label="评论内容" value={comment} onChange={(event) => { setLocalComment(event.currentTarget.value); onChange?.(event.currentTarget.value); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
        {tooLong && <p role="alert">评论过长，请限制在 16000 字符以内</p>}
        {error && <p role="alert">{error}</p>}
        <div className="context-comment-actions"><button type="button" onClick={onCancel}>取消</button><button type="button" disabled={!canConfirm} onClick={confirm}>{confirmLabel}</button></div>
      </div>
    , document.body,
  );
}
