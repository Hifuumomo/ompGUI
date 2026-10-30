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
const tree: TreeNode[] = [
  {
    entry: {
      id: "user",
      parentId: null,
      type: "message",
      timestamp: "",
      message: { role: "user", content: "question" },
    },
    children: [],
  },
];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

/** 创建可由测试完成的真实异步边界。[in] 无。返回值：等待操作及完成器。 */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** 渲染全屏树并观察注入边界。[in] options：覆盖属性。返回值：操作属性。 */
async function renderTree(options: Partial<NativeTreeScreenProps>) {
  const props = {
    tree,
    leafId: "user",
    onNavigate: vi.fn(),
    onLabel: vi.fn(),
    onClose: vi.fn(),
    ...options,
  };
  await act(() => root.render(<NativeTreeScreen {...props} />));
  return props;
}

/** 发送真实捕获键盘事件。[in] key：按键；[in] options：修饰键。返回值：完成。 */
async function press(key: string, options: KeyboardEventInit = {}) {
  await act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
}

/** 获取关闭/取消导航按钮。[in] 无。返回值：标题按钮。 */
function closeButton() {
  return container.querySelector<HTMLButtonElement>(
    ".native-tree-toolbar button",
  )!;
}

it.each(["Escape", "CtrlC", "button", "buttonEnter"])(
  "导航进行中%s请求一次取消并等待原导航结束，保留树页面",
  async (trigger) => {
    const operation = deferred();
    const onCancelNavigation = vi.fn();
    const props = await renderTree({
      onNavigate: () => operation.promise,
      onCancelNavigation,
    });
    await press("Enter", { shiftKey: true });
    if (trigger.startsWith("button"))
      await act(() => {
        const enter = new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        });
        closeButton().dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(false);
        closeButton().click();
      });
    else
      await press(trigger === "CtrlC" ? "c" : trigger, {
        ctrlKey: trigger === "CtrlC",
      });
    await press("Escape");
    expect(onCancelNavigation).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(closeButton().textContent).toBe("正在取消…");
    expect(closeButton().disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[role="option"]')!.disabled,
    ).toBe(true);
    await act(() => operation.reject(new Error("branch summary aborted")));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "branch summary aborted",
    );
    expect(closeButton().disabled).toBe(false);
    expect(props.onClose).not.toHaveBeenCalled();
  },
);

it("缺少真实取消回调时不伪造中止也不关闭页面", async () => {
  const operation = deferred();
  const props = await renderTree({ onNavigate: () => operation.promise });
  await press("Enter");
  expect(closeButton().disabled).toBe(true);
  expect(closeButton().textContent).toBe("处理中…");
  await press("Escape");
  await press("c", { ctrlKey: true });
  expect(props.onClose).not.toHaveBeenCalled();
  await act(() => operation.resolve());
  expect(closeButton().disabled).toBe(false);
});

it("标签写入中不能关闭或取消，失败保留编辑器与原始错误", async () => {
  const operation = deferred();
  const onCancelNavigation = vi.fn();
  const props = await renderTree({
    onLabel: () => operation.promise,
    onCancelNavigation,
  });
  await press("L", { shiftKey: true });
  await act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await press("Escape");
  await press("c", { ctrlKey: true });
  await act(() => closeButton().click());
  expect(onCancelNavigation).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(closeButton().disabled).toBe(true);
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="条目标签"]')!
      .disabled,
  ).toBe(true);
  await act(() => operation.reject(new Error("label write failed")));
  expect(container.querySelector('[aria-label="条目标签"]')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "label write failed",
  );
});

it("同一渲染周期连续确认只提交一次，并能立即取消", async () => {
  const operation = deferred();
  const onNavigate = vi.fn(() => operation.promise);
  const onCancelNavigation = vi.fn();
  await renderTree({ onNavigate, onCancelNavigation });
  await act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(onCancelNavigation).toHaveBeenCalledOnce();
  await act(() => operation.resolve());
});

it("取消接口失败明确展示且允许重试，原导航仍保持等待", async () => {
  const operation = deferred();
  const onCancelNavigation = vi
    .fn()
    .mockRejectedValueOnce(new Error("abort transport failed"))
    .mockResolvedValueOnce(undefined);
  await renderTree({ onNavigate: () => operation.promise, onCancelNavigation });
  await press("Enter");
  await press("Escape");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "abort transport failed",
  );
  expect(closeButton().disabled).toBe(false);
  expect(
    container.querySelector<HTMLButtonElement>('[role="option"]')!.disabled,
  ).toBe(true);
  await press("Escape");
  expect(onCancelNavigation).toHaveBeenCalledTimes(2);
  await act(() => operation.resolve());
});
