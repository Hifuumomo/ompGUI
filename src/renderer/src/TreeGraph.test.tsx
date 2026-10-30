// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TreeGraph } from "./TreeGraph";
import { NativeTreeScreen } from "./NativeTreeScreen";
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  layoutTreeGraph,
} from "./tree-graph-layout";
import type { SessionEntry, TreeNode } from "../../shared/protocol";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const SURFACE_WIDTH = 1000;
const SURFACE_HEIGHT = 600;
const tree: TreeNode[] = [
  {
    entry: {
      id: "root",
      type: "message",
      parentId: null,
      timestamp: "",
      message: { role: "user", content: "root question" },
    },
    children: [
      {
        entry: {
          id: "answer",
          type: "message",
          parentId: "root",
          timestamp: "",
          message: { role: "assistant", content: "complete answer" },
        },
        children: [],
      },
    ],
  },
];
const activePath = new Set(["root", "answer"]);
let container: HTMLDivElement;
let root: Root;
const resizeObservers = new Set<() => void>();

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    SURFACE_WIDTH,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
    SURFACE_HEIGHT,
  );
  vi.stubGlobal("ResizeObserver", class {
    private readonly notify: () => void;
    constructor(callback: ResizeObserverCallback) {
      this.notify = () => callback([], this as unknown as ResizeObserver);
    }
    observe() { resizeObservers.add(this.notify); }
    disconnect() { resizeObservers.delete(this.notify); }
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resizeObservers.clear();
});

/** 用真实本地选择状态包装图形。[in] callbacks：注入操作。返回值：测试视图。 */
function GraphHarness(callbacks: {
  onSelect: (entry: SessionEntry) => void;
  onActivate: (entry: SessionEntry) => void;
}) {
  const [selected, setSelected] = useState<string>();
  return (
    <TreeGraph
      tree={tree}
      leafId="answer"
      selectedId={selected}
      activePath={activePath}
      onSelect={(entry) => {
        setSelected(entry.id);
        callbacks.onSelect(entry);
      }}
      onActivate={callbacks.onActivate}
    />
  );
}

/** 渲染图形并返回可观察回调。[in] 无。返回值：观察器。 */
async function renderGraph() {
  const callbacks = { onSelect: vi.fn(), onActivate: vi.fn() };
  await act(() => root.render(<GraphHarness {...callbacks} />));
  return callbacks;
}

/** 读取实际渲染的变换。[in] 无。返回值：相机位置和缩放。 */
function camera() {
  const transform =
    container.querySelector<HTMLElement>(".tree-graph-world")!.style.transform;
  const values = transform.match(
    /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/,
  )!;
  return {
    x: Number(values[1]),
    y: Number(values[2]),
    scale: Number(values[3]),
  };
}

/** 检查节点在实际画布中的位置，不约束布局内部坐标。 */
function expectCentered(nodes: readonly TreeNode[], id: string) {
  const node = layoutTreeGraph(nodes).nodes.find((item) => item.entry.id === id)!;
  const position = camera();
  expect(position.scale).toBe(1);
  expect(position.x + node.x + GRAPH_NODE_WIDTH / 2).toBeCloseTo(SURFACE_WIDTH / 2);
  expect(position.y + node.y + GRAPH_NODE_HEIGHT / 2).toBeCloseTo(SURFACE_HEIGHT / 2);
}

/** 渲染指定投影，允许在同一个画布上切换当前叶或可见树。 */
async function renderTree(nodes: readonly TreeNode[], leafId: string | null, focusId?: string | null) {
  await act(() => root.render(
    <TreeGraph tree={nodes} leafId={leafId} focusId={focusId}
      activePath={activePath} onSelect={vi.fn()} onActivate={vi.fn()} />,
  ));
}

it("打开短会话默认以原始比例居中当前叶", async () => {
  await renderGraph();
  expectCentered(tree, "answer");
});

it("等待实际容器尺寸就绪后居中，不被重复尺寸通知重置缩放", async () => {
  const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(0);
  const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(0);
  await renderGraph();
  width.mockReturnValue(SURFACE_WIDTH);
  height.mockReturnValue(SURFACE_HEIGHT);
  await act(() => resizeObservers.forEach((notify) => notify()));
  expectCentered(tree, "answer");
  const surface = container.querySelector(".tree-graph-surface")!;
  await act(() => {
    surface.dispatchEvent(new WheelEvent("wheel", {
      deltaY: -100, clientX: 200, clientY: 100, cancelable: true,
    }));
  });
  const zoomed = camera();
  await act(() => resizeObservers.forEach((notify) => notify()));
  expect(camera()).toEqual(zoomed);
  width.mockReturnValue(SURFACE_WIDTH + 200);
  height.mockReturnValue(SURFACE_HEIGHT + 100);
  await act(() => resizeObservers.forEach((notify) => notify()));
  expect(camera()).toEqual({ ...zoomed, x: zoomed.x + 100, y: zoomed.y + 50 });
});

