import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { fileMentionTokens } from "./file-reference-tokens";

export interface MentionToken {
  readonly start: number; // @ 标记在草稿中的起点。
  readonly end: number; // 当前引用 token 的结束位置。
  readonly query: string; // 光标前用于模糊搜索的相对路径片段。
}

/** 识别光标所在的文件引用，邮箱和非折叠选择不触发补全。[in] text：完整草稿；[in] start：选择起点；[in] end：选择终点。返回值：当前引用范围和查询，不在引用中时为 undefined。 */
export function mentionToken(text: string, start: number, end: number): MentionToken | undefined {
  if (start !== end) return undefined;
  for (const token of fileMentionTokens(text)) {
    if (start < token.queryStart || start > token.queryEnd) continue;
    return { start: token.start, end: token.end, query: text.slice(token.queryStart, start) };
  }
  return undefined;
}

/** 管理引用搜索、键盘选择及补全后的焦点；旧会话和旧查询的异步响应不进入当前候选。[in] options：草稿、真实工作目录、会话身份、输入框引用、草稿写入及错误报告回调。返回值：当前候选、选择索引和输入事件操作。 */
export function useFileMentions(options: {
  readonly draft: string;
  readonly cwd: string;
  readonly scope: string;
  readonly input: RefObject<HTMLTextAreaElement | null>;
  readonly setDraft: (draft: string) => void;
  readonly report: (error: unknown) => void;
  readonly enabled: boolean;
}) {
  const { draft, cwd, scope, input, setDraft, report, enabled } = options;
  const [selection, setSelection] = useState({ text: "", start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState("");
  const [result, setResult] = useState<{ key: string; paths: string[]; error?: string }>();
  const [choice, setChoice] = useState({ key: "", index: 0 });
  const [confirmed, setConfirmed] = useState<{ scope: string; cwd: string; paths: readonly string[] }>({ scope, cwd, paths: [] });
  const confirmedPaths = confirmed.scope === scope && confirmed.cwd === cwd ? confirmed.paths : [];
  const restoreCaret = useRef<number | undefined>(undefined);
  const editingToken = selection.text === draft
    ? mentionToken(draft, selection.start, selection.end)
    : undefined;
  const token = enabled && focused && !composing ? editingToken : undefined;
  const key = JSON.stringify([scope, cwd, draft, selection.start, selection.end]);
  const active = Boolean(cwd && token && dismissed !== key);
  const current = useRef({ key, active });
  current.current = { key, active };
  const paths = active && result?.key === key ? result.paths : [];
  const error = active && result?.key === key ? result.error : undefined;
  const loading = active && result?.key !== key;
  const index = choice.key === key ? Math.min(choice.index, Math.max(0, paths.length - 1)) : 0;
  const query = token?.query;

  useEffect(() => {
    if (!active || query === undefined) return;
    let live = true;
    // 搜索只依赖本机工作目录，不要求聊天 RPC 已连接。
    window.desktop.searchMentionFiles(cwd, query).then(
      (files) => {
        if (live && current.current.active && current.current.key === key)
          setResult({ key, paths: files });
      },
      (failure: unknown) => {
        if (!live || !current.current.active || current.current.key !== key) return;
        setResult({ key, paths: [], error: failure instanceof Error ? failure.message : String(failure) });
        report(failure);
      },
    );
    return () => { live = false; };
  }, [active, cwd, query, key, report]);

  useLayoutEffect(() => {
    if (restoreCaret.current === undefined) return;
    const caret = restoreCaret.current;
    restoreCaret.current = undefined;
    input.current?.focus();
    input.current?.setSelectionRange(caret, caret);
  }, [draft, input, selection.start, selection.end]);

  /** 将当前键盘候选保持在可见菜单区域，不依赖 textarea 的直接父节点。参数：无。返回值：无。 */
  function revealSelection() {
    input.current?.closest(".composer-box")
      ?.querySelector('.mention-menu [aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }
  useEffect(revealSelection, [index, key, paths, input]);

  /** 记录当前输入值与选择，使移动光标也能刷新对应 token。[in] element：当前输入框。返回值：无。 */
  function observe(element: HTMLTextAreaElement) {
    setSelection({ text: element.value, start: element.selectionStart, end: element.selectionEnd });
  }

  /** 写入用户草稿并记录该次编辑的光标。[in] element：已完成原生输入的文本框。返回值：无。 */
  function change(element: HTMLTextAreaElement) {
    setDraft(element.value);
    observe(element);
  }

  /** 聚焦时依据真实光标重新判断引用。[in] element：获得焦点的输入框。返回值：无。 */
  function focus(element: HTMLTextAreaElement) {
    setFocused(true);
    observe(element);
  }

  /** 失焦后关闭文件候选。参数：无。返回值：无。 */
  function blur() {
    setFocused(false);
  }

  /** 切换输入法组合状态，组合期间不搜索也不抢确认键。[in] value：是否正在组合；[in] element：组合事件对应的输入框。返回值：无。 */
  function composition(value: boolean, element: HTMLTextAreaElement) {
    setComposing(value);
    observe(element);
  }

  /** 仅替换当前引用 token 并恢复插入点，不发送草稿。[in] path：后端返回的真实相对文件路径。返回值：无。 */
  function choose(path: string) {
    if (!active || !token) return;
    // 原生不解析反斜杠转义；引用同时保护空白及原生会裁剪的首尾标点。
    const quote = path.includes('"') ? "'" : '"';
    const needsQuote = /[\s"'@]/.test(path) || /^[`"'([{<]/.test(path) || /[)\]}>.,;:!?"'`]$/.test(path);
    const reference = needsQuote ? `@${quote}${path}${quote}` : `@${path}`;
    const suffix = draft.slice(token.end);
    const replacement = reference + (suffix ? "" : " ");
    const next = draft.slice(0, token.start) + replacement + suffix;
    const caret = token.start + replacement.length;
    // 已由后端候选确认的真实路径，在光标移回引用内时仍保持链接颜色。
    setConfirmed({ scope, cwd, paths: confirmedPaths.includes(path) ? confirmedPaths : [...confirmedPaths, path] });
    setDismissed(JSON.stringify([scope, cwd, next, caret, caret]));
    setSelection({ text: next, start: caret, end: caret });
    restoreCaret.current = caret;
    setDraft(next);
  }

  /** 更新鼠标悬停或键盘选中的候选。[in] next：候选索引。返回值：无。 */
  function select(next: number) {
    setChoice({ key, index: next });
  }

  /** 优先处理文件补全快捷键，保留带修饰键的原生 composer 行为。[in] event：文本框键盘事件。返回值：是否已消费事件。 */
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!active || composing || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(key);
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
    if (paths.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      select(Math.max(0, Math.min(paths.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
      return true;
    }
    if ((paths.length || loading) && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      if (paths.length) choose(paths[index]);
      return true;
    }
    return false;
  }

  return { active, editingToken, confirmedPaths, paths, index, loading, error, composing, observe, change, focus, blur, composition, choose, select, keyDown };
}
