import { messageFileHref } from "../../../shared/message-file-link";
import { FileReferenceLink } from "../FileReferenceLink";
import { countLines, splitLines } from "../inline-detail-limits";
import { ToolOutput } from "../TranscriptContent";
import type { ProcessContext } from "../TranscriptToolRow";
import type { ToolEvidence } from "../transcript-types";
import {
  cardStatus,
  toolDetails,
  toolDurationMs,
  toolResultText,
} from "../tool-card-model";
import { useNow } from "../use-now";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";

/** 仅缩短当前工作目录内的显示路径，不改变真实链接或访问授权。 */
function relativeLabel(path: string, cwd?: string): string {
  if (!cwd) return path;
  const normalized = path.replace(/\\/g, "/");
  const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    ? normalized.slice(root.length + 1)
    : path;
}

/** 删除卡展示结果中保存的旧正文；不读取已经删除的文件。 */
export function DeleteCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const details = toolDetails(tool);
  const expanded = context.expanded[tool.id] !== undefined;
  if (
    typeof details.path !== "string" ||
    (details.oldText !== undefined && typeof details.oldText !== "string")
  )
    return <GenericCard tool={tool} context={context} />;
  const oldText =
    typeof details.oldText === "string" ? details.oldText : undefined;
  const total = oldText === undefined ? undefined : countLines(oldText);
  const lines = oldText === undefined ? [] : splitLines(oldText);
  return (
    <CardFrame
      toolId={tool.id}
      kind="delete"
      status={status}
      tone="danger"
      title={
        <>
          <strong>删除</strong>{" "}
          <FileReferenceLink href={messageFileHref(details.path)}>
            {relativeLabel(details.path, context.cwd)}
          </FileReferenceLink>
        </>
      }
      meta={
        total !== undefined ? (
          <span className="tool-card-stat-del">−{total} 行</span>
        ) : undefined
      }
      durationMs={toolDurationMs(tool, now)}
      expand={{ expanded, onToggle: () => context.toggle(tool.id, 0) }}
      footer={
        total !== undefined && total > 6 && !expanded ? (
          <>
            前 6 行 · 共 {total} 行 ·{" "}
            <button onClick={() => context.toggle(tool.id, 0)}>展开全部</button>
          </>
        ) : undefined
      }
    >
      {oldText === undefined ? (
        <ToolOutput
          result={{ content: [{ type: "text", text: toolResultText(tool) }] }}
          executable={false}
        />
      ) : (
        <div className="tool-card-diff">
          {(expanded ? lines : lines.slice(0, 6)).map((text, index) => (
            <div className="tool-card-diff-line" data-kind="del" key={index}>
              <span className="tool-card-line-number">{index + 1}</span>
              <span className="tool-card-line-text">
                −{text.replace(/[\r\n]+$/, "")}
              </span>
            </div>
          ))}
        </div>
      )}
    </CardFrame>
  );
}
