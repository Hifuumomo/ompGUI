import {
  TREE_FILTERS,
  type NativeTreeRow,
  type TreeFilter,
} from "./native-tree-data";

export interface TreeKey {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}
export type TreeKeyAction =
  | { type: "select"; id: string | null }
  | { type: "filter"; filter: TreeFilter }
  | { type: "confirm"; summarize: boolean }
  | { type: "escape" | "close" | "label" }
  | null;

/** 解码原生筛选快捷键。[in] key：按键；[in] filter：当前筛选。返回值：目标筛选。 */
function filterKey(key: TreeKey, filter: TreeFilter): TreeKeyAction {
  const letter = key.key.toLowerCase();
  if (key.ctrlKey && letter === "o") {
    const direction = key.shiftKey ? -1 : 1;
    const index =
      (TREE_FILTERS.indexOf(filter) + direction + TREE_FILTERS.length) %
      TREE_FILTERS.length;
    return { type: "filter", filter: TREE_FILTERS[index] };
  }
  const shortcuts: Record<string, TreeFilter> = {
    d: "default",
    t: "no-tools",
    u: "user-only",
    l: "labeled-only",
    a: "all",
  };
  return key.altKey && shortcuts[letter]
    ? { type: "filter", filter: shortcuts[letter] }
    : null;
}

/** 在可见行中移动；上下循环，翻页停在边界。[in] options：移动参数。返回值：目标 id。 */
export function moveTreeSelection(options: {
  rows: readonly NativeTreeRow[];
  selected: string | null;
  delta: number;
  wrap?: boolean;
  turns?: boolean;
}): string | null {
  const { rows, selected, delta } = options;
  if (!rows.length) return null;
  const index = rows.findIndex((row) => row.node.entry.id === selected);
  if (options.turns) {
    const candidates = rows
      .map((row, position) => ({ row, position }))
      .filter(({ row }) =>
        ["user", "assistant"].includes(row.node.entry.message?.role ?? ""),
      );
    const target =
      delta < 0
        ? candidates.findLast(({ position }) => position < index)
        : candidates.find(({ position }) => position > index);
    return target?.row.node.entry.id ?? selected;
  }
  const next = options.wrap
    ? (index + delta + rows.length) % rows.length
    : Math.max(0, Math.min(rows.length - 1, index + delta));
  return rows[next].node.entry.id;
}

/** 将树导航按键转为无副作用动作。[in] options：按键及可见树状态。返回值：动作。 */
interface TreeKeyOptions {
  key: TreeKey;
  rows: readonly NativeTreeRow[];
  selected: string | null;
  filter: TreeFilter;
  pageSize: number;
  query: string;
}

export function nativeTreeKey(options: TreeKeyOptions): TreeKeyAction {
  return (
    filterKey(options.key, options.filter) ??
    controlKey(options) ??
    boundaryKey(options) ??
    movementKey(options)
  );
}

/** 确认、标签和退出快捷键。[in] options：按键和查询。返回值：动作。 */
function controlKey(options: TreeKeyOptions): TreeKeyAction {
  const { key } = options;
  if (key.key === "Escape") return { type: "escape" };
  if (key.ctrlKey && key.key.toLowerCase() === "c") return { type: "close" };
  if (key.key === "Enter") return { type: "confirm", summarize: key.shiftKey };
  if (key.shiftKey && key.key.toLowerCase() === "l" && !options.query)
    return { type: "label" };
  return null;
}

/** Home/End 定位首尾。[in] options：可见行和按键。返回值：选择动作。 */
function boundaryKey(options: TreeKeyOptions): TreeKeyAction {
  const { key, rows } = options;
  if (key.key === "Home")
    return { type: "select", id: rows[0]?.node.entry.id ?? null };
  if (key.key === "End")
    return { type: "select", id: rows.at(-1)?.node.entry.id ?? null };
  return null;
}

/** 翻页和逐轮导航。[in] options：可见行和按键。返回值：选择动作。 */
function movementKey(options: TreeKeyOptions): TreeKeyAction {
  const { key, rows } = options;
  const vertical = key.key === "ArrowUp" || key.key === "ArrowDown";
  const page = ["ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(
    key.key,
  );
  if (!vertical && !page) return null;
  const direction = ["ArrowUp", "ArrowLeft", "PageUp"].includes(key.key)
    ? -1
    : 1;
  return {
    type: "select",
    id: moveTreeSelection({
      rows,
      selected: options.selected,
      delta: direction * (page ? options.pageSize : 1),
      wrap: vertical && !key.altKey,
      turns: vertical && key.altKey,
    }),
  };
}
