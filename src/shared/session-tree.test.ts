import { expect, it } from "vitest";
import { sessionTree } from "./session-tree";
import type { SessionEntry } from "./protocol";

function entry(id: string, parentId: string | null): SessionEntry {
  return {
    id,
    parentId,
    type: "message",
    timestamp: "2026-10-15T00:00:00Z",
    message: { role: "user", content: id },
  };
}

it("一万层长会话由扁平记录迭代组装，不截断历史", () => {
  const entries = Array.from({ length: 10000 }, (_, index) =>
    entry(String(index), index ? String(index - 1) : null),
  );
  let nodes = sessionTree(structuredClone(entries));
  for (let index = 0; index < entries.length; index++) {
    expect(nodes).toHaveLength(1);
    expect(nodes[0].entry.id).toBe(String(index));
    nodes = nodes[0].children;
  }
  expect(nodes).toHaveLength(0);
});

it("保留孤立根、分支顺序，并应用及清除最新标签", () => {
  const entries = [
    entry("root", null),
    entry("b", "root"),
    entry("a", "root"),
    entry("orphan", "missing"),
  ];
  entries[1].timestamp = "2026-10-15T00:00:02Z";
  const label = {
    ...entry("label", "b"),
    type: "label",
    targetId: "root",
    label: "检查点",
  };
  const tree = sessionTree([...entries, label]);
  expect(tree.map((node) => node.entry.id)).toEqual(["root", "orphan"]);
  expect(tree[0].children.map((node) => node.entry.id)).toEqual(["a", "b"]);
  expect(tree[0].label).toBe("检查点");
  expect(
    sessionTree([
      ...entries,
      label,
      { ...label, id: "clear", label: undefined },
    ])[0].label,
  ).toBeUndefined();
});
