import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { durationText } from "../duration-text";
import {
  cardStatus,
  toolDetails,
  toolDurationMs,
  toolResultText,
} from "../tool-card-model";
import { useNow } from "../use-now";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";

/** 只接受原生结构化 MCP 元数据，不把虚拟地址转为文件证据。 */
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 展示 MCP 调用身份、参数输入和结果输出；缺少可信元数据时使用通用框。 */
export function McpCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const xdev = record(toolDetails(tool).xdev);
  const inner = record(xdev?.inner);
  const args = record(xdev?.args);
  if (
    !inner ||
    typeof inner.serverName !== "string" ||
    !inner.serverName ||
    typeof inner.mcpToolName !== "string" ||
    !inner.mcpToolName ||
    !args
  ) {
    return <GenericCard tool={tool} context={context} />;
  }
  const expanded = context.expanded[tool.id] !== undefined;
  const result = toolResultText(tool);
  const toggle = () => context.toggle(tool.id, 0);
  const oneLine = JSON.stringify(args);
  const resultLines = result.split("\n");
  const collapsible = resultLines.length > 2;
  const duration = toolDurationMs(tool, now);
  return (
    <CardFrame
      toolId={tool.id}
      kind="mcp"
      status={status}
      title={
        <>
          <strong>调用 MCP</strong>{" "}
          <code>
            {inner.serverName}/{inner.mcpToolName}
          </code>
        </>
      }
      aside={duration !== undefined ? `(${durationText(duration)})` : undefined}
      expand={{ expanded, onToggle: toggle }}
      output={
        result ? (
          expanded ? (
            <pre className="tool-card-output" aria-label="MCP 结果">
              {result}
            </pre>
          ) : (
            <>
              <pre className="tool-card-output" aria-label="MCP 结果">
                {resultLines.slice(0, 2).join("\n")}
              </pre>
              {(collapsible || result.length > 0) && (
                <div className="tool-card-muted">
                  … 共 {result.length} 字符 ·{" "}
                  <button
                    type="button"
                    className="tool-card-expand"
                    aria-expanded={expanded}
                    onClick={toggle}
                  >
                    展开
                  </button>
                </div>
              )}
            </>
          )
        ) : undefined
      }
    >
      {expanded ? (
        <pre className="tool-card-json" aria-label="MCP 参数">
          {JSON.stringify(args, null, 2)}
        </pre>
      ) : (
        <div className="tool-card-mcp-summary tool-card-muted">
          参数{" "}
          <code>
            {oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine}
          </code>
        </div>
      )}
    </CardFrame>
  );
}
