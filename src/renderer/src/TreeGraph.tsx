import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { TreeNode, SessionEntry } from "../../shared/protocol";
import { displayMessageText } from "./session";
import {
  graphLink,
  layoutTreeGraph,
  GRAPH_NODE_WIDTH,
  GRAPH_NODE_HEIGHT,
  type GraphNode,
  type TreeGraphLayout,
} from "./tree-graph-layout";
import { useTreeGraphViewport } from "./useTreeGraphViewport";
import { usePopover } from "./usePopover";
import "./session-menu.css";
import "./tree-graph.css";

interface Props {
  readonly tree: readonly TreeNode[];
  readonly leafId: string | null;
  readonly focusId?: string | null;
  readonly disabled?: boolean;
  readonly selectedId?: string | null;
  readonly activePath: ReadonlySet<string>;
  readonly onSelect: (entry: SessionEntry) => void;
  readonly onActivate: (entry: SessionEntry, summarize?: boolean) => void;
  readonly onLabel?: (entry: SessionEntry) => void;
  readonly onDelete?: (entry: SessionEntry) => void;
}
type Camera = ReturnType<typeof useTreeGraphViewport>;
interface GraphView {
  readonly props: Props;
  readonly layout: TreeGraphLayout;
  readonly camera: Camera;
  readonly onPreview: (node: GraphNode) => void;
  readonly onHover: (node: GraphNode, element: HTMLElement) => void;
  readonly onLeave: () => void;
  readonly onContextMenu: (node: GraphNode, event: MouseEvent<HTMLButtonElement>) => void;
}
interface CardProps {
  readonly node: GraphNode;
  readonly state: { active: boolean; current: boolean; selected: boolean };
  readonly disabled?: boolean;
  readonly events: {
    select: () => void;
    activate: (summarize?: boolean) => void;
    preview: () => void;
    hover: (element: HTMLElement) => void;
    leave: () => void;
    contextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  };
}
interface GraphMenuTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly trigger: HTMLButtonElement;
}

/** 读取节点完整内容，预览不截断。[in] node：节点。返回值：文本。 */
function nodeText(node: GraphNode): string {
  if (node.entry.message)
    return displayMessageText(node.entry.message) || node.entry.message.role;
  return String(node.entry.summary ?? node.label ?? node.entry.type);
}

/** 可缩放平移的会话分支图。[in] props：真实会话与注入操作。返回值：图形视图。 */
export function TreeGraph(props: Props) {
  const layout = useMemo(() => layoutTreeGraph(props.tree), [props.tree]);
  const camera = useTreeGraphViewport(
    layout,
    props.focusId === undefined ? props.leafId : props.focusId,
  );
  const panel = useGraphSelectionFocus(props.selectedId);
  const [previewId, setPreviewId] = useState<string>();
  const [menu, setMenu] = useState<GraphMenuTarget>();
  const [hover, setHover] = useState<{
    node: GraphNode;
    x: number;
    y: number;
  }>();
  const preview = layout.nodes.find((node) => node.entry.id === previewId);
  const menuNode = menu && layout.nodes.find((node) => node.entry.id === menu.id);
  useEffect(() => setMenu(undefined), [layout, props.disabled]);
  const view = {
    props,
    layout,
    camera,
    onPreview: (node: GraphNode) => setPreviewId(node.entry.id),
    onHover: (node: GraphNode, element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      setHover({
        node,
        x: Math.max(12, Math.min(rect.right + 12, window.innerWidth - 432)),
        y: Math.max(12, Math.min(rect.top, window.innerHeight - 332)),
      });
    },
    onLeave: () => setHover(undefined),
    onContextMenu: (node: GraphNode, event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (props.disabled) return;
      props.onSelect(node.entry);
      setHover(undefined);
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({
        id: node.entry.id,
        x: event.clientX || rect.left + rect.width / 2,
        y: event.clientY || rect.top + rect.height / 2,
        trigger: event.currentTarget,
      });
    },
  };
  return (
    <div className="tree-graph-panel" ref={panel}>
      <GraphToolbar
        camera={camera}
        leafId={props.focusId === undefined ? props.leafId : props.focusId}
      />
      <GraphSurface view={view} />
      {menu && menuNode && !props.disabled && (
        <GraphContextMenu
          key={`${menu.id}:${menu.x}:${menu.y}`}
          target={menu}
          entry={menuNode.entry}
          props={props}
          onClose={() => setMenu(undefined)}
        />
      )}
      {hover && (
        <aside
          className="tree-graph-tooltip"
          role="tooltip"
          style={{ left: hover.x, top: hover.y }}
        >
          <strong>
            {hover.node.label ??
              hover.node.entry.message?.role ??
              hover.node.entry.type}
          </strong>
          <pre>{nodeText(hover.node)}</pre>
        </aside>
      )}
      {preview && (
        <aside className="tree-graph-preview" aria-label="节点完整内容">
          <strong>
            {preview.label ?? preview.entry.message?.role ?? preview.entry.type}
          </strong>
          <pre>{nodeText(preview)}</pre>
        </aside>
      )}
    </div>
  );
}

