import { expect, it } from "vitest";
import { pruneTreeEntries } from "./tree-deletion.mjs";

const entry = (id, parentId) => ({ id, parentId, type: "message" });
const entries = [
  entry("u", null),
  entry("a", "u"),
  entry("b", "a"),
  entry("c", "b"),
  entry("s", "a"),
];

it("删除完整旁支保留兄弟和当前末端", () => {
  const result = pruneTreeEntries(entries, "s", {
    entryId: "b",
    entryIds: ["b", "c"],
  });
  expect(result.entries.map((e) => e.id)).toEqual(["u", "a", "s"]);
  expect(result.leafId).toBe("s");
  expect(result.count).toBe(2);
});
it("当前路径被删除时选保留父节点；删除根后允许空上下文", () => {
  expect(
    pruneTreeEntries(entries, "c", { entryId: "b", entryIds: ["b", "c"] })
      .leafId,
  ).toBe("a");
  const result = pruneTreeEntries(entries, "s", {
    entryId: "u",
    entryIds: entries.map((e) => e.id),
  });
  expect(result.entries).toEqual([]);
  expect(result.leafId).toBeNull();
});
it("拒绝确认后发生变化的子树", () => {
  expect(() =>
    pruneTreeEntries(entries, "s", { entryId: "b", entryIds: ["b"] }),
  ).toThrow("已变化");
  expect(() =>
    pruneTreeEntries(entries, "s", { entryId: "b", entryIds: ["b", "b"] }),
  ).toThrow("已变化");
});
it("清除旁支中指向删除目标的标签，并接回其保留子项", () => {
  const history = [
    ...entries,
    { ...entry("label", "s"), type: "label", targetId: "b", label: "旧标签" },
    entry("after", "label"),
  ];
  const result = pruneTreeEntries(history, "after", {
    entryId: "b",
    entryIds: ["b", "c"],
  });
  expect(result.entries.map((e) => e.id)).toEqual(["u", "a", "s", "after"]);
  expect(result.entries.at(-1).parentId).toBe("s");
  expect(history.at(-1).parentId).toBe("label");
});
