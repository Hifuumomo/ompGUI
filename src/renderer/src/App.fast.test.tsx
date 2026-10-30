import { act } from "react";
import { afterEach, expect, it, vi, type Mock } from "vitest";
import type { PlanSnapshot } from "../../shared/native-plan";
import type { RpcCommand, RpcFrame, SessionState } from "../../shared/protocol";
import App from "./App";
import { FAST_SHORTCUT } from "./fast-mode";
import { offPlanBridge } from "./plan-test-fixture";
import { container, render } from "./transcript-test-harness";

const originalBridge = Object.getOwnPropertyDescriptor(window, "desktop");
afterEach(() => {
  if (originalBridge) Object.defineProperty(window, "desktop", originalBridge);
  else Reflect.deleteProperty(window, "desktop");
});

/** 使用真实 App 和按钮，仅替换原生边界；允许暂停命令与刷新以验证竞态。 */
async function mount(options: { connected?: boolean; state?: Partial<SessionState> } = {}) {
  const listeners = new Set<(frame: RpcFrame) => void>();
  let state: SessionState = {
    sessionId: "fast-test", sessionFile: "D:/fast.jsonl", isStreaming: false,
    isCompacting: false, isSettled: true, messageCount: 0, queuedMessageCount: 0,
    fastModeEnabled: false, fastModeActive: false, ...options.state,
  };
  let plan: PlanSnapshot = {
    identity: { sessionId: state.sessionId, sessionFile: state.sessionFile!, epoch: "fast-epoch" },
    phase: "off", busy: false,
  };
  const handlers: Record<string, (command: RpcCommand) => unknown> = {};
  const request = vi.fn(async (command: RpcCommand) => {
    if (handlers[command.type]) return handlers[command.type](command);
    switch (command.type) {
      case "get_state": return state;
      case "get_entries": return { entries: [], leafId: null };
      case "get_btw_history": return { records: [] };
      case "set_fast_mode": {
        const enabled = command.enabled === true;
        state = { ...state, fastModeEnabled: enabled, fastModeActive: enabled };
        return { enabled, active: enabled };
      }
      default: throw new Error(`意外 RPC：${command.type}`);
    }
  });
  const start = vi.fn();
  const modelRequest = vi.fn(async ({ type }: { type: string }) => {
    if (type === "get_state") return {};
    throw new Error(`意外模型请求：${type}`);
  });
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: {
      ...offPlanBridge,
      setZoomFactor() {},
      preferences: async () => ({ executable: "omp.exe", cwd: "D:/workspace" }),
      listSessions: async () => [], prepareModels: async () => ({}),
      plan: async () => plan,
      onFrame: (listener: (frame: RpcFrame) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      start, request, modelRequest,
    },
  });
  await render(<App />);
  const emit = async (frame: RpcFrame) => {
    await act(async () => { listeners.forEach(listener => listener(frame)); });
  };
  if (options.connected !== false) {
    await emit({ type: "desktop_status", status: "connected" });
    await emit({ type: "session_info_update" });
  }
  request.mockClear();
  return {
    request, start, modelRequest, handlers, emit,
    getState: () => state,
    setState: (next: Partial<SessionState>) => { state = { ...state, ...next }; },
    setPlan: async (next: Partial<PlanSnapshot>) => {
      plan = { ...plan, ...next };
      await emit({ type: "plan_state", snapshot: plan });
    },
  };
}

function toggle() {
  return container.querySelector<HTMLButtonElement>('button[aria-label="Fast 模式"]')!;
}
async function clickToggle() { await act(() => toggle().click()); }
async function shortcut(init: KeyboardEventInit = {}) {
  await act(() => window.dispatchEvent(new KeyboardEvent("keydown", {
    key: "f", altKey: true, bubbles: true, cancelable: true, ...init,
  })));
}
function fastCommands(api: { request: Mock<(command: RpcCommand) => Promise<unknown>> }) {
  return api.request.mock.calls.filter(([command]) => command.type === "set_fast_mode");
}

