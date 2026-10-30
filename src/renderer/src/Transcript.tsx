import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ContextActionsMenu, type ContextActionsMenuProps } from "./ContextActionsMenu";
import { copyRichSelection, richSelectionText } from "./rich-selection";
import { ThinkingVisibility } from "./ThinkingContent";
import { MessageFileLinks } from "./MessageFileLinks";
import type { TranscriptProps } from "./transcript-types";
import { transcriptUnits } from "./transcript-model";
import { ProcessGroup } from "./TranscriptProcess";
import { MessageBody, roleLabels } from "./TranscriptContent";
import { planApprovalPresentation } from "./plan-approval";
import type { PlanStatusCardProps } from "./PlanStatusCard";
import type { TimelineMessage } from "./session";
import { PlanStatusCard } from "./PlanStatusCard";
import { parsePlanStatus } from "./plan-status";
import { ConversationOutline, outlineEntries } from "./ConversationOutline";
import { LateResultDivider } from "./TranscriptNotice";
import "./inline-tool.css";
export type { ToolInspection, TranscriptProps } from "./transcript-types";
export { NativeImage } from "./TranscriptContent";

interface TranscriptPlanCard extends PlanStatusCardProps {
  id: string;
}

/** 在过程分组之前合并相邻原始消息，避免跨工具或正文误配批准快照。 */
function preparePlanCards(messages: TimelineMessage[]) {
  const visible: TimelineMessage[] = [];
  const cards = new Map<string, TranscriptPlanCard>();
  const legacyOrdinals = new Map<string, number>();
  let latestApproved: string | undefined;
  for (let index = 0; index < messages.length; index += 1) {
    const item = messages[index];
    const message = item.message;
    if (message.display === false) continue;
    const isStatus = message.role === "custom" && message.customType === "ompgui-plan-status";
    const record = isStatus ? parsePlanStatus(message) : undefined;
    if (isStatus && !record) continue;
    const approval = planApprovalPresentation(message);
    let card: TranscriptPlanCard | undefined;
    if (record) {
      card = { id: `${record.operationId}:${record.kind}`, record, timestamp: message.timestamp };
      if (record.kind === "approved" || record.kind === "continued") {
        const next = messages[index + 1]?.message;
        const nextApproval = next?.display !== false && next ? planApprovalPresentation(next) : undefined;
        if (nextApproval?.kind === "approved" && nextApproval.path === record.planPath) {
          card.markdown = nextApproval.markdown;
          index += 1;
        }
      }
    } else if (approval?.kind === "approved") {
      const identity = `${message.timestamp ?? "unknown"}:${approval.path}`;
      const ordinal = legacyOrdinals.get(identity) ?? 0;
      legacyOrdinals.set(identity, ordinal + 1);
      card = { id: `legacy:${identity}:${ordinal}`, path: approval.path, markdown: approval.markdown, timestamp: message.timestamp };
    }
    if (card) {
      cards.set(item.key, card);
      if (card.markdown?.trim()) latestApproved = card.id;
      // 独立卡片保持原始位置，不让 developer 文本拆块或助手过程分组吞入卡片。
      visible.push({ ...item, message: { ...message, role: "custom", content: undefined } });
    } else visible.push(item);
  }
  return { visible, cards, latestApproved };
}

