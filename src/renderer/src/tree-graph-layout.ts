import type { TreeNode, SessionEntry } from "../../shared/protocol";

export const GRAPH_NODE_WIDTH = 240;
export const GRAPH_NODE_HEIGHT = 88;
export const GRAPH_COLUMN_GAP = 40;
export const GRAPH_ROW_GAP = 64;
export const GRAPH_PADDING = 48;

export interface GraphNode {
  readonly entry: SessionEntry;
  readonly label?: string;
  readonly parentId: string | null;
  readonly x: number;
  readonly y: number;
}
export interface TreeGraphLayout {
  readonly nodes: readonly GraphNode[];
  readonly width: number;
  readonly height: number;
}
interface TreeRecord {
  readonly node: TreeNode;
  readonly depth: number;
  readonly parentId: string | null;
}

/** 后序分配叶子列，再把父节点放在子节点中心；单链保持竖直。 */
export function layoutTreeGraph(roots: readonly TreeNode[]): TreeGraphLayout {
  const records = graphRecords(roots);
  const { positions, column } = graphColumns(records);
  const nodes = records.map(({ node, depth, parentId }) => ({
    entry: node.entry,
    label: node.label ?? node.entry.label,
    parentId,
    x:
      GRAPH_PADDING +
      (column - 1 - positions.get(node.entry.id)!) *
        (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP),
    y: GRAPH_PADDING + depth * (GRAPH_NODE_HEIGHT + GRAPH_ROW_GAP),
  }));
  return {
    nodes,
    width:
      GRAPH_PADDING * 2 +
      Math.max(1, column) * (GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP) -
      GRAPH_COLUMN_GAP,
    height:
      GRAPH_PADDING +
      nodes.reduce(
        (height, node) => Math.max(height, node.y + GRAPH_NODE_HEIGHT),
        GRAPH_PADDING,
      ),
  };
}

/** 记录深度优先顺序而不递归长会话。[in] roots：树根。返回值：记录。 */
function graphRecords(roots: readonly TreeNode[]): TreeRecord[] {
  const records: TreeRecord[] = [];
  const pending = roots
    .map((node) => ({ node, depth: 0, parentId: null as string | null }))
    .reverse();
  while (pending.length) {
    const record = pending.pop()!;
    records.push(record);
    pending.push(
      ...record.node.children
        .map((node) => ({
          node,
          depth: record.depth + 1,
          parentId: record.node.entry.id,
        }))
        .reverse(),
    );
  }
  return records;
}

/** 先分配叶列，再居中放置其祖先。[in] records：树记录。返回值：列位置。 */
function graphColumns(records: readonly TreeRecord[]) {
  const positions = new Map<string, number>();
  let column = 0;
  for (const { node } of [...records].reverse()) {
    const children = node.children.map((child) =>
      positions.get(child.entry.id)!,
    );
    positions.set(
      node.entry.id,
      children.length ? (children[0] + children.at(-1)!) / 2 : column++,
    );
  }
  return { positions, column };
}

export function graphLink(parent: GraphNode, child: GraphNode): string {
  const startX = parent.x + GRAPH_NODE_WIDTH / 2;
  const startY = parent.y + GRAPH_NODE_HEIGHT;
  const endX = child.x + GRAPH_NODE_WIDTH / 2;
  const middleY = startY + GRAPH_ROW_GAP / 2;
  return `M ${startX} ${startY} V ${middleY} H ${endX} V ${child.y}`;
}
