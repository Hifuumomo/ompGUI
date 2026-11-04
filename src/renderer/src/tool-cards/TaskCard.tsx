import { useContext } from "react";
import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { cardStatus, toolDetails, toolDurationMs } from "../tool-card-model";
import { durationText } from "../duration-text";
import { useNow } from "../use-now";
import { TranscriptActions } from "./actions";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";

type TaskProgress = {
  id: string;
  agent: string;
  status: string;
  task?: string;
};

const statusLabels: Record<string, string> = {
  completed: "已完成",
  running: "运行中",
  pending: "等待中",
  failed: "失败",
  error: "失败",
  cancelled: "已取消",
};

/** 仅接收有身份与状态的原生子任务，未知结果结构交回通用框展示。 */
function isTaskProgress(value: unknown): value is TaskProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.agent === "string" &&
    row.agent.length > 0 &&
    typeof row.status === "string" &&
    row.status.length > 0 &&
    (row.task === undefined || typeof row.task === "string")
  );
}

/** 展示全部原生子任务；可选操作仅打开已有子代理面板，不添加导航协议。 */
export function TaskCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const { onOpenSubagent } = useContext(TranscriptActions);
  const details = toolDetails(tool);
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const rows =
    details.progress !== undefined ? details.progress : details.results;
  const total = details.totalDurationMs;
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    !rows.every(isTaskProgress) ||
    (total !== undefined &&
      (typeof total !== "number" || !Number.isFinite(total) || total < 0))
  ) {
    return <GenericCard tool={tool} context={context} />;
  }
  return (
    <CardFrame
      toolId={tool.id}
      kind="task"
      status={status}
      title={
        <>
          <strong>子代理</strong>{" "}
          <span className="tool-card-muted">· {rows.length} 个</span>
        </>
      }
      durationMs={total ?? toolDurationMs(tool, now)}
      footer={onOpenSubagent ? "点击打开子代理面板" : undefined}
    >
      <div className="tool-card-list">
        {rows.map((row, index) => {
          const content = (
            <>
              <span
                className="tool-card-job-dot"
                aria-hidden="true"
                data-status={
                  row.status === "completed"
                    ? "ok"
                    : row.status === "failed"
                      ? "error"
                      : row.status
                }
              />
              <code>{row.id}</code>
              <span className="tool-card-muted">
                {row.agent} ·{" "}
                {Object.prototype.hasOwnProperty.call(statusLabels, row.status)
                  ? statusLabels[row.status]
                  : row.status}
              </span>
            </>
          );
          return onOpenSubagent ? (
            <button
              type="button"
              className="tool-card-row tool-card-job-button"
              key={`${row.id}:${index}`}
              title={row.task}
              onClick={onOpenSubagent}
            >
              {content}
            </button>
          ) : (
            <div
              className="tool-card-row"
              key={`${row.id}:${index}`}
              title={row.task}
            >
              {content}
            </div>
          );
        })}
      </div>
    </CardFrame>
  );
}
