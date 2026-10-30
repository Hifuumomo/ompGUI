import { expect, it } from "vitest";
import type { AgentMessage, SessionState } from "../../shared/protocol";
import { parsePlanStatus } from "./plan-status";
import { initialSession, sessionReducer } from "./session";

const record = { version: 1, operationId: "approve", kind: "approved", choice: "keep", planPath: "local://PLAN.md", model: { provider: "one", modelId: "model", name: "Chat" } };
const status: AgentMessage = { role: "custom", customType: "ompgui-plan-status", details: record, display: true, timestamp: 20 };

it("忽略未知版本、损坏数值、缺失身份和非法可选字段，不把普通自定义消息识别为计划", () => {
  expect(parsePlanStatus(status)).toEqual(record);
  for (const patch of [{ version: 2 }, { operationId: "" }, { kind: "unknown" }, { choice: "unknown" }, { planPath: "file:///PLAN.md" }, { revision: 0 }, { revision: 1.5 }, { contextPercent: NaN }, { contextPercent: -1 }, { model: { provider: "one" } }, { model: { provider: "one", modelId: "m", name: 1 } }, { document: {} }, { error: [] }, { targetSessionId: 3 }]) {
    expect(parsePlanStatus({ ...status, details: { ...record, ...patch } })).toBeUndefined();
  }
  expect(parsePlanStatus({ ...status, customType: "other" })).toBeUndefined();
  expect(parsePlanStatus({ ...status, display: false })).toBeUndefined();
});

it("终态元数据插入批准信封之前，不中断正在生成的回复；重复刷新和旧会话结果无副作用", () => {
  const state: SessionState = { sessionId: "session", sessionFile: "session.jsonl", isStreaming: true, isCompacting: false, messageCount: 3, queuedMessageCount: 0 };
  const user: AgentMessage = { role: "user", content: "开始", timestamp: 10 };
  const approval: AgentMessage = { role: "developer", synthetic: true, content: "Plan approved.", timestamp: 20 };
  const answer: AgentMessage = { role: "assistant", content: "正在执行…", timestamp: 21 };
  const active = { ...initialSession, state, busy: true, activeMessage: "stream", messages: [{ key: "u", message: user, streaming: false }, { key: "a", message: approval, streaming: false }, { key: "stream", message: answer, streaming: true }] };
  const history = [user, status, approval];
  const next = sessionReducer(active, { type: "plan-status", sessionId: "session", messages: history });
  expect(next.messages.map((item) => item.message)).toEqual([user, status, approval, answer]);
  expect(next.messages[3]).toBe(active.messages[2]);
  expect(next.activeMessage).toBe("stream");
  expect(next.busy).toBe(true);
  expect(sessionReducer(next, { type: "plan-status", sessionId: "session", messages: history })).toBe(next);
  expect(sessionReducer(next, { type: "plan-status", sessionId: "other", messages: history })).toBe(next);
  const ended = sessionReducer(next, { type: "frame", frame: { type: "message_end", messageId: "stream", message: { ...answer, content: "执行完成" } } });
  expect(ended.messages.at(-1)?.message.content).toBe("执行完成");
  expect(ended.messages.filter((item) => parsePlanStatus(item.message))).toHaveLength(1);
});
