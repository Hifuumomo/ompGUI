import { useContext, useId, useMemo, useState } from "react";
import {
  getFileReviewEvidence,
  type FileReviewEvidence,
} from "../../shared/file-review";
import { messageFileHref } from "../../shared/message-file-link";
import {
  FileReviewDiff,
  FileReviewReplacement,
  FileReviewSource,
} from "./FileReviewContent";
import { MessageFileLinks } from "./MessageFileLinks";
import { readDisplayContent } from "./NativeReadContent";
import { ToolOutput } from "./TranscriptContent";
import {
  INLINE_EXPAND_LIMIT,
  PREVIEW_LINES,
  countLines,
} from "./inline-detail-limits";
import type { ToolInspection } from "./transcript-types";
import { describeToolCall } from "../../shared/tool-presentation";

interface FileContentProps {
  inspection: ToolInspection;
  evidence: FileReviewEvidence;
  path: string;
  wrap: boolean;
  maxLines?: number;
}

/** 写入和编辑直接呈现该次操作绑定的内容，不展示补丁指令或调用参数。 */
function ChangedFileContent({
  inspection,
  evidence,
  path,
  wrap,
  maxLines,
}: FileContentProps) {
  if (evidence.kind === "write")
    return (
      <>
        {evidence.content === "" && <p className="muted">文件内容为空</p>}
        <FileReviewSource
          content={evidence.content}
          path={path}
          wrap={wrap}
          maxLines={maxLines}
        />
      </>
    );
  if (evidence.kind === "diff")
    return (
      <FileReviewDiff
        content={evidence.content}
        path={path}
        wrap={wrap}
        maxLines={maxLines}
      />
    );
  return (
    <div className="file-review-replacements">
      {evidence.changes.map((change, index) => (
        <FileReviewReplacement
          key={`${inspection.toolCallId}:${path}:${index}`}
          change={change}
          index={index}
          path={path}
          wrap={wrap}
        />
      ))}
    </div>
  );
}

function FileToolbar({
  path,
  wrap,
  onToggle,
}: {
  path: string;
  wrap: boolean;
  onToggle: () => void;
}) {
  return (
    <header className="inline-file-header">
      <span className="inline-tool-label" title={path}>
        {path.split(/[\\/]/).pop()}
      </span>
      <button
        type="button"
        className="file-review-wrap"
        aria-label="自动换行"
        aria-pressed={wrap}
        onClick={onToggle}
        title="自动换行"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 3h12M2 7h9a3 3 0 0 1 0 6H8m2-2-2 2 2 2M2 11h3" />
        </svg>
      </button>
    </header>
  );
}

/** 失败操作呈现实际错误结果，不能用尝试写入的参数代替文件内容。 */
function useFileEvidence(inspection: ToolInspection, path: string) {
  return useMemo(
    () =>
      inspection.status === "错误"
        ? undefined
        : getFileReviewEvidence(
            inspection.toolName,
            inspection.args,
            inspection.result,
            path,
          ),
    [
      inspection.status,
      inspection.toolName,
      inspection.args,
      inspection.result,
      path,
    ],
  );
}

/** 读取结果中的可预览正文：优先原生展示正文，其次字符串或文本块。 */
function resultText(result: unknown): string | undefined {
  const display = readDisplayContent(result);
  if (display) return display.text;
  if (typeof result === "string") return result;
  const content = (result as { content?: unknown } | null)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .filter((part) => part?.type === "text")
      .map((part) => part.text ?? "")
      .join("");
  return undefined;
}

/** 参与行数预览的正文；替换视图由多段前后快照组成，暂不截断。 */
function previewText(
  evidence: FileReviewEvidence | undefined,
  result: unknown,
): string | undefined {
  if (!evidence) return resultText(result);
  return evidence.kind === "replacements" ? undefined : evidence.content;
}

/** 去掉读取路径末尾的 :起-止 行段，得到可在侧栏打开的文件路径。 */
function sidebarPath(path: string): string {
  return path.replace(/(?<=.):\d+(?:-\d+)?$/, "");
}

function FileBody({
  inspection,
  path,
  wrap,
  expanded,
  onExpand,
}: {
  inspection: ToolInspection;
  path: string;
  wrap: boolean;
  expanded: boolean;
  onExpand: () => void;
}) {
  const evidence = useFileEvidence(inspection, path);
  const contentId = useId();
  const openFile = useContext(MessageFileLinks);
  const [openError, setOpenError] = useState("");
  const text = previewText(evidence, inspection.result);
  const total = text === undefined ? 0 : countLines(text);
  const long = total > PREVIEW_LINES;
  // 超过原地展开上限时只给侧栏入口；没有侧栏入口则退回原地展开。
  const inlineAllowed = total <= INLINE_EXPAND_LIMIT || !openFile;
  const preview = long && !expanded;
  const maxLines = preview ? PREVIEW_LINES : undefined;
  /** 在侧栏打开完整文件，失败时在脚注栏提示。 */
  async function openInSidebar() {
    setOpenError("");
    try {
      await openFile!(messageFileHref(sidebarPath(path)));
    } catch (failure) {
      setOpenError(
        `打开失败：${failure instanceof Error ? failure.message : String(failure)}`,
      );
    }
  }
  return (
    <>
      <div
        id={contentId}
        className="inline-file-content"
        data-preview={preview}
      >
        {inspection.status === "错误" && (
          <p className="inline-error" role="alert">
            文件操作失败
          </p>
        )}
        {evidence ? (
          <ChangedFileContent
            inspection={inspection}
            evidence={evidence}
            path={path}
            wrap={wrap}
            maxLines={maxLines}
          />
        ) : inspection.result === undefined ? (
          <p className="muted" role="status">
            {inspection.status === "执行中" ? "正在读取文件…" : "未记录文件内容"}
          </p>
        ) : (
          <ToolOutput
            result={inspection.result}
            executable
            path={path}
            wrap={wrap}
            maxLines={maxLines}
            fileRead={
              describeToolCall(inspection.toolName, inspection.args).verb ===
              "读取"
            }
          />
        )}
      </div>
      {long && (
        <footer className="inline-detail-footer">
          <span>共 {total} 行</span>
          {inlineAllowed && !expanded && (
            <button
              type="button"
              aria-controls={contentId}
              aria-expanded={false}
              onClick={onExpand}
            >
              展开全部 {total} 行
            </button>
          )}
          {openFile && (
            <button type="button" onClick={() => void openInSidebar()}>
              在侧栏打开
            </button>
          )}
          {openError && <span role="alert">{openError}</span>}
        </footer>
      )}
    </>
  );
}

/** 文件名和工具行共用只读内容卡片；读取结果按原文保留，不以当前磁盘替代历史内容。 */
export function InlineFileDetails({
  inspection,
}: {
  inspection: ToolInspection;
}) {
  const path =
    inspection.target.kind === "file"
      ? inspection.target.path
      : inspection.target.label;
  const [wrap, setWrap] = useState(true);
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      className="inline-tool-details inline-file-details tool-inspector"
      aria-label="文件内容审阅"
      data-expanded={expanded}
    >
      <FileToolbar
        path={path}
        wrap={wrap}
        onToggle={() => setWrap((value) => !value)}
      />
      <FileBody
        inspection={inspection}
        path={path}
        wrap={wrap}
        expanded={expanded}
        onExpand={() => setExpanded(true)}
      />
    </section>
  );
}
