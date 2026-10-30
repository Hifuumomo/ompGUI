import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { container, render } from "./transcript-test-harness";
import { hubSnapshot } from "./model-hub-test-fixture";
import type { NativeModelAction } from "../../shared/native-model";
import type { NativeModelSnapshot } from "../../shared/native-model";

const snapshot: NativeModelSnapshot = {
  models: [],
  roles: [],
  providers: [],
  recent: [],
  cycleOrder: [],
  fallbackChains: {},
  presets: { names: [] },
  storage: "global",
  query: "",
  matches: [],
};
const originalBridge = Object.getOwnPropertyDescriptor(window, "desktop");
afterEach(() => {
  if (originalBridge) Object.defineProperty(window, "desktop", originalBridge);
  else Reflect.deleteProperty(window, "desktop");
});

async function openCommand(command: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>(
    ".composer-box textarea",
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, command);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>(".send-button")!.click();
  });
}

function boundary(failure = false) {
  const start = vi.fn();
  const request = vi.fn();
  const modelRequest = vi.fn(async ({ type }: { type: string }) => {
    if (failure) throw new Error("原生模型目录读取失败");
    if (type === "model_hub") return snapshot;
    if (type === "get_state") return {};
    throw new Error(`意外模型请求：${type}`);
  });
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: {
      setZoomFactor: () => {},
      preferences: async () => ({ executable: "test", cwd: "D:/test" }),
      listSessions: async () => [],
      onFrame: () => () => {},
      ...offPlanBridge,
      prepareModels: async () => ({}),
      modelRequest,
      request,
      start,
    },
  });
  return { start, request, modelRequest };
}

it("/model 在未连接聊天时打开原生模型管理，不发送提示词或启动聊天", async () => {
  const api = boundary();
  await render(<App />);
  await openCommand("/model");
  expect(api.modelRequest).toHaveBeenCalledWith({
    type: "model_hub",
    action: { op: "list" },
  });
  expect(container.querySelector(".native-model-hub")).not.toBeNull();
  expect(api.start).not.toHaveBeenCalled();
  expect(api.request).not.toHaveBeenCalled();
  expect(
    container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!
      .value,
  ).toBe("");
});

it("模型目录失败明确显示且保留 /model 草稿", async () => {
  const api = boundary(true);
  await render(<App />);
  await openCommand("/model");
  expect(container.textContent).toContain("原生模型目录读取失败");
  expect(
    container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!
      .value,
  ).toBe("/model");
  expect(api.start).not.toHaveBeenCalled();
});

it("Alt+P打开临时选择器，选择成功关闭且不启动聊天或修改持久化角色", async () => {
  const api = boundary();
  let current = hubSnapshot.models[0];
  api.modelRequest.mockImplementation(async (command: { type: string; action?: NativeModelAction }) => {
    const action = command.action;
    if (command.type === "get_state") return { model: current, thinkingLevel: "high" };
    if (command.type === "model_hub") {
      if (action?.op === "temporary") current = hubSnapshot.models.find((model) => model.selector === action.selector)!;
      return { ...hubSnapshot, currentSelector: current.selector };
    }
    throw new Error(`意外模型请求：${command.type}`);
  });
  await render(<App />);
  const composer = container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!;
  await act(() => {
    composer.focus();
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "p", altKey: true, bubbles: true }));
  });
  expect(container.querySelector('[aria-label="Switch Model"]')).not.toBeNull();
  expect(document.activeElement).toBe(container.querySelector('[aria-label="Search models"]'));
  await act(() => container.querySelectorAll<HTMLButtonElement>(".model-hub-model")[1].click());
  expect(container.querySelector('[aria-label="Switch Model"]')).toBeNull();
  expect(container.querySelector(".model-button")?.textContent).toContain(current.name);
  expect(document.activeElement).toBe(composer);
  expect(api.modelRequest).toHaveBeenCalledWith({
    type: "model_hub", action: { op: "temporary", selector: "test/two", target: "session" },
  });
  expect(api.start).not.toHaveBeenCalled();
  expect(api.request).not.toHaveBeenCalled();
});
