import type { ReactNode } from "react";
import type { AgentMessage } from "../../shared/protocol";
import { durationText } from "./duration-text";

/** 仅根据原生类型识别后台投递，不从正文猜测消息用途。 */
export function isBackgroundOutput(message: AgentMessage): boolean {
  return message.role === "custom" && message.customType === "async-result";
}

/** 代理来信属于执行过程，display:true 也不要求默认展开正文。 */
export function isAgentMessage(message: AgentMessage): boolean {
  return message.role === "custom" && message.customType === "irc:incoming";
}

/** 从已有任务标签或 Markdown 标题提取单行标题，不生成任务名称。 */
function noticeTitle(
  message: AgentMessage,
  background: boolean,
): string | undefined {
  if (isAgentMessage(message)) {
    const details = message.details as { from?: unknown } | undefined;
    return typeof details?.from === "string" ? details.from : undefined;
  }
  if (background) {
    const details = message.details as
      { jobs?: { label?: unknown }[] } | undefined;
    if (!Array.isArray(details?.jobs)) return undefined;
    const labels = details.jobs
      .map((job) => job?.label)
      .filter(
        (label): label is string => typeof label === "string" && !!label.trim(),
      );
    return labels.length ? labels.join(" / ").replace(/\s+/g, " ") : undefined;
  }
  const text =
    typeof message.content === "string"
      ? message.content
      : (message.content
          ?.filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n") ?? "");
  return (
    text.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1] ??
    (typeof message.customType === "string" ? message.customType : undefined)
  );
}

/** 供后续段标签复用的单行标题，与通知摘要保持一致。 */
export function noticeLabel(message: AgentMessage): string | undefined {
  return noticeTitle(message, isBackgroundOutput(message))
    ?.replace(/\s+/g, " ")
    .trim() || undefined;
}

/** 只统计真实会话已记录的任务终态，不把日志中的测试失败数当成任务状态。 */
function noticeStatus(message: AgentMessage): string | undefined {
  if (!isBackgroundOutput(message)) return undefined;
  const details = message.details as { jobs?: { status?: unknown }[] } | undefined;
  if (!Array.isArray(details?.jobs)) return undefined;
  let failed = 0;
  let completed = 0;
  for (const job of details.jobs) {
    if (job?.status === "failed") failed += 1;
    else if (job?.status === "completed") completed += 1;
  }
  return [
    failed ? `${failed} 个任务失败` : "",
    completed ? `${completed} 个任务完成` : "",
  ].filter(Boolean).join(" · ") || undefined;
}

/** 标出已结束回复之后才到达的后台结果，缺少时间时不推断间隔。 */
export function LateResultDivider({
  arrivedAt,
  answeredAt,
}: {
  arrivedAt?: number;
  answeredAt?: number;
}) {
  const gap =
    arrivedAt !== undefined && answeredAt !== undefined
      ? durationText(arrivedAt - answeredAt)
      : undefined;
  return (
    <div
      className="late-result-divider"
      role="separator"
      aria-label="后台结果迟到"
    >
      <span>
        后台结果迟到
        {arrivedAt !== undefined &&
          ` · ${new Date(arrivedAt).toLocaleTimeString()}`}
        {gap && ` · 回复后 ${gap}`}
      </span>
    </div>
  );
}

/** 原生 details 默认收起，刷新正文不重置用户的展开选择。 */
export function TranscriptNotice({
  message,
  children,
}: {
  message: AgentMessage;
  children: ReactNode;
}) {
  const background = isBackgroundOutput(message);
  const title = noticeLabel(message);
  const status = noticeStatus(message);
  return (
    <details
      className={`transcript-notice ${background ? "background-output" : "internal-notice"}`}
    >
      <summary title={title}>
        <span className="notice-title">
          {background
            ? "后台任务输出"
            : isAgentMessage(message)
              ? "代理消息"
              : "内部通知"}
          {title ? ` · ${title}` : ""}
        </span>
        {status && <span className="notice-status">{status}</span>}
      </summary>
      <div className="notice-body">{children}</div>
    </details>
  );
}
