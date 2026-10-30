import type { SessionEntry } from "../../shared/protocol";
import { activeBranchEntries } from "../../shared/session-history";
import {
  matchesRewindFilter,
  rewindTargets,
  type RewindTarget,
} from "./rewind-targets";

export interface RewindState {
  readonly entries: readonly SessionEntry[];
  readonly mainPath: readonly SessionEntry[];
  readonly mainTargets: readonly RewindTarget[];
  readonly selected: number;
  readonly variantIndex: number;
  readonly siblingSelected: number;
  readonly filterMode: boolean;
  readonly query: string;
}

export interface RewindColumn {
  readonly rootId: string;
  readonly label: string;
  readonly entries: readonly SessionEntry[];
  readonly targets: readonly RewindTarget[];
}

/** 全量原生路径已经包含早期历史，无需另行加载或截断。 */
export function createRewindState(
  entries: readonly SessionEntry[],
  leafId: string | null,
): RewindState {
  const mainPath = activeBranchEntries({ entries: [...entries], leafId });
  const mainTargets = rewindTargets(mainPath);
  return {
    entries,
    mainPath,
    mainTargets,
    selected: mainTargets.length - 1,
    variantIndex: 0,
    siblingSelected: 0,
    filterMode: false,
    query: "",
  };
}

/** 沿每个节点最后一个子项前进，与原生兄弟分支的最新路径一致。 */
function latestPath(
  children: ReadonlyMap<string | null, SessionEntry>,
  root: SessionEntry,
): readonly SessionEntry[] {
  const result: SessionEntry[] = [];
  const seen = new Set<string>();
  let entry: SessionEntry | undefined = root;
  while (entry) {
    if (seen.has(entry.id)) throw new Error("原生会话历史的子节点存在循环");
    seen.add(entry.id);
    result.push(entry);
    entry = children.get(entry.id);
  }
  return result;
}

function column(entries: readonly SessionEntry[]): RewindColumn {
  const targets = rewindTargets(entries);
  return {
    rootId: entries[0].id,
    entries,
    targets,
    label: targets.find((target) => target.userTurn)?.text || entries[0].id,
  };
}

/** 分岔只取当前选中消息的直接兄弟，保持原生子节点的顺序。 */
export function rewindColumns(state: RewindState): readonly RewindColumn[] {
  const target = state.mainTargets[state.selected];
  if (!target || state.filterMode) return [];
  const anchor = state.entries.find((entry) => entry.id === target.turnId)!;
  const siblings = state.entries.filter(
    (entry) => entry.parentId === anchor.parentId && entry.id !== anchor.id,
  );
  if (!siblings.length) return [];
  const children = new Map<string | null, SessionEntry>();
  for (const entry of state.entries) children.set(entry.parentId, entry);
  const mainStart = state.mainPath.findIndex((entry) => entry.id === anchor.id);
  return [
    column(state.mainPath.slice(mainStart)),
    ...siblings.map((sibling) => column(latestPath(children, sibling))),
  ];
}

/** 当前绘制路径、横向分支列与虚线框目标由同一份状态推导。 */
export function rewindView(state: RewindState) {
  const columns = rewindColumns(state);
  const anchor = state.mainTargets[state.selected];
  const anchorIndex = state.mainPath.findIndex(
    (entry) => entry.id === anchor?.turnId,
  );
  const sharedEntries = columns.length
    ? state.mainPath.slice(0, anchorIndex)
    : [];
  const activeColumn = columns[state.variantIndex];
  const entries =
    state.variantIndex > 0 && activeColumn
      ? [...sharedEntries, ...activeColumn.entries]
      : state.mainPath;
  const selectedTarget =
    state.variantIndex > 0
      ? activeColumn?.targets[state.siblingSelected]
      : anchor;
  const matchingTargets = state.mainTargets.filter((target) =>
    matchesRewindFilter(target, state.query),
  );
  return {
    columns,
    sharedEntries,
    entries,
    selectedTarget,
    matchingTargets,
    targets:
      state.variantIndex > 0
        ? (activeColumn?.targets ?? [])
        : state.mainTargets,
    canConfirm: Boolean(
      selectedTarget &&
      (!state.filterMode || matchesRewindFilter(selectedTarget, state.query)),
    ),
  };
}

/** 不循环越界；过滤后的左右键仅在匹配用户轮之间移动。 */
function moveMain(
  state: RewindState,
  delta: -1 | 1,
  userOnly = false,
): RewindState {
  for (
    let index = state.selected + delta;
    index >= 0 && index < state.mainTargets.length;
    index += delta
  ) {
    const target = state.mainTargets[index];
    if (userOnly && !target.userTurn) continue;
    if (state.filterMode && !matchesRewindFilter(target, state.query)) continue;
    return { ...state, selected: index, variantIndex: 0, siblingSelected: 0 };
  }
  return state;
}

/** 兄弟列顶部继续向上会回到主路径分岔之前。 */
function moveVertical(state: RewindState, delta: -1 | 1): RewindState {
  if (!state.variantIndex) return moveMain(state, delta);
  const targets = rewindColumns(state)[state.variantIndex].targets;
  const index = state.siblingSelected + delta;
  if (index >= 0 && index < targets.length)
    return { ...state, siblingSelected: index };
  return delta < 0
    ? moveMain({ ...state, variantIndex: 0, siblingSelected: 0 }, delta)
    : state;
}

function moveHorizontal(state: RewindState, delta: -1 | 1): RewindState {
  if (state.filterMode) return moveMain(state, delta, true);
  if (delta < 0)
    return state.variantIndex > 0
      ? { ...state, variantIndex: state.variantIndex - 1 }
      : moveMain(state, delta, true);
  if (state.variantIndex + 1 < rewindColumns(state).length)
    return {
      ...state,
      variantIndex: state.variantIndex + 1,
      siblingSelected: 0,
    };
  return state.variantIndex === 0 ? moveMain(state, delta, true) : state;
}

export function moveRewind(state: RewindState, key: string): RewindState {
  if (key === "ArrowUp") return moveVertical(state, -1);
  if (key === "ArrowDown") return moveVertical(state, 1);
  if (key === "ArrowLeft") return moveHorizontal(state, -1);
  if (key === "ArrowRight") return moveHorizontal(state, 1);
  return state;
}

export function openRewindFilter(state: RewindState): RewindState {
  return {
    ...state,
    filterMode: true,
    query: "",
    variantIndex: 0,
    siblingSelected: 0,
  };
}

/** 查询变化优先保留当前命中，之后取上方最后命中，再取全部最后命中。 */
export function filterRewind(state: RewindState, query: string): RewindState {
  const indices = state.mainTargets.flatMap((target, index) =>
    matchesRewindFilter(target, query) ? [index] : [],
  );
  const selected = indices.includes(state.selected)
    ? state.selected
    : (indices.findLast((index) => index < state.selected) ??
      indices.at(-1) ??
      state.selected);
  return { ...state, query, selected };
}

/** 点击转录目标使用真实 turnId，工具结果依旧通过 entryId 提交。 */
export function selectRewindTarget(
  state: RewindState,
  turnId: string,
  variantIndex = state.variantIndex,
): RewindState {
  const targets =
    variantIndex > 0
      ? rewindColumns(state)[variantIndex].targets
      : state.mainTargets;
  const index = targets.findIndex((target) => target.turnId === turnId);
  if (index < 0) throw new Error(`当前回退路径中不存在消息：${turnId}`);
  return variantIndex
    ? { ...state, variantIndex, siblingSelected: index }
    : { ...state, variantIndex: 0, selected: index };
}
