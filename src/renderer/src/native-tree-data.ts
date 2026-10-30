import type { SessionEntry, TreeNode } from "../../shared/protocol";
import {
  treeEntryText,
  treeText,
  type TreeToolCall,
} from "./native-tree-display";

// 原生契约：oh-my-pi v18.8.6/packages/tui/src/overlays/tree-selector.ts。
export const TREE_FILTERS = [
  "default",
  "no-tools",
  "user-only",
  "labeled-only",
  "all",
] as const;
export type TreeFilter = (typeof TREE_FILTERS)[number];
export const TREE_FILTER_LABELS: Record<TreeFilter, string> = {
  default: "默认",
  "no-tools": "不含工具",
  "user-only": "仅用户",
  "labeled-only": "有标签",
  all: "全部",
};
const SETTINGS_TYPES = new Set([
  "label",
  "custom",
  "model_change",
  "model_usage",
  "thinking_level_change",
  "service_tier_change",
  "title_change",
  "credential_pin",
  "session_init",
  "ttsr_injection",
  "mode_change",
  "reset_boundary",
]);
export interface NativeTreeRow {
  readonly node: TreeNode;
  readonly depth: number;
  readonly prefix: string;
  readonly active: boolean;
  readonly text: string;
}
/** 判定用户或用户发起的自定义请求。[in] entry：条目。返回值：是否用户请求。 */
export function treeUserRequest(entry: SessionEntry): boolean {
  if (entry.message?.role === "user") return true;
  const custom = entry.type === "custom_message" ? entry : entry.message;
  return (
    custom?.attribution === "user" &&
    ["skill-prompt", "collab-prompt"].includes(String(custom.customType))
  );
}

/** 按原生规则隐藏纯工具调用助手项和设置项。[in] options：筛选上下文。返回值：可见性。 */
export function treeNodeVisible(options: {
  node: TreeNode;
  leafId: string | null;
  filter: TreeFilter;
}): boolean {
  const { node, leafId, filter } = options;
  const { entry } = node;
  const message = entry.message;
  if (entry.id !== leafId && hiddenAssistant(entry)) return false;
  if (filter === "all") return true;
  if (filter === "user-only") return treeUserRequest(entry);
  if (filter === "labeled-only") return node.label !== undefined;
  if (SETTINGS_TYPES.has(entry.type)) return false;
  return filter !== "no-tools" || message?.role !== "toolResult";
}

/** 仅含工具调用的助手项折入工具结果，错误项仍可见。[in] entry：条目。返回值：是否隐藏。 */
function hiddenAssistant(entry: SessionEntry): boolean {
  const message = entry.message;
  if (message?.role !== "assistant") return false;
  const stopped =
    message.stopReason && !["stop", "toolUse"].includes(message.stopReason);
  return !treeText(message.content) && !stopped;
}

/** 多词模糊搜索，每个词的字符须依次出现。[in] text：文本；[in] query：查询。返回值：是否命中。 */
export function treeFuzzyMatch(text: string, query: string): boolean {
  const source = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => {
      let position = 0;
      for (const character of word) {
        const found = source.indexOf(character, position);
        if (found < 0) return false;
        position = found + 1;
      }
      return true;
    });
}

/** 收集原生节点及当前分支祖先。[in] tree：树；[in] leafId：当前末端。返回值：索引。 */
export function treeIndex(tree: readonly TreeNode[], leafId: string | null) {
  const nodes = new Map<string, TreeNode>();
  const tools = new Map<string, TreeToolCall>();
  const pending = [...tree];
  while (pending.length) {
    const node = pending.pop()!;
    nodes.set(node.entry.id, node);
    for (const call of treeToolCalls(node.entry))
      tools.set(call.id!, { name: call.name!, arguments: call.arguments });
    pending.push(...node.children);
  }
  const active = new Set<string>();
  let current = leafId;
  while (current) {
    active.add(current);
    current = nodes.get(current)?.entry.parentId ?? null;
  }
  return { nodes, active, tools };
}

/** 读取助手调用用于工具结果行的参数标题。[in] entry：条目。返回值：工具调用。 */
function treeToolCalls(entry: SessionEntry) {
  const content = entry.message?.content;
  return Array.isArray(content)
    ? content.filter(
        (block) => block.type === "toolCall" && block.id && block.name,
      )
    : [];
}

interface WalkContext {
  readonly active: ReadonlySet<string>;
  readonly filter: (node: TreeNode) => boolean;
  readonly depth: number;
  readonly gutter: string;
  readonly root: boolean;
  readonly tools: ReadonlyMap<string, TreeToolCall>;
}

/** 仅在真实分岔增加缩进，当前分支排在首位。[in] nodes：兄弟；[in] context：遍历参数。返回值：行。 */
function walkTree(
  nodes: readonly TreeNode[],
  context: WalkContext,
): NativeTreeRow[] {
  const pending = pendingTreeRows(nodes, context);
  const rows: NativeTreeRow[] = [];
  while (pending.length) {
    const { node, context: current, branch, last } = pending.pop()!;
    const prefix = current.gutter + (branch ? (last ? "└─ " : "├─ ") : "");
    if (current.filter(node))
      rows.push({
        node,
        depth: current.depth,
        prefix,
        active: current.active.has(node.entry.id),
        text: treeEntryText(node.entry, current.tools),
      });
    pending.push(
      ...pendingTreeRows(node.children, {
        ...current,
        root: false,
        gutter: current.gutter + (branch ? (last ? "   " : "│  ") : ""),
        depth: current.depth + (node.children.length > 1 ? 1 : 0),
      }),
    );
  }
  return rows;
}

/** 反序入栈使超长线性会话不依赖递归调用栈。[in] nodes：兄弟；[in] context：上下文。返回值：遍历工作项。 */
function pendingTreeRows(nodes: readonly TreeNode[], context: WalkContext) {
  const ordered = [...nodes].sort(
    (a, b) =>
      Number(context.active.has(b.entry.id)) -
      Number(context.active.has(a.entry.id)),
  );
  return ordered
    .map((node, index) => ({
      node,
      context,
      branch: !context.root && nodes.length > 1,
      last: index === ordered.length - 1,
    }))
    .reverse();
}

/** 构造筛选后仍保留分支结构的树行。[in] options：原生树与筛选。返回值：显示行。 */
export function nativeTreeRows(options: {
  tree: readonly TreeNode[];
  leafId: string | null;
  filter: TreeFilter;
  query: string;
}): NativeTreeRow[] {
  const { active, tools } = treeIndex(options.tree, options.leafId);
  return walkTree(options.tree, {
    active,
    tools,
    depth: 0,
    gutter: "",
    root: true,
    filter: (node) =>
      treeNodeVisible({
        node,
        leafId: options.leafId,
        filter: options.filter,
      }) &&
      treeFuzzyMatch(
        `${node.label ?? ""} ${treeEntryText(node.entry, tools)} ${treeText(node.entry.message?.content)}`,
        options.query,
      ),
  });
}

/** 保留选中项；被隐藏时选最近可见祖先。[in] options：可见行和完整索引。返回值：选中 id。 */
export function resolveTreeSelection(options: {
  rows: readonly NativeTreeRow[];
  nodes: ReadonlyMap<string, TreeNode>;
  selected: string | null;
}): string | null {
  const visible = new Set(options.rows.map((row) => row.node.entry.id));
  let selected = options.selected;
  while (selected && !visible.has(selected))
    selected = options.nodes.get(selected)?.entry.parentId ?? null;
  return selected ?? options.rows.at(-1)?.node.entry.id ?? null;
}