it("切换当前叶、可见祖先和筛选布局时重新居中", async () => {
  await renderTree(tree, "answer");
  await renderTree(tree, "root");
  expectCentered(tree, "root");
  await renderTree(tree, "answer");
  expectCentered(tree, "answer");
  const filtered = [{ ...tree[0], children: [] }];
  await renderTree(filtered, "answer", "root");
  expectCentered(filtered, "root");
  const shifted = [...filtered, {
    entry: { ...tree[0].entry, id: "other" }, children: [],
  }];
  await renderTree(shifted, "answer", "root");
  expectCentered(shifted, "root");
});

it.each([null, "missing"])("没有可用焦点 %s 时以原始比例展示首个可见节点", async (focusId) => {
  await renderTree(tree, "answer", focusId);
  expectCentered(tree, "root");
});

it("空树相机保持有限坐标，并在节点到达后居中", async () => {
  await renderTree([], null);
  const position = camera();
  expect(Number.isFinite(position.x)).toBe(true);
  expect(Number.isFinite(position.y)).toBe(true);
  expect(position.scale).toBe(1);
  await renderTree(tree, "answer");
  expectCentered(tree, "answer");
});

/** 派发指定元素的实际鼠标事件。[in] element：目标；[in] type：事件；[in] options：坐标。返回值：完成。 */
async function mouse(
  element: Element,
  type: string,
  options: MouseEventInit = {},
) {
  await act(() => {
    element.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, ...options }),
    );
  });
}

it("选择和预览不导航，双击才激活真实节点", async () => {
  const callbacks = await renderGraph();
  const card = container.querySelector<HTMLButtonElement>(
    '[aria-label="user root question"]',
  )!;
  await mouse(card, "click");
  expect(callbacks.onSelect).toHaveBeenCalledWith(tree[0].entry);
  expect(callbacks.onActivate).not.toHaveBeenCalled();
  expect(card.classList.contains("selected")).toBe(true);
  expect(
    container.querySelector('[aria-label="节点完整内容"]')?.textContent,
  ).toContain("root question");
  await mouse(card, "dblclick");
  expect(callbacks.onActivate).toHaveBeenCalledExactlyOnceWith(tree[0].entry);
});

it("悬停显示浮动完整内容，离开关闭且不改变节点选择", async () => {
  const callbacks = await renderGraph();
  const card = container.querySelector<HTMLButtonElement>(
    '[aria-label="user root question"]',
  )!;
  await mouse(card, "mouseover");
  expect(container.querySelector('[role="tooltip"]')?.textContent).toContain(
    "root question",
  );
  expect(callbacks.onSelect).not.toHaveBeenCalled();
  expect(callbacks.onActivate).not.toHaveBeenCalled();
  await mouse(card, "mouseout", { relatedTarget: container });
  expect(container.querySelector('[role="tooltip"]')).toBeNull();
});

it("滚轮以鼠标为中心缩放，拖动空白只移动画布", async () => {
  const callbacks = await renderGraph();
  const surface = container.querySelector<HTMLDivElement>(
    ".tree-graph-surface",
  )!;
  Object.defineProperty(surface, "setPointerCapture", { value: vi.fn() });
  const initial = camera();
  await act(() => {
    surface.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        clientX: 200,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const zoomed = camera();
  expect(zoomed.scale).toBeGreaterThan(initial.scale);
  expect((200 - zoomed.x) / zoomed.scale).toBeCloseTo(
    (200 - initial.x) / initial.scale,
  );
  await mouse(surface, "pointerdown", {
    button: 0,
    clientX: 100,
    clientY: 100,
  });
  await mouse(surface, "pointermove", { clientX: 180, clientY: 150 });
  await mouse(surface, "pointerup");
  expect(camera().x).toBeCloseTo(zoomed.x + 80);
  expect(camera().y).toBeCloseTo(zoomed.y + 50);
  expect(callbacks.onSelect).not.toHaveBeenCalled();
  expect(callbacks.onActivate).not.toHaveBeenCalled();
});

it("当前分支按钮把真实当前叶移到画布中央", async () => {
  const callbacks = await renderGraph();
  await act(() => {
    container.querySelector(".tree-graph-surface")!.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 200, clientX: 100, clientY: 100, cancelable: true,
      }),
    );
  });
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === "当前分支",
  )!;
  await mouse(button, "click");
  const position = camera();
  const leaf = layoutTreeGraph(tree).nodes.find(
    (node) => node.entry.id === "answer",
  )!;
  expect(position.scale).toBe(1);
  expect(position.x + leaf.x + GRAPH_NODE_WIDTH / 2).toBe(SURFACE_WIDTH / 2);
  expect(position.y + leaf.y + GRAPH_NODE_HEIGHT / 2).toBe(SURFACE_HEIGHT / 2);
  expect(
    container.querySelector('[aria-current="location"]')?.textContent,
  ).toContain("complete answer");
  expect(callbacks.onActivate).not.toHaveBeenCalled();
});

