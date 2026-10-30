import { useRef, useState, type RefObject } from "react";
import type { NativeTreeRow } from "./native-tree-data";
import type {
  NativeTreeScreenProps,
  TreeLabelChange,
} from "./native-tree-types";

type PendingKind = "navigation" | "label" | "delete" | null;

/** 保留真实操作的异常文本，不把失败当作成功。[in] operation：操作；[in] setError：错误显示。返回值：是否成功。 */
async function actionResult(
  operation: () => Promise<void> | void,
  setError: (error: string) => void,
) {
  try {
    await operation();
    return true;
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** 用同步引用防止重复提交，取消完成仍等待原导航结束。[in] 无。返回值：操作状态和执行入口。 */
export function useNativeTreeOperation() {
  const active = useRef<PendingKind>(null);
  const cancelActive = useRef(false);
  const [pendingKind, setPendingKind] = useState<PendingKind>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  async function run(
    kind: Exclude<PendingKind, null>,
    operation: () => Promise<void> | void,
  ) {
    if (active.current) return false;
    active.current = kind;
    setPendingKind(kind);
    setError("");
    try {
      return await actionResult(operation, setError);
    } finally {
      active.current = null;
      cancelActive.current = false;
      setPendingKind(null);
      setCancelling(false);
    }
  }
  async function cancel(operation?: () => Promise<void> | void) {
    if (active.current !== "navigation" || cancelActive.current || !operation)
      return;
    cancelActive.current = true;
    setCancelling(true);
    if (await actionResult(operation, setError)) return;
    cancelActive.current = false;
    setCancelling(false);
  }
  return {
    pending: pendingKind !== null,
    pendingKind,
    cancelling,
    error,
    run,
    cancel,
    isPending: () => active.current !== null,
  };
}

export interface TreeActionState extends ReturnType<
  typeof useNativeTreeOperation
> {
  readonly selectedId: string | null;
  readonly rows: readonly NativeTreeRow[];
  readonly labelTarget: TreeLabelChange | null;
  readonly setLabelTarget: (value: TreeLabelChange | null) => void;
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly search: RefObject<HTMLInputElement | null>;
}

/** 构造原生导航、标签及取消操作。[in] props：注入边界；[in] state：树状态。返回值：动作。 */
export function treeActions(
  props: NativeTreeScreenProps,
  state: TreeActionState,
) {
  async function navigate(summarize: boolean, entryId = state.selectedId) {
    if (!entryId) return;
    await state.run("navigation", () =>
      props.onNavigate({ entryId, summarize }),
    );
  }
  function editLabel(entryId = state.selectedId) {
    const node = state.rows.find(
      (row) => row.node.entry.id === entryId,
    )?.node;
    if (node && !state.isPending())
      state.setLabelTarget({ entryId: node.entry.id, label: node.label });
  }
  async function saveLabel(label: string) {
    if (!state.labelTarget) return;
    const request = {
      entryId: state.labelTarget.entryId,
      label: label.trim() || undefined,
    };
    if (await state.run("label", () => props.onLabel(request)))
      state.setLabelTarget(null);
    state.search.current?.focus();
  }
  function close() {
    if (state.isPending()) {
      void state.cancel(props.onCancelNavigation);
      return;
    }
    props.onClose();
  }
  function escape() {
    if (state.isPending()) close();
    else if (state.query) state.setQuery("");
    else props.onClose();
  }
  const closeDisabled =
    state.pending &&
    (state.pendingKind !== "navigation" ||
      !props.onCancelNavigation ||
      state.cancelling);
  return { navigate, editLabel, saveLabel, escape, close, closeDisabled };
}
