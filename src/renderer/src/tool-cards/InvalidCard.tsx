import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { cardStatus, toolDetails, toolDurationMs } from "../tool-card-model";
import { useNow } from "../use-now";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";

/** 保留参数校验错误的原始空白和文本，默认显示两行并支持全文展开。 */
export function InvalidCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const error = toolDetails(tool).error;
  if (typeof error !== "string" || !error)
    return <GenericCard tool={tool} context={context} />;
  const expanded = context.expanded[tool.id] !== undefined;
  const lines = error.split("\n");
  const truncated = lines.length > 2;
  return (
    <CardFrame
      toolId={tool.id}
      kind="invalid"
      status={status}
      tone="danger"
      title={<strong>✗ 参数无效 · {tool.name}</strong>}
      statusText=""
      durationMs={toolDurationMs(tool, now)}
      expand={
        truncated
          ? { expanded, onToggle: () => context.toggle(tool.id, 0) }
          : undefined
      }
      footer={
        truncated ? (
          <button
            type="button"
            className="tool-card-expand"
            aria-expanded={expanded}
            onClick={() => context.toggle(tool.id, 0)}
          >
            {expanded ? "收起" : "展开全部"}
          </button>
        ) : undefined
      }
    >
      <pre className="tool-card-invalid-error">
        {expanded ? error : lines.slice(0, 2).join("\n")}
      </pre>
    </CardFrame>
  );
}
