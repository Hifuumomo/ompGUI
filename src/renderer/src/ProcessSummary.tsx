import { useEffect, useState } from "react";
import { toolStatus } from "./transcript-model";
import type { ProcessItem } from "./transcript-types";
import { durationText } from "./duration-text";
import { isAgentMessage, isBackgroundOutput } from "./TranscriptNotice";

/** 为纯用时文本附加执行过程的场景文案。 */
export function formatDuration(milliseconds: number): string {
  return `运行了 ${durationText(milliseconds)}`;
}

export function ProcessSummary({
  items,
  active,
  startedAt,
  endedAt,
}: {
  items: ProcessItem[];
  active?: boolean;
  startedAt?: number;
  endedAt?: number;
}) {
  const tools = items
    .filter((item) => item.kind === "tool")
    .map((item) => item.tool);
  const statuses = tools.map(toolStatus);
  const thinking = items.some(
    (item) => item.kind === "thinking" && item.streaming,
  );
  const background = items.filter(
    (item) => item.kind === "message" && isBackgroundOutput(item.message),
  ).length;
  const agent = items.filter(
    (item) => item.kind === "message" && isAgentMessage(item.message),
  ).length;
  const running = active ?? (statuses.includes("执行中") || thinking);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);
  return (
    <summary aria-busy={running}>
      <span className={running ? "spinner" : "process-icon"} aria-hidden="true">
        {running ? "" : "◇"}
      </span>
      <span className="process-summary-label">
        {startedAt === undefined
          ? "执行过程"
          : formatDuration((running ? now : (endedAt ?? now)) - startedAt)}
      </span>
      {(background > 0 || agent > 0) && (
        <span className="process-summary-notices">
          {background > 0 ? ` · ${background} 条后台结果` : ""}
          {agent > 0 ? ` · ${agent} 条代理消息` : ""}
        </span>
      )}
      <span className="process-summary-chevron" aria-hidden="true">
        ›
      </span>
    </summary>
  );
}
