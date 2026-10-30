import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  nativeTreeRows,
  resolveTreeSelection,
  treeIndex,
  type TreeFilter,
} from "./native-tree-data";
import { nativeTreeKey, type TreeKeyAction } from "./native-tree-keys";
import {
  treeActions,
  useNativeTreeOperation,
  type TreeActionState,
} from "./native-tree-actions";
import type {
  NativeTreeScreenProps,
  TreeLabelChange,
  TreeDeletion,
} from "./native-tree-types";

const TREE_ROW_HEIGHT = 34;
const MIN_PAGE_ROWS = 1;

/** 保存树选择器的独立状态；写操作由调用方注入。[in] props：原生树和操作。返回值：视图状态。 */
export function useNativeTree(props: NativeTreeScreenProps) {
  const [filter, setFilter] = useState<TreeFilter>(
    props.initialFilter ?? "default",
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(props.leafId);
  const [labelTarget, setLabelTarget] = useState<TreeLabelChange | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TreeDeletion | null>(null);
  const operation = useNativeTreeOperation();
  const screen = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const index = useMemo(
    () => treeIndex(props.tree, props.leafId),
    [props.tree, props.leafId],
  );
  const rows = useMemo(
    () =>
      nativeTreeRows({ tree: props.tree, leafId: props.leafId, filter, query }),
    [props.tree, props.leafId, filter, query],
  );
  const selectedId = resolveTreeSelection({
    rows,
    nodes: index.nodes,
    selected,
  });
  const state = {
    filter,
    setFilter,
    query,
    setQuery,
    selectedId,
    setSelected,
    labelTarget,
    setLabelTarget,
    ...operation,
    screen,
    list,
    search,
    rows,
    total: index.nodes.size,
  };
  const actions = treeActions(props, state);
  useTreeFocus(state);
  useTreeKeyboard(state, actions, props.suspended || Boolean(deleteTarget));
  function requestDelete(entryId = selectedId) {
    if (operation.isPending() || !props.onDelete || !entryId) return;
    const node = index.nodes.get(entryId);
    if (!node) return;
    const pending = [node];
    const entryIds: string[] = [];
    while (pending.length) {
      const current = pending.pop()!;
      entryIds.push(current.entry.id);
      pending.push(...current.children);
    }
    setDeleteTarget({ entryId, entryIds });
  }
  async function confirmDelete() {
    if (!deleteTarget || !props.onDelete) return;
    if (await operation.run("delete", () => props.onDelete!(deleteTarget))) {
      setDeleteTarget(null);
      setSelected(null);
      search.current?.focus();
    }
  }
  return {
    ...state,
    ...actions,
    deleteTarget,
    requestDelete,
    confirmDelete,
    canDelete: Boolean(props.onDelete),
    cancelDelete: () => {
      if (!operation.isPending()) {
        setDeleteTarget(null);
        search.current?.focus();
      }
    },
  };
}

interface TreeState extends TreeActionState {
  filter: TreeFilter;
  setFilter: (value: TreeFilter) => void;
  query: string;
  setQuery: (value: string) => void;
  selectedId: string | null;
  setSelected: (value: string | null) => void;
  labelTarget: TreeLabelChange | null;
  setLabelTarget: (value: TreeLabelChange | null) => void;
  screen: RefObject<HTMLDivElement | null>;
  list: RefObject<HTMLDivElement | null>;
  search: RefObject<HTMLInputElement | null>;
  rows: ReturnType<typeof nativeTreeRows>;
  total: number;
}

/** 保持查询焦点和键盘选中行可见。[in] state：树视图。返回值：无。 */
function useTreeFocus(state: TreeState) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    state.search.current?.focus();
    return () => previous?.focus();
  }, [state.search]);
  useEffect(() => {
    const selected = state.list.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    const viewport = state.list.current;
    if (!selected || !viewport) return;
    const bottom = selected.offsetTop + selected.offsetHeight;
    if (selected.offsetTop < viewport.scrollTop)
      viewport.scrollTop = selected.offsetTop;
    else if (bottom > viewport.scrollTop + viewport.clientHeight)
      viewport.scrollTop = bottom - viewport.clientHeight;
  }, [state.selectedId, state.rows, state.list]);
}

