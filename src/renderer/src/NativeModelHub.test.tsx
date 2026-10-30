import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeModelHub } from "./NativeModelHub";
import { hubSnapshot } from "./model-hub-test-fixture";
import { setup, cleanup, render, container } from "./transcript-test-harness";
import type { NativeModelAction } from "../../shared/native-model";

beforeEach(setup);
afterEach(cleanup);

it("模型智力值使用原生分数和脑子图标，未知值不补造", async () => {
  const snapshot = {
    ...hubSnapshot,
    models: hubSnapshot.models.map((model, index) => ({
      ...model,
      intelligence: index === 0 ? 52 : undefined,
    })),
  };
  await render(
    <NativeModelHub
      snapshot={snapshot}
      onAction={vi.fn(async () => snapshot)}
      onClose={vi.fn()}
      temporary
    />,
  );
  const scores = container.querySelectorAll(
    ".model-hub-model .model-intelligence",
  );
  expect(scores[0].textContent).toBe("🧠 52");
  expect(scores[0].getAttribute("aria-label")).toBe("智力值 52");
  expect(scores[1].textContent).toBe("—");
});

async function key(value: string, options: KeyboardEventInit = {}) {
  await act(() =>
    container.querySelector("[role=dialog]")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    ),
  );
}

async function clickLabel(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(button, label).toBeTruthy();
  await act(() => button!.click());
}

async function typeQuery(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    "[aria-label='Search models']",
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("匹配原生角色选择、先保存再调思考、Esc返回角色页的层级", async () => {
  const onAction = vi.fn(async () => hubSnapshot);
  const onClose = vi.fn();
  await render(
    <NativeModelHub
      snapshot={hubSnapshot}
      onAction={onAction}
      onClose={onClose}
    />,
  );
  await clickLabel("Roles2");
  await key("Enter");
  expect(container.textContent).toContain("Assign default");
  await key("Enter");
  expect(onAction).toHaveBeenCalledWith({
    op: "assign",
    role: "default",
    selector: "test/one",
    scope: "global",
    thinkingLevel: "low",
  });
  expect(container.textContent).toContain("default · Thinking");
  await key("Escape");
  expect(container.querySelector("[aria-label='Model roles']")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  await key("Escape");
  expect(onClose).toHaveBeenCalledOnce();
});

it("搜索使用原生排名，Esc先清空搜索；Tab和方向键切换左右面板", async () => {
  const onAction = vi.fn(async (action: NativeModelAction) =>
    action.op === "search"
      ? { ...hubSnapshot, query: action.query, matches: ["test/two"] }
      : hubSnapshot,
  );
  const onClose = vi.fn();
  await render(
    <NativeModelHub
      snapshot={hubSnapshot}
      onAction={onAction}
      onClose={onClose}
    />,
  );
  await typeQuery("two");
  expect(onAction).toHaveBeenCalledWith({ op: "search", query: "two" });
  expect(container.querySelectorAll(".model-hub-model")).toHaveLength(1);
  await key("Escape");
  expect(onClose).not.toHaveBeenCalled();
  await key("ArrowLeft");
  expect(container.querySelector(".model-hub-sidebar")?.className).toContain(
    "has-focus",
  );
  await key("Tab");
  expect(container.querySelector(".model-hub-main")?.className).toContain(
    "has-focus",
  );
});

it("临时选择只发临时动作，@角色按Ctrl+P顺序选择", async () => {
  const onAction = vi.fn(async () => hubSnapshot);
  const onClose = vi.fn();
  await render(
    <NativeModelHub
      snapshot={hubSnapshot}
      onAction={onAction}
      onClose={onClose}
      temporary
    />,
  );
  expect(container.querySelector(".is-temporary")).toBeTruthy();
  await typeQuery("@");
  const roles = [...container.querySelectorAll(".model-hub-quick strong")].map(
    (item) => item.textContent,
  );
  expect(roles).toEqual(["@smol", "@default"]);
  await key("ArrowDown");
  await key("Enter");
  expect(onAction).toHaveBeenCalledWith({
    op: "applyRole",
    role: "default",
    target: "session",
  });
  expect(onClose).toHaveBeenCalledOnce();
});

it("原生失败保持页面并显示错误，预设快捷键不会静默成功", async () => {
  const onAction = vi.fn(async () => {
    throw new Error("原生预设模型不可用");
  });
  const onClose = vi.fn();
  await render(
    <NativeModelHub
      snapshot={hubSnapshot}
      onAction={onAction}
      onClose={onClose}
    />,
  );
  await clickLabel("Roles2");
  await key("ArrowRight", { ctrlKey: true });
  expect(onAction).toHaveBeenCalledWith({
    op: "switchPreset",
    name: "quality",
  });
  expect(container.querySelector("[role=alert]")?.textContent).toContain(
    "原生预设模型不可用",
  );
  expect(onClose).not.toHaveBeenCalled();
});

it("Task选择只修改子代理目标，重复Alt+P不反复切换", async () => {
  const onAction = vi.fn(async () => hubSnapshot);
  await render(
    <NativeModelHub
      snapshot={hubSnapshot}
      onAction={onAction}
      onClose={vi.fn()}
      temporary
    />,
  );
  await key("p", { altKey: true });
  await key("p", { altKey: true, repeat: true });
  expect(container.querySelector('[aria-label="Switch Task Model"]')).not.toBeNull();
  await key("ArrowDown");
  await key("Enter");
  expect(onAction).toHaveBeenCalledWith({
    op: "temporary",
    selector: "test/two",
    target: "task",
  });
});

it("异步搜索期间Enter不能选择旧结果，返回后按原生排名应用", async () => {
  let resolveSearch!: (value: typeof hubSnapshot) => void;
  const onAction = vi.fn((action: NativeModelAction) => action.op === "search"
    ? new Promise<typeof hubSnapshot>((resolve) => { resolveSearch = resolve; })
    : Promise.resolve(hubSnapshot));
  const onClose = vi.fn();
  await render(<NativeModelHub snapshot={hubSnapshot} onAction={onAction} onClose={onClose} temporary />);
  await typeQuery("two");
  await key("Enter");
  expect(onAction.mock.calls.some(([action]) => action.op === "temporary")).toBe(false);
  await act(() => resolveSearch({ ...hubSnapshot, query: "two", matches: ["test/two"] }));
  await key("Enter");
  expect(onAction.mock.calls.filter(([action]) => action.op === "temporary")).toEqual([
    [{ op: "temporary", selector: "test/two", target: "session" }],
  ]);
  expect(onClose).toHaveBeenCalledOnce();
});

it("输入法确认不会切换模型，临时选择排除非聊天类型且失败保留选择", async () => {
  const snapshot = {
    ...hubSnapshot,
    models: [{ ...hubSnapshot.models[0], selector: "test/image", kind: "image" }, ...hubSnapshot.models],
  };
  const onAction = vi.fn().mockRejectedValue(new Error("切换失败"));
  const onClose = vi.fn();
  await render(<NativeModelHub snapshot={snapshot} onAction={onAction} onClose={onClose} temporary />);
  await key("Enter", { isComposing: true });
  expect(onAction).not.toHaveBeenCalled();
  await key("Enter");
  expect(onAction).toHaveBeenCalledExactlyOnceWith({ op: "temporary", selector: "test/one", target: "session" });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("切换失败");
  expect(onClose).not.toHaveBeenCalled();
});
