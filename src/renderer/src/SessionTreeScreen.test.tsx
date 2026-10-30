// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  SessionTreeScreen,
  type SessionTreeScreenProps,
} from "./SessionTreeScreen";
import type { TreeNode } from "../../shared/protocol";
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  layoutTreeGraph,
} from "./tree-graph-layout";
import { nativeTreeRows } from "./native-tree-data";
import { projectTreeGraph } from "./tree-graph-projection";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const SURFACE_WIDTH = 1000;
const SURFACE_HEIGHT = 600;
const leaf: TreeNode = {
  entry: {
    type: "message",
    id: "leaf",
    parentId: "follow",
    timestamp: "",
    message: { role: "assistant", content: "final answer" },
  },
  children: [],
};
const follow: TreeNode = {
  entry: {
    type: "message",
    id: "follow",
    parentId: "hidden",
    timestamp: "",
    message: { role: "user", content: "needle follow-up" },
  },
  children: [leaf],
};
const hidden: TreeNode = {
  entry: {
    type: "model_change",
    id: "hidden",
    parentId: "root",
    timestamp: "",
  },
  children: [follow],
};
const tree: TreeNode[] = [
  {
    entry: {
      type: "message",
      id: "root",
      parentId: null,
      timestamp: "",
      message: { role: "user", content: "initial question" },
    },
    children: [hidden],
  },
];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    SURFACE_WIDTH,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
    SURFACE_HEIGHT,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/** 渲染组合页面并观察注入的原生操作。[in] options：覆盖属性。返回值：属性。 */
async function renderScreen(options: Partial<SessionTreeScreenProps> = {}) {
  const props = {
    tree,
    leafId: "leaf",
    onNavigate: vi.fn(),
    onLabel: vi.fn(),
    onClose: vi.fn(),
    ...options,
  };
  await act(() => root.render(<SessionTreeScreen {...props} />));
  return props;
}

/** 获取具名工具栏或节点按钮。[in] label：可访问名称。返回值：按钮。 */
function button(label: string) {
  return container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
}

/** 发送真实点击事件。[in] element：目标；[in] event：事件。返回值：完成。 */
async function click(element: Element, event = "click") {
  await act(() => {
    element.dispatchEvent(
      new MouseEvent(event, { bubbles: true, cancelable: true }),
    );
  });
}

/** 修改实际搜索框并触发 React 输入。[in] value：搜索值。返回值：完成。 */
async function search(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    '[aria-label="搜索会话树"]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("列表和图形共享选择，点击只预览，Enter只提交一次", async () => {
  const props = await renderScreen();
  await click(button("切换为树形视图"));
  expect(
    container.querySelector(".tree-graph-node.selected")?.textContent,
  ).toContain("final answer");
  await click(button("user needle follow-up"));
  expect(props.onNavigate).not.toHaveBeenCalled();
  await click(button("切换为列表视图"));
  expect(
    container.querySelector('[role="option"][aria-selected="true"]')?.id,
  ).toBe("native-tree-follow");
  await click(button("切换为树形视图"));
  const card = button("user needle follow-up");
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
  expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith({
    entryId: "follow",
    summarize: false,
  });
});

it("Alt+V 在列表与图形间往返，其他修饰键组合不触发", async () => {
  await renderScreen();
  const press = (init: KeyboardEventInit) =>
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "v",
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    });
  const inGraph = () => container.querySelector(".tree-graph-surface") !== null;
  await press({ altKey: true });
  expect(inGraph()).toBe(true);
  await press({ altKey: true, ctrlKey: true });
  await press({ ctrlKey: true });
  expect(inGraph()).toBe(true);
  await press({ altKey: true });
  expect(inGraph()).toBe(false);
  expect(container.querySelector('[role="listbox"]')).not.toBeNull();
});

it("图形共享原生过滤和搜索，隐藏中间节点时仍有正确连线", async () => {
  await renderScreen();
  await click(button("切换为树形视图"));
  expect(container.querySelectorAll(".tree-graph-node")).toHaveLength(3);
  expect(container.querySelectorAll(".tree-graph-world path")).toHaveLength(2);
  await click(button("assistant final answer"));
  expect(container.querySelector('[aria-label="节点完整内容"]')).not.toBeNull();
  const userFilter = Array.from(
    container.querySelectorAll('[role="tab"]'),
  ).find((item) => item.textContent?.startsWith("仅用户"))!;
  await click(userFilter);
  expect(container.querySelector('[aria-label="节点完整内容"]')).toBeNull();
  expect(container.querySelectorAll(".tree-graph-node")).toHaveLength(2);
  expect(container.querySelectorAll(".tree-graph-node.active")).toHaveLength(2);
  expect(container.querySelector('[aria-current="location"]')).toBeNull();
  await search("needle");
  expect(container.querySelectorAll(".tree-graph-node")).toHaveLength(1);
  expect(container.querySelectorAll(".tree-graph-world path")).toHaveLength(0);
  expect(
    container.querySelector(".tree-graph-node.selected")?.textContent,
  ).toContain("needle");
});

