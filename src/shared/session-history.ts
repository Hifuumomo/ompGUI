import type { AgentMessage, SessionEntry } from "./protocol";
import { parseTodoPhases, todoResultPhases, type TodoPhase } from "./todo";

export interface SessionHistorySnapshot {
  entries: SessionEntry[];
  leafId: string | null;
}

/** 沿当前分支恢复计划，包含原生手动编辑及清空记录，不混入旁支或遗漏压缩前计划。 */
export function sessionHistoryTodos(
  snapshot: SessionHistorySnapshot,
): TodoPhase[] {
  const branch = activeBranchEntries(snapshot);
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    const phases =
      entry.type === "custom" && entry.customType === "user_todo_edit"
        ? parseTodoPhases(
            (entry.data as { phases?: unknown } | undefined)?.phases,
          )
        : entry.type === "message" && entry.message?.role === "toolResult"
          ? todoResultPhases(entry.message.toolName, entry.message)
          : undefined;
    if (phases !== undefined) return phases;
  }
  return [];
}

/** 沿原生 leaf 的父链恢复当前分支；压缩边界不截断历史，也不混入旁支。 */
export function activeBranchEntries(
  snapshot: SessionHistorySnapshot,
): SessionEntry[] {
  const byId = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const branch: SessionEntry[] = [];
  let id = snapshot.leafId;
  while (id !== null) {
    if (seen.has(id)) throw new Error("原生会话历史的父节点存在循环");
    const entry = byId.get(id);
    if (!entry) throw new Error(`原生会话历史缺少节点：${id}`);
    seen.add(id);
    branch.push(entry);
    id = entry.parentId;
  }
  return branch.reverse();
}

/** 从原生记录生成展示消息与会话事件，隐藏工具开始和模型提及仅供转录证据使用。 */
export function sessionHistoryMessages(
  snapshot: SessionHistorySnapshot,
): AgentMessage[] {
  return activeBranchEntries(snapshot).flatMap((entry): AgentMessage[] => {
    if (entry.type === "message" && entry.message) return [entry.message];
    if (entry.type === "custom" && entry.customType === "ompgui-plan-status") {
      return [{
        role: "custom",
        customType: entry.customType,
        details: entry.data,
        display: true,
        timestamp: Date.parse(entry.timestamp),
      }];
    }
    if (entry.type === "custom_message") {
      return [
        {
          role: "custom",
          customType: entry.customType,
          content: entry.content as AgentMessage["content"],
          display: entry.display,
          details: entry.details,
          attribution: entry.attribution,
          timestamp: Date.parse(entry.timestamp),
        },
      ];
    }
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      if (typeof entry.summary !== "string") return [];
      return [
        {
          role:
            entry.type === "compaction" ? "compactionSummary" : "branchSummary",
          summary: entry.summary,
          timestamp: Date.parse(entry.timestamp),
          tokensBefore: entry.tokensBefore,
          tokensAfter: entry.tokensAfter,
          method: entry.method,
          fromId: entry.fromId,
        },
      ];
    }
    if (
      entry.type === "model_change" ||
      entry.type === "thinking_level_change" ||
      entry.type === "mode_change"
    ) {
      return [{
        role: "custom",
        customType: "ompgui-session-event",
        display: true,
        details: {
          event: entry.type,
          model: entry.model,
          thinkingLevel: entry.thinkingLevel,
          mode: entry.mode,
        },
        timestamp: Date.parse(entry.timestamp),
      }];
    }
    if (
      entry.type === "custom" &&
      (entry.customType === "tool_execution_start" || entry.customType === "model_mention")
    ) {
      return [{
        role: "custom",
        customType: entry.customType,
        display: false,
        details: entry.data,
        timestamp: Date.parse(entry.timestamp),
      }];
    }
    return [];
  });
}
