import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeAgentsHub } from "./NativeAgentsHub";
import { agentsSnapshot } from "./agents-hub-test-fixture";
import { container, render } from "./transcript-test-harness";
import type { AgentsAction } from "../../shared/native-agents";

beforeEach(() => vi.stubGlobal("desktop", { onFrame: () => () => {} }));
afterEach(() => vi.unstubAllGlobals());

async function key(key: string, options: KeyboardEventInit = {}) {
  await act(() => {
    const target = document.activeElement?.closest(".native-agents-hub")
      ? document.activeElement!
      : container.querySelector("[role=dialog]")!;
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
}

async function click(text: string) {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((node) => node.textContent === text);
  expect(button, text).toBeTruthy();
  await act(() => button!.click());
}

async function input(label: string, value: string) {
  const node = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label='${label}']`,
  )!;
  await act(() => {
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function mount(
  onAction = vi.fn(async (_action: AgentsAction) => agentsSnapshot),
) {
  const close = vi.fn();
  await render(
    <NativeAgentsHub
      snapshot={agentsSnapshot}
      onAction={onAction}
      onClose={close}
    />,
  );
  return { onAction, close };
}

it("Space 启停，Enter 配置，Esc 逐级返回且不会直接关闭", async () => {
  const api = await mount();
  await key(" ");
  expect(api.onAction).toHaveBeenCalledWith({
    op: "toggle",
    name: "project-reviewer",
    disabled: true,
    query: "",
  });
  await key("Enter");
  expect(container.querySelector(".agents-strip")).toBeTruthy();
  await act(() => (document.activeElement as HTMLButtonElement).click());
  await click("输入表达式…");
  await input("模型表达式", "@smol");
  await key("Escape");
  expect(container.querySelector("[aria-label='模型表达式']")).toBeNull();
  await key("Escape");
  expect(container.textContent).toContain("配置代理");
  await key("Escape");
  expect(container.querySelector(".agents-strip")).toBeNull();
  expect(api.close).not.toHaveBeenCalled();
  await key("Escape");
  expect(api.close).toHaveBeenCalledOnce();
});

it("模型选择和 Prewalk 开关写入对应代理属性", async () => {
  const api = await mount();
  await key("Enter");
  await act(() => (document.activeElement as HTMLButtonElement).click());
  await click("选择模型…");
  await input("搜索代理模型", "Two");
  await key("Enter");
  expect(api.onAction).toHaveBeenCalledWith({
    op: "override",
    name: "project-reviewer",
    property: "model",
    value: "test/two",
    query: "",
  });
  await key("Enter");
  await click("Prewalk on");
  await click("关闭");
  expect(api.onAction).toHaveBeenCalledWith({
    op: "override",
    name: "project-reviewer",
    property: "prewalk",
    value: "off",
    query: "",
  });
});

it("原生搜索与来源过滤组合，Esc 先清除搜索", async () => {
  const action = vi.fn(async (request: AgentsAction) => ({
    ...agentsSnapshot,
    query: request.query ?? "",
    matches: request.query ? ["scout"] : agentsSnapshot.matches,
  }));
  const api = await mount(action);
  await input("搜索代理", "sct");
  expect(container.querySelectorAll(".agents-row")).toHaveLength(1);
  expect(container.querySelector(".agents-row")?.textContent).toContain(
    "scout",
  );
  await key("Escape");
  expect(container.querySelectorAll(".agents-row")).toHaveLength(2);
  expect(api.close).not.toHaveBeenCalled();
  await key("ArrowLeft");
  await key("ArrowDown");
  expect(container.querySelectorAll(".agents-row")).toHaveLength(1);
  expect(container.querySelector(".agents-row")?.textContent).toContain(
    "project-reviewer",
  );
});

it("搜索失败只显示错误，不自动重试；可 Ctrl+R 重试", async () => {
  const action = vi.fn(async (_request: AgentsAction) => {
    throw new Error("代理目录读取失败");
  });
  await mount(action);
  await input("搜索代理", "test");
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "代理目录读取失败",
  );
  expect(action).toHaveBeenCalledTimes(1);
  await key("r", { ctrlKey: true });
  expect(action).toHaveBeenCalledTimes(2);
});

it("从侧栏新建后 Esc 返回完整列表", async () => {
  const api = await mount();
  await click("+ 新建代理");
  expect(container.querySelector(".agents-create")).toBeTruthy();
  await key("Escape");
  expect(container.querySelectorAll(".agents-row")).toHaveLength(2);
  expect(api.close).not.toHaveBeenCalled();
});

it("编辑表达式保留光标方向键，提交空值清除覆盖", async () => {
  const api = await mount();
  await key("Enter");
  await act(() => (document.activeElement as HTMLButtonElement).click());
  await click("输入表达式…");
  const field = container.querySelector<HTMLInputElement>(
    "[aria-label='模型表达式']",
  )!;
  const arrow = new KeyboardEvent("keydown", {
    key: "ArrowLeft",
    bubbles: true,
    cancelable: true,
  });
  await act(() => field.dispatchEvent(arrow));
  expect(arrow.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(field);
  await act(() =>
    field
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(api.onAction).toHaveBeenCalledWith({
    op: "override",
    name: "project-reviewer",
    property: "model",
    value: undefined,
    query: "",
  });
});

it("生成后显示预览，切换保存范围并显式保存；失败保留预览", async () => {
  const spec = {
    identifier: "test-agent",
    whenToUse: "Use this agent when testing",
    systemPrompt: "Test the change.",
  };
  const action = vi.fn(async (request: AgentsAction) => {
    if (request.op === "generate") return { ...agentsSnapshot, spec };
    if (request.op === "save") throw new Error("Agent file already exists");
    return agentsSnapshot;
  });
  await mount(action);
  await click("＋ 新建代理…");
  await input("代理用途描述", "Review changes");
  await key("Enter", { ctrlKey: true });
  expect(container.textContent).toContain("test-agent");
  expect(action).toHaveBeenCalledTimes(1);
  await key("Tab");
  await click("保存代理");
  expect(action).toHaveBeenLastCalledWith({
    op: "save",
    scope: "user",
    spec,
    query: "",
  });
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "already exists",
  );
  expect(container.querySelector(".agents-create-preview")).toBeTruthy();
});
