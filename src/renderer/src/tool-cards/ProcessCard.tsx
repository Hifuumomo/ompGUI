import type { ReactNode } from "react";
import { toolOperation } from "../../../shared/tool-presentation";
import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { ANSI_PATTERN } from "../jobs-output";
import { durationText } from "../duration-text";
import {
  cardStatus,
  outputTail,
  toolDetails,
  toolDurationMs,
  toolResultText,
} from "../tool-card-model";
import { useNow } from "../use-now";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";
import { CommandOutput } from "./BashCard";

type Fields = Record<string, unknown>;
/** 只接受普通结构字段，忽略缺失、数组及原始值。参数：[in] value 原生字段。返回值：字段集合。 */
function fields(value: unknown): Fields | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Fields)
    : undefined;
}
/** 兼容已解析及完整 JSON 参数，不接受流式残片。参数：[in] value 参数。返回值：参数对象。 */
function argumentsObject(value: unknown): Fields {
  if (typeof value !== "string") return fields(value) ?? {};
  try {
    return fields(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}
/** 仅显示真实字符串和有限数值。参数：[in] value 原生值。返回值：安全显示文字。 */
function label(value: unknown): string | undefined {
  return typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : undefined;
}
/** 提取有效结构行，不把错误数组项当作进程。参数：[in] value 列表。返回值：结构行。 */
function rows(value: unknown): Fields[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const row = fields(item);
        return row ? [row] : [];
      })
    : [];
}
/** 根据真实开始与结束时间计算运行时长。参数：[in] row 进程字段，[in] now 当前时间。返回值：时长或空。 */
function runtime(row: Fields, now: number): string | undefined {
  if (typeof row.durationMs === "number" && Number.isFinite(row.durationMs))
    return durationText(Math.max(0, row.durationMs));
  const start = row.startedAt;
  const end = row.exitedAt ?? now;
  return typeof start === "number" &&
    Number.isFinite(start) &&
    typeof end === "number" &&
    Number.isFinite(end)
    ? durationText(Math.max(0, end - start))
    : undefined;
}
/** 状态圆点不暗示未知状态已经就绪。参数：[in] props 状态字段。返回值：状态圆点和原文。 */
function ProcessState({ state }: { state: unknown }) {
  const text = label(state);
  return (
    <>
      <span
        className="tool-card-process-dot"
        data-state={text}
        aria-hidden="true"
      >
        ●
      </span>{" "}
      {text}
    </>
  );
}