it("当前叶被隐藏后定位最近可见当前祖先，不把祖先标成当前叶", async () => {
  await renderScreen({ initialFilter: "user-only" });
  await click(button("切换为树形视图"));
  const current = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === "当前分支",
  )!;
  await click(current);
  const rows = nativeTreeRows({
    tree,
    leafId: "leaf",
    filter: "user-only",
    query: "",
  });
  const projection = projectTreeGraph({ tree, leafId: "leaf", rows });
  const target = layoutTreeGraph(projection.tree).nodes.find(
    (node) => node.entry.id === "follow",
  )!;
  const x = SURFACE_WIDTH / 2 - target.x - GRAPH_NODE_WIDTH / 2;
  const y = SURFACE_HEIGHT / 2 - target.y - GRAPH_NODE_HEIGHT / 2;
  expect(
    container.querySelector<HTMLElement>(".tree-graph-world")!.style.transform,
  ).toBe(`translate(${x}px, ${y}px) scale(1)`);
  expect(container.querySelector('[aria-current="location"]')).toBeNull();
});

it("搜索无匹配时没有可导航旧节点且禁用当前分支定位", async () => {
  const props = await renderScreen();
  await click(button("切换为树形视图"));
  await search("unmatched");
  expect(container.querySelectorAll(".tree-graph-node")).toHaveLength(0);
  const current = Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === "当前分支",
  )!;
  expect(current.disabled).toBe(true);
  await act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(props.onNavigate).not.toHaveBeenCalled();
});

it("导航处理中重复激活只提交一次，失败后恢复操作并展示原生错误", async () => {
  let rejectNavigation!: (error: Error) => void;
  const navigation = new Promise<void>((_resolve, reject) => {
    rejectNavigation = reject;
  });
  const onNavigate = vi.fn(() => navigation);
  await renderScreen({ onNavigate });
  await click(button("切换为树形视图"));
  const card = button("user needle follow-up");
  await act(() => {
    card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(card.disabled).toBe(true);
  expect(container.querySelector(".native-tree-confirm")?.textContent).toBe(
    "处理中…",
  );
  await act(() => {
    rejectNavigation(new Error("native branch navigation failed"));
  });
  expect(card.disabled).toBe(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "native branch navigation failed",
  );
});

it("图形方向键同步选择和焦点，Shift Enter保留原生总结导航", async () => {
  const props = await renderScreen();
  await click(button("切换为树形视图"));
  const card = button("user needle follow-up");
  await click(card);
  await act(() => {
    card.focus();
    card.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(document.activeElement).toBe(button("user initial question"));
  expect(
    container.querySelector(".tree-graph-node.selected")?.textContent,
  ).toContain("initial question");
  await act(() => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith({
    entryId: "root",
    summarize: true,
  });
});

/** 打开目标节点菜单，模拟右键而不先左键选择。 */
async function openNodeMenu(label: string) {
  await click(button(label), "contextmenu");
}

/** 仅在当前节点菜单内查找操作，避免与页脚按钮混淆。 */
function menuItem(label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find((item) => item.textContent?.trim() === label)!;
}

it("节点菜单独占键盘，Esc仅关闭菜单并恢复目标焦点", async () => {
  const props = await renderScreen({ onDelete: vi.fn() });
  await click(button("切换为树形视图"));
  await openNodeMenu("user initial question");
  expect(document.activeElement).toBe(menuItem("切换"));
  await act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowDown", bubbles: true, cancelable: true,
    }));
  });
  expect(document.activeElement).toBe(menuItem("切换并总结"));
  expect(container.querySelector(".tree-graph-node.selected")).toBe(button("user initial question"));
  await act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    }));
  });
  expect(container.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(button("user initial question"));
  expect(props.onClose).not.toHaveBeenCalled();
  expect(props.onNavigate).not.toHaveBeenCalled();
});

it.each([["切换", false], ["切换并总结", true]] as const)(
  "右键%s使用目标节点，导航失败后可重新操作",
  async (label, summarize) => {
    const props = await renderScreen({
      onNavigate: vi.fn().mockRejectedValueOnce(new Error("导航失败")),
    });
    await click(button("切换为树形视图"));
    await openNodeMenu("user initial question");
    await click(menuItem(label));
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith({ entryId: "root", summarize });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("导航失败");
    await openNodeMenu("user needle follow-up");
    await click(menuItem(label));
    expect(props.onNavigate).toHaveBeenLastCalledWith({ entryId: "follow", summarize });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  },
);

it("菜单标签编辑右键目标，删除确认包含被筛选隐藏的完整子树", async () => {
  const props = await renderScreen({ onDelete: vi.fn() });
  await click(button("切换为树形视图"));
  await openNodeMenu("user initial question");
  await click(menuItem("标签"));
  const input = container.querySelector<HTMLInputElement>('[aria-label="条目标签"]')!;
  expect(document.activeElement).toBe(input);
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "检查点");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(props.onLabel).toHaveBeenCalledExactlyOnceWith({ entryId: "root", label: "检查点" });
  await openNodeMenu("user initial question");
  await click(menuItem("删除"));
  const dialog = () => container.querySelector('[role="alertdialog"]')!;
  expect(dialog().textContent).toContain("4 个节点");
  expect(props.onDelete).not.toHaveBeenCalled();
  await click(Array.from(dialog().querySelectorAll("button")).find((item) => item.textContent === "取消")!);
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  expect(props.onDelete).not.toHaveBeenCalled();
  await openNodeMenu("user initial question");
  await click(menuItem("删除"));
  await click(Array.from(dialog().querySelectorAll("button")).find((item) => item.textContent === "确认删除")!);
  expect(props.onDelete).toHaveBeenCalledExactlyOnceWith({
    entryId: "root", entryIds: ["root", "hidden", "follow", "leaf"],
  });
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
});
