import { expect, it } from "vitest";
import type { TreeNode } from "../../shared/protocol";
import { nativeTreeRows } from "./native-tree-data";
import { layoutTreeGraph } from "./tree-graph-layout";
import { projectTreeGraph } from "./tree-graph-projection";

/** 创建树节点以测试多层隐藏节点。[in] options：节点属性。返回值：树节点。 */
function node(options: {
  id: string;
  parentId: string | null;
  type?: string;
  role?: string;
  children?: TreeNode[];
}): TreeNode {
  return {
    entry: {
      id: options.id,
      parentId: options.parentId,
      type: options.type ?? "message",
      timestamp: "",
      message: { role: options.role ?? "user", content: options.id },
    },
    children: options.children ?? [],
  };
}

const leaf = node({ id: "leaf", parentId: "second", role: "assistant" });
const second = node({ id: "second", parentId: "hidden", children: [leaf] });
const hidden = node({
  id: "hidden",
  parentId: "root",
  type: "model_change",
  children: [second],
});
const side = node({ id: "zzside", parentId: "root", role: "assistant" });
const tree = [node({ id: "root", parentId: null, children: [side, hidden] })];

it("过滤隐藏节点后连接最近可见祖先并保留原始条目和活动分支顺序", () => {
  const rows = nativeTreeRows({
    tree,
    leafId: "leaf",
    filter: "default",
    query: "",
  });
  const graph = projectTreeGraph({ tree, leafId: "leaf", rows });
  const layout = layoutTreeGraph(graph.tree);
  expect(layout.nodes.map((item) => [item.entry.id, item.parentId])).toEqual([
    ["root", null],
    ["second", "root"],
    ["leaf", "second"],
    ["zzside", "root"],
  ]);
  expect(graph.tree[0].children[0].entry).toBe(second.entry);
  expect(second.entry.parentId).toBe("hidden");
  expect(tree[0].children).toEqual([side, hidden]);
  expect([...graph.activePath]).toEqual(["root", "second", "leaf"]);
  expect(graph.leafId).toBe("leaf");
  expect(graph.focusId).toBe("leaf");
});

it("叶被筛选隐藏时定位最近可见祖先且不伪造当前叶", () => {
  const rows = nativeTreeRows({
    tree,
    leafId: "leaf",
    filter: "user-only",
    query: "second",
  });
  const graph = projectTreeGraph({ tree, leafId: "leaf", rows });
  expect(graph.tree.map((item) => item.entry.id)).toEqual(["second"]);
  expect(graph.tree[0].children).toEqual([]);
  expect(graph.focusId).toBe("second");
  expect(graph.leafId).toBe("leaf");
  expect([...graph.activePath]).toEqual(["second"]);
});

it("只显示其他分支或无结果时无虚假当前路径和悬空连接", () => {
  const rows = nativeTreeRows({
    tree,
    leafId: "leaf",
    filter: "all",
    query: "zzside",
  });
  const graph = projectTreeGraph({ tree, leafId: "leaf", rows });
  expect(layoutTreeGraph(graph.tree).nodes[0].parentId).toBeNull();
  expect(graph.focusId).toBeNull();
  expect(graph.activePath.size).toBe(0);
  const empty = projectTreeGraph({ tree, leafId: "leaf", rows: [] });
  expect(empty.tree).toEqual([]);
  expect(empty.focusId).toBeNull();
});