it("已连接空闲时按钮开启 Fast，随后刷新原生状态；再次点击关闭", async () => {
  const api = await mount();
  expect(toggle().disabled).toBe(false);
  expect(toggle().getAttribute("data-phase")).toBe("off");
  await clickToggle();
  expect(api.request.mock.calls[0][0]).toEqual({ type: "set_fast_mode", enabled: true });
  expect(api.request.mock.calls[1][0]).toEqual({ type: "get_state" });
  expect(toggle().getAttribute("data-phase")).toBe("on");
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  await clickToggle();
  expect(fastCommands(api).map(([command]) => command)).toEqual([
    { type: "set_fast_mode", enabled: true }, { type: "set_fast_mode", enabled: false },
  ]);
  expect(toggle().getAttribute("data-phase")).toBe("off");
  expect(api.modelRequest).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
});

it("get_state 已开启时点击发送 enabled:false，而非依赖本地默认值", async () => {
  const api = await mount({ state: { fastModeEnabled: true, fastModeActive: false } });
  expect(toggle().getAttribute("data-phase")).toBe("degraded");
  await clickToggle();
  expect(fastCommands(api)[0][0]).toEqual({ type: "set_fast_mode", enabled: false });
  expect(toggle().getAttribute("data-phase")).toBe("off");
});

it("忙碌时按钮与 Alt+F 都不发送 Fast 请求", async () => {
  const api = await mount({ state: { isStreaming: true, isSettled: false } });
  expect(toggle().disabled).toBe(true);
  await clickToggle();
  await shortcut();
  expect(fastCommands(api)).toEqual([]);
});

it("后端拒绝时显示原文且不乐观更新按钮，之后允许重试", async () => {
  const api = await mount();
  const message = "[set_fast_mode] Fast mode is unavailable for the current model.";
  api.handlers.set_fast_mode = () => { throw new Error(message); };
  await clickToggle();
  expect(container.textContent).toContain(message);
  expect(toggle().getAttribute("data-phase")).toBe("off");
  expect(toggle().getAttribute("aria-pressed")).toBe("false");
  expect(toggle().hasAttribute("aria-busy")).toBe(false);
  expect(toggle().disabled).toBe(false);
  expect(api.request).toHaveBeenCalledTimes(1);
  delete api.handlers.set_fast_mode;
  await clickToggle();
  expect(toggle().getAttribute("data-phase")).toBe("on");
});

it("未连接时按钮和快捷键禁用，不向模型准备进程发送 Fast", async () => {
  const api = await mount({ connected: false });
  expect(toggle().disabled).toBe(true);
  await clickToggle();
  await shortcut();
  expect(api.request).not.toHaveBeenCalled();
  expect(api.modelRequest).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
});

it("请求及完整历史刷新期间保持旧 phase、pressed 和 title，阻止同批连按与快捷键重入", async () => {
  const api = await mount({ state: { fastModeEnabled: true, fastModeActive: true, tokensPerSecond: 42 } });
  const acceptance = Promise.withResolvers<unknown>();
  const history = Promise.withResolvers<unknown>();
  api.handlers.set_fast_mode = () => acceptance.promise;
  api.handlers.get_entries = () => history.promise;
  const originalTitle = toggle().title;
  await act(() => {
    toggle().click();
    toggle().click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", altKey: true }));
  });
  expect(fastCommands(api)).toHaveLength(1);
  expect(toggle().getAttribute("aria-busy")).toBe("true");
  expect(toggle().getAttribute("data-phase")).toBe("on");
  await act(async () => {
    api.setState({ fastModeEnabled: false, fastModeActive: false, tokensPerSecond: null });
    acceptance.resolve({ enabled: false, active: false });
  });
  expect(api.request).toHaveBeenCalledWith({ type: "get_state" });
  expect(api.request).toHaveBeenCalledWith({ type: "get_entries" });
  expect(toggle().getAttribute("aria-busy")).toBe("true");
  expect(toggle().getAttribute("data-phase")).toBe("on");
  expect(toggle().getAttribute("aria-pressed")).toBe("true");
  expect(toggle().title).toBe(originalTitle);
  await shortcut();
  expect(fastCommands(api)).toHaveLength(1);
  await act(async () => history.resolve({ entries: [], leafId: null }));
  expect(toggle().hasAttribute("aria-busy")).toBe(false);
  expect(toggle().getAttribute("data-phase")).toBe("off");
  expect(toggle().disabled).toBe(false);
});

