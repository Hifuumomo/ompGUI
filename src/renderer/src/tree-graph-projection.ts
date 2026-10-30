import type { TreeNode } from "../../shared/protocol";
import type { NativeTreeRow } from "./native-tree-data";

interface ProjectionOptions {
  readonly tree: readonly TreeNode[];
  readonly rows: readonly NativeTreeRow[];
  readonly leafId: string | null;
}

/** 对每个原生节点记录最近可见祖先，保留隐藏节点两侧的分支关系。[in] options：完整树及可见 id。返回值：祖先索引。 */
function visibleParents(options: {
  tree: readonly TreeNode[];
  visible: ReadonlySet<string>;
}) {
  const parents = new Map<string, string | null>();
  const pending = options.tree.map((node) => ({
    node,
    parent: null as string | null,
  }));
  while (pending.length) {
    const { node, parent } = pending.pop()!;
    const id = node.entry.id;
    parents.set(id, parent);
    const nextParent = options.visible.has(id) ? id : parent;
    pending.push(
      ...node.children.map((child) => ({ node: child, parent: nextParent })),
    );
  }
  return parents;
}

/** 按原生显示顺序分组，不改动原始 entry.parentId。[in] rows：可见行；[in] parents：投影父节点。返回值：子节点 id。 */
function projectedChildren(
  rows: readonly NativeTreeRow[],
  parents: ReadonlyMap<string, string | null>,
) {
  const children = new Map<string | null, string[]>();
  for (const row of rows) {
    const id = row.node.entry.id;
    const parent = parents.get(id)!;
    const siblings = children.get(parent) ?? [];
    siblings.push(id);
    children.set(parent, siblings);
  }
  return children;
}

/** 将原生筛选结果投影成无悬空连线的图形树。[in] options：原生树、显示行及真实叶。返回值：投影及当前分支定位点。 */
export function projectTreeGraph(options: ProjectionOptions) {
  const visible = new Set(options.rows.map((row) => row.node.entry.id));
  const parents = visibleParents({ tree: options.tree, visible });
  const children = projectedChildren(options.rows, parents);
  const projected = new Map<string, TreeNode>();
  for (const { node } of [...options.rows].reverse()) {
    projected.set(node.entry.id, {
      ...node,
      children: (children.get(node.entry.id) ?? []).map((id) =>
        projected.get(id)!,
      ),
    });
  }
  const leafId = options.leafId;
  const focusId =
    leafId && visible.has(leafId) ? leafId : (parents.get(leafId!) ?? null);
  return {
    tree: (children.get(null) ?? []).map((id) => projected.get(id)!),
    activePath: new Set(
      options.rows.filter((row) => row.active).map((row) => row.node.entry.id),
    ),
    leafId,
    focusId,
  };
}
