import type { AgentMessage, MessageContent } from "../../shared/protocol";
import type { TimelineMessage, ToolActivity } from "./session";
import { isAgentMessage, isBackgroundOutput, noticeLabel } from "./TranscriptNotice";
import type {
  FollowupTrigger,
  ProcessItem,
  ToolEvidence,
  TranscriptUnit,
} from "./transcript-types";

export const executableNames: Readonly<Record<string, true>> = {
  bash: true,
  psh: true,
  pwsh: true,
  powershell: true,
  python: true,
  eval: true,
  exec: true,
  shell: true,
  command: true,
  execute_shell_command: true,
};

const hiddenToolNames = new Set(["todo", "eval", "wait"]);

/** 判断原生工具调用块，保留原生大小写兼容类型。 */
function isToolCall(part: MessageContent): boolean {
  return part.type === "toolCall" || part.type === "toolcall";
}

/** 合并真实调用参数，保留先到达的工具结果。 */
function callEvidence(
  id: string,
  part: MessageContent,
  previous?: ToolEvidence,
): ToolEvidence {
  return {
    ...previous,
    id,
    name: part.name ?? "工具",
    args: part.arguments,
    call: part,
  };
}

/** 历史结果沿用调用名称与参数，缺少调用时保留原生工具名。 */
function resultEvidence(
  id: string,
  message: AgentMessage,
  previous?: ToolEvidence,
): ToolEvidence {
  return {
    ...previous,
    id,
    name: previous?.name ?? message.toolName ?? "工具",
    args: previous?.args,
    resultMessage: message,
  };
}

/** 配对完整历史证据及实时状态，保持首次发现的工具顺序。 */
function collectEvidence(messages: TimelineMessage[], tools: ToolActivity[]) {
  const evidence = new Map<string, ToolEvidence>();
  for (const { message } of messages) {
    const parts = Array.isArray(message.content) ? message.content : [];
    for (const part of parts.filter(isToolCall)) {
      if (!part.id) continue;
      evidence.set(part.id, callEvidence(part.id, part, evidence.get(part.id)));
    }
    if (message.role !== "toolResult" || !message.toolCallId) continue;
    const previous = evidence.get(message.toolCallId);
    evidence.set(
      message.toolCallId,
      resultEvidence(message.toolCallId, message, previous),
    );
  }
  for (const live of tools) {
    const previous = evidence.get(live.id);
    evidence.set(live.id, {
      ...previous,
      id: live.id,
      name: previous?.name ?? live.name,
      args: previous?.args ?? live.args,
      live,
    });
  }
  return evidence;
}

/** 创建局部时间线累积器，只修改自身持有的数据，不修改原始证据。 */
function createTimeline() {
  const units: TranscriptUnit[] = [];
  const rendered = new Set<string>();
  let pending: ProcessItem[] = [];
  function flush() {
    if (!pending.length) return;
    units.push({ kind: "process", key: pending[0].key, items: pending });
    pending = [];
  }
  function process(item: ProcessItem) {
    pending.push(item);
  }
  function toolRow(tool: ToolEvidence, key: string) {
    // 在时间线入口统一隐藏，历史结果和实时工具都不产生行或空过程组。
    if (hiddenToolNames.has(tool.name) || rendered.has(tool.id)) return;
    rendered.add(tool.id);
    process({ kind: "tool", key, tool });
  }
  function message(unit: Extract<TranscriptUnit, { kind: "message" }>) {
    flush();
    units.push(unit);
  }
  function result() {
    flush();
    return units;
  }
  return { process, toolRow, message, result };
}

type TimelineBuilder = ReturnType<typeof createTimeline>;

/** 仅合并没有普通正文的助手错误，避免吞掉回复、思考或工具记录。 */
export function isErrorOnlyMessage(message: AgentMessage): boolean {
  if (
    message.role !== "assistant" ||
    !(message.errorMessage || message.stopReason === "error")
  )
    return false;
  return typeof message.content === "string"
    ? !message.content.trim()
    : !message.content?.some(
        (part) => part.type !== "text" || !!part.text?.trim(),
      );
}

