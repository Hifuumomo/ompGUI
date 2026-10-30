import type { AgentMessage } from "./protocol";

/** 与 omp 原生 TODO 工具保持一致的任务状态。 */
export type TodoStatus =
  "pending" | "in_progress" | "completed" | "blocked" | "abandoned";
export interface TodoItem {
  content: string;
  status: TodoStatus;
  blocker?: string;
}
export interface TodoPhase {
  name: string;
  tasks: TodoItem[];
}

const statuses = new Set<string>([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "abandoned",
]);

/** 验证原生完整快照；undefined 表示无效，空数组表示明确清空计划。 */
export function parseTodoPhases(value: unknown): TodoPhase[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const phases: TodoPhase[] = [];
  for (const phase of value) {
    if (!phase || typeof phase.name !== "string" || !Array.isArray(phase.tasks))
      return undefined;
    const tasks: TodoItem[] = [];
    for (const task of phase.tasks) {
      if (
        !task ||
        typeof task.content !== "string" ||
        !statuses.has(task.status)
      )
        return undefined;
      if (task.blocker !== undefined && typeof task.blocker !== "string")
        return undefined;
      tasks.push({
        content: task.content,
        status: task.status,
        ...(task.blocker !== undefined ? { blocker: task.blocker } : {}),
      });
    }
    phases.push({ name: phase.name, tasks });
  }
  return phases;
}

/** 只接受成功的 TODO 状态变更结果；view 是只读查询，不能恢复已清空的旧计划。 */
export function todoResultPhases(
  toolName: string | undefined,
  result: unknown,
): TodoPhase[] | undefined {
  if (toolName !== "todo" || !result || typeof result !== "object")
    return undefined;
  const { isError, details } = result as {
    isError?: boolean;
    details?: { op?: unknown; phases?: unknown };
  };
  if (isError || !details || details.op === "view") return undefined;
  return parseTodoPhases(details.phases);
}

/** 从消息恢复最近一次成功的计划，兼容没有独立 TODO 快照的历史调用方。 */
export function todoPhasesFromMessages(messages: AgentMessage[]): TodoPhase[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "toolResult") continue;
    const phases = todoResultPhases(message.toolName, message);
    if (phases !== undefined) return phases;
  }
  return [];
}
