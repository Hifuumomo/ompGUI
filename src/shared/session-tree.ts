import type { SessionEntry, TreeNode } from "./protocol";

/** 从原生扁平历史组装显示树，避免把深层 children 跨 Electron IPC/contextBridge 传输。 */
export function sessionTree(entries: readonly SessionEntry[]): TreeNode[] {
  const labels = new Map<string, string>();
  const nodes = new Map<string, TreeNode>();
  for (const entry of entries) {
    if (entry.type === "label" && typeof entry.targetId === "string") {
      if (entry.label) labels.set(entry.targetId, entry.label);
      else labels.delete(entry.targetId);
    }
    nodes.set(entry.id, { entry, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    node.label = labels.get(node.entry.id);
    const parent = nodes.get(node.entry.parentId ?? "");
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  for (const node of nodes.values())
    node.children.sort((a, b) =>
      Date.parse(a.entry.timestamp) - Date.parse(b.entry.timestamp),
    );
  return roots;
}
