import { useEffect, useId, useRef, useState } from "react";
import type { ProcessItem } from "./transcript-types";
import { ThinkingContent } from "./ThinkingContent";
import { type ProcessContext } from "./TranscriptToolRow";
import { groupToolItems, ToolGroup } from "./TranscriptToolGroup";
import { ProcessSummary } from "./ProcessSummary";
import { MessageBody, roleLabels } from "./TranscriptContent";

function ThinkingText({
  item,
}: {
  item: Extract<ProcessItem, { kind: "thinking" }>;
}) {
  return <ThinkingContent text={item.part.thinking ?? item.part.text ?? ""} />;
}

/** 过程摘要展开操作列表，各工具行独立保留自己的详情展开状态。 */
export function ProcessGroup({
  items,
  sessionId,
  active,
  startedAt,
  endedAt,
  inline,
  followup,
}: {
  items: ProcessItem[];
  sessionId: string;
  active?: boolean;
  startedAt?: number;
  endedAt?: number;
  inline?: boolean;
  followup?: boolean;
}) {
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  // 只在整轮运行状态改变时控制折叠，普通消息刷新保留用户手动展开状态。
  useEffect(() => {
    if (active !== undefined && details.current) details.current.open = active;
  }, [active]);
  const [expanded, setExpanded] = useState<Readonly<Record<string, number>>>(
    {},
  );
  function toggle(toolId: string, index: number) {
    setExpanded((current) => {
      if (current[toolId] !== index) return { ...current, [toolId]: index };
      return Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== toolId),
      );
    });
  }
  const context: ProcessContext = {
    sessionId,
    expanded,
    toggle,
    panelId: (toolId) => `${id}-${encodeURIComponent(toolId)}`,
  };
  // 回退目标直接展示原有操作标题，避免新增默认收起的通用过程层。
  if (inline) return followup
    ? <div className="process-group followup"><ProcessItems items={items} context={context} /></div>
    : <ProcessItems items={items} context={context} />;
  return (
    <details ref={details} className={`process-group${followup ? " followup" : ""}`}>
      <ProcessSummary
        items={items}
        active={active}
        startedAt={startedAt}
        endedAt={endedAt}
      />
      <ProcessItems items={items} context={context} />
    </details>
  );
}

function ProcessItems({
  items,
  context,
}: {
  items: ProcessItem[];
  context: ProcessContext;
}) {
  return (
    <div
      className="process-evidence"
      role="region"
      aria-label="执行过程记录"
      tabIndex={0}
    >
      {groupToolItems(items).map((item) =>
        item.kind === "errors" ? (
          <details
            key={item.key}
            className="transcript-evidence process-error-group"
          >
            <summary>错误信息</summary>
            <div
              className="process-errors"
              role="region"
              aria-label="错误记录"
              tabIndex={0}
            >
              {item.items.map((entry) => (
                <MessageBody key={entry.key} message={entry.message} />
              ))}
            </div>
          </details>
        ) : item.kind === "message" ? (
          <article
            key={item.key}
            className="conversation-message conversation-assistant"
            aria-label={
              roleLabels[item.message.role] ?? `原生消息 ${item.message.role}`
            }
          >
            <MessageBody message={item.message} />
          </article>
        ) : item.kind === "thinking" ? (
          <ThinkingText key={item.key} item={item} />
        ) : (
          <ToolGroup key={item.key} items={item.items} context={context} />
        ),
      )}
    </div>
  );
}