/** 拆分正文时仅给最后一块保留错误和中止状态。 */
function createMessageChunks(item: TimelineMessage, timeline: TimelineBuilder) {
  const { message } = item;
  let parts: MessageContent[] = [];
  let chunk = 0;
  function flush(final: boolean) {
    const terminal =
      message.errorMessage ||
      message.stopReason === "aborted" ||
      message.stopReason === "error";
    if (parts.length || (final && terminal)) {
      timeline.message({
        kind: "message",
        key: `${item.key}:text:${chunk++}`,
        message: {
          ...message,
          content: parts,
          errorMessage: final ? message.errorMessage : undefined,
          stopReason: final ? message.stopReason : undefined,
        },
        streaming: item.streaming,
      });
    }
    parts = [];
  }
  return { flush, append: (part: MessageContent) => parts.push(part) };
}

interface MessageContext {
  readonly item: TimelineMessage;
  readonly evidence: ReadonlyMap<string, ToolEvidence>;
  readonly timeline: TimelineBuilder;
}

/** 依次发出正文、思考及工具块，保证每个工具只占一个原始位置。 */
function appendContent({ item, evidence, timeline }: MessageContext) {
  const chunks = createMessageChunks(item, timeline);
  const content = item.message.content as MessageContent[];
  for (const [index, part] of content.entries()) {
    const key = `${item.key}:part:${index}`;
    if (part.type === "thinking") {
      // 空思考块不创建入口，也不打断相邻工具分组。
      if (!(part.thinking ?? part.text ?? "").trim()) continue;
      chunks.flush(false);
      timeline.process({
        kind: "thinking",
        key,
        part,
        streaming: item.streaming,
      });
      continue;
    }
    if (!isToolCall(part)) {
      chunks.append(part);
      continue;
    }
    chunks.flush(false);
    const tool = part.id ? evidence.get(part.id) : undefined;
    timeline.toolRow(
      tool ?? {
        id: key,
        name: part.name ?? "工具",
        args: part.arguments,
        call: part,
      },
      key,
    );
  }
  chunks.flush(true);
}

/** 工具结果优先复用已配对调用；孤立结果仍保留完整原生证据。 */
function appendMessage(context: MessageContext) {
  const { item, evidence, timeline } = context;
  const { message } = item;
  if (
    isBackgroundOutput(message) ||
    isAgentMessage(message) ||
    message.role === "compactionSummary" ||
    isErrorOnlyMessage(message)
  ) {
    timeline.process({
      kind: "message",
      key: item.key,
      message,
      streaming: item.streaming,
    });
    return;
  }
  if (message.role === "toolResult") {
    const tool = message.toolCallId
      ? evidence.get(message.toolCallId)
      : undefined;
    timeline.toolRow(
      tool ?? {
        id: item.key,
        name: message.toolName ?? "工具",
        args: undefined,
        resultMessage: message,
      },
      item.key,
    );
    return;
  }
  if (
    ["assistant", "user", "developer"].includes(message.role) &&
    Array.isArray(message.content)
  ) {
    appendContent(context);
    return;
  }
  timeline.message({
    kind: "message",
    key: item.key,
    message,
    streaming: item.streaming,
  });
}

/** 按真实 id 配对工具，依次保留正文、过程块和未落入历史的实时工具。 */
export function transcriptUnits(
  messages: TimelineMessage[],
  tools: ToolActivity[],
): TranscriptUnit[] {
  // 内部通知和文件引用不进入展示时间线，避免空占位或打断同轮执行过程。
  const visibleMessages = messages.filter(
    ({ message }) =>
      message.display !== false && message.role !== "fileMention",
  );
  const evidence = collectEvidence(visibleMessages, tools);
  const timeline = createTimeline();
  for (const original of visibleMessages) {
    let item = original;
    if (original.message.role === "assistant") {
      // 仅精确识别引擎静默中止；展示副本去掉内部状态，原始会话证据保持不变。
      const silentAbort = original.message.stopReason === "aborted" &&
        original.message.errorMessage === "__omp.silent_abort__";
      const content = original.message.content;
      // 保留正文、工具和思考；纯内部停止连同空文本不产生占位消息。
      const visibleContent = Array.isArray(content)
        ? content.filter(
            (part) => part.type !== "text" || (part.text?.trim() !== "." && (!silentAbort || !!part.text?.trim())),
          )
        : content?.trim() === "." || (silentAbort && !content?.trim())
          ? []
          : content;
      item = {
        ...original,
        message: {
          ...original.message,
          content: visibleContent,
          errorMessage: silentAbort ? undefined : original.message.errorMessage,
          stopReason: silentAbort ? undefined : original.message.stopReason,
        },
      };
    }
    appendMessage({ item, evidence, timeline });
  }
  for (const tool of evidence.values()) {
    if (tool.live) timeline.toolRow(tool, `live:${tool.id}`);
  }
  return groupTurnProcesses(timeline.result());
}