it("切换遇到已在途的刷新时 pending 等待该刷新及追加轮次完成", async () => {
  const api = await mount();
  const firstState = Promise.withResolvers<unknown>();
  const history = Promise.withResolvers<unknown>();
  const previous = api.getState();
  let first = true;
  api.handlers.get_state = () => {
    if (first) { first = false; return firstState.promise; }
    return api.getState();
  };
  api.handlers.get_entries = () => history.promise;
  await api.emit({ type: "session_info_update" });
  expect(toggle().disabled).toBe(false);
  await clickToggle();
  expect(fastCommands(api)).toHaveLength(1);
  expect(toggle().getAttribute("aria-busy")).toBe("true");
  await act(async () => firstState.resolve(previous));
  expect(toggle().getAttribute("aria-busy")).toBe("true");
  expect(toggle().getAttribute("data-phase")).toBe("off");
  await shortcut();
  expect(fastCommands(api)).toHaveLength(1);
  await act(async () => history.resolve({ entries: [], leafId: null }));
  expect(api.request.mock.calls.filter(([command]) => command.type === "get_state")).toHaveLength(4);
  expect(toggle().hasAttribute("aria-busy")).toBe(false);
  expect(toggle().getAttribute("data-phase")).toBe("on");
});

it.each([
  { repeat: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: false },
])("Alt+F 忽略重复或额外修饰键 %j", async modifiers => {
  const api = await mount();
  await shortcut(modifiers);
  expect(fastCommands(api)).toEqual([]);
});

it("Alt+F 大写键也通过同一切换路径刷新，并在两个帮助面板使用共享快捷键", async () => {
  const api = await mount();
  expect(container.querySelector(".welcome")?.textContent).toContain(FAST_SHORTCUT.replace("+", " "));
  await shortcut({ key: "F" });
  expect(fastCommands(api)[0][0]).toEqual({ type: "set_fast_mode", enabled: true });
  expect(toggle().getAttribute("data-phase")).toBe("on");
  await act(() => container.querySelector<HTMLButtonElement>('[aria-label="查看全部命令"]')!.click());
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain(`${FAST_SHORTCUT.replace("+", " ")} 切换 Fast 模式`);
});

it("历史刷新与计划应用期间按钮和快捷键一致禁用", async () => {
  const api = await mount();
  const history = Promise.withResolvers<unknown>();
  api.handlers.get_entries = () => history.promise;
  await api.emit({ type: "session_info_update" });
  expect(toggle().disabled).toBe(true);
  await shortcut();
  await clickToggle();
  expect(fastCommands(api)).toEqual([]);
  await act(async () => history.resolve({ entries: [], leafId: null }));
  expect(toggle().disabled).toBe(false);
  await api.setPlan({ phase: "applying", busy: true });
  expect(toggle().disabled).toBe(true);
  await shortcut();
  await clickToggle();
  expect(fastCommands(api)).toEqual([]);
});

it("后端回合中关闭 Fast 的 warning 原文保留，agent_end 已触发原生状态同步", async () => {
  const api = await mount({ state: { fastModeEnabled: true, fastModeActive: true } });
  await api.emit({ type: "agent_start" });
  const message = "Priority/fast mode rejected for this model; retried without it. Fast mode is now off.";
  await api.emit({ type: "extension_ui_request", id: "fast-warning", method: "notify", notifyType: "warning", message });
  expect(container.textContent).toContain(message);
  api.setState({ fastModeEnabled: false, fastModeActive: false });
  await api.emit({ type: "agent_end", isTerminal: true });
  expect(api.request).toHaveBeenCalledWith({ type: "get_state" });
  expect(toggle().getAttribute("data-phase")).toBe("off");
  expect(toggle().disabled).toBe(false);
});

it("模型变更后 phase 跟随刷新状态而非残留前一模型设置", async () => {
  const api = await mount({ state: { fastModeEnabled: true, fastModeActive: true } });
  api.setState({ fastModeActive: false });
  await api.emit({ type: "model_changed" });
  expect(toggle().getAttribute("data-phase")).toBe("degraded");
  api.setState({ fastModeEnabled: false });
  await api.emit({ type: "model_changed" });
  expect(toggle().getAttribute("data-phase")).toBe("off");
});