/** 图形节点持有焦点时，原生方向键选择同步其焦点。[in] selectedId：共享选择。返回值：面板引用。 */
function useGraphSelectionFocus(selectedId: Props["selectedId"]) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const focused = document.activeElement;
    if (
      !(focused instanceof HTMLElement) ||
      !focused.classList.contains("tree-graph-node") ||
      !panel.current?.contains(focused)
    )
      return;
    panel.current
      .querySelector<HTMLButtonElement>(".tree-graph-node.selected")
      ?.focus();
  }, [selectedId]);
  return panel;
}

/** 提供画布定位操作，不更改会话。[in] camera：相机；[in] leafId：当前叶。返回值：工具栏。 */
function GraphToolbar({
  camera,
  leafId,
}: {
  camera: Camera;
  leafId: string | null;
}) {
  return (
    <div className="tree-graph-toolbar">
      <span>
        滚轮缩放 · 拖动空白平移 · 选择节点查看内容 · 右键菜单 · 双击或 Enter 切换
      </span>
      <output aria-label="缩放比例">
        {Math.round(camera.viewport.scale * 100)}%
      </output>
      <button onClick={camera.fit} title="居中适应画布；超长会话保持可见比例并定位当前分支">
        适应画布
      </button>
      <button disabled={!leafId} onClick={() => camera.center(leafId!)}>
        当前分支
      </button>
    </div>
  );
}

