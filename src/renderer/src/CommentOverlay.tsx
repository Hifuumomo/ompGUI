import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CommentOverlayBridge, CommentOverlayState } from "../../shared/comment-overlay";
import { validatePromptContextImage } from "../../shared/prompt-context";
import { DEFAULT_INTERFACE_FONT_SIZE } from "./useInterfaceFontSize";
import "./comment-overlay.css";

declare global {
  interface Window { commentOverlay: CommentOverlayBridge }
}

export function CommentOverlay() {
  const [state, setState] = useState<CommentOverlayState | null>(null);
  const [comment, setComment] = useState("");
  const [validation, setValidation] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const lastRequest = useRef("");
  const panel = useRef<HTMLElement>(null);
  useEffect(() => window.commentOverlay.onState(setState), []);
  const imageError = useMemo(() => {
    if (!state?.editor.image) return "";
    try { validatePromptContextImage(state.editor.image); return ""; }
    catch (error) { return error instanceof Error ? error.message : "选区图片无效"; }
  }, [state?.editor.image]);
  useLayoutEffect(() => {
    if (!state) { lastRequest.current = ""; return; }
    const newRequest = state.requestId !== lastRequest.current;
    // 同一请求的 host 回声可能落后于本地输入，不能用旧回声覆盖新文字。
    if (newRequest) setComment(state.editor.comment);
    if (state.requestId !== lastRequest.current) {
      composing.current = false;
      lastRequest.current = state.requestId;
      setValidation("");
      input.current?.focus();
      input.current?.setSelectionRange(state.editor.comment.length, state.editor.comment.length);
    }
    // Main validates this identity before focusing the native view, once per request.
    window.commentOverlay.ready(state.requestId);
  }, [state]);
  if (!state) return null;
  const { editor, requestId } = state;
  const unavailable = state.unavailable || editor.sourceAnchor.unavailable;
  const cancel = () => window.commentOverlay.send(requestId, { type: "cancel", scope: editor.scope, editorId: editor.editorId });
  const confirm = () => {
    if (composing.current) return;
    if (imageError) { setValidation(imageError); return; }
    if (!comment.trim()) { setValidation("请输入评论内容"); input.current?.focus(); return; }
    if (comment.length > 16_000) { setValidation("评论不能超过 16000 字符"); input.current?.focus(); return; }
    window.commentOverlay.send(requestId, { type: "confirm", scope: editor.scope, editorId: editor.editorId, comment });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.target === input.current && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      confirm();
    } else if (event.key === "Tab") {
      const controls = panel.current?.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>("textarea:not(:disabled), button:not(:disabled)");
      if (!controls?.length) return;
      const index = Array.from(controls).indexOf(document.activeElement as HTMLButtonElement);
      const next = (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      event.preventDefault();
      controls[next].focus();
    }
  };
  // 原生 view 已采用宿主 zoom；CSS 使用基准字号，不能重复缩放。
  const fontSize = DEFAULT_INTERFACE_FONT_SIZE;
  return <section ref={panel} className={`comment-overlay ${editor.theme === "light" ? "light" : "dark"}`} style={{ fontSize }} role="dialog" aria-modal="false" aria-labelledby="comment-title" onKeyDown={onKeyDown}>
    <header><strong id="comment-title">评论</strong><button type="button" className="close" aria-label="取消评论" onClick={cancel}>×</button></header>
    <blockquote title={editor.source}>{editor.source}</blockquote>
    {editor.image && !imageError && <img className="selection-preview" src={`data:image/png;base64,${editor.image.data}`} width={editor.image.width} height={editor.image.height} alt="评论选区截图" />}
    <textarea ref={input} aria-label="评论内容" aria-describedby="comment-status" placeholder="输入评论…" value={comment} maxLength={16_000}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={(event) => {
        composing.current = false;
        const value = event.currentTarget.value;
        setComment(value);
        window.commentOverlay.send(requestId, { type: "change", scope: editor.scope, editorId: editor.editorId, comment: value });
      }}
      onChange={(event) => {
        const value = event.target.value;
        setComment(value);
        setValidation("");
        window.commentOverlay.send(requestId, { type: "change", scope: editor.scope, editorId: editor.editorId, comment: value });
      }} />
    <div id="comment-status" className="status" role="status">{validation || imageError || editor.error || unavailable}</div>
    <footer><span className="hint">Enter 确认 · Shift+Enter 换行 · Esc 取消</span><button type="button" onClick={cancel}>取消</button><button type="button" className="confirm" onClick={confirm}>{editor.editing ? "保存评论" : "确认"}</button></footer>
  </section>;
}
