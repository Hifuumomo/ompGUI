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
    entry("meta", "a2", { type: "model_change" }),
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
