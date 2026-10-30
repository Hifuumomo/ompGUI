import { useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { messageFileHref } from "../../shared/message-file-link";
import { FileReferenceLink } from "./FileReferenceLink";
import { parseFileReferences } from "./file-reference-tokens";
import type { MentionToken } from "./useFileMentions";
import "./composer-file-references.css";

/** 在原生 textarea 上镜像原文及内联文件链接，不接管文本、键盘或输入法编辑。[in] props：draft 为草稿，input 为原生输入框，editingToken 为当前查询，confirmedPaths 为已确认的真实路径，composing 为输入法状态，onOpen 为文件打开入口，onSelectionChange 为拖选观察回调，children 为原有 textarea。返回值：保留原生编辑能力的镜像容器。 */
export function ComposerFileReferences({
  draft,
  input,
  editingToken,
  confirmedPaths,
  composing,
  onOpen,
  onSelectionChange,
  children,
}: {
  draft: string;
  input: RefObject<HTMLTextAreaElement | null>;
  editingToken?: MentionToken;
  confirmedPaths: readonly string[];
  composing: boolean;
  onOpen: (href: string) => Promise<void>;
  onSelectionChange: (element: HTMLTextAreaElement) => void;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; start: number; moved: boolean } | undefined>(undefined);
  const suppressClick = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const [controlPressed, setControlPressed] = useState(false);

  /** 原地按放 Ctrl 也更新引用光标；失焦时清除粘滞修饰键。 */
  useLayoutEffect(() => {
    function update(event: KeyboardEvent | PointerEvent) {
      setControlPressed(event.ctrlKey);
    }
    function reset() { setControlPressed(false); }
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("pointermove", update);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("pointermove", update);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, []);

  /** 使用原生 clientWidth 排除滚动条，保持软换行、侧栏调宽与真实光标一致。参数：无。返回值：无。 */
  function synchronize() {
    const textarea = input.current!;
    viewport.current!.style.width = `${textarea.clientWidth}px`;
    viewport.current!.style.height = `${textarea.clientHeight}px`;
    mirror.current!.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
  }
  // 草稿、布局状态和侧栏宽度均由 React 驱动；每次布局提交后读取最终原生尺寸。
  useLayoutEffect(synchronize);

  /** 跟随窗口缩放和原生滚动同步镜像。参数：无。返回值：移除尺寸与滚动监听的清理函数。 */
  function watchGeometry() {
    const textarea = input.current!;
    const frame = viewport.current!;
    window.addEventListener("resize", synchronize);
    textarea.addEventListener("scroll", synchronize);
    /** 将链接上的滚轮交回原生输入框，避免镜像阻断多行滚动。[in] event：滚轮事件。返回值：无。 */
    function scrollInput(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? parseFloat(getComputedStyle(textarea).lineHeight) : event.deltaMode === 2 ? textarea.clientHeight : 1;
      textarea.scrollTop += event.deltaY * unit;
      textarea.scrollLeft += event.deltaX * unit;
      synchronize();
    }
    frame.addEventListener("wheel", scrollInput, { passive: false });
    /** 解除已卸载输入框的布局观察。参数：无。返回值：无。 */
    function stopWatching() {
      window.removeEventListener("resize", synchronize);
      textarea.removeEventListener("scroll", synchronize);
      frame.removeEventListener("wheel", scrollInput);
    }
    return stopWatching;
  }
  useLayoutEffect(watchGeometry, [input]);

  /** 用镜像 DOM 的浏览器排版结果求原文下标，避免自行计算中英文、tab 或软换行宽度。[in] x：视口横坐标；[in] y：视口纵坐标。返回值：正文下标，指针未命中文字时为 undefined。 */
  function offsetAtPoint(x: number, y: number): number | undefined {
    const content = mirror.current!;
    const bounds = viewport.current!.getBoundingClientRect();
    // 临时让浏览器命中镜像正文；平时普通文字仍直接透传给原生 textarea。
    content.style.pointerEvents = "auto";
    const caret = document.caretRangeFromPoint(
      Math.max(bounds.left, Math.min(x, bounds.right - 1)),
      Math.max(bounds.top, Math.min(y, bounds.bottom - 1)),
    );
    content.style.pointerEvents = "";
    if (!caret || !content.contains(caret.startContainer)) return undefined;
    const prefix = document.createRange();
    prefix.selectNodeContents(content);
    prefix.setEnd(caret.startContainer, caret.startOffset);
    let offset = prefix.toString().length;
    // 打开失败提示不是草稿正文，不能把其文字计入原生选择下标。
    for (const error of content.querySelectorAll(".rich-link-error")) {
      if (prefix.intersectsNode(error)) offset -= error.textContent?.length ?? 0;
    }
    return Math.min(draft.length, offset);
  }

  /** 让链接上的拖动选择原生文本，Ctrl 单击才打开文件。参数：无。返回值：移除本次文档指针监听的清理函数。 */
  function watchSelection() {
    /** 更新链接起始的拖选，并在超出可见区域时滚动原生输入框。[in] event：文档指针移动。返回值：无。 */
    function move(event: PointerEvent) {
      const active = gesture.current;
      if (!active) return;
      if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < 4) return;
      active.moved = true;
      suppressClick.current = true;
      setSelecting(true);
      const textarea = input.current!;
      const bounds = viewport.current!.getBoundingClientRect();
      if (event.clientY < bounds.top) textarea.scrollTop -= bounds.top - event.clientY;
      else if (event.clientY > bounds.bottom) textarea.scrollTop += event.clientY - bounds.bottom;
      synchronize();
      const end = offsetAtPoint(event.clientX, event.clientY);
      if (end === undefined) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(Math.min(active.start, end), Math.max(active.start, end), end < active.start ? "backward" : "forward");
      onSelectionChange(textarea);
    }
    /** 结束原生或镜像拖选，让下一次悬停可继续命中文件链接。参数：无。返回值：无。 */
    function finish() {
      gesture.current = undefined;
      setSelecting(false);
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    /** 解除文档监听，避免切换会话或卸载后继续修改旧输入框。参数：无。返回值：无。 */
    function stopWatching() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
    }
    return stopWatching;
  }
  useLayoutEffect(watchSelection, [draft, input, onSelectionChange]);

  /** 普通单击定位输入光标，Ctrl 单击保留原选择，同时允许从引用开始拖选。 */
  function startSelection(event: ReactPointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    setControlPressed(event.ctrlKey);
    if (event.button !== 0) return;
    const link = (event.target as Element).closest("a.rich-file-link");
    if (!link) {
      setSelecting(true);
      return;
    }
    event.preventDefault();
    const start = offsetAtPoint(event.clientX, event.clientY);
    if (start === undefined) return;
    gesture.current = { x: event.clientX, y: event.clientY, start, moved: false };
    if (!event.ctrlKey) {
      const textarea = input.current!;
      const anchor = event.shiftKey
        ? (textarea.selectionDirection === "backward" ? textarea.selectionEnd : textarea.selectionStart)
        : start;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(Math.min(anchor, start), Math.max(anchor, start), start < anchor ? "backward" : "forward");
      gesture.current.start = anchor;
      onSelectionChange(textarea);
    }
  }

  /** 输入框仅允许 Ctrl+左键打开，且拖选结束不能误触发打开。 */
  function stopDragClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!(event.target as Element).closest("a.rich-file-link")) return;
    if (event.ctrlKey && event.button === 0 && !suppressClick.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = false;
  }

  const segments: ReactNode[] = [];
  let end = 0;
  for (const reference of parseFileReferences(draft)) {
    if (reference.start === editingToken?.start && reference.end === editingToken.end && !confirmedPaths.includes(reference.path)) continue;
    segments.push(draft.slice(end, reference.start));
    segments.push(
      <FileReferenceLink key={reference.start} href={messageFileHref(reference.path)} onOpen={onOpen}>
        {draft.slice(reference.start, reference.end)}
      </FileReferenceLink>,
    );
    end = reference.end;
  }
  segments.push(draft.slice(end));

  return (
    <div
      className={`composer-file-references${controlPressed ? " is-control-pressed" : ""}${composing ? " is-composing" : ""}${selecting ? " is-selecting" : ""}`}
      onPointerDownCapture={startSelection}
      onClickCapture={stopDragClick}
      onAuxClickCapture={stopDragClick}
    >
      {children}
      <div className="composer-reference-viewport" ref={viewport}>
        <div className="composer-reference-content" ref={mirror}>{segments}{draft.endsWith("\n") ? "\u200b" : null}</div>
      </div>
    </div>
  );
}