/** 执行已解码的键盘动作。[in] action：动作；[in] context：状态与操作。返回值：无。 */
function applyTreeKey(
  action: NonNullable<TreeKeyAction>,
  context: { state: TreeState; actions: ReturnType<typeof treeActions> },
) {
  const { state, actions } = context;
  if (action.type === "select") state.setSelected(action.id);
  else if (action.type === "filter") state.setFilter(action.filter);
  else if (action.type === "confirm") void actions.navigate(action.summarize);
  else if (action.type === "escape") actions.escape();
  else if (action.type === "close") actions.close();
  else if (action.type === "label") actions.editLabel();
}

/** Tab 保持全屏选择器内的焦点。[in] event：按键；[in] state：视图。返回值：无。 */
function treeTab(event: KeyboardEvent, state: TreeState) {
  const items = Array.from(
    state.screen.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
    ) ?? [],
  );
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

/** 捕获原生树快捷键，普通字符交给搜索框。[in] state：视图；[in] actions：操作。返回值：无。 */
function useTreeKeyboard(
  state: TreeState,
  actions: ReturnType<typeof treeActions>,
  suspended?: boolean,
) {
  useEffect(() => {
    if (suspended) return;
    function onKey(event: KeyboardEvent) {
      treeKeydown(event, state, actions);
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [state, actions, suspended]);
}

/** 对标签、页面导航、搜索分别路由按键。[in] event：输入；[in] state：状态；[in] actions：操作。返回值：无。 */
function treeKeydown(
  event: KeyboardEvent,
  state: TreeState,
  actions: ReturnType<typeof treeActions>,
) {
  if (event.isComposing) return;
  // 图形菜单独占键盘，避免方向键、Esc 和输入穿透到会话树。
  if (event.target instanceof Element && event.target.closest(".tree-graph-menu"))
    return;
  if (state.isPending()) return pendingTreeKey(event, state, actions);
  if (buttonOwnsActivation(event)) return;
  if (state.labelTarget && event.key !== "Escape") return;
  event.stopPropagation();
  if (event.key === "Tab") return treeTab(event, state);
  if (state.labelTarget) {
    event.preventDefault();
    state.setLabelTarget(null);
    state.search.current?.focus();
    return;
  }
  const pageSize = treePageSize(state.list.current);
  const action = nativeTreeKey({
    key: event,
    rows: state.rows,
    selected: state.selectedId,
    filter: state.filter,
    pageSize,
    query: state.query,
  });
  if (!action) return typeTreeQuery(event, state);
  event.preventDefault();
  if (!state.pending) applyTreeKey(action, { state, actions });
}

/** 根据可见高度计算原生翻页行数。[in] viewport：列表容器。返回值：每页行数。 */
function treePageSize(viewport: HTMLDivElement | null) {
  return Math.max(
    MIN_PAGE_ROWS,
    Math.floor((viewport?.clientHeight ?? TREE_ROW_HEIGHT) / TREE_ROW_HEIGHT),
  );
}

/** 操作期间只允许保持焦点或请求取消导航，标签写入不能被关闭。[in] event：按键；[in] state：状态；[in] actions：动作。返回值：无。 */
function pendingTreeKey(
  event: KeyboardEvent,
  state: TreeState,
  actions: ReturnType<typeof treeActions>,
) {
  if (buttonOwnsActivation(event)) return;
  event.stopPropagation();
  if (event.key === "Tab") return treeTab(event, state);
  event.preventDefault();
  if (
    event.key === "Escape" ||
    (event.ctrlKey && event.key.toLowerCase() === "c")
  )
    actions.close();
}

/** 原生按钮保留自身 Enter/空格激活语义。[in] event：按键。返回值：是否由按钮处理。 */
function buttonOwnsActivation(event: KeyboardEvent): boolean {
  return (
    (event.key === "Enter" || event.key === " ") &&
    event.target instanceof Element &&
    Boolean(event.target.closest("button"))
  );
}

/** 非搜索框获得焦点时仍可直接输入查询。[in] event：按键；[in] state：状态。返回值：无。 */
function typeTreeQuery(event: KeyboardEvent, state: TreeState) {
  if (
    event.target === state.search.current ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  )
    return;
  if (event.key.length !== 1 && event.key !== "Backspace") return;
  event.preventDefault();
  state.setQuery(
    event.key === "Backspace"
      ? state.query.slice(0, -1)
      : state.query + event.key,
  );
  state.search.current?.focus();
}
