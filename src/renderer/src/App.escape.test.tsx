import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { RpcCommand, RpcFrame } from "../../shared/protocol";
import App from "./App";
import { render, container } from "./transcript-test-harness";

const DOUBLE_ESCAPE_WINDOW_MS = 500;
const NOTICE = "连接具体会话 omp 后才能使用此功能。";
const summary = {
  path: "D:/sessions/one.jsonl",
  id: "one",
  cwd: "D:/workspace",
  title: "只读会话",
  timestamp: "2026-10-15",
  modified: 1,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** 隔离原生边界，未声明的 RPC 显式失败。 */
async function mount(
  options: {
    prepared?: boolean;
    sessionId?: string;
    startSuccess?: boolean;
  } = {},
) {
  vi.useFakeTimers();
  const listeners = new Set<(frame: RpcFrame) => void>();
  const responses: Record<string, unknown> = {
    get_state: {
      sessionId: options.sessionId ?? "one",
      isStreaming: false,
      isCompacting: false,
      isSettled: true,
      messageCount: 0,
      queuedMessageCount: 0,
    },
    get_entries: { entries: [], leafId: null },
    get_tree: { tree: [], leafId: null },
    get_btw_history: { records: [] },
    abort: {},
    get_available_commands: { commands: [] },
  };
  const request = vi.fn(async (command: RpcCommand) => {
    if (!Object.hasOwn(responses, command.type))
      throw new Error(`意外 RPC：${command.type}`);
    return responses[command.type];
  });
  const prepareModels = vi.fn(async () => ({ thinkingLevel: "medium" }));
  const start = vi.fn(async (launch: unknown) => {
    if (!options.startSuccess)
      throw new Error("SESSION_OCCUPIED：该会话正在被其他 omp 实例使用");
    return { ...(launch as object), cwd: summary.cwd, protocolVersion: 2 };
  });
  vi.stubGlobal("desktop", {
    setZoomFactor: () => {},
    preferences: async () => ({
      executable: "omp.exe",
      cwd: summary.cwd,
      autoConnect: options.prepared,
    }),
    listSessions: async () => [summary],
    openSession: async () => ({ snapshot: { summary, messages: [] } }),
    prepareModels,
    start,
    request,
    ...offPlanBridge,
    onFrame: (listener: (frame: RpcFrame) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  await render(<App />);
  const emit = async (frame: RpcFrame) => {
    await act(async () => listeners.forEach((listener) => listener(frame)));
  };
  return { request, prepareModels, start, emit };
}

async function escape(repeat = false) {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", repeat }),
    );
  });
}

async function doubleEscape() {
  await escape();
  await escape();
}

it.each([false, true])(
  "未连接具体会话时双 Esc 显示提示（已准备模型：%s）",
  async (prepared) => {
    const fixture = await mount({ prepared });
    await escape();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await escape();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      NOTICE,
    );
    expect(fixture.prepareModels).toHaveBeenCalledTimes(prepared ? 1 : 0);
    expect(fixture.request).not.toHaveBeenCalled();
  },
);

it("只读会话双 Esc 尝试安全连接，占用时保留只读状态", async () => {
  const fixture = await mount({ prepared: true });
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".session-item")!.click(),
  );
  await doubleEscape();
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
    "SESSION_OCCUPIED",
  );
  expect(container.querySelector(".send-button")?.textContent).toBe("连接");
  expect(fixture.request).not.toHaveBeenCalled();
  expect(fixture.start).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ sessionPath: summary.path }),
  );
});

it("只读会话提交 /rewind 同样检查占用，失败时保留草稿", async () => {
  const fixture = await mount({ prepared: true });
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".session-item")!.click(),
  );
  await act(async () => {
    const textarea = container.querySelector(".composer-box textarea")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, "/rewind");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".send-button")!.click(),
  );
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
    "SESSION_OCCUPIED",
  );
  expect(
    container.querySelector<HTMLTextAreaElement>(".composer-box textarea")!
      .value,
  ).toBe("/rewind");
  expect(container.querySelector(".send-button")?.textContent).toBe("连接");
  expect(fixture.request).not.toHaveBeenCalled();
  expect(fixture.start).toHaveBeenCalledTimes(1);
});

it("只读会话取得租约后双 Esc 直接进入回退，不发送提示词", async () => {
  const fixture = await mount({ startSuccess: true });
  await act(async () =>
    container.querySelector<HTMLButtonElement>(".session-item")!.click(),
  );
  await doubleEscape();
  expect(fixture.start).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ sessionPath: summary.path }),
  );
  expect(container.querySelector(".rewind-transcript")).not.toBeNull();
  expect(
    fixture.request.mock.calls.some(([command]) => command.type === "prompt"),
  ).toBe(false);
});

it("长按产生的重复事件和超过 500 毫秒的按键不组成双 Esc", async () => {
  await mount();
  await escape();
  await escape(true);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  vi.advanceTimersByTime(DOUBLE_ESCAPE_WINDOW_MS);
  await escape();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await escape();
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
    NOTICE,
  );
});

it("连接尚未完成时双 Esc 不打开提示或请求回退", async () => {
  const fixture = await mount();
  await fixture.emit({ type: "desktop_status", status: "starting" });
  await doubleEscape();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(fixture.request).not.toHaveBeenCalled();
});

it("已连接但尚无具体 sessionId 时双 Esc 仍提示连接", async () => {
  const fixture = await mount({ sessionId: "" });
  await fixture.emit({ type: "desktop_status", status: "connected" });
  await fixture.emit({ type: "session_info_update" });
  fixture.request.mockClear();
  await doubleEscape();
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
    NOTICE,
  );
  expect(fixture.request).not.toHaveBeenCalled();
});

it("忙时 Esc 仍调用原生 abort", async () => {
  const fixture = await mount();
  await fixture.emit({ type: "desktop_status", status: "connected" });
  await fixture.emit({ type: "agent_start" });
  fixture.request.mockClear();
  await escape();
  expect(fixture.request).toHaveBeenCalledWith({ type: "abort" });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
