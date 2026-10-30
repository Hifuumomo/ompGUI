import { expect, it } from "vitest";
import type { TreeNode } from "../../shared/protocol";
import { layoutTreeGraph } from "./tree-graph-layout";

const node = (id: string, children: TreeNode[] = []): TreeNode => ({
  entry: {
    id,
    type: "message",
    parentId: null,
    timestamp: "",
    message: { role: "user", content: id },
  },
  children,
});

it("分支布局保留顺序、父子连线和单链对齐，不修改原树", () => {
  const roots = [node("root", [node("left", [node("end")]), node("right")])];
  const before = JSON.stringify(roots);
  const { nodes } = layoutTreeGraph(roots);
  const byId = new Map(nodes.map((item) => [item.entry.id, item]));
  expect(byId.get("left")!.x).toBeLessThan(byId.get("right")!.x);
  expect(byId.get("root")!.x).toBe(
    (byId.get("left")!.x + byId.get("right")!.x) / 2,
  );
  expect(byId.get("end")!.x).toBe(byId.get("left")!.x);
  expect(byId.get("end")!.parentId).toBe("left");
  expect(byId.get("end")!.y).toBeGreaterThan(byId.get("left")!.y);
  expect(JSON.stringify(roots)).toBe(before);
});

it("空树和多个根节点都有有效画布尺寸", () => {
  expect(layoutTreeGraph([]).nodes).toEqual([]);
  const layout = layoutTreeGraph([node("a"), node("b")]);
  expect(layout.nodes[0].x).toBeLessThan(layout.nodes[1].x);
  expect(layout.width).toBeGreaterThan(layout.nodes[1].x);
});
