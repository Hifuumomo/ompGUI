import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { container, render } from "./transcript-test-harness";
import { agentsSnapshot } from "./agents-hub-test-fixture";

afterEach(() => vi.unstubAllGlobals());

function boundary(failure = false) {
  const start = vi.fn();
  const request = vi.fn();
  const modelRequest = vi.fn(async ({ type }: { type: string }) => {
    if (failure) throw new Error("原生代理目录读取失败");
    if (type === "agents_hub") return agentsSnapshot;
    if (type === "get_state") return {};
    throw new Error(`Unexpected request ${type}`);
  });
  vi.stubGlobal("desktop", {
    setZoomFactor: () => {},
    preferences: async () => ({ executable: "test", cwd: "D:/test" }),
    listSessions: async () => [],
    onFrame: () => () => {},
    ...offPlanBridge,
    prepareModels: async () => ({}),
    modelRequest,
    request,
    start,
  });
  return { start, request, modelRequest };
}

async function command(value: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>(
    ".composer-box textarea",
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() =>
    container.querySelector<HTMLButtonElement>(".send-button")!.click(),
  );
}

it("/agents 未连接时直接打开原生代理管理，不启动聊天或发送提示词", async () => {
  const api = boundary();
  await render(<App />);
  await command("/agents");
  expect(api.modelRequest).toHaveBeenCalledWith({
    type: "agents_hub",
    action: { op: "list" },
  });
  expect(container.querySelector(".native-agents-hub")).toBeTruthy();
  expect(api.start).not.toHaveBeenCalled();
  expect(api.request).not.toHaveBeenCalled();
  expect(
    container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!
      .value,
  ).toBe("");
});

it("读取失败保留命令和明确错误", async () => {
  const api = boundary(true);
  await render(<App />);
  await command("/agents");
  expect(container.textContent).toContain("原生代理目录读取失败");
  expect(
    container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!
      .value,
  ).toBe("/agents");
  expect(api.start).not.toHaveBeenCalled();
});

it("拒绝多余参数且不会误发模型", async () => {
  const api = boundary();
  await render(<App />);
  await command("/agents extra");
  expect(container.textContent).toContain("无需参数");
  expect(api.request).not.toHaveBeenCalled();
  expect(api.modelRequest).not.toHaveBeenCalled();
});
