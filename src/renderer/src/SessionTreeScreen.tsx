import { useEffect, useMemo, useRef, useState } from "react";
import { NativeTreeScreen } from "./NativeTreeScreen";
import { TreeGraph } from "./TreeGraph";
import { projectTreeGraph } from "./tree-graph-projection";
import type {
  NativeTreeContent,
  NativeTreeScreenProps,
  TreeNavigation,
} from "./native-tree-types";
import "./session-tree.css";

export type SessionTreeScreenProps = Omit<
  NativeTreeScreenProps,
  "renderContent"
>;

/** 在同一个原生树状态中切换列表和图形。[in] props：会话数据及原生操作。返回值：全屏会话树。 */
export function SessionTreeScreen(props: SessionTreeScreenProps) {
  const [graph, setGraph] = useState(false);
  const navigation = useSessionTreeNavigation(props.onNavigate);
  useViewShortcut(
    () => setGraph((value) => !value),
    navigation.pending || Boolean(props.suspended),
  );
  return (
    <NativeTreeScreen
      {...props}
      onNavigate={navigation.navigate}
      toolbar={
        <>
          {props.toolbar}
          <ViewToggle
            graph={graph}
            disabled={navigation.pending}
            onToggle={() => setGraph(!graph)}
          />
        </>
      }
      renderContent={
        graph
          ? (view) => (
              <SessionGraph
                props={props}
                view={view}
                pending={navigation.pending}
              />
            )
          : undefined
      }
    />
  );
}

/** Alt+V 在列表与图形间往返；原生树不使用该组合，删除确认和操作中不响应。[in] toggle：切换动作；[in] disabled：是否暂停。返回值：无。 */
function useViewShortcut(toggle: () => void, disabled: boolean) {
  useEffect(() => {
    if (disabled) return;
    function onKey(event: KeyboardEvent) {
      if (
        event.isComposing ||
        event.repeat ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "v"
      )
        return;
      if (
        document.querySelector("[role=alertdialog], .native-tree-label-editor, .tree-graph-menu")
      )
        return;
      event.preventDefault();
      toggle();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [toggle, disabled]);
}

/** 在同一渲染周期内只提交一次真实导航。[in] onNavigate：原生操作。返回值：操作及处理中状态。 */
function useSessionTreeNavigation(
  onNavigate: SessionTreeScreenProps["onNavigate"],
) {
  const active = useRef<Promise<void> | null>(null);
  const [pending, setPending] = useState(false);
  function navigate(request: TreeNavigation) {
    if (active.current) return active.current;
    setPending(true);
    const operation = Promise.resolve()
      .then(() => onNavigate(request))
      .finally(() => {
        active.current = null;
        setPending(false);
      });
    active.current = operation;
    return operation;
  }
  return { navigate, pending };
}

/** 图形复用原生搜索、筛选、选择及激活动作。[in] options：原生页面、可见行、操作状态。返回值：图形。 */
function SessionGraph({
  props,
  view,
  pending,
}: {
  props: SessionTreeScreenProps;
  view: NativeTreeContent;
  pending: boolean;
}) {
  const projection = useMemo(
    () =>
      projectTreeGraph({
        tree: props.tree,
        rows: view.rows,
        leafId: props.leafId,
      }),
    [props.tree, props.leafId, view.rows],
  );
  return (
    <TreeGraph
      {...projection}
      selectedId={view.selectedId}
      disabled={pending || view.pending}
      onSelect={(entry) => view.onSelect(entry.id)}
      onActivate={(entry, summarize) => view.onActivate(entry.id, summarize)}
      onLabel={(entry) => view.onLabel(entry.id)}
      onDelete={view.onDelete ? (entry) => view.onDelete!(entry.id) : undefined}
    />
  );
}

/** 可通过键盘触发的列表/图形工具栏图标。[in] options：模式、禁用状态及切换动作。返回值：按钮。 */
function ViewToggle({
  graph,
  disabled,
  onToggle,
}: {
  graph: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const label = graph ? "切换为列表视图" : "切换为树形视图";
  return (
    <button
      className="session-tree-view-toggle"
      type="button"
      aria-label={label}
      title={`${label}（Alt+V）`}
      aria-keyshortcuts="Alt+V"
      aria-pressed={graph}
      disabled={disabled}
      onClick={onToggle}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        {graph ? (
          <path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1" />
        ) : (
          <>
            <path d="M12 8v4M5 16v-4h14v4" />
            <rect x="9" y="2" width="6" height="6" rx="1" />
            <rect x="2" y="16" width="6" height="6" rx="1" />
            <rect x="16" y="16" width="6" height="6" rx="1" />
          </>
        )}
      </svg>
    </button>
  );
}
