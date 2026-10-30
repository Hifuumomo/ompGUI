import { useState, type SyntheticEvent } from "react";
import { FileCodeView } from "./FileCodeView";
import { headLines } from "./inline-detail-limits";

const MAX_REVIEW_CODE_UNITS = 256 * 1024;
const MAX_DIFF_ROWS = 2000;

interface SourceProps {
  content: string;
  path?: string;
  wrap?: boolean;
  className?: string;
  startLine?: number;
  lineNumbers?: ReadonlyArray<number | null>;
  /** 仅渲染前若干行；截断只发生在渲染层，原始 content 不变。 */
  maxLines?: number;
}

interface DiffProps {
  content: string;
  path: string;
  wrap: boolean;
  maxLines?: number;
}

interface ReplacementProps {
  change: { before: string; after: string; nativeDiff?: string };
  index: number;
  path: string;
  wrap: boolean;
}

/** 限制审阅显示的文本前缀，不修改原始证据。[in] content：完整正文；[in] diff：是否额外限制差异行数。返回值：预览正文和明确截断标识。 */
function fileReviewPreview(content: string, diff = false) {
  let end = Math.min(content.length, MAX_REVIEW_CODE_UNITS);
  // UTF-16 前缀边界不能留下半个代理对。
  if (
    end < content.length &&
    end > 0 &&
    /[\uD800-\uDBFF]/.test(content[end - 1])
  )
    end -= 1;
  let preview = content.slice(0, end);
  let truncated = end < content.length;
  if (diff) {
    // 按协议 LF 边界保留原始行前缀，尾 LF 本身不算额外空行。
    let rowEnd = 0;
    for (let line = 0; line < MAX_DIFF_ROWS; line += 1) {
      const newline = preview.indexOf("\n", rowEnd);
      if (newline < 0) {
        rowEnd = preview.length;
        break;
      }
      rowEnd = newline + 1;
    }
    if (rowEnd < preview.length) {
      preview = preview.slice(0, rowEnd);
      truncated = true;
    }
  }
  return { content: preview, truncated };
}

/** 显示有界安全源码并保留文件行号阅读。[in] content：原始正文；[in] path：可选文件路径；[in] wrap：自动换行状态；[in] className：附加源码样式。返回值：源码预览及截断提示。 */
export function FileReviewSource({
  content,
  path,
  wrap = true,
  className = "",
  startLine,
  lineNumbers,
  maxLines,
}: SourceProps) {
  const preview = fileReviewPreview(content);
  const shown =
    maxLines === undefined
      ? preview.content
      : headLines(preview.content, maxLines);
  return (
    <>
      {preview.truncated && (
        <p className="muted" role="status">
          已截断预览（正文显示上限 256 Ki UTF-16 码元）
        </p>
      )}
      {path !== undefined ? (
        <FileCodeView
          content={shown}
          path={path}
          wrap={wrap}
          className={className}
          startLine={startLine}
          lineNumbers={lineNumbers}
        />
      ) : (
        <pre className={`file-review-source ${className}`}>
          {shown}
        </pre>
      )}
    </>
  );
}

/** 呈现有界真实统一差异，标记与行号分离到独立 gutter。[in] content：原始统一差异；[in] path：文件路径；[in] wrap：自动换行状态。返回值：带真实计数的安全代码阅读区。 */
export function FileReviewDiff({ content, path, wrap, maxLines }: DiffProps) {
  const preview = fileReviewPreview(content, true);
  return (
    <>
      {preview.truncated && <DiffTruncation />}
      <FileCodeView
        content={
          maxLines === undefined
            ? preview.content
            : headLines(preview.content, maxLines)
        }
        path={path}
        wrap={wrap}
        format="unified"
      />
    </>
  );
}

/** 显示差异预览的现有截断说明。参数：无。返回值：明确标记预览边界的状态节点。 */
function DiffTruncation() {
  return (
    <p className="muted" role="status">
      已截断预览（差异上限 2000 行 / 256 Ki UTF-16 码元）
    </p>
  );
}

/** 呈现历史前后正文的有界预览，不生成逐行差异。[in] change：同文件前后正文；[in] path：文件路径；[in] wrap：自动换行状态。返回值：带空内容说明的前后快照面板。 */
function ReplacementSnapshots({
  change,
  path,
  wrap,
}: Omit<ReplacementProps, "index">) {
  return (
    <>
      <h3>修改前</h3>
      {change.before === "" && <p className="muted">空内容</p>}
      <FileReviewSource
        content={change.before}
        path={path}
        wrap={wrap}
        className="file-review-before"
      />
      <h3>修改后</h3>
      {change.after === "" && <p className="muted">空内容</p>}
      <FileReviewSource
        content={change.after}
        path={path}
        wrap={wrap}
        className="file-review-after"
      />
    </>
  );
}

/** 呈现原生真实差异及懒挂载前后快照，不合成新增计数。[in] change：同文件前后正文及可选原生差异；[in] index：片段序号；[in] path：文件路径；[in] wrap：自动换行状态。返回值：只读修改审阅节点。 */
export function FileReviewReplacement({
  change,
  index,
  path,
  wrap,
}: ReplacementProps) {
  const [expanded, setExpanded] = useState(false);
  const preview =
    change.nativeDiff === undefined
      ? undefined
      : fileReviewPreview(change.nativeDiff, true);
  /** 仅展开后挂载完整历史快照。[in] event：快照详情开合事件。返回值：无。 */
  function toggleSnapshots(event: SyntheticEvent<HTMLDetailsElement>) {
    setExpanded(event.currentTarget.open);
  }
  return (
    <section aria-label={`修改片段 ${index + 1}`}>
      {preview ? (
        <>
          {preview.truncated && <DiffTruncation />}
          <FileCodeView
            content={preview.content}
            path={path}
            wrap={wrap}
            format="native"
            className="file-review-native-diff"
          />
          <details className="file-review-snapshots" onToggle={toggleSnapshots}>
            <summary>修改前后内容</summary>
            {expanded && (
              <ReplacementSnapshots change={change} path={path} wrap={wrap} />
            )}
          </details>
        </>
      ) : (
        <ReplacementSnapshots change={change} path={path} wrap={wrap} />
      )}
    </section>
  );
}
