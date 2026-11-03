import { describeToolCall } from "../../../shared/tool-presentation";
import type { ToolEvidence } from "../transcript-types";
import { ToolRowBody, type ProcessContext } from "../TranscriptToolRow";
import { cardKind, cardStatus, toolDurationMs } from "../tool-card-model";
import { useNow } from "../use-now";
import { CardFrame, withoutResultImages } from "./CardFrame";

/** 通用工具框复用既有目标详情；参数：[in] tool 工具证据，[in] context 展开状态。返回值：通用框。 */
export function GenericCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const description = describeToolCall(tool.name, tool.args);
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const expanded = context.expanded[tool.id] !== undefined;
  const textTool: ToolEvidence = {
    ...tool,
    resultMessage: withoutResultImages(tool.resultMessage),
    live: tool.live
      ? { ...tool.live, result: withoutResultImages(tool.live.result) }
      : undefined,
  };
  return (
    <CardFrame
      toolId={tool.id}
      kind={cardKind(tool)}
      status={status}
      result={tool.resultMessage ?? tool.live?.result}
      title={
        <>
          <strong>{description.verb}</strong>{" "}
          <code>{description.targets[0]?.label ?? tool.name}</code>
        </>
      }
      statusText={
        status === "running" && tool.streamingArgs ? "◐ 生成中" : undefined
      }
      durationMs={toolDurationMs(tool, now)}
      expand={{ expanded, onToggle: () => context.toggle(tool.id, 0) }}
    >
      {expanded ? (
        <ToolRowBody
          tool={textTool}
          target={description.targets[0]}
          context={context}
        />
      ) : null}
    </CardFrame>
  );
}
