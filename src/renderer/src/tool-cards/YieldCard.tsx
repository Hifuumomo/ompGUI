import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { cardStatus, toolDetails, toolDurationMs } from "../tool-card-model";
import { useNow } from "../use-now";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";

/** 提交结果默认仅展示数据键名，展开时保留完整原生 JSON。 */
export function YieldCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const data = toolDetails(tool).data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return <GenericCard tool={tool} context={context} />;
  }
  const expanded = context.expanded[tool.id] !== undefined;
  return (
    <CardFrame
      toolId={tool.id}
      kind="yield"
      status={status}
      title={<strong>提交结果</strong>}
      durationMs={toolDurationMs(tool, now)}
      expand={{ expanded, onToggle: () => context.toggle(tool.id, 0) }}
      footer={
        <button
          type="button"
          className="tool-card-expand"
          aria-expanded={expanded}
          onClick={() => context.toggle(tool.id, 0)}
        >
          {expanded ? "收起 JSON" : "展开查看 JSON"}
        </button>
      }
    >
      <div className="tool-card-yield-keys tool-card-muted">
        data 字段：
        <br />
        <code>{Object.keys(data).join(" · ")}</code>
      </div>
      {expanded && (
        <pre className="tool-card-json" aria-label="提交数据">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </CardFrame>
  );
}
