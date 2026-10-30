import type { SubagentSnapshot } from "../../shared/subagents";

export const runningAgent: SubagentSnapshot = {
  id: "agent-1",
  index: 1,
  agent: "explore",
  agentSource: "bundled",
  task: "检查子代理活动接口",
  status: "running",
  sessionFile: "/isolated/agent-1.jsonl",
  parentToolCallId: "task-1",
  lastUpdate: 100,
  progress: {
    id: "agent-1",
    status: "running",
    task: "检查子代理活动接口",
    currentTool: "read",
    currentToolArgs: { path: "rpc.ts" },
    currentToolStartMs: 90,
    recentTools: [{ tool: "grep", args: { pattern: "subagent" }, endMs: 80 }],
    recentOutput: ["已找到进度订阅接口"],
    tokens: 1200,
    requests: 2,
    toolCount: 2,
    cost: 0.0012,
    durationMs: 2000,
    resolvedModel: "test-model",
  },
};
