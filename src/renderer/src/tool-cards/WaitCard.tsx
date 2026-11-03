import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { cardStatus, toolDetails, toolDurationMs } from "../tool-card-model";
import { durationText } from "../duration-text";
import { useNow } from "../use-now";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";

type WaitJob = {
  id: string;
  status: string;
  label?: string;
  durationMs?: number;
};

const statusLabels: Record<string, string> = {
  completed: "已完成",
  running: "运行中",
  pending: "等待中",
  failed: "失败",
  error: "失败",
  cancelled: "已取消",
};

/** 校验原生后台任务条目，保留缺失的可选标签和耗时。 */
function isWaitJob(value: unknown): value is WaitJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.id === "string" &&
    job.id.length > 0 &&
    typeof job.status === "string" &&
    job.status.length > 0 &&
    (job.label === undefined || typeof job.label === "string") &&
    (job.durationMs === undefined ||
      (typeof job.durationMs === "number" &&
        Number.isFinite(job.durationMs) &&
        job.durationMs >= 0))
  );
}

/** 显示原生等待任务的全部状态与耗时，不以后台状态替代本次调用状态。 */
export function WaitCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const details = toolDetails(tool);
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  if (!Array.isArray(details.jobs) || !details.jobs.every(isWaitJob)) {
    return <GenericCard tool={tool} context={context} />;
  }
  return (
    <CardFrame
      toolId={tool.id}
      kind="wait"
      plainHeader
      status={status}
      title={
        <>
          <strong>等待后台任务</strong>{" "}
          <span className="tool-card-muted">{details.jobs.length} 个</span>
        </>
      }
      durationMs={toolDurationMs(tool, now)}
      footer={details.__interrupted === true ? "等待被中断" : undefined}
    >
      <div className="tool-card-list">
        {details.jobs.map((job, index) => (
          <div className="tool-card-row" key={`${job.id}:${index}`}>
            <code>{job.id}</code>
            {job.label && (
              <span className="tool-card-job-title">{job.label}</span>
            )}
            <span
              className="tool-card-job-status"
              data-status={
                job.status === "completed"
                  ? "ok"
                  : job.status === "failed"
                    ? "error"
                    : job.status
              }
            >
              {Object.prototype.hasOwnProperty.call(statusLabels, job.status)
                ? statusLabels[job.status]
                : job.status}
              {job.durationMs !== undefined && (
                <> · {durationText(job.durationMs)}</>
              )}
            </span>
          </div>
        ))}
      </div>
    </CardFrame>
  );
}