it("嵌入全屏树后图形Enter只导航一次，父级不重复拦截", async () => {
  const navigate = vi.fn();
  await act(() =>
    root.render(
      <NativeTreeScreen
        tree={tree}
        leafId="answer"
        onClose={vi.fn()}
        onLabel={vi.fn()}
        onNavigate={navigate}
        renderContent={(view) => (
          <TreeGraph
            tree={tree}
            leafId="answer"
            selectedId={view.selectedId}
            activePath={activePath}
            onSelect={(entry) => view.onSelect(entry.id)}
            onActivate={(entry) => view.onActivate(entry.id)}
          />
        )}
      />,
    ),
  );
  const card = container.querySelector<HTMLButtonElement>(
    '[aria-label="user root question"]',
  )!;
  await act(() => {
    card.focus();
    card.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(navigate).toHaveBeenCalledExactlyOnceWith({
    entryId: "root",
    summarize: false,
  });
});

it("图形节点输入法选词不触发导航", async () => {
  const callbacks = await renderGraph();
  const card = container.querySelector<HTMLButtonElement>(
    '[aria-label="user root question"]',
  )!;
  await act(() => {
    card.focus();
    card.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(callbacks.onActivate).not.toHaveBeenCalled();
});

it("适应画布让短会话全部居中可见", async () => {
  await renderGraph();
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === "适应画布",
  )!;
  await mouse(button, "click");
  const position = camera();
  const layout = layoutTreeGraph(tree);
  expect(position.scale).toBeGreaterThan(0);
  expect(position.x).toBeGreaterThanOrEqual(0);
  expect(position.y).toBeGreaterThanOrEqual(0);
  expect(position.x + layout.width * position.scale).toBeLessThanOrEqual(SURFACE_WIDTH);
  expect(position.y + layout.height * position.scale).toBeLessThanOrEqual(SURFACE_HEIGHT);
});

it("超长会话适应画布保留可辨识比例，定位当前叶而非缩成细线", async () => {
  const longTree: TreeNode[] = [];
  let children = longTree;
  for (let index = 0; index < 150; index++) {
    const node: TreeNode = {
      entry: { ...tree[0].entry, id: String(index), parentId: index ? String(index - 1) : null },
      children: [],
    };
    children.push(node);
    children = node.children;
  }
  await act(() => root.render(
    <TreeGraph tree={longTree} leafId="149" activePath={activePath}
      onSelect={vi.fn()} onActivate={vi.fn()} />,
  ));
  expectCentered(longTree, "149");
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === "适应画布",
  )!;
  await mouse(button, "click");
  const position = camera();
  const leaf = layoutTreeGraph(longTree).nodes.at(-1)!;
  expect(position.scale).toBeGreaterThan(SURFACE_HEIGHT / layoutTreeGraph(longTree).height);
  expect(position.x + (leaf.x + GRAPH_NODE_WIDTH / 2) * position.scale).toBeCloseTo(SURFACE_WIDTH / 2);
  expect(position.y + (leaf.y + GRAPH_NODE_HEIGHT / 2) * position.scale).toBeCloseTo(SURFACE_HEIGHT / 2);
});

it("画布没有可用尺寸时适应操作不破坏相机", async () => {
  await renderGraph();
  const previous = camera();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(0);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(0);
  const button = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === "适应画布",
  )!;
  await mouse(button, "click");
  expect(camera()).toEqual(previous);
});
