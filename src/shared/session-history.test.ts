import { expect, it } from "vitest";
import type { SessionEntry } from "./protocol";
import { sessionHistoryMessages, activeBranchEntries } from "./session-history";

/** 构造真实 parentId 链上的记录，时间戳不参与分支排序。 */
function entry(
  id: string,
  parentId: string | null,
  fields: Partial<SessionEntry>,
): SessionEntry {
  return {
    id,
    parentId,
    type: "message",
    timestamp: "2026-10-13T00:00:00Z",
    ...fields,
  };
}

it("多次压缩保留全部早期消息，摘要位于发生位置，排除旁支和配置记录", () => {
  const entries = [
    entry("u1", null, { message: { role: "user", content: "提示1" } }),
    entry("a1", "u1", { message: { role: "assistant", content: "回答1" } }),
    entry("u2", "a1", { message: { role: "user", content: "提示2" } }),
    entry("c1", "u2", {
      type: "compaction",
      summary: "压缩1",
      firstKeptEntryId: "u2",
    }),
    entry("a2", "c1", { message: { role: "assistant", content: "回答2" } }),
    entry("meta", "a2", { type: "title_change" }),
    entry("c2", "meta", {
      type: "compaction",
      summary: "压缩2",
      firstKeptEntryId: "a2",
    }),
    entry("a3", "c2", { message: { role: "assistant", content: "回答3" } }),
    entry("other", "a1", { message: { role: "user", content: "其他分支" } }),
  ];
  expect(
    sessionHistoryMessages({ entries, leafId: "a3" }).map(
      (m) => m.content ?? m.summary,
    ),
  ).toEqual(["提示1", "回答1", "提示2", "压缩1", "回答2", "压缩2", "回答3"]);
  expect(
    sessionHistoryMessages({ entries, leafId: "a1" }).map((m) => m.content),
  ).toEqual(["提示1", "回答1"]);
  expect(sessionHistoryMessages({ entries, leafId: null })).toEqual([]);
});

it("自定义消息保留显示属性、来源与正文，忽略扩展状态记录", () => {
  const details = { from: "agent-a" };
  const entries = [
    entry("state", null, { type: "custom", data: "内部状态" }),
    entry("notice", "state", {
      type: "custom_message",
      customType: "irc:incoming",
      display: true,
      content: "来信",
      details,
      attribution: "agent",
    }),
    entry("summary", "notice", {
      type: "branch_summary",
      summary: "分支说明",
      fromId: "original",
    }),
  ];
  const messages = sessionHistoryMessages({ entries, leafId: "summary" });
  expect(messages).toHaveLength(2);
  expect(messages[0]).toMatchObject({
    role: "custom",
    customType: "irc:incoming",
    display: true,
    details,
    content: "来信",
    attribution: "agent",
  });
  expect(messages[1]).toMatchObject({
    role: "branchSummary",
    fromId: "original",
    summary: "分支说明",
  });
});

it("计划状态仅作为当前分支显示元数据恢复，保留原生时间及顺序", () => {
  const status = { version: 1, operationId: "refine-1", kind: "refined", choice: "refine", planPath: "local://PLAN.md", document: "# 第一版" };
  const entries = [
    entry("u", null, { message: { role: "user", content: "先做计划" } }),
    entry("status", "u", { type: "custom", customType: "ompgui-plan-status", data: status }),
    entry("internal", "status", { type: "custom", customType: "ompgui-tree-pruned", data: { hidden: true } }),
    entry("reply", "internal", { message: { role: "user", content: "补充边界" } }),
    entry("other-status", "u", { type: "custom", customType: "ompgui-plan-status", data: { ...status, operationId: "other" } }),
  ];
  const messages = sessionHistoryMessages({ entries, leafId: "reply" });
  expect(messages.map((message) => message.role)).toEqual(["user", "custom", "user"]);
  expect(messages[1]).toEqual({ role: "custom", customType: "ompgui-plan-status", details: status, display: true, timestamp: Date.parse("2026-10-13T00:00:00Z") });
  expect(messages[1].content).toBeUndefined();
  expect(sessionHistoryMessages({ entries, leafId: "u" })).toEqual([{ role: "user", content: "先做计划" }]);
});

