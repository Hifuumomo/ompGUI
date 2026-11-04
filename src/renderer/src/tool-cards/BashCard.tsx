import { useLayoutEffect, useRef } from "react";
import { describeToolCall } from "../../../shared/tool-presentation";
import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { ToolOutput } from "../TranscriptContent";
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

/** 输出正文保持原生文件位置链接，并在用户未向上滚动时跟随实时末行。参数：[in] props 文本和运行状态。返回值：浅色输出区。 */
export function CommandOutput({
  text,
  running,
}: {
  text: string;
  running: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    if (running && follow.current && element.current) {
      element.current.scrollTop = element.current.scrollHeight;
    }
  }, [text, running]);
  return (
    <div
      className="tool-card-output"
      ref={element}
      onScroll={(event) => {
        const node = event.currentTarget;
        follow.current =
          node.scrollHeight - node.clientHeight - node.scrollTop <= 4;
      }}
    >
      <ToolOutput result={text} executable collapse={false} />
    </div>
  );
}

/** 读取超时秒数；参数：[in] value 原生字段。返回值：有限正数或 undefined。 */
function timeoutSeconds(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** 命令框展示原生输出、退出码和后台回执，不推测缺失的退出码。参数：[in] props 工具证据和受控展开上下文。返回值：命令框。 */
export function BashCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const details = toolDetails(tool);
  const commandTarget = describeToolCall(tool.name, tool.args).targets.find(
    (target) => target.kind === "command",
  );
  const command =
    commandTarget?.kind === "command"
      ? commandTarget.command
      : tool.streamingArgs?.command;
  const expanded = context.expanded[tool.id] !== undefined;
  if (typeof command !== "string")
    return <GenericCard tool={tool} context={context} />;
  const commandLines = command.replace(/\r\n/g, "\n").split("\n");
  const text = toolResultText(tool).replace(ANSI_PATTERN, "");
  const tail = outputTail(
    text,
    status === "running" ? 10 : status === "error" ? 15 : 5,
  );
  const result = tool.resultMessage;
  const exitCode =
    typeof details.exitCode === "number"
      ? details.exitCode
      : typeof result?.exitCode === "number"
        ? result.exitCode
        : undefined;
  const asyncInfo =
    details.async &&
    typeof details.async === "object" &&
    !Array.isArray(details.async)
      ? (details.async as Record<string, unknown>)
      : undefined;
  const background =
    status !== "cancelled" &&
    status !== "error" &&
    (details.async === true || asyncInfo !== undefined);
  const jobId =
    typeof asyncInfo?.jobId === "string"
      ? asyncInfo.jobId
      : typeof details.jobId === "string"
        ? details.jobId
        : undefined;
  const killAfter = /killed once it has run\s+(\d+(?:\.\d+)?)s/i.exec(
    text,
  )?.[1];
  const duration = background ? undefined : toolDurationMs(tool, now);
  const args = (tool.args ?? {}) as Record<string, unknown>;
  const timeout =
    timeoutSeconds(details.timeoutSeconds) ?? timeoutSeconds(args.timeout);
  // 底部边框：状态、用时、超时、后台终止提示、截断说明，缺失的项省略。
  const state =
    status === "cancelled"
      ? "已取消"
      : background
        ? `后台${jobId ? ` ${jobId}` : ""}`
        : status === "running"
          ? tool.streamingArgs
            ? "生成中"
            : `运行中${duration !== undefined ? ` ${durationText(duration)}` : ""}`
          : exitCode !== undefined
            ? `exit ${exitCode}`
            : undefined;
  const footerParts = [
    state,
    status !== "running" && !background && duration !== undefined
      ? `用时 ${durationText(duration)}`
      : undefined,
    timeout !== undefined ? `超时 ${timeout}s` : undefined,
    killAfter ? `超过 ${killAfter} 秒将被终止` : undefined,
    details.truncated === true || result?.truncated === true
      ? "输出已截断"
      : undefined,
    details.prunedAt != null || result?.prunedAt != null
      ? "输出已裁剪"
      : undefined,
  ].filter((part): part is string => !!part);
  const hidden = tail.total - tail.lines.length;
  const toggle = () => context.toggle(tool.id, 0);
  return (
    <CardFrame
      toolId={tool.id}
      kind="bash"
      variant="command"
      status={background ? "running" : status}
      icon={background ? "⇢" : status === "cancelled" ? null : undefined}
      title={
        <span className="tool-card-command-title" title={command}>
          $ {commandLines[0]}
          {commandLines.length > 1 && (
            <span className="tool-card-muted">
              {" "}
              +{commandLines.length - 1} 行
            </span>
          )}
        </span>
      }
      expand={{ expanded, onToggle: toggle }}
      footer={footerParts.length ? footerParts.join(" · ") : undefined}
      output={
        background ? (
          <>
            <p>已转入后台运行。</p>
            <p className="tool-card-muted">
              完成后以「后台任务完成」通知条出现。
            </p>
            {expanded && text && <CommandOutput text={text} running={false} />}
          </>
        ) : text ? (
          <>
            {hidden > 0 && (
              <div className="tool-card-truncation">
                {expanded ? (
                  <>共 {tail.total} 行 · </>
                ) : (
                  <>
                    … 前 {hidden} 行已省略 · 显示 {tail.lines.length} /{" "}
                    {tail.total} 行 ·{" "}
                  </>
                )}
                <button type="button" onClick={toggle}>
                  {expanded ? "收起" : "展开全部"}
                </button>
              </div>
            )}
            <CommandOutput
              text={expanded ? text : tail.lines.join("\n")}
              running={status === "running"}
            />
          </>
        ) : undefined
      }
    />
  );
}
