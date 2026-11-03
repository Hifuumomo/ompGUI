import type { AgentMessage, MessageContent, RpcFrame } from "./protocol";

/** 仅供展示的原始参数；完整参数仍只经 arguments 进入授权路径。 */
export type StreamingMessageContent = MessageContent & { partialArguments?: string };

/** 按同一位置和工具标识匹配，避免并行调用或复用位置串入旧参数。 */
function sameTool(left: MessageContent | undefined, right: MessageContent | undefined): boolean {
  return left?.type === "toolCall" && right?.type === "toolCall" &&
    (left.id !== undefined || right.id !== undefined
      ? left.id === right.id
      : left.name === right.name);
}

/** 前后台共用增量归并；快照权威，但不能覆盖尚未结束工具的原始参数流。 */
export function streamedMessage(previous: AgentMessage | undefined, frame: RpcFrame): AgentMessage {
  const event = frame.assistantMessageEvent as
    | {
        type?: string;
        partial?: AgentMessage;
        contentIndex?: number;
        delta?: string;
        content?: string;
        toolCall?: MessageContent;
      }
    | undefined;
  const snapshot = frame.message as AgentMessage | undefined;
  const authoritative = snapshot ?? event?.partial;
  const base = authoritative ?? previous ?? { role: "assistant" };
  const previousContent = Array.isArray(previous?.content) ? previous.content : [];
  const content: StreamingMessageContent[] = Array.isArray(base.content)
    ? base.content.map((part) => ({ ...part }))
    : typeof base.content === "string" ? [{ type: "text", text: base.content }] : [];
  const index = event?.contentIndex ?? 0;
  let changed = false;
  for (let position = 0; position < previousContent.length; position += 1) {
    const old = previousContent[position] as StreamingMessageContent;
    if (old.partialArguments === undefined ||
        (event?.type === "toolcall_end" && position === index)) continue;
    if (sameTool(old, content[position])) {
      content[position] = { ...content[position], partialArguments: old.partialArguments };
      delete content[position].arguments;
      changed = true;
    } else if (content[position] === undefined) {
      content[position] = { ...old };
      changed = true;
    }
  }
  if (event?.type === "toolcall_start" || event?.type === "toolcall_delta") {
    const partialContent = event.partial?.content;
    const incoming = event.toolCall ?? content[index] ??
      (Array.isArray(partialContent) ? partialContent[index] : undefined);
    if (incoming?.type === "toolCall") {
      const old = previousContent[index] as StreamingMessageContent | undefined;
      const raw = sameTool(old, incoming) ? old?.partialArguments ?? "" : "";
      content[index] = {
        ...incoming,
        partialArguments: raw + (event.delta ?? ""),
      };
      delete content[index].arguments;
      changed = true;
    }
  } else if (event?.type === "toolcall_end") {
    const complete = event.toolCall ?? content[index];
    if (complete?.type === "toolCall") {
      content[index] = { ...complete };
      delete content[index].partialArguments;
      changed = true;
    }
  } else if (!authoritative && event?.type?.startsWith("text_")) {
    content[index] = {
      type: "text",
      text: event.type === "text_end"
        ? (event.content ?? content[index]?.text ?? "")
        : (content[index]?.text ?? "") + (event.delta ?? ""),
    };
    changed = true;
  } else if (!authoritative && event?.type?.startsWith("thinking_")) {
    content[index] = {
      type: "thinking",
      thinking: event.type === "thinking_end"
        ? (event.content ?? content[index]?.thinking ?? "")
        : (content[index]?.thinking ?? "") + (event.delta ?? ""),
    };
    changed = true;
  }
  return changed ? { ...base, content } : base;
}
