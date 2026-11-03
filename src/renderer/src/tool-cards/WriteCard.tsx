import { describeToolCall } from "../../../shared/tool-presentation";
import { getFileReviewEvidence } from "../../../shared/file-review";
import { messageFileHref } from "../../../shared/message-file-link";
import { FileReferenceLink } from "../FileReferenceLink";
import { FileReviewSource } from "../FileReviewContent";
import { RichContent } from "../RichContent";
import { countLines, headLines } from "../inline-detail-limits";
import type { ProcessContext } from "../TranscriptToolRow";
import type { ToolEvidence } from "../transcript-types";
import { cardStatus, toolDetails, toolDurationMs } from "../tool-card-model";
import { useNow } from "../use-now";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";

/** 完整本地笔记参数仅用于正文展示，不进入文件证据授权。 */
function noteArgs(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 写入卡展示本次实际写入正文，空文件也保持框和零行统计。 */
export function WriteCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const expanded = context.expanded[tool.id] !== undefined;
  const pending = status === "running" && tool.streamingArgs !== undefined;
  const args = noteArgs(tool.args);
  const local =
    typeof args.path === "string" && args.path.startsWith("local://");
  const description = describeToolCall(tool.name, tool.args);
  const target = description.targets.find((item) => item.kind === "file");
  const path = local ? (args.path as string) : target?.path;
  const details = toolDetails(tool);
  if (details.xdev !== undefined || details.proc !== undefined)
    return <GenericCard tool={tool} context={context} />;
  const evidence =
    !pending && !local && path
      ? getFileReviewEvidence(
          tool.name,
          tool.args,
          tool.resultMessage ?? tool.live?.result,
          path,
        )
      : undefined;
  const content = pending
    ? (tool.streamingArgs?.content ?? "")
    : local && typeof args.content === "string"
      ? args.content
      : evidence?.kind === "write"
        ? evidence.content
        : undefined;
  if (content === undefined || status === "error")
    return <GenericCard tool={tool} context={context} />;
  const total = countLines(content);
  return (
    <CardFrame
      toolId={tool.id}
      kind="write"
      status={status}
      title={
        <>
          <strong>写入</strong>{" "}
          {local ? (
            <code>{path}</code>
          ) : path ? (
            <FileReferenceLink href={messageFileHref(path)}>
              {path}
            </FileReferenceLink>
          ) : (
            <code>{tool.streamingArgs?.path ?? tool.name}</code>
          )}
          {local && <span className="tool-card-chip">会话笔记</span>}
        </>
      }
      meta={`${total} 行`}
      statusText={
        pending ? "◐ 生成中" : status === "running" ? "◐ 应用中" : undefined
      }
      durationMs={toolDurationMs(tool, now)}
      expand={{ expanded, onToggle: () => context.toggle(tool.id, 0) }}
      footer={
        <>
          {local && <>Markdown 渲染{!expanded ? " · 前 12 行" : ""}</>}
          {total > 12 && !expanded && (
            <button onClick={() => context.toggle(tool.id, 0)}>
              展开全部（共 {total} 行）
            </button>
          )}
        </>
      }
    >
      {pending ? (
        <pre className="tool-card-output">
          {expanded ? content : headLines(content, 12)}
          <span className="tool-card-cursor">▍</span>
        </pre>
      ) : local ? (
        <RichContent text={expanded ? content : headLines(content, 12)} />
      ) : (
        <FileReviewSource
          content={content}
          path={path}
          maxLines={expanded ? undefined : 12}
        />
      )}
      {!pending && !content && <p className="tool-card-muted">空文件</p>}
    </CardFrame>
  );
}
