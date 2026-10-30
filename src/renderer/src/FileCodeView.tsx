import { useMemo, useRef, useState, type CSSProperties } from "react";
import { LocalSourceMarkers } from "./LocalCommentMarkers";
import { sourceContextRange } from "./project-context-selection";
import {
  applyTokens,
  fileLanguage,
  highlightDiff,
  tokenRanges,
  type TokenRange,
} from "./file-code-highlight";
import {
  diffRows,
  rowMetrics,
  sourceDigits,
  sourceRows,
  type CodeRow,
  type FileFormat,
} from "./file-code-model";

const DECORATION_BATCH_ROWS = 2000;

interface FileCodeProps {
  content: string;
  path: string;
  wrap: boolean;
  format?: FileFormat;
  className?: string;
  startLine?: number;
  lineNumbers?: ReadonlyArray<number | null>;
  onContext?: (value: { text: string; copyText: string; startLine?: number; endLine?: number; x: number; y: number; trigger: HTMLElement }) => void;
}
interface PreparedRows {
  rows: CodeRow[];
  tail: string;
  gutterWidth: string;
  additions: number;
  deletions: number;
}

/** 准备源码前缀或真实差异并计算全文位宽。[in] props：来源格式及真实文件行号；[in] options：已选语言、装饰预算与完整源码 token。返回值：装饰行、完整尾文及真实差异计数。 */
function prepareRows(
  props: FileCodeProps,
  options: { language: string; rowLimit: number; tokens: TokenRange[] },
): PreparedRows {
  const format = props.format ?? "source";
  if (format !== "source") {
    const rows = highlightDiff(
      diffRows(props.content, format),
      options.language,
    );
    return { rows, tail: "", ...rowMetrics(rows, { format }) };
  }
  const prefix = sourceRows(props.content, {
    maxRows: options.rowLimit,
    startLine: props.startLine,
    lineNumbers: props.lineNumbers,
  });
  const rows = applyTokens(prefix.rows, props.content, options.tokens);
  return {
    rows,
    tail: props.content.slice(prefix.end),
    ...rowMetrics(rows, {
      format,
      sourceDigits: sourceDigits(props.content, props),
    }),
  };
}

/** 缓存跨行语法区间并保留渐进装饰状态。[in] props：完整正文和真实行号来源。返回值：阅读行结构、显式语言及继续装饰回调。 */
function useCodeView(props: FileCodeProps) {
  const { content, path, format = "source", startLine, lineNumbers } = props;
  const language = fileLanguage(path);
  const [decoration, setDecoration] = useState<{
    content: string;
    path: string;
    count: number;
  }>();
  const rowLimit =
    decoration?.content === content && decoration.path === path
      ? decoration.count
      : DECORATION_BATCH_ROWS;
  // 渐进续显只改变行装饰数量，完整有界源码只高亮一次。
  const tokens = useMemo(
    () =>
      format === "source" && language && content
        ? tokenRanges(content, language)
        : [],
    [content, format, language],
  );
  const view = useMemo(
    () => prepareRows(props, { language, rowLimit, tokens }),
    [content, format, language, rowLimit, tokens, startLine, lineNumbers],
  );
  /** 逐批添加行号与语法装饰，沿用完整正文的真实映射。参数：无。返回值：无。 */
  function decorateMore() {
    setDecoration({ content, path, count: rowLimit + DECORATION_BATCH_ROWS });
  }
  return { view, language, decorateMore };
}

/** 呈现完整正文仍可阅读的渐进装饰提示。[in] onMore：增加一批行装饰的回调。返回值：进度说明与继续按钮。 */
function ProgressiveDecoration({ onMore }: { onMore: () => void }) {
  return (
    <div className="file-code-progressive">
      <p>后续正文已完整显示，尚未添加行号与语法高亮。</p>
      <button type="button" aria-label="继续显示行号" onClick={onMore}>
        继续显示行号（再 2000 行）
      </button>
    </div>
  );
}

/** 呈现当前可见真实差异统计。[in] view：已解析行和增删计数。返回值：真实增删统计节点。 */
function DiffCounts({ view }: { view: PreparedRows }) {
  return (
    <p
      className="file-review-counts"
      aria-label="显示差异统计"
      data-additions={view.additions}
      data-deletions={view.deletions}
    >
      显示差异：<span className="file-count-addition">+{view.additions}</span>{" "}
      <span className="file-count-deletion">−{view.deletions}</span>
    </p>
  );
}

/** 呈现纯文本代码行并将真实行号放入独立 gutter。[in] row：原始行和可信 token 装饰。返回值：不执行源码的行节点。 */
function CodeLine({ row, offset }: { row: CodeRow; offset: number }) {
  return (
    <span
      className={`file-code-row${row.kind === "addition" ? " diff-addition" : row.kind === "deletion" ? " diff-removal" : ""}`}
      data-kind={row.kind}
      data-source-offset={offset}
    >
      <span
        className="file-code-gutter"
        aria-hidden="true"
        data-line={row.line}
        data-old-line={row.oldLine}
        data-new-line={row.newLine}
      />
      <span className="file-code-text">
        {row.tokens ?? row.text + row.ending}
      </span>
    </span>
  );
}

