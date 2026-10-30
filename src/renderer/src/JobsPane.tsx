import { useLayoutEffect, useRef, useState } from "react";
import { ANSI_PATTERN, parseJobsOutput, type JobEntry } from "./jobs-output";
import type { ToolActivity } from "./session";
import { PaneResizeHandle } from "./PaneResizeHandle";

const statusLabels: Record<string, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

interface Props {
  output?: string; // 最近一次 /jobs 的原生输出；undefined 表示尚未取得。
  tools: ToolActivity[]; // 会话工具活动；后台任务的累积输出快照随原生更新帧写入。
  pending: boolean; // 原生命令执行中。
  disabled: boolean; // 未连接时禁止刷新。
  onRefresh: () => void;
  onClose: () => void;
}

/** 展开任务的终端输出：纯文本渲染不可信内容，内容增长时贴底滚动。 */
function JobOutput({ text }: { text?: string }) {
  const box = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);
  return (
    <>
      <span className="job-label">输出</span>
      {text ? (
        <pre ref={box} className="job-output">
          {text}
        </pre>
      ) : (
        <p className="job-output-empty">暂无输出（仅显示本次连接中启动的任务）。</p>
      )}
    </>
  );
}

/** 右侧后台任务侧栏：按任务分卡片，单独折叠展开，命令与输出分区显示。 */
export function JobsPane({ output, tools, pending, disabled, onRefresh, onClose }: Props) {
  // 展开状态按原生任务 id 保存，刷新后保持。
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const report = output === undefined ? undefined : parseJobsOutput(output);
  const jobs = report?.entries.filter((entry): entry is JobEntry => entry.kind === "job") ?? [];
  const allExpanded = jobs.length > 0 && jobs.every((job) => expanded.has(job.id));
  // 原生后台更新帧的 partialResult 是累积快照（≤50 KiB 尾部），按 details.async.jobId 归属。
  const jobOutputs = new Map<string, string>();
  for (const tool of tools) {
    const result = tool.result as
      | { content?: { type?: string; text?: string }[]; details?: { async?: { jobId?: string } } }
      | undefined;
    const jobId = result?.details?.async?.jobId;
    if (!jobId || !Array.isArray(result.content)) continue;
    jobOutputs.set(
      jobId,
      result.content
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("")
        .replace(ANSI_PATTERN, "")
        .trimEnd(),
    );
  }
  return (
    <aside className="jobs-pane" aria-label="后台任务">
      <PaneResizeHandle storageKey="omp-desktop.jobs-width" label="调整后台任务侧栏宽度" initialWidth={345} />
      <header>
        <div className="jobs-title">
          <h2>后台任务</h2>
          {report?.running !== undefined && (
            <span className="jobs-count">运行中 {report.running}</span>
          )}
        </div>
        <button className="icon-button" aria-label="关闭后台任务" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="jobs-controls">
        <button disabled={pending || disabled} onClick={onRefresh}>
          {pending ? "读取中…" : "刷新"}
        </button>
        {jobs.length > 1 && (
          <button
            onClick={() =>
              setExpanded(allExpanded ? new Set() : new Set(jobs.map((job) => job.id)))
            }
          >
            {allExpanded ? "全部折叠" : "全部展开"}
          </button>
        )}
      </div>
      <div className="jobs-output" aria-busy={pending}>
        {report === undefined ? (
          <p className="jobs-message">{pending ? "正在读取后台任务…" : "尚未读取。"}</p>
        ) : report.message !== undefined ? (
          <p className="jobs-message">{report.message || "原生命令没有返回输出。"}</p>
        ) : (
          <ul className="jobs-list">
            {report.entries.map((entry) => {
              if (entry.kind === "agent")
                return (
                  <li
                    key={`agent:${entry.id}`}
                    className="jobs-agent"
                    style={{ marginLeft: `${entry.depth}ch` }}
                  >
                    子代理 {entry.id}
                  </li>
                );
              const open = expanded.has(entry.id);
              return (
                <li
                  key={entry.id}
                  className="job-item"
                  data-status={entry.status}
                  style={{ marginLeft: `${entry.depth}ch` }}
                >
                  <button
                    className="job-summary"
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (!next.delete(entry.id)) next.add(entry.id);
                        return next;
                      })
                    }
                  >
                    <span className="job-meta">
                      <span className="job-chevron" aria-hidden="true">
                        {open ? "▾" : "▸"}
                      </span>
                      <span className="job-id">{entry.id}</span>
                      <span className="job-type">{entry.type}</span>
                      <span className="job-status">
                        {statusLabels[entry.status] ?? entry.status}
                      </span>
                      <span className="job-duration">{entry.duration}</span>
                    </span>
                    {!open && entry.command && (
                      <span className="job-preview">{entry.command.split("\n")[0]}</span>
                    )}
                  </button>
                  {open && (
                    <div className="job-detail">
                      {entry.agent && <p className="job-agent">子代理 {entry.agent}</p>}
                      <span className="job-label">命令</span>
                      <pre className="job-command">{entry.command || entry.id}</pre>
                      <JobOutput text={jobOutputs.get(entry.id)} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
