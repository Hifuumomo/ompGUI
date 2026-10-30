import type { AgentMessage, SessionEntry } from "../../shared/protocol";
import { sessionHistoryMessages } from "../../shared/session-history";
import { messageText } from "./session";
import { transcriptUnits } from "./transcript-model";

export interface RewindTarget {
  readonly turnId: string;
  readonly entryId: string;
  readonly entryIds: readonly string[];
  readonly text: string;
  readonly userTurn: boolean;
}

/** 沿用历史转换规则，将单个原生节点转换为可展示消息。 */
export function rewindEntryMessage(
  entry: SessionEntry,
): AgentMessage | undefined {
  return sessionHistoryMessages({
    entries: [{ ...entry, parentId: null }],
    leafId: entry.id,
  })[0];
}

/** 原生用户轮需要文字；单独的图片仍可选中，但不作为用户轮跳转点。 */
function isUserTurn(message: AgentMessage): boolean {
  if (message.role === "user") return Boolean(messageText(message).trim());
  return (
    message.role === "custom" &&
    message.attribution === "user" &&
    ["skill-prompt", "collab-prompt"].includes(String(message.customType))
  );
}

/** 用现有转录规则排除隐藏通知、内部工具与没有显示内容的消息。 */
function isVisible(message: AgentMessage, id: string): boolean {
  const units = transcriptUnits([{ key: id, message, streaming: false }], []);
  if (!units.length) return false;
  if (
    message.errorMessage ||
    ["aborted", "error"].includes(message.stopReason ?? "")
  )
    return true;
  if (messageText(message).trim()) return true;
  return (
    Array.isArray(message.content) &&
    message.content.some(
      (part) =>
        part.type === "image" ||
        part.type === "toolCall" ||
        part.type === "toolcall",
    )
  );
}

/** 工具结果归属于前一可见消息，提交回退点时保留完整的工具调用与结果。 */
function appendResult(
  previous: RewindTarget,
  entry: SessionEntry,
): RewindTarget {
  return {
    ...previous,
    entryId: entry.id,
    entryIds: [...previous.entryIds, entry.id],
    text: [previous.text, messageText(entry.message!)].join("\n"),
  };
}

/** 建立与转录内容对应的回退目标，不把会话元数据或隐藏消息当作可选项。 */
export function rewindTargets(
  path: readonly SessionEntry[],
): readonly RewindTarget[] {
  const targets: RewindTarget[] = [];
  for (const entry of path) {
    const message = rewindEntryMessage(entry);
    if (message?.role === "toolResult") {
      const previous = targets.at(-1);
      if (previous) targets[targets.length - 1] = appendResult(previous, entry);
      continue;
    }
    if (!message || !isVisible(message, entry.id)) continue;
    targets.push({
      turnId: entry.id,
      entryId: entry.id,
      entryIds: [entry.id],
      text: messageText(message),
      userTurn: isUserTurn(message),
    });
  }
  return targets;
}

/** 英文词按完整词匹配，其余文字按子串匹配；多个关键词必须全部命中。 */
export function matchesRewindFilter(
  target: RewindTarget,
  query: string,
): boolean {
  const text = target.text.toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((word) => {
      if (/^[\p{Script=Latin}\p{N}_]+$/u.test(word))
        return new RegExp(
          `(?<![\\p{L}\\p{N}_])${word}(?![\\p{L}\\p{N}_])`,
          "u",
        ).test(text);
      return text.includes(word);
    });
}