/** 独立画布承接缩放和平移。[in] view：图形上下文。返回值：画布。 */
function GraphSurface({ view }: { view: GraphView }) {
  const { camera, layout } = view;
  return (
    <div
      ref={camera.surface}
      className="tree-graph-surface"
      aria-label="会话树形图"
      {...camera.events}
    >
      <div
        className="tree-graph-world"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${camera.viewport.x}px, ${camera.viewport.y}px) scale(${camera.viewport.scale})`,
        }}
      >
        <GraphEdges layout={layout} activePath={view.props.activePath} />
        <GraphCards view={view} />
      </div>
      {!layout.nodes.length && (
        <p className="tree-graph-empty">会话树暂无节点。</p>
      )}
    </div>
  );
}

/** 当前分支使用强调连线。[in] options：布局和当前路径。返回值：连线图层。 */
function GraphEdges({
  layout,
  activePath,
}: {
  layout: TreeGraphLayout;
  activePath: ReadonlySet<string>;
}) {
  const byId = useMemo(
    () => new Map(layout.nodes.map((node) => [node.entry.id, node])),
    [layout],
  );
  return (
    <svg width={layout.width} height={layout.height} aria-hidden="true">
      {layout.nodes
        .filter((node) => node.parentId)
        .map((node) => (
          <path
            key={node.entry.id}
            d={graphLink(byId.get(node.parentId!)!, node)}
            className={activePath.has(node.entry.id) ? "active" : ""}
          />
        ))}
    </svg>
  );
}

/** 选择只预览，显式激活才导航。[in] view：图形上下文。返回值：节点卡片。 */
function GraphCards({ view }: { view: GraphView }) {
  const { props, layout, onPreview } = view;
  return layout.nodes.map((node) => (
    <GraphCard
      key={node.entry.id}
      node={node}
      disabled={props.disabled}
      state={{
        active: props.activePath.has(node.entry.id),
        current: node.entry.id === props.leafId,
        selected: node.entry.id === props.selectedId,
      }}
      events={{
        select: () => {
          onPreview(node);
          props.onSelect(node.entry);
        },
        activate: (summarize) =>
          summarize
            ? props.onActivate(node.entry, true)
            : props.onActivate(node.entry),
        preview: () => onPreview(node),
        hover: (element) => view.onHover(node, element),
        leave: view.onLeave,
        contextMenu: (event) => view.onContextMenu(node, event),
      }}
    />
  ));
}

/** 节点键盘激活只产生一次导航。[in] options：节点、状态、动作。返回值：节点按钮。 */
function GraphCard({ node, state, events, disabled }: CardProps) {
  return (
    <button
      disabled={disabled}
      data-role={node.entry.message?.role ?? node.entry.type}
      className={`tree-graph-node ${state.active ? "active" : ""} ${state.selected ? "selected" : ""}`}
      style={{
        left: node.x,
        top: node.y,
        width: GRAPH_NODE_WIDTH,
        height: GRAPH_NODE_HEIGHT,
      }}
      aria-label={`${node.entry.message?.role ?? node.entry.type} ${nodeText(node)}`}
      aria-current={state.current ? "location" : undefined}
      onClick={events.select}
      onDoubleClick={() => events.activate()}
      onContextMenu={events.contextMenu}
      onMouseEnter={(event) => events.hover(event.currentTarget)}
      onMouseLeave={events.leave}
      onFocus={events.preview}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          events.activate(event.shiftKey);
        }
      }}
    >
      <strong>
        {node.label ?? node.entry.message?.role ?? node.entry.type}
        {state.current && " · 当前"}
      </strong>
      <span>{nodeText(node)}</span>
    </button>
  );
}

/** 复用浮层焦点和键盘导航；操作始终绑定右键目标而非后续选择。 */
function GraphContextMenu({
  target, entry, props, onClose,
}: {
  target: GraphMenuTarget;
  entry: SessionEntry;
  props: Props;
  onClose: () => void;
}) {
  const trigger = useRef(target.trigger);
  const popover = usePopover(onClose, trigger);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  useLayoutEffect(() => {
    const rect = popover.ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(4, Math.min(target.x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(target.y, window.innerHeight - rect.height - 4)),
    });
  }, [target, popover.ref]);
  useEffect(() => {
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("wheel", onClose);
    };
  }, [onClose]);
  function perform(action: () => void) {
    onClose();
    trigger.current.focus({ preventScroll: true });
    action();
  }
  return (
    <div
      {...popover}
      className="session-menu tree-graph-menu"
      role="menu"
      aria-label="会话节点操作"
      style={position}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => perform(() => props.onActivate(entry))}>
        切换
      </button>
      <button type="button" role="menuitem" onClick={() => perform(() => props.onActivate(entry, true))}>
        切换并总结
      </button>
      <button type="button" role="menuitem" disabled={!props.onLabel} onClick={() => perform(() => props.onLabel?.(entry))}>
        标签
      </button>
      <button type="button" role="menuitem" className="danger" disabled={!props.onDelete} onClick={() => perform(() => props.onDelete?.(entry))}>
        删除
      </button>
    </div>
  );
}
