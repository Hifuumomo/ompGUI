import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { RichContent } from "../RichContent";
import { cardStatus, toolDetails, toolDurationMs } from "../tool-card-model";
import { useNow } from "../use-now";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";

/** 从完整参数读取代理名称；仅用于标签，不建立文件授权。 */
function agentName(args: unknown): string | undefined {
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return undefined;
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args))
    return undefined;
  const path = (args as Record<string, unknown>).path;
  return typeof path === "string"
    ? /^agent:\/\/(.+)$/i.exec(path)?.[1]
    : undefined;
}

/** 子代理结果按原生总行数标记，以 Markdown 呈现前十二行并复用展开状态。 */
export function AgentOutputCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const details = toolDetails(tool);
  const display = details.displayContent;
  const text =
    display && typeof display === "object" && !Array.isArray(display)
      ? (display as Record<string, unknown>).text
      : undefined;
  const name = agentName(tool.args);
  if (
    !name ||
    typeof text !== "string" ||
    typeof details.totalLines !== "number" ||
    !Number.isFinite(details.totalLines) ||
    details.totalLines < 0
  ) {
    return <GenericCard tool={tool} context={context} />;
  }
  const expanded = context.expanded[tool.id] !== undefined;
  const lines = text.split("\n");
  const truncated = lines.length > 12;
  return (
    <CardFrame
      toolId={tool.id}
      kind="agent-output"
      status={status}
      title={
        <>
          <strong>子代理输出</strong> <code>{name}</code>
        </>
      }
      meta={`${details.totalLines} 行`}
      durationMs={toolDurationMs(tool, now)}
      expand={{ expanded, onToggle: () => context.toggle(tool.id, 0) }}
      footer={
        <>
          Markdown 渲染 ·{" "}
          {expanded ? `共 ${details.totalLines} 行` : "前 12 行"}
          {truncated && (
            <>
              {" "}
              ·{" "}
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => context.toggle(tool.id, 0)}
              >
                {expanded ? "收起" : "展开全部"}
              </button>
            </>
          )}
        </>
      }
    >
      <RichContent text={expanded ? text : lines.slice(0, 12).join("\n")} />
    </CardFrame>
  );
}
