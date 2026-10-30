import type { SubagentHistoryRequest } from "../shared/subagents";

export interface HistoryHost {
  readonly current: () => Promise<{ id: string; path: string } | undefined>;
  readonly prepare: () => Promise<unknown>;
  readonly read: (action: Record<string, unknown>) => Promise<unknown>;
}

/** Resolve the root in the main process; renderer input never grants arbitrary file access. */
export async function readSubagentHistory(input: unknown, host: HistoryHost) {
  const request = parseHistoryRequest(input);
  const session = await host.current();
  if (!session || session.id !== request.sessionId)
    throw new Error("会话已切换，请重新打开子代理活动");
  await host.prepare();
  return host.read({ ...request, rootSessionFile: session.path });
}

function parseHistoryRequest(input: unknown): SubagentHistoryRequest {
  if (!input || typeof input !== "object")
    throw new Error("无效的历史代理请求");
  const value = input as Record<string, unknown>;
  if (typeof value.sessionId !== "string" || !value.sessionId)
    throw new Error("缺少会话标识");
  if (value.op === "list") return { op: "list", sessionId: value.sessionId };
  if (
    value.op !== "messages" ||
    typeof value.subagentId !== "string" ||
    !value.subagentId
  )
    throw new Error("无效的历史代理对话请求");
  const fromByte = value.fromByte ?? 0;
  if (
    typeof fromByte !== "number" ||
    !Number.isSafeInteger(fromByte) ||
    fromByte < 0
  )
    throw new Error("无效的对话读取位置");
  return {
    op: "messages",
    sessionId: value.sessionId,
    subagentId: value.subagentId,
    fromByte,
  };
}
