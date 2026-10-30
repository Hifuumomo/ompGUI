// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  NativeTreeScreen,
  type NativeTreeScreenProps,
} from "./NativeTreeScreen";
import type { TreeNode } from "../../shared/protocol";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;
const tree: TreeNode[] = [
  {
    entry: {
      type: "message",
      id: "user",
      parentId: null,
      timestamp: "2026-10-15",
      message: { role: "user", content: "initial question" },
    },
    children: [
      {
        entry: {
          type: "message",
          id: "answer",
          parentId: "user",
          timestamp: "2026-10-15",
          message: { role: "assistant", content: "the answer" },
        },
        children: [],
      },
    ],
  },
];

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

/** 渲染注入真实边界回调的组件。[in] options：覆盖属性。返回值：操作观察器。 */
async function renderTree(options: Partial<NativeTreeScreenProps> = {}) {
  const props: NativeTreeScreenProps = {
    tree,
    leafId: "answer",
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onLabel: vi.fn(),
    ...options,
  };
  await act(() => root.render(<NativeTreeScreen {...props} />));
  return props;
}

/** 触发实际DOM键盘冒泡。[in] key：按键；[in] options：修饰键。返回值：完成。 */
async function press(key: string, options: KeyboardEventInit = {}) {
  await act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
}

/** 通过原生input setter触发React输入。[in] input：元素；[in] value：值。返回值：完成。 */
async function type(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("删除前确认完整子树，取消不写入，确认才提交", async () => {
  const onDelete = vi.fn();
  await renderTree({ onDelete });
  await press("ArrowUp");
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "删除节点及子节点",
  )!;
  await act(() => button.click());
  expect(
    container.querySelector('[role="alertdialog"]')?.textContent,
  ).toContain("共 2 个节点");
  expect(onDelete).not.toHaveBeenCalled();
  await press("Escape");
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  await act(() => button.click());
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((node) => node.textContent === "确认删除")!
      .click(),
  );
  expect(onDelete).toHaveBeenCalledExactlyOnceWith({
    entryId: "user",
    entryIds: ["user", "answer"],
  });
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
});

it("删除失败保留确认窗口、显示错误且不触发导航", async () => {
  const onDelete = vi.fn(async () => {
    throw new Error("写入失败，已恢复原会话");
  });
  const props = await renderTree({ onDelete });
  await act(() =>
    [...container.querySelectorAll("button")]
      .find((node) => node.textContent === "删除节点及子节点")!
      .click(),
  );
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((node) => node.textContent === "确认删除")!
      .click(),
  );
  expect(
    container.querySelector('[role="alertdialog"]')?.textContent,
  ).toContain("写入失败，已恢复原会话");
  expect(props.onNavigate).not.toHaveBeenCalled();
});

it("覆盖全屏并默认选中当前叶，键盘Enter传递原生目标", async () => {
  const props = await renderTree();
  expect(container.querySelector('[role="dialog"]')?.className).toBe(
    "native-tree-screen",
  );
  expect(
    container.querySelector('[role="option"][aria-selected="true"]')?.id,
  ).toBe("native-tree-answer");
  await press("ArrowUp");
  await press("Enter", { shiftKey: true });
  expect(props.onNavigate).toHaveBeenCalledWith({
    entryId: "user",
    summarize: true,
  });
});

it("Esc先清除查询，再关闭，不触发上层快捷键", async () => {
  const props = await renderTree();
  const parent = vi.fn();
  window.addEventListener("keydown", parent);
  const search = container.querySelector<HTMLInputElement>(
    '[aria-label="搜索会话树"]',
  )!;
  await type(search, "question");
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
  await press("Escape");
  expect(search.value).toBe("");
  expect(props.onClose).not.toHaveBeenCalled();
  await press("Escape");
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(parent).not.toHaveBeenCalled();
  window.removeEventListener("keydown", parent);
});

it("Shift L编辑标签，留空保存明确传递删除标签", async () => {
  const props = await renderTree();
  await press("L", { shiftKey: true });
  expect(container.querySelector('[aria-label="条目标签"]')).not.toBeNull();
  await act(() => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(props.onLabel).toHaveBeenCalledWith({
    entryId: "answer",
    label: undefined,
  });
  expect(container.querySelector('[aria-label="条目标签"]')).toBeNull();
});

it("导航失败展示真实错误并保留树", async () => {
  await renderTree({
    onNavigate: async () => {
      throw new Error("native navigation rejected");
    },
  });
  await press("Enter");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "native navigation rejected",
  );
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
});

it("空搜索结果不会把旧目标送入原生导航", async () => {
  const props = await renderTree();
  await type(
    container.querySelector<HTMLInputElement>('[aria-label="搜索会话树"]')!,
    "unmatched",
  );
  await press("Enter");
  expect(props.onNavigate).not.toHaveBeenCalled();
  expect(container.textContent).toContain("没有条目匹配");
});

it("原生问答挂起树键盘且保留筛选与选择，取消问答后继续导航", async () => {
  const props = await renderTree();
  const search = container.querySelector<HTMLInputElement>(
    '[aria-label="搜索会话树"]',
  )!;
  await type(search, "question");
  await act(() => root.render(<NativeTreeScreen {...props} suspended />));
  expect(
    container.querySelector('[role="dialog"]')?.hasAttribute("inert"),
  ).toBe(true);
  await press("Enter");
  await press("Escape");
  expect(props.onNavigate).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(search.value).toBe("question");
  await act(() =>
    root.render(<NativeTreeScreen {...props} suspended={false} />),
  );
  expect(
    container.querySelector('[role="option"][aria-selected="true"]')?.id,
  ).toBe("native-tree-user");
  await press("Enter");
  expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith({
    entryId: "user",
    summarize: false,
  });
});

it("输入法选词不导航，document上的键盘事件不会抛出closest错误", async () => {
  const props = await renderTree();
  await press("Enter", { isComposing: true });
  expect(props.onNavigate).not.toHaveBeenCalled();
  await act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
  });
  await act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith({
    entryId: "user",
    summarize: false,
  });
});

it("焦点位于树行按钮时Shift Enter仍请求总结导航", async () => {
  const props = await renderTree();
  const row = container.querySelector<HTMLButtonElement>("#native-tree-user")!;
  await act(() => row.focus());
  await press("Enter", { shiftKey: true, isComposing: true });
  expect(props.onNavigate).not.toHaveBeenCalled();
  await press("Enter", { shiftKey: true });
  expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith({
    entryId: "user",
    summarize: true,
  });
});
