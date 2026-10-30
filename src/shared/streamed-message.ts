import type { AgentMessage, MessageContent, RpcFrame } from "./protocol";

/** 前后台共用同一增量归并规则；原生完整快照优先于增量。 */
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
  // content 缺省也是合法快照，不能误退回旧消息。
  if (snapshot !== undefined) return snapshot;
  if (event?.partial !== undefined) return event.partial;
  const base = previous ?? { role: "assistant" };
  const isContentDelta = event?.type?.startsWith("text_") ||
    event?.type?.startsWith("thinking_") ||
    (event?.type === "toolcall_end" && event.toolCall);
  if (!isContentDelta) return base;
  const content: MessageContent[] = Array.isArray(base.content)
    ? base.content.map((part) => ({ ...part }))
    : typeof base.content === "string" ? [{ type: "text", text: base.content }] : [];
  const index = event?.contentIndex ?? 0;
  if (event?.type?.startsWith("text_")) {
    content[index] = {
      type: "text",
      text: event.type === "text_end"
        ? (event.content ?? content[index]?.text ?? "")
        : (content[index]?.text ?? "") + (event.delta ?? ""),
    };
  } else if (event?.type?.startsWith("thinking_")) {
    content[index] = {
      type: "thinking",
      thinking: event.type === "thinking_end"
        ? (event.content ?? content[index]?.thinking ?? "")
        : (content[index]?.thinking ?? "") + (event.delta ?? ""),
    };
  } else if (event?.type === "toolcall_end" && event.toolCall) {
    content[index] = event.toolCall;
  }
  return { ...base, content };
}
