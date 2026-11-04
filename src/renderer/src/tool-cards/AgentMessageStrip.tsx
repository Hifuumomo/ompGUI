import { useContext, useId, useLayoutEffect, useRef, useState } from "react";
import type { AgentMessage } from "../../../shared/protocol";
import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { cardStatus, toolDetails } from "../tool-card-model";
import { TranscriptActions } from "./actions";
import { GenericCard } from "./GenericCard";

import { ToolResultImages } from "./CardFrame";
/** 只读取对象字段，不把数组或空值当作消息。 */
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 读取完整调用参数；未完成的流式片段不参与通讯目标解析。 */
function argumentsObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

/** 去除原生 IRC 信封及说明首行，正文仍作为纯文本呈现。 */
function incomingText(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value
            .flatMap((part) => {
              const block = record(part);
              return block?.type === "text" && typeof block.text === "string"
                ? [block.text]
                : [];
            })
            .join("\n")
        : "";
  return text
    .trim()
    .replace(/^<irc>\s*/i, "")
    .replace(/\s*<\/irc>$/i, "")
    .replace(/^Incoming IRC message from agent\s+`[^`]*`:\s*/i, "")
    .trim();
}

/** 仅格式化真实时间戳，缺失或无效时间不生成占位时间。 */
function messageTime(timestamp: unknown): string | undefined {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp))
    return undefined;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 通讯条使用三行纯文本预览，代理按钮只打开已有活动面板。 */
export function AgentMessageStrip({
  direction,
  peer,
  text,
  aside,
  tool,
  context,
}: {
  direction: "in" | "out";
  peer: string;
  text: string;
  aside?: string;
  tool?: ToolEvidence;
  context?: ProcessContext;
}) {
  const { onOpenSubagent } = useContext(TranscriptActions);
  const [localExpanded, setExpanded] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const textId = useId();
  const [overflows, setOverflows] = useState(false);
  const controlled = tool !== undefined && context !== undefined;
  const expanded = controlled
    ? context.expanded[tool.id] !== undefined
    : localExpanded;
  const explicitOverflow = text.split("\n").length > 3;
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    /** 按完整正文的实际高度判断换行，展开后仍按三行阈值测量。 */
    function measure() {
      const style = getComputedStyle(element!);
      const lineHeight = Number.parseFloat(style.lineHeight);
      setOverflows(
        Number.isFinite(lineHeight) &&
          element!.scrollHeight > lineHeight * 3 + 1,
      );
    }
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [text, expanded]);
  const truncated = explicitOverflow || overflows;
  /** 工具通讯复用转录展开状态，原生来信使用局部状态。 */
  function toggle() {
    if (controlled) context.toggle(tool.id, 0);
    else setExpanded((value) => !value);
  }
  return (
    <section
      className="agent-message-strip"
      data-direction={direction}
      data-tool-id={tool?.id}
    >
      <header className="agent-message-header">
        <span className="agent-message-legend">
          {direction === "in" ? "← 来自 " : "→ 发给 "}
          {onOpenSubagent ? (
            <button
              type="button"
              className="agent-message-peer"
              onClick={onOpenSubagent}
            >
              {peer}
            </button>
          ) : (
            <span className="agent-message-peer">{peer}</span>
          )}
        </span>
        {aside && (
          <span className="agent-message-aside" data-outcome={aside}>
            {aside === "woken" ? "已唤醒" : aside}
          </span>
        )}
      </header>
      <div
        ref={textRef}
        id={textId}
        className="agent-message-text"
        data-expanded={expanded}
      >
        {text}
      </div>
      {tool && (
        <div className="agent-message-media">
          <ToolResultImages result={tool.resultMessage ?? tool.live?.result} />
        </div>
      )}
      {(truncated || expanded) && (
        <footer className="agent-message-footer">
          <span>
            <button
              type="button"
              className="agent-message-expand"
              aria-expanded={expanded}
              aria-controls={textId}
              onClick={toggle}
            >
              {expanded ? "收起" : "展开全部"}
            </button>
          </span>
        </footer>
      )}
    </section>
  );
}

/** 全量转录的原生代理来信；不改变消息分组或紧凑视图。 */
export function IncomingAgentMessage({ message }: { message: AgentMessage }) {
  const details = record(message.details);
  return (
    <AgentMessageStrip
      direction="in"
      peer={typeof details?.from === "string" ? details.from : "未知代理"}
      text={
        typeof details?.message === "string"
          ? details.message
          : incomingText(message.content)
      }
      aside={messageTime(message.timestamp)}
    />
  );
}

/** 将已完成工具证据适配为发送通讯条或原生收件箱，缺失详情回退通用框。 */
export function AgentMessageCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  if (cardStatus(tool) !== "ok")
    return <GenericCard tool={tool} context={context} />;
  const args = argumentsObject(tool.args);
  const details = toolDetails(tool);
  if (args?.op === "inbox" || details.op === "inbox") {
    if (!Array.isArray(details.inbox))
      return <GenericCard tool={tool} context={context} />;
    const entries = details.inbox.map(record);
    if (
      entries.some(
        (entry) =>
          typeof entry?.from !== "string" || typeof entry.message !== "string",
      )
    ) {
      return <GenericCard tool={tool} context={context} />;
    }
    return (
      <section className="agent-message-inbox" data-tool-id={tool.id}>
        <header className="agent-message-header">
          <span className="agent-message-legend">
            收件箱 · {entries.length} 条
          </span>
        </header>
        {entries.length ? (
          entries.map((entry, index) => (
            <AgentMessageStrip
              key={typeof entry!.id === "string" ? entry!.id : index}
              direction="in"
              peer={entry!.from as string}
              text={entry!.message as string}
              aside={messageTime(entry!.timestamp)}
            />
          ))
        ) : (
          <div className="tool-card-muted">收件箱为空</div>
        )}
        <ToolResultImages result={tool.resultMessage ?? tool.live?.result} />
      </section>
    );
  }
  const message = record(details.message);
  const path = typeof args?.path === "string" ? args.path : "";
  const peer =
    typeof message?.to === "string"
      ? message.to
      : /^agent:\/\/(.+)$/i.exec(path)?.[1];
  if (!peer || !args || !("content" in args))
    return <GenericCard tool={tool} context={context} />;
  const receipt = Array.isArray(message?.receipts)
    ? record(message.receipts[0])
    : undefined;
  if (!message || typeof receipt?.outcome !== "string")
    return <GenericCard tool={tool} context={context} />;
  let text: string;
  try {
    text =
      typeof args.content === "string"
        ? args.content
        : (JSON.stringify(args.content) ?? "");
  } catch {
    return <GenericCard tool={tool} context={context} />;
  }
  return (
    <AgentMessageStrip
      direction="out"
      peer={peer}
      text={text}
      aside={typeof receipt?.outcome === "string" ? receipt.outcome : undefined}
      tool={tool}
      context={context}
    />
  );
}
