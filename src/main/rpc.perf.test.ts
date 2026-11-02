// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RpcFrame } from "../shared/protocol";

const diagnostics = vi.hoisted(() => ({ get: vi.fn(), event: vi.fn(), count: vi.fn(), observe: vi.fn(), close: vi.fn() }));
vi.mock("./performance-log", () => ({ getPerformanceLogger: diagnostics.get }));
import { OmpRuntime } from "./rpc";

/** 保留真实请求/停止逻辑，仅用可控 stdin 与 close 等待器代替操作系统进程。 */
function connected() {
  const frames: RpcFrame[] = [];
  const runtime = new OmpRuntime((frame) => frames.push(frame));
  const closed = Promise.withResolvers<void>();
  const writes: string[] = [];
  const child = {
    stdin: {
      destroyed: false, writableEnded: false,
      write: vi.fn((line: string, callback?: (error?: Error) => void) => {
        writes.push(line);
        callback?.();
        return true;
      }),
      end: vi.fn(),
    },
    kill: vi.fn(),
  };
  const transport = runtime as unknown as {
    child: typeof child;
    closePromise: Promise<void>;
    connected: boolean;
    commands: Set<string>;
    dispatch(frame: RpcFrame): void;
    bridge<T>(command: string, payload: Record<string, unknown>): Promise<T>;
  };
  transport.child = child;
  transport.closePromise = closed.promise;
  transport.connected = true;
  transport.commands = new Set(["ompgui-model"]);
  return { runtime, transport, child, writes, closed, frames };
}

beforeEach(() => {
  vi.resetAllMocks();
  diagnostics.get.mockReturnValue(undefined);
});
afterEach(() => vi.useRealTimers());

it("disabled diagnostics preserves native prompt response and output without reading the clock", async () => {
  const f = connected();
  const clock = vi.spyOn(performance, "now");
  try {
    const result = f.runtime.request({ type: "prompt", message: "private-prompt" });
    const command = JSON.parse(f.writes[0]);
    f.transport.dispatch({ type: "response", id: command.id, success: true, data: { admitted: true } });
    await expect(result).resolves.toEqual({ admitted: true });
    expect(command.message).toBe("private-prompt");
    expect(f.runtime.performanceId).toBeUndefined();
    expect(clock).not.toHaveBeenCalled();
    expect(diagnostics.event).not.toHaveBeenCalled();
    expect(diagnostics.count).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); }
});

it("times prompt admission separately from extension completion without recording content", async () => {
  diagnostics.get.mockReturnValue(diagnostics);
  const f = connected();
  const result = f.transport.bridge("ompgui-model", { op: "list", secret: "private-payload" });
  const command = JSON.parse(f.writes[0]);
  const payload = JSON.parse(command.message.slice(command.message.indexOf(" ") + 1));
  f.transport.dispatch({ type: "response", id: command.id, success: true, data: { admitted: true } });
  await Promise.resolve();
  expect(diagnostics.count).toHaveBeenCalledWith("rpc.end", 1, expect.objectContaining({ request: "prompt", kind: "admission", outcome: "success" }));
  expect(diagnostics.count).not.toHaveBeenCalledWith("rpc.end", 1, expect.objectContaining({ kind: "extension" }));
  f.transport.dispatch({ type: "extension_ui_request", method: "notify", message: JSON.stringify({ namespace: "ompgui", requestId: payload.requestId, ok: true, data: { complete: true } }) });
  await expect(result).resolves.toEqual({ complete: true });
  expect(diagnostics.count).toHaveBeenCalledWith("rpc.end", 1, expect.objectContaining({ request: "ompgui-model", kind: "extension", outcome: "success" }));
  expect(JSON.stringify([diagnostics.event.mock.calls, diagnostics.count.mock.calls, diagnostics.observe.mock.calls])).not.toContain("private-payload");
});

it("records rejected extension admission as an error rather than a cancellation", async () => {
  diagnostics.get.mockReturnValue(diagnostics);
  const f = connected();
  const result = f.transport.bridge("ompgui-model", { op: "list" });
  const rejection = expect(result).rejects.toThrow("admission-rejected");
  const command = JSON.parse(f.writes[0]);
  f.transport.dispatch({ type: "response", id: command.id, success: false, error: "admission-rejected" });
  await rejection;
  expect(diagnostics.count).toHaveBeenCalledWith("rpc.end", 1,
    expect.objectContaining({ request: "ompgui-model", kind: "extension", outcome: "error" }));
  expect(diagnostics.count).not.toHaveBeenCalledWith("rpc.end", 1,
    expect.objectContaining({ kind: "extension", outcome: "cancelled" }));
});

it("records native timeout distinctly and does not replace the existing rejection", async () => {
  vi.useFakeTimers();
  diagnostics.get.mockReturnValue(diagnostics);
  const f = connected();
  const result = f.runtime.request({ type: "get_state" });
  const rejection = expect(result).rejects.toThrow("请求超时：get_state");
  await vi.advanceTimersByTimeAsync(120_000);
  await rejection;
  expect(diagnostics.event).toHaveBeenCalledWith("rpc.end", expect.objectContaining({ outcome: "timeout", request: "get_state" }));
});


it.each([false, true])("shutdown preserves three native writes and waits for stdio close (perf=%s)", async (enabled) => {
  vi.useFakeTimers();
  if (enabled) diagnostics.get.mockReturnValue(diagnostics);
  const f = connected();
  let settled = false;
  const stopping = f.runtime.stop().then(() => { settled = true; });
  expect(f.writes.map((line) => JSON.parse(line).type)).toEqual(["abort", "abort_bash", "btw_cancel"]);
  expect(f.child.stdin.end).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(f.child.kill).toHaveBeenCalledOnce();
  expect(settled).toBe(false);
  f.closed.resolve();
  await stopping;
  if (enabled) {
    expect(diagnostics.event).toHaveBeenCalledWith("engine.kill", expect.objectContaining({ reason: "stop-timeout" }));
    expect(diagnostics.event).toHaveBeenCalledWith("engine.stop.end", expect.objectContaining({ fault: true }));
    expect(diagnostics.count.mock.calls.filter(([name]) => name === "transport.frames.out")).toHaveLength(3);
  } else expect(diagnostics.event).not.toHaveBeenCalled();
});
