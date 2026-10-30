import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionEntry } from "../../shared/protocol";
import {
  createRewindState,
  filterRewind,
  moveRewind,
  openRewindFilter,
  rewindView,
  selectRewindTarget,
  type RewindState,
} from "./rewind-navigation";

export interface RewindOptions {
  readonly enabled: boolean;
  readonly entries: readonly SessionEntry[];
  readonly leafId: string | null;
  readonly disabled?: boolean;
  readonly onNavigate: (entry: SessionEntry) => void;
  readonly onCancel: () => void;
}

interface RewindKeyContext {
  readonly state: RewindState;
  readonly setState: (updater: (previous: RewindState) => RewindState) => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

type KeyAction = "move" | "filter" | "confirm" | "cancel";
const keyActions: Readonly<Record<string, KeyAction>> = {
  ArrowUp: "move",
  ArrowDown: "move",
  ArrowLeft: "move",
  ArrowRight: "move",
  Enter: "confirm",
  Escape: "cancel",
};

function keyAction(
  event: KeyboardEvent,
  state: RewindState,
): KeyAction | undefined {
  if (event.shiftKey && event.key.startsWith("Arrow")) return;
  if (event.key === "f") return state.filterMode ? undefined : "filter";
  if (event.key === "Backspace")
    return state.filterMode && !state.query ? "cancel" : undefined;
  return keyActions[event.key];
}

/** 输入框保留文字编辑；导航键、过滤键与退出键由回退选择器独占。 */
function handleRewindKey(event: KeyboardEvent, context: RewindKeyContext) {
  if (
    [event.isComposing, event.altKey, event.ctrlKey, event.metaKey].some(
      Boolean,
    )
  )
    return;
  const { state, setState, confirm, cancel } = context;
  const action = keyAction(event, state);
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  if (action === "move")
    setState((previous) => moveRewind(previous, event.key));
  else if (action === "filter") setState(openRewindFilter);
  else if (action === "confirm") confirm();
  else if (state.filterMode)
    setState((previous) => ({ ...previous, filterMode: false }));
  else cancel();
}

/** 回退只更换预览与虚线框，确认时才调用注入的原生同文件导航。 */
export function useRewind(options: RewindOptions) {
  const { enabled, entries, leafId, disabled, onNavigate, onCancel } = options;
  const initialState = useMemo(
    () => createRewindState(entries, leafId),
    [entries, leafId],
  );
  const [state, setState] = useState(initialState);
  useEffect(() => {
    if (enabled) setState(initialState);
  }, [enabled, initialState]);
  const view = useMemo(() => rewindView(state), [state]);
  const move = useCallback(
    (direction: "ArrowUp" | "ArrowDown") => {
      if (!disabled) setState((previous) => moveRewind(previous, direction));
    },
    [disabled],
  );
  function confirm() {
    if (disabled || !view.canConfirm || !view.selectedTarget) return;
    const entry = entries.find(
      (candidate) => candidate.id === view.selectedTarget!.entryId,
    );
    if (!entry)
      throw new Error(
        `原生会话历史缺少回退节点：${view.selectedTarget.entryId}`,
      );
    onNavigate(entry);
  }
  useEffect(() => {
    if (!enabled) return;
    function handle(event: KeyboardEvent) {
      if (disabled) return;
      handleRewindKey(event, { state, setState, confirm, cancel: onCancel });
    }
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  });
  return {
    ...view,
    historyEntries: state.entries,
    mainTargets: state.mainTargets,
    mainSelected: state.selected,
    variantIndex: state.variantIndex,
    filterMode: state.filterMode,
    query: state.query,
    disabled: Boolean(disabled),
    confirm,
    cancel: onCancel,
    move,
    select: (turnId: string, variantIndex?: number) =>
      setState((previous) =>
        selectRewindTarget(previous, turnId, variantIndex),
      ),
    setQuery: (query: string) =>
      setState((previous) => filterRewind(previous, query)),
    openFilter: () => setState(openRewindFilter),
    closeFilter: () =>
      setState((previous) => ({ ...previous, filterMode: false })),
  };
}

export type RewindController = ReturnType<typeof useRewind>;