/** 以白底和真实文件行号阅读源码或差异，不执行源码。[in] props：有界正文、语言路径、换行布局、格式及样式；startLine 为源码真实起始行（默认 1），lineNumbers 为优先使用的逐行原生映射（null 行不编号）。返回值：安全代码阅读区及真实可见差异计数。 */
export function FileCodeView(props: FileCodeProps) {
  const { wrap, format = "source", className = "" } = props;
  const { view, language, decorateMore } = useCodeView(props);
  const root = useRef<HTMLPreElement>(null);
  const offsets = useMemo(() => {
    let offset = 0;
    return view.rows.map((row) => { const start = offset; offset += row.text.length + row.ending.length; return start; });
  }, [view.rows]);

  /** DOM 只确定原文偏移；正文和整行引用始终从 content 快照切片。 */
  function contextAt(pre: HTMLPreElement, target: EventTarget | null, x: number, y: number, keyboard = false) {
    if (!props.onContext || format !== "source") return;
    const selection = window.getSelection();
    const offsetAt = (node: Node, offset: number) => {
      // pre 的元素边界直接映射相邻模型行；不对已装饰的整个正文建立 Range。
      if (node === pre) {
        for (let index = offset; index < pre.childNodes.length; index++) {
          const child = pre.childNodes[index];
          if (child instanceof HTMLElement && child.dataset.sourceOffset !== undefined)
            return Number(child.dataset.sourceOffset);
        }
        return props.content.length;
      }
      const element = node instanceof Element ? node : node.parentElement;
      const owner = element?.closest<HTMLElement>("[data-source-offset]");
      if (!owner || !pre.contains(owner)) throw new Error("无有效源码选区");
      const base = Number(owner.dataset.sourceOffset);
      const text = owner.matches(".file-code-tail")
        ? owner
        : owner.querySelector<HTMLElement>(".file-code-text");
      if (!text) return base;
      if (node === owner && owner !== text) {
        const textIndex = [...owner.childNodes].indexOf(text);
        const rowIndex = offsets.indexOf(base);
        return offset <= textIndex ? base
          : base + view.rows[rowIndex].text.length + view.rows[rowIndex].ending.length;
      }
      if (node !== text && !text.contains(node)) return base;
      // token 仅影响局部树结构；尾部保留单个原文文本节点，可直接使用 UTF-16 offset。
      if (node.nodeType === Node.TEXT_NODE && node.parentNode === text && node === text.firstChild)
        return base + offset;
      const range = document.createRange();
      range.selectNodeContents(text);
      range.setEnd(node, offset);
      return base + range.toString().length;
    };
    let start: number;
    let end: number;
    if (selection && !selection.isCollapsed && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (!pre.contains(range.startContainer) || !pre.contains(range.endContainer)) return;
      start = offsetAt(range.startContainer, range.startOffset);
      end = offsetAt(range.endContainer, range.endOffset);
      if (keyboard) {
        const rects = range.getClientRects();
        const rect = rects[rects.length - 1];
        if (rect) { x = rect.right; y = rect.bottom; }
      }
    } else {
      const element = target instanceof Element ? target : null;
      const row = element?.closest<HTMLElement>(".file-code-row[data-source-offset]");
      if (row && pre.contains(row)) {
        start = Number(row.dataset.sourceOffset);
        const index = offsets.indexOf(start);
        end = start + view.rows[index].text.length + view.rows[index].ending.length;
      } else if (element?.closest(".file-code-tail") && !keyboard) {
        const caretDocument = document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
          caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        };
        const caret = caretDocument.caretPositionFromPoint?.(x, y);
        const range = caretDocument.caretRangeFromPoint?.(x, y);
        const node = caret?.offsetNode ?? range?.startContainer;
        if (!node || !pre.contains(node)) return;
        start = end = offsetAt(node, caret?.offset ?? range!.startOffset);
      } else {
        if (!keyboard) return;
        const rect = pre.getBoundingClientRect();
        props.onContext({ text: "", copyText: "", x: rect.left, y: rect.top, trigger: pre });
        return;
      }
    }
    if (!props.content.length) return;
    const value = sourceContextRange(props.content, start, end);
    props.onContext({ ...value, copyText: selection && !selection.isCollapsed ? value.copyText : value.text, x, y, trigger: pre });
  }
  const hasDiff =
    format !== "source" && view.rows.some((row) => row.kind !== "metadata");
  return (
    <>
      {view.tail && <ProgressiveDecoration onMore={decorateMore} />}
      {hasDiff && <DiffCounts view={view} />}
      <pre
        ref={root}
        className={`file-review-source file-code-view ${format === "source" ? "" : "file-review-diff"} ${className}`}
        data-wrap={wrap}
        data-format={format}
        data-language={language || "plaintext"}
        tabIndex={props.onContext ? 0 : undefined}
        onContextMenu={props.onContext ? (event) => {
          event.preventDefault();
          contextAt(event.currentTarget, event.target, event.clientX, event.clientY);
        } : undefined}
        onKeyDown={props.onContext ? (event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          event.stopPropagation();
          contextAt(event.currentTarget, document.activeElement, 0, 0, true);
        } : undefined}
        style={
          { "--file-code-gutter-width": view.gutterWidth } as CSSProperties
        }
      >
        {view.rows.map((row, index) => (
          <CodeLine row={row} offset={offsets[index]} key={index} />
        ))}
        {view.tail && <span className="file-code-tail" data-source-offset={props.content.length - view.tail.length}>{view.tail}</span>}
      </pre>
      {format === "source" && <LocalSourceMarkers root={root} path={props.path} view="source" identity={props.content} />}
    </>
  );
}
