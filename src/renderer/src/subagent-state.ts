import type { RpcFrame } from "../../shared/protocol";
import type {
  SubagentSnapshot,
  SubagentActivityRow,
  SubagentStatus,
} from "../../shared/subagents";

export const SUBAGENT_LABELS: Record<SubagentStatus, string> = {
  pending: "等待中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  aborted: "已停止",
  parked: "历史 · 已停驻",
};
export interface SubagentState {
  readonly agents: readonly SubagentSnapshot[];
  readonly activity: readonly SubagentActivityRow[];
}
export const EMPTY_SUBAGENTS: SubagentState = { agents: [], activity: [] };
export const SUBAGENT_FILTERS = {
  all: "全部活动",
  errors: "错误",
  response: "回复",
  tool: "工具",
} as const;
export type SubagentFilter = keyof typeof SUBAGENT_FILTERS;
export function subagentParent(agent: SubagentSnapshot): string {
  return agent.parentId ?? agent.parentToolCallId ?? "未报告";
}

function activityFor(agent: SubagentSnapshot): SubagentActivityRow[] {
  const base = { agentId: agent.id, time: agent.lastUpdate };
  const rows: SubagentActivityRow[] = [
    {
      ...base,
      id: `${agent.id}:status:${agent.status}`,
      kind: "lifecycle",
      title: SUBAGENT_LABELS[agent.status],
      text: agent.task ?? agent.description ?? "",
      error: agent.status === "failed",
    },
  ];
  const progress = agent.progress;
  if (!progress) return rows;
  for (const tool of progress.recentTools)
    rows.push({
      ...base,
      id: `${agent.id}:tool:${tool.endMs}:${tool.tool}`,
      time: tool.endMs,
      kind: "tool",
      title: tool.tool,
      text: tool.intent ?? JSON.stringify(tool.args),
      error: tool.isError,
    });
  return [...rows, ...liveActivity(agent)];
}

function liveActivity(agent: SubagentSnapshot): SubagentActivityRow[] {
  const progress = agent.progress;
  if (!progress) return [];
  const base = { agentId: agent.id, time: agent.lastUpdate };
  const rows: SubagentActivityRow[] = [];
  if (progress.currentTool && agent.status === "running")
    rows.push({
      ...base,
      id: `${agent.id}:current`,
      kind: "tool",
      title: `执行 ${progress.currentTool}`,
      text:
        progress.currentToolIntent ??
        JSON.stringify(progress.currentToolArgs ?? {}),
      time: progress.currentToolStartMs ?? agent.lastUpdate,
    });
  if (progress.recentOutput.length)
    rows.push({
      ...base,
      id: `${agent.id}:response`,
      kind: "response",
      title: "近期输出",
      text: progress.recentOutput.join("\n"),
    });
  return rows;
}

export function mergeSubagent(
  state: SubagentState,
  agent: SubagentSnapshot,
): SubagentState {
  const previous = state.agents.find((item) => item.id === agent.id);
  const merged = { ...previous, ...agent };
  const agents = [
    ...state.agents.filter((item) => item.id !== agent.id),
    merged,
  ].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  const activity = new Map(
    state.activity
      .filter((row) => row.id !== `${agent.id}:current`)
      .map((row) => [row.id, row]),
  );
  for (const row of activityFor(merged)) {
    const old = activity.get(row.id);
    activity.set(row.id, old?.text === row.text ? old : row);
  }
  return {
    agents,
    activity: [...activity.values()].sort(
      (a, b) => a.time - b.time || a.id.localeCompare(b.id),
    ),
  };
}

export function applySubagentFrame(
  state: SubagentState,
  frame: RpcFrame,
): SubagentState {
  if (frame.type !== "subagent_progress" && frame.type !== "subagent_lifecycle")
    return state;
  const payload = frame.payload as Omit<SubagentSnapshot, "status"> & {
    status: SubagentStatus | "started";
  };
  const progress = payload.progress;
  const id = progress?.id ?? payload.id;
  const previous = state.agents.find((agent) => agent.id === id);
  const status =
    frame.type === "subagent_progress" ? progress!.status : payload.status;
  return mergeSubagent(state, {
    ...previous,
    ...payload,
    id,
    status: status === "started" ? "running" : status,
    progress: progress ?? previous?.progress,
    lastUpdate: Date.now(),
  });
}