type MessageUnit = Extract<TranscriptUnit, { kind: "message" }>;
type NoticeItem = Extract<ProcessItem, { kind: "message" }>;

/** 只有原生 stop 且已结束生成的助手正文才是轮次边界。 */
function isTurnEnd(unit: TranscriptUnit): unit is MessageUnit {
  return (
    unit.kind === "message" &&
    unit.message.role === "assistant" &&
    unit.message.stopReason === "stop" &&
    !unit.streaming
  );
}

/** 仅剥离过程开头连续的后台结果和代理来信，不越过思考或工具。 */
function leadingNotices(items: ProcessItem[]): NoticeItem[] {
  const notices: NoticeItem[] = [];
  for (const item of items) {
    if (
      item.kind !== "message" ||
      !(isBackgroundOutput(item.message) || isAgentMessage(item.message))
    )
      break;
    notices.push(item);
  }
  return notices;
}

/** 合并同轮过程；已结束回复为边界，其后到达的通知开启后续段。 */
function groupTurnProcesses(units: TranscriptUnit[]): TranscriptUnit[] {
  const result: TranscriptUnit[] = [];
  let pending: TranscriptUnit[] = [];
  // 最近一条已结束回复；其他角色或非通知过程会清除这一边界。
  let ended: MessageUnit | undefined;
  // 当前后续段的来源只在遇到其他角色或新的迟到通知时替换。
  let followup: FollowupTrigger | undefined;
  function flush() {
    const last = pending.at(-1);
    const answer = last?.kind === "message" ? (pending.pop() as MessageUnit) : undefined;
    const items: ProcessItem[] = pending.flatMap((unit): ProcessItem[] =>
      unit.kind === "process" ? unit.items : unit.kind === "message" ? [unit] : [],
    );
    if (items.length)
      result.push({ kind: "process", key: items[0].key, items, followup });
    if (answer)
      result.push(followup ? { ...answer, segment: "followup", followup } : answer);
    pending = [];
  }
  for (const unit of units) {
    if (unit.kind === "message" && unit.message.role !== "assistant") {
      flush();
      ended = undefined;
      followup = undefined;
      result.push(unit);
      continue;
    }
    const notices =
      ended && !pending.length && unit.kind === "process"
        ? leadingNotices(unit.items)
        : [];
    if (unit.kind === "process" && notices.length) {
      const first = notices[0];
      followup = { key: first.key, title: noticeLabel(first.message) };
      result.push({
        kind: "lateDivider",
        key: `late:${first.key}`,
        arrivedAt: first.message.timestamp,
        answeredAt: ended?.message.timestamp,
      });
      for (const notice of notices)
        result.push({ ...notice, segment: "trigger", followup });
      ended = undefined;
      const rest = unit.items.slice(notices.length);
      if (rest.length) pending.push({ kind: "process", key: rest[0].key, items: rest });
      continue;
    }
    ended = undefined;
    pending.push(unit);
    if (isTurnEnd(unit)) {
      flush();
      ended = unit;
    }
  }
  flush();
  return result;
}

/** 读取真实工具终态，历史结果优先于过期实时状态。 */
export function toolStatus(tool: ToolEvidence): string {
  const result = tool.resultMessage;
  const payload = result ?? tool.live?.result;
  const object =
    payload !== null && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : undefined;
  if (object?.cancelled === true || result?.stopReason === "aborted")
    return "已取消";
  if (failedTool(tool, object)) return "错误";
  if (result) return "已完成";
  if (tool.live?.running) return "执行中";
  return tool.live ? "已完成" : "未记录结果";
}

/** 保留原生结果中的错误判定，不被已过期实时错误覆盖。 */
function failedTool(
  tool: ToolEvidence,
  payload?: Record<string, unknown>,
): boolean {
  return Boolean(
    payload?.isError === true ||
    payload?.errorMessage ||
    tool.resultMessage?.stopReason === "error" ||
    (!tool.resultMessage && tool.live?.error),
  );
}

/** 判断执行类工具，避免读取和搜索结果被误认作源代码。 */
export function executableTool(name: string): boolean {
  return Object.hasOwn(
    executableNames,
    name
      .toLowerCase()
      .split(/__|[.:/]/)
      .at(-1) ?? "",
  );
}