it("模型、思考级别和模式变更沿父链恢复为显示事件，不丢失前后消息", () => {
  const entries = [
    entry("u", null, { message: { role: "user", content: "继续" } }),
    entry("model", "u", { type: "model_change", model: "openai-codex/gpt-6.1-sol" }),
    entry("thinking", "model", { type: "thinking_level_change", thinkingLevel: "medium" }),
    entry("mode", "thinking", { type: "mode_change", mode: "plan", data: { planFilePath: "local://PLAN.md" } }),
    entry("tier", "mode", { type: "service_tier_change" }),
    entry("title", "tier", { type: "title_change" }),
    entry("a", "title", { message: { role: "assistant", content: "已继续" } }),
    entry("other", "u", { type: "model_change", model: "旁支模型" }),
  ];
  const messages = sessionHistoryMessages({ entries, leafId: "a" });
  expect(messages).toHaveLength(5);
  expect(messages[0].content).toBe("继续");
  expect(messages[4].content).toBe("已继续");
  expect(messages.slice(1, 4)).toEqual([
    expect.objectContaining({ role: "custom", customType: "ompgui-session-event", display: true, details: { event: "model_change", model: "openai-codex/gpt-6.1-sol" } }),
    expect.objectContaining({ role: "custom", customType: "ompgui-session-event", display: true, details: { event: "thinking_level_change", thinkingLevel: "medium" } }),
    expect.objectContaining({ role: "custom", customType: "ompgui-session-event", display: true, details: { event: "mode_change", mode: "plan" } }),
  ]);
  expect(messages[1].timestamp).toBe(Date.parse(entries[1].timestamp));
});

it("工具开始和模型提及保留隐藏证据，无关自定义状态仍被丢弃", () => {
  const started = { toolCallId: "read-1", toolName: "read", startedAt: "2026-10-13T00:00:00Z", args: { path: "README.md" } };
  const mention = { agent: "m1", selector: "openai-codex/gpt-6-luna", name: "GPT-6-Luna" };
  const entries = [
    entry("u", null, { message: { role: "user", content: "读取" } }),
    entry("start", "u", { type: "custom", customType: "tool_execution_start", data: started }),
    entry("mention", "start", { type: "custom", customType: "model_mention", data: mention }),
    entry("internal", "mention", { type: "custom", customType: "session_exit", data: {} }),
  ];
  const messages = sessionHistoryMessages({ entries, leafId: "internal" });
  expect(messages).toHaveLength(3);
  expect(messages.slice(1)).toEqual([
    { role: "custom", customType: "tool_execution_start", display: false, details: started, timestamp: Date.parse(entries[1].timestamp) },
    { role: "custom", customType: "model_mention", display: false, details: mention, timestamp: Date.parse(entries[2].timestamp) },
  ]);
  expect(messages[1].details).toBe(started);
});

it("事件和隐藏证据缺少可选字段时仍可转换", () => {
  const entries = [
    entry("model", null, { type: "model_change" }),
    entry("thinking", "model", { type: "thinking_level_change" }),
    entry("mode", "thinking", { type: "mode_change" }),
    entry("start", "mode", { type: "custom", customType: "tool_execution_start" }),
    entry("mention", "start", { type: "custom", customType: "model_mention" }),
  ];
  const messages = sessionHistoryMessages({ entries, leafId: "mention" });
  expect(messages).toHaveLength(5);
  expect(messages.slice(0, 3).map((message) => message.details)).toEqual([
    { event: "model_change" },
    { event: "thinking_level_change" },
    { event: "mode_change" },
  ]);
  expect(messages.slice(3).every((message) => message.display === false && message.details === undefined)).toBe(true);
});

it("缺失或循环父链明确报错，不静默显示不完整历史", () => {
  expect(() => activeBranchEntries({ entries: [], leafId: "missing" })).toThrow(
    "缺少节点",
  );
  expect(() =>
    activeBranchEntries({
      entries: [entry("loop", "loop", {})],
      leafId: "loop",
    }),
  ).toThrow("循环");
});