/** 按原生进程操作展示服务、日志和后台任务。参数：[in] props 工具证据及展开上下文。返回值：进程框或通用回退。 */
export function ProcessCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const details = toolDetails(tool);
  const args = argumentsObject(tool.args);
  const proc = fields(details.proc);
  const daemons = rows(details.daemons);
  const daemon =
    [details.daemon, proc?.daemon, details.service, daemons[0]]
      .map(fields)
      .find((row) => row && Object.keys(row).length > 0) ?? {};
  const path = typeof args.path === "string" ? args.path : undefined;
  const operation = toolOperation(tool.name);
  const op =
    label(details.op) ??
    label(proc?.action) ??
    label(args.op) ??
    (operation === "read" && path?.startsWith("proc://")
      ? "logs"
      : operation === "write" && path?.endsWith("/kill")
        ? "stop"
        : details.service
          ? "start"
          : undefined);
  const name =
    label(daemon.name) ??
    label(args.name) ??
    path?.replace(/^proc:\/\//, "").split(/[/:]/)[0];
  const status = cardStatus(tool);
  const ticking =
    status === "running" ||
    (typeof daemon.startedAt === "number" &&
      daemon.exitedAt == null &&
      ["list", "ps"].includes(op ?? ""));
  const now = useNow(ticking);
  const expanded = context.expanded[tool.id] !== undefined;
  const exitCode =
    typeof daemon.exitCode === "number" ? daemon.exitCode : undefined;
  const error = exitCode !== undefined && exitCode !== 0;
  let title: ReactNode;
  let body: ReactNode;
  let footer: ReactNode;
  let statusText: ReactNode;
  let valid = false;
  const timedOut = details.timedOut === true || daemon.timedOut === true;
  const heading = name ? <code>{name}</code> : null;
  if (op === "start") {
    valid =
      [label(daemon.name), label(daemon.state), label(daemon.pid)].some(
        (value) => value !== undefined,
      ) ||
      typeof daemon.ready === "boolean" ||
      typeof daemon.timedOut === "boolean";
    title = <>启动服务 · {heading}</>;
    const startDuration =
      typeof daemon.readyAt === "number" && typeof daemon.startedAt === "number"
        ? durationText(Math.max(0, daemon.readyAt - daemon.startedAt))
        : undefined;
    const ready = fields(args.ready);
    const seconds =
      label(ready?.timeout) ??
      label(details.timeoutSeconds) ??
      label(args.timeout);
    body = (
      <>
        <div className="tool-card-row">
          <ProcessState
            state={
              daemon.state ?? (daemon.ready === true ? "ready" : undefined)
            }
          />
          <code className="tool-card-muted">
            {[label(daemon.pid) && `pid ${label(daemon.pid)}`, startDuration]
              .filter(Boolean)
              .join(" · ")}
          </code>
        </div>
        {label(daemon.readyMatch) && (
          <p className="tool-card-muted">
            就绪匹配：{label(daemon.readyMatch)}
          </p>
        )}
        {timedOut && (
          <>
            <p className="tool-card-warning">
              ⚠ {seconds ? `${seconds} 秒内` : "等待期间"}未匹配就绪日志
            </p>
            {["starting", "ready", "running"].includes(
              String(daemon.state),
            ) && <p className="tool-card-muted">进程仍在运行</p>}
          </>
        )}
      </>
    );
  } else if (op === "stop" || op === "kill") {
    valid = [
      daemon.state,
      daemon.exitCode,
      daemon.startedAt,
      daemon.exitedAt,
    ].some((value) => value !== undefined);
    title = <>终止 · {heading}</>;
    body = (
      <>
        <p>
          <span className="tool-card-process-exit" data-error={error}>
            {exitCode !== undefined ? `exit ${exitCode}` : label(daemon.state)}
          </span>
          {runtime(daemon, now) && (
            <span className="tool-card-muted">
              {" "}
              · 运行 {runtime(daemon, now)}
            </span>
          )}
        </p>
        {path && <code className="tool-card-muted">{path}</code>}
      </>
    );
  } else if (op === "cancel" || op === "jobs") {
    const jobs = rows(details.jobs);
    const cancelled = rows(details.cancelled);
    const items = jobs.length ? jobs : cancelled;
    valid = Array.isArray(details.jobs) || Array.isArray(details.cancelled);
    title =
      op === "cancel" ? (
        <>
          取消后台任务 ·{" "}
          <code>
            {items
              .map((row) => label(row.id))
              .filter(Boolean)
              .join("、")}
          </code>
        </>
      ) : (
        <>后台任务 · {items.length} 个</>
      );
    body = (
      <div className="tool-card-list">
        {items.map((row, index) => (
          <div className="tool-card-row" key={label(row.id) ?? index}>
            <code>{label(row.id)}</code>
            <span className="tool-card-muted">
              {op === "cancel" ? "已取消" : label(row.status)}
              {runtime(row, now) && ` · ${runtime(row, now)}`}
            </span>
            <code className="tool-card-muted">{label(row.label)}</code>
          </div>
        ))}
      </div>
    );
  } else if (op === "list" || op === "ps") {
    valid = Array.isArray(details.daemons);
    title = "进程列表";
    body = (
      <div className="tool-card-list">
        {daemons.map((row, index) => (
          <div className="tool-card-row" key={label(row.id) ?? index}>
            <ProcessState state={row.state} />
            <code>{label(row.name)}</code>
            <span className="tool-card-muted">
              {[label(row.pid) && `pid ${label(row.pid)}`, runtime(row, now)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ))}
      </div>
    );
  } else if (op === "logs" || op === "read") {
    const terminalRows = details.terminalRows ?? proc?.terminalRows;
    const text = (
      Array.isArray(terminalRows) &&
      terminalRows.every((row) => typeof row === "string")
        ? terminalRows.join("\n")
        : toolResultText(tool)
    ).replace(ANSI_PATTERN, "");
    valid =
      !!text || Array.isArray(terminalRows) || Object.keys(daemon).length > 0;
    const limit =
      typeof args.lines === "number" && Number.isFinite(args.lines)
        ? Math.max(1, args.lines)
        : 10;
    const tail = outputTail(text, limit);
    title = <>进程日志 · {heading}</>;
    statusText = `末尾 ${tail.lines.length} 行`;
    body = text ? (
      <CommandOutput
        text={expanded ? text : tail.lines.join("\n")}
        running={status === "running"}
      />
    ) : null;
    footer = (
      <>
        末尾 {tail.lines.length} 行 · 共 {tail.total} 行
        {tail.total > tail.lines.length && (
          <>
            {" "}
            ·{" "}
            <button type="button" onClick={() => context.toggle(tool.id, 0)}>
              {expanded ? "收起" : "展开全部"}
            </button>
          </>
        )}
      </>
    );
  } else if (op === "wait") {
    valid =
      typeof details.timedOut === "boolean" ||
      Object.keys(daemon).length > 0 ||
      typeof details.matched === "boolean";
    title = <>等待 · {heading}</>;
    statusText = timedOut ? (
      <span className="tool-card-warning">超时</span>
    ) : details.matched === true || details.timedOut === false ? (
      "✓ 已匹配"
    ) : undefined;
    body = label(args.pattern) ? (
      <code className="tool-card-muted">匹配 {label(args.pattern)}</code>
    ) : null;
  } else if (op === "send") {
    valid = typeof args.text === "string" && Object.keys(daemon).length > 0;
    title = <>发送输入 → {heading}</>;
    body = <pre>{label(args.text)}</pre>;
  }
  if (!valid) return <GenericCard tool={tool} context={context} />;
  return (
    <CardFrame
      toolId={tool.id}
      kind="process"
      status={error ? "error" : status}
      tone={error ? "danger" : "default"}
      title={title}
      statusText={statusText}
      durationMs={toolDurationMs(tool, now)}
      expand={{ expanded, onToggle: () => context.toggle(tool.id, 0) }}
      footer={footer}
    >
      {body}
    </CardFrame>
  );
}
