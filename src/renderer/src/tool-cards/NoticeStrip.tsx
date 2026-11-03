import type { AgentMessage } from "../../../shared/protocol";
import { durationText } from "../duration-text";
import { MessageBody } from "../TranscriptContent";
import { noticeLabel } from "../TranscriptNotice";

/** 仅按原生类型识别守护进程退出通知。 */
export function isLaunchCompletion(message: AgentMessage): boolean {
  return (
    message.role === "custom" && message.customType === "launch-completion"
  );
}

/** 只接受结构化对象，不从输出正文猜测任务状态。 */
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 后台完成通知保留全部原生任务；缺失状态或时长时省略对应字段。 */
export function NoticeStrip({ message }: { message: AgentMessage }) {
  const launch = isLaunchCompletion(message);
  const details = record(message.details);
  const entries = launch ? details.daemons : details.jobs;
  const jobs = (Array.isArray(entries) ? entries : []).map((entry) => {
    const job = record(entry);
    const name = launch
      ? job.name
      : [job.jobId, job.label]
          .filter((value) => typeof value === "string" && value)
          .join(" · ");
    const elapsed =
      typeof job.durationMs === "number"
        ? job.durationMs
        : launch &&
            typeof job.startedAt === "number" &&
            typeof job.exitedAt === "number"
          ? job.exitedAt - job.startedAt
          : undefined;
    const status = [
      typeof job.exitCode === "number" ? `exit ${job.exitCode}` : undefined,
      typeof job.status === "string"
        ? job.status === "failed"
          ? "任务失败"
          : job.status === "completed"
            ? "任务完成"
            : job.status
        : undefined,
      elapsed !== undefined && Number.isFinite(elapsed) && elapsed >= 0
        ? `${launch ? "运行 " : ""}${durationText(elapsed)}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    return { name: typeof name === "string" ? name : "", status };
  });
  const singleJob = !launch && jobs.length === 1 ? jobs[0] : undefined;
  return (
    <section
      className="notice-strip"
      data-kind={launch ? "launch-completion" : "async-result"}
    >
      <header>
        <strong>{launch ? "守护进程已退出" : "后台任务完成"}</strong>
        {singleJob?.name && <code>{singleJob.name}</code>}
        {!launch && !jobs.length && noticeLabel(message)
          ? ` · ${noticeLabel(message)}`
          : ""}
      </header>
      {!singleJob &&
        jobs.map((job, index) => (
          <div className="notice-job" key={index}>
            {job.name && <code>{job.name}</code>}
            {job.status && <small>{job.status}</small>}
          </div>
        ))}
      <details className={singleJob ? "notice-single-output" : undefined}>
        <summary>
          {singleJob?.status && <small>{singleJob.status} · </small>}
          查看输出
        </summary>
        <MessageBody
          message={{ ...message, role: "assistant", customType: undefined }}
        />
      </details>
    </section>
  );
}
