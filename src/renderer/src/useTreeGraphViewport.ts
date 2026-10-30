import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  type TreeGraphLayout,
} from "./tree-graph-layout";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 3;
const MIN_FIT_ZOOM = 0.2;
const WHEEL_SENSITIVITY = 0.001;
const VIEWPORT_INSET = 24;
interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}
interface CameraState {
  readonly surface: RefObject<HTMLDivElement | null>;
  readonly viewport: Viewport;
  readonly setViewport: Dispatch<SetStateAction<Viewport>>;
}

/** 独立维护画布相机，操作不写会话。[in] layout：真实图布局。返回值：画布控制器。 */
export function useTreeGraphViewport(layout: TreeGraphLayout, focusId: string | null) {
  const surface = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const state = { surface, viewport, setViewport };
  const actions = graphViewportActions(layout, state, focusId);
  const events = useGraphDrag(state);
  useGraphWheel(state);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    let size: { width: number; height: number } | undefined;
    function place() {
      const width = element!.clientWidth;
      const height = element!.clientHeight;
      if (width <= 0 || height <= 0) return;
      if (!size) {
        const focus = layout.nodes.find((node) => node.entry.id === focusId)
          ?? layout.nodes[0];
        setViewport({
          scale: 1,
          x: width / 2 - (focus ? focus.x + GRAPH_NODE_WIDTH / 2 : layout.width / 2),
          y: height / 2 - (focus ? focus.y + GRAPH_NODE_HEIGHT / 2 : layout.height / 2),
        });
      } else if (size.width !== width || size.height !== height) {
        // 容器变化只平移视口中心，保留用户手动缩放和拖动的结果。
        const dx = (width - size.width) / 2;
        const dy = (height - size.height) / 2;
        setViewport((previous) => ({
          ...previous,
          x: previous.x + dx,
          y: previous.y + dy,
        }));
      }
      size = { width, height };
    }
    // 首次挂载可能尚无尺寸，等画布实际可用后再定位当前可见节点。
    place();
    const observer = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(place);
    observer?.observe(element);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [layout, focusId]);
  return { surface, viewport, ...actions, events };
}

/** 适应整体或定位当前叶。[in] layout：布局；[in] state：相机。返回值：动作。 */
function graphViewportActions(layout: TreeGraphLayout, state: CameraState, focusId: string | null) {
  function fit() {
    const element = state.surface.current;
    if (!element) return;
    if (element.clientWidth <= VIEWPORT_INSET || element.clientHeight <= VIEWPORT_INSET)
      return;
    const fittedScale = Math.min(
      1,
      (element.clientWidth - VIEWPORT_INSET) / layout.width,
      (element.clientHeight - VIEWPORT_INSET) / layout.height,
    );
    // 长会话不能缩成近乎不可见的细线；优先保留当前分支的可辨识节点。
    const scale = Math.max(MIN_FIT_ZOOM, fittedScale);
    const focus = fittedScale < MIN_FIT_ZOOM
      ? layout.nodes.find((node) => node.entry.id === focusId) ?? layout.nodes[0]
      : undefined;
    state.setViewport({
      scale,
      x: focus
        ? element.clientWidth / 2 - (focus.x + GRAPH_NODE_WIDTH / 2) * scale
        : (element.clientWidth - layout.width * scale) / 2,
      y: focus
        ? element.clientHeight / 2 - (focus.y + GRAPH_NODE_HEIGHT / 2) * scale
        : (element.clientHeight - layout.height * scale) / 2,
    });
  }
  function center(id: string) {
    const node = layout.nodes.find((item) => item.entry.id === id);
    const element = state.surface.current;
    if (!node || !element) return;
    if (element.clientWidth <= 0 || element.clientHeight <= 0) return;
    state.setViewport({
      scale: 1,
      x: element.clientWidth / 2 - node.x - GRAPH_NODE_WIDTH / 2,
      y: element.clientHeight / 2 - node.y - GRAPH_NODE_HEIGHT / 2,
    });
  }
  return { fit, center };
}

/** 保持鼠标下的世界坐标不动地缩放。[in] previous：相机；[in] input：指针和滚轮。返回值：新相机。 */
function zoomViewport(
  previous: Viewport,
  input: { x: number; y: number; delta: number },
): Viewport {
  const scale = Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      previous.scale * Math.exp(-input.delta * WHEEL_SENSITIVITY),
    ),
  );
  const ratio = scale / previous.scale;
  return {
    scale,
    x: input.x - (input.x - previous.x) * ratio,
    y: input.y - (input.y - previous.y) * ratio,
  };
}

/** 非被动滚轮监听禁止页面滚动。[in] state：相机。返回值：无。 */
function useGraphWheel(state: CameraState) {
  useEffect(() => {
    const element = state.surface.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      state.setViewport((previous) =>
        zoomViewport(previous, {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          delta: event.deltaY,
        }),
      );
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [state.surface, state.setViewport]);
}

/** 指针捕获使跨越画布边界拖动仍连续。[in] state：相机。返回值：事件处理器。 */
function useGraphDrag(state: CameraState) {
  const drag = useRef<{ x: number; y: number; viewport: Viewport } | null>(
    null,
  );
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest("button"))
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      viewport: state.viewport,
    };
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const start = drag.current;
    state.setViewport({
      ...start.viewport,
      x: start.viewport.x + event.clientX - start.x,
      y: start.viewport.y + event.clientY - start.y,
    });
  }
  function stopDrag() {
    drag.current = null;
  }
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: stopDrag,
    onPointerCancel: stopDrag,
    onLostPointerCapture: stopDrag,
  };
}