/** 同轮进度统一折叠，运行结束自动收起，最终回复独立展示。 */
export function Transcript({
  messages,
  tools,
  sessionId,
  busy,
  runStart,
  inlineProcess,
  onOpenFile,
  outline,
  planCardState,
  onPlanCardToggle,
  onOpenPlanSession,
}: TranscriptProps) {
  const [showThinking, setShowThinking] = useState(true);
  const [selectionMenu, setSelectionMenu] = useState<ContextActionsMenuProps>();
  useLayoutEffect(() => setSelectionMenu(undefined), [sessionId]);
  const localCardStates = useRef(new Map<string, Map<string, boolean>>());
  if (!localCardStates.current.has(sessionId)) localCardStates.current.set(sessionId, new Map());
  const cardStates = planCardState ?? localCardStates.current.get(sessionId)!;
  const [, redrawCards] = useState(0);
  const prepared = useMemo(() => preparePlanCards(messages), [messages]);
  useEffect(() => {
    function toggleThinking(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "t"
      )
        return;
      event.preventDefault();
      if (!event.repeat) setShowThinking((visible) => !visible);
    }
    window.addEventListener("keydown", toggleThinking);
    return () => window.removeEventListener("keydown", toggleThinking);
  }, []);
  const originalUnits = useMemo(
    () => transcriptUnits(prepared.visible, tools),
    [prepared, tools],
  );
  const entries = useMemo(() => outlineEntries(originalUnits), [originalUnits]);
  const targets = useRef(new Map<string, HTMLElement>());
  const waiting =
    busy &&
    runStart &&
    !messages
      .slice(runStart.messageCount)
      .some(({ message }) => message.role === "user");
  const units = [...originalUnits];
  if (
    busy &&
    (waiting ||
      !units.some(
        (unit, index) =>
          unit.kind === "process" &&
          index >
            units.findLastIndex(
              (entry) =>
                entry.kind === "message" && entry.message.role === "user",
            ),
      ))
  ) {
    units.push({ kind: "process", key: "pending", items: [] });
  }
  // 以用户消息的原生时间戳关联轮次，历史刷新改写消息键时仍保留实时终止时间。
  const timings = useRef(new Map<string, { start: number; end?: number }>());
  const users = messages.filter(({ message }) => message.role === "user");
  let userIndex = -1;
  const lastProcess = units.findLastIndex((unit) => unit.kind === "process");
  const lastDivider = units.findLastIndex((unit) => unit.kind === "lateDivider");
  const triggerPositions = units.flatMap((unit) =>
    unit.kind === "message" && unit.segment === "trigger" && unit.followup?.key === unit.key
      ? [{ key: unit.key, index: messages.findIndex((message) => message.key === unit.key) }]
      : [],
  );
  const timedUnits = units.map((unit, index) => {
    if (unit.kind === "message" && unit.message.role === "user") userIndex += 1;
    const user = users[userIndex];
    if (unit.kind !== "process")
      return { unit, current: false, key: `${sessionId}:${unit.key}`, start: undefined, end: undefined };
    const current =
      busy &&
      index === lastProcess &&
      index > lastDivider &&
      (!waiting || unit.key === "pending");
    const toolId = unit.items.find((item) => item.kind === "tool")?.tool.id;
    const key = unit.followup
      ? `${sessionId}:late:${unit.followup.key}`
      : `${sessionId}:${waiting && unit.key === "pending" ? `pending:${runStart?.time}` : (user?.message.timestamp ?? user?.key ?? toolId ?? unit.key)}`;
    const previous = timings.current.get(key);
    const triggerIndex = unit.followup
      ? triggerPositions.find((trigger) => trigger.key === unit.followup?.key)?.index
      : undefined;
    const from = triggerIndex !== undefined && triggerIndex >= 0
      ? triggerIndex
      : user ? messages.indexOf(user) : -1;
    const nextUser = users[userIndex + 1];
    const turnEnd = nextUser ? messages.indexOf(nextUser) : messages.length;
    // 每段在下一段触发前截止，迟到等待时间不延长已完成的过程。
    const nextTrigger = triggerPositions.find((trigger) =>
      trigger.index > from && trigger.index < turnEnd,
    );
    const until = nextTrigger?.index ?? turnEnd;
    const origin = unit.followup
      ? messages[from]?.message.timestamp
      : user?.message.timestamp;
    const submittedTurn =
      !unit.followup && runStart &&
      (waiting ||
        user === messages.slice(runStart.messageCount).find(({ message }) => message.role === "user"));
    const start = current
      ? ((submittedTurn ? runStart?.time : undefined) ?? previous?.start ?? origin ?? Date.now())
      : (previous?.start ?? origin);
    let end = previous?.end;
    if (current && start !== undefined) timings.current.set(key, { start });
    else if (previous && end === undefined) {
      end = Date.now();
      timings.current.set(key, { ...previous, end });
    }
    if ((end === undefined || nextTrigger) && from >= 0) {
      const timestamps = messages.slice(from, until).flatMap(({ message }) =>
        message.timestamp === undefined ? [] : [message.timestamp],
      );
      end = timestamps.length > 1 ? Math.max(...timestamps) : undefined;
    }
    return {
      unit,
      current,
      start: current || end !== undefined ? start : undefined,
      end,
      key,
    };
  });
  const lastUser = units.findLastIndex(
    (unit) => unit.kind === "message" && unit.message.role === "user",
  );
  return (
    <MessageFileLinks.Provider value={onOpenFile}>
      <ThinkingVisibility.Provider value={showThinking}>
        {outline && <ConversationOutline entries={entries} targets={targets} />}
        <div className="conversation-review" tabIndex={-1} onCopy={(event) => copyRichSelection(event.nativeEvent, event.currentTarget)} onContextMenuCapture={(event) => {
          if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest("input,textarea,[contenteditable]:not([contenteditable='false'])")) return;
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed || !selection.rangeCount) return;
          const range = selection.getRangeAt(0);
          if (!event.currentTarget.contains(range.startContainer) || !event.currentTarget.contains(range.endContainer) || !range.intersectsNode(event.target)) return;
          const copyText = richSelectionText(selection);
          if (!copyText) return;
          event.preventDefault(); event.stopPropagation();
          setSelectionMenu({ x: event.clientX, y: event.clientY, copyText, trigger: event.currentTarget, onClose: () => setSelectionMenu(undefined) });
        }}>
          {timedUnits.map(({ unit, current, start, end, key }, index) => {
            const card = prepared.cards.get(unit.key);
            if (card) return <PlanStatusCard
              key={`${sessionId}:${card.id}`}
              {...card}
              expanded={cardStates.get(card.id) ?? (card.id === prepared.latestApproved)}
              onToggle={(expanded) => {
                cardStates.set(card.id, expanded);
                onPlanCardToggle?.(card.id, expanded);
                redrawCards((value) => value + 1);
              }}
              onOpenSession={onOpenPlanSession}
            />;
            if (unit.kind === "lateDivider")
              return <LateResultDivider key={`${sessionId}:${unit.key}`} arrivedAt={unit.arrivedAt} answeredAt={unit.answeredAt} />;
            const approval = unit.kind === "message"
              ? planApprovalPresentation(unit.message) ?? null
              : null;
            const approvalLabel = approval?.kind === "approved"
              ? "计划已批准"
              : approval?.kind === "raw" ? "计划批准消息（原文）" : undefined;
            return unit.kind === "process" ? (
              <ProcessGroup
                key={unit.followup ? `${key}:followup:${unit.followup.key}` : `${key}:process:${unit.key === "pending" ? "pending" : "record"}`}
                items={unit.items}
                sessionId={sessionId}
                inline={inlineProcess}
                followup={!!unit.followup}
                active={
                  busy === undefined
                    ? undefined
                    : current &&
                      index === lastProcess &&
                      (index > lastUser || !!waiting)
                }
                startedAt={start}
                endedAt={end}
              />
            ) : (
              <article
                key={`${sessionId}:${unit.key}`}
                ref={
                  (outline && unit.message.role === "user") || unit.segment === "trigger"
                    ? (element) => {
                        if (element) targets.current.set(unit.key, element);
                        else targets.current.delete(unit.key);
                      }
                    : undefined
                }
                className={`conversation-message conversation-${unit.message.role}${unit.segment === "trigger" ? " conversation-late-trigger" : unit.segment === "followup" ? " conversation-followup" : ""}`}
                data-late-trigger={unit.segment === "trigger" ? unit.key : undefined}
                aria-label={
                  approvalLabel ?? roleLabels[unit.message.role] ??
                  `原生消息 ${unit.message.role}`
                }
              >
                <div className="conversation-heading">
                  {unit.message.role !== "assistant" &&
                    unit.segment !== "trigger" &&
                    unit.message.role !== "compactionSummary" &&
                    unit.message.display !== false &&
                    unit.message.role !== "user" && (
                      <strong>
                        {approvalLabel ?? roleLabels[unit.message.role] ?? unit.message.role}
                      </strong>
                    )}
                  {unit.segment === "followup" && unit.followup && (
                    <button
                      type="button"
                      className="followup-tag"
                      onClick={() => {
                        const target = targets.current.get(unit.followup!.key);
                        target?.scrollIntoView({ block: "center" });
                        target?.classList.add("flash");
                        window.setTimeout(() => target?.classList.remove("flash"), 1200);
                      }}
                    >
                      后续回复{unit.followup.title ? ` ↩ ${unit.followup.title}` : ""}
                    </button>
                  )}
                  {unit.streaming && <span className="live-label">生成中</span>}
                </div>
                <MessageBody message={unit.message} planApproval={approval} />
              </article>
            );
          })}
        </div>
        {selectionMenu && <ContextActionsMenu {...selectionMenu} />}
      </ThinkingVisibility.Provider>
    </MessageFileLinks.Provider>
  );
}
