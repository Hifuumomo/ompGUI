import type { AgentMessage, DesktopBridge } from "./protocol";

export type SubagentStatus =
  "pending" | "running" | "completed" | "failed" | "aborted" | "parked";
export interface SubagentProgress {
  readonly id: string;
  readonly status: SubagentStatus;
  readonly task: string;
  readonly description?: string;
  readonly currentTool?: string;
  readonly currentToolArgs?: unknown;
  readonly currentToolIntent?: string;
  readonly currentToolStartMs?: number;
  readonly lastIntent?: string;
  readonly recentTools: readonly {
    tool: string;
    args: unknown;
    intent?: string;
    isError?: boolean;
    endMs: number;
  }[];
  readonly recentOutput: readonly string[];
  readonly toolCount: number;
  readonly requests: number;
  readonly tokens: number;
  readonly cost: number;
  readonly durationMs: number;
  readonly durationKind?: "span";
  readonly contextTokens?: number;
  readonly contextWindow?: number;
  readonly resolvedModel?: string;
  readonly modelRole?: string;
}
export interface SubagentSnapshot {
  readonly historical?: boolean;
  readonly parentId?: string;
  readonly id: string;
  readonly index: number;
  readonly agent: string;
  readonly agentSource: string;
  readonly status: SubagentStatus;
  readonly description?: string;
  readonly task?: string;
  readonly assignment?: string;
  readonly sessionFile?: string;
  readonly parentToolCallId?: string;
  readonly lastUpdate: number;
  readonly progress?: SubagentProgress;
}
export interface SubagentTranscriptResult {
  readonly nextByte: number;
  readonly reset: boolean;
  readonly messages: AgentMessage[];
}
export type SubagentTransport = Pick<
  DesktopBridge,
  "request" | "onFrame" | "subagentHistory"
>;
export interface SubagentHistoryRequest {
  readonly sessionId: string;
  readonly op: "list" | "messages";
  readonly subagentId?: string;
  readonly fromByte?: number;
}
export interface SubagentHistoryResult {
  readonly subagents: SubagentSnapshot[];
}
export interface SubagentActivityRow {
  readonly id: string;
  readonly agentId: string;
  readonly time: number;
  readonly kind: "lifecycle" | "tool" | "response";
  readonly title: string;
  readonly text: string;
  readonly error?: boolean;
}
