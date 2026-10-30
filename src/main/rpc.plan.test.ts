// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createServer, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { cancelPlanOperation, readPlanControl } from "./plan-control";
import { OmpRuntime } from "./rpc";
import type { RpcFrame } from "../shared/protocol";
import type { PlanSnapshot } from "../shared/native-plan";

const identity = { sessionId: "session", sessionFile: "C:/session.jsonl", epoch: "epoch" };
const running: PlanSnapshot = { identity, phase: "applying", busy: true,
  operation: { id: "operation", choice: "compact", status: "running", origin: identity } };

describe("native plan runtime boundary", () => {
  it("forwards plan notifications outside extension chat UI", () => {
    const frames: RpcFrame[] = [];
    const runtime = new OmpRuntime((frame) => frames.push(frame));
    const transport = runtime as unknown as { dispatch(frame: RpcFrame): void };
    transport.dispatch({ type: "extension_ui_request", method: "notify", message: JSON.stringify({ namespace: "ompgui-plan-state", snapshot: running }) });
    expect(frames).toEqual([{ type: "plan_state", snapshot: running }]);
    expect(runtime.currentPlan).toEqual(running);
  });
  it("does not regress completed operations to a delayed running notification", () => {
    const emit = vi.fn();
    const runtime = new OmpRuntime(emit);
    const transport = runtime as unknown as { dispatch(frame: RpcFrame): void };
    const completed: PlanSnapshot = { ...running, phase: "off", busy: false, operation: { ...running.operation!, status: "completed" } };
    for (const snapshot of [running, completed, running]) transport.dispatch({
      type: "extension_ui_request", method: "notify", message: JSON.stringify({ namespace: "ompgui-plan-state", snapshot }),
    });
    expect(runtime.currentPlan).toEqual(completed);
    expect(emit).toHaveBeenCalledTimes(2);
  });
  it("routes abort to immediate plan cancellation while refusing concurrent prompts", async () => {
    const runtime = new OmpRuntime(vi.fn());
    const transport = runtime as unknown as { child: object; dispatch(frame: RpcFrame): void };
    transport.child = {};
    transport.dispatch({ type: "extension_ui_request", method: "notify", message: JSON.stringify({ namespace: "ompgui-plan-state", snapshot: running }) });
    const cancel = vi.spyOn(runtime, "plan").mockResolvedValue({ ...running, phase: "off", busy: false });
    await expect(runtime.request({ type: "prompt", message: "must not run" })).rejects.toThrow("计划正在转换");
    await runtime.request({ type: "abort" });
    expect(cancel).toHaveBeenCalledExactlyOnceWith({ op: "cancel", identity, operationId: "operation" });
  });
});

/** 使用真实本地 socket 和独立压缩取消状态，验证命令队列外的取消行为。 */
async function localControl() {
  const directory = process.platform === "win32" ? undefined : await mkdtemp(join(tmpdir(), "ompgui-plan-"));
  const endpoint = directory ? join(directory, "control.sock") : `\\\\.\\pipe\\ompgui-plan-${randomUUID()}`;
  const token = randomBytes(32).toString("hex");
  const compaction = new AbortController();
  const sockets = new Set<Socket>();
  let requests = 0;
  let mode: "normal" | "wrongIdentity" | "oversized" | "incomplete" | "silent" = "normal";
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => { /* 客户端有界拒绝后可以提前关闭测试连接。 */ });
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk.toString();
      if (!input.includes("\n")) return;
      requests++;
      const request = JSON.parse(input);
      if (request.token !== token || request.action.op !== "cancel" ||
          request.action.operationId !== running.operation!.id ||
          JSON.stringify(request.action.identity) !== JSON.stringify(identity)) {
        socket.end(`${JSON.stringify({ ok: false, error: "unauthorized cancellation" })}\n`);
        return;
      }
      if (mode === "silent") return;
      if (mode === "incomplete") { socket.end('{"ok":true'); return; }
      if (mode === "oversized") { socket.end(Buffer.alloc(8 * 1024 * 1024 + 1, 32)); return; }
      compaction.abort();
      socket.end(`${JSON.stringify({ ok: true, data: { ...running, phase: "off", busy: false,
        operation: { ...running.operation, id: mode === "wrongIdentity" ? "other" : "operation", status: "cancelled" } } })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, resolve);
  });
  return {
    endpoint, token, compaction,
    get requests() { return requests; },
    setMode(value: typeof mode) { mode = value; },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (directory) await rm(directory, { force: true, recursive: true });
    },
  };
}

describe("private plan cancellation transport", () => {
  it("strips native credentials and aborts real local maintenance without another bridge command", async () => {
    const host = await localControl();
    try {
      const runtime = new OmpRuntime(vi.fn());
      const bridge = vi.spyOn(runtime as unknown as { bridge(): Promise<unknown> }, "bridge")
        .mockResolvedValue({ ...running, _planControl: { endpoint: host.endpoint, token: host.token } });
      expect(await runtime.plan({ op: "status" })).toEqual(running);
      expect(runtime.currentPlan).not.toHaveProperty("_planControl");
      expect(await runtime.plan({ op: "status" })).toEqual(running);
      expect(bridge).toHaveBeenCalledTimes(1);
      const cancelled = await runtime.plan({ op: "cancel", identity, operationId: "operation" });
      expect(host.compaction.signal.aborted).toBe(true);
      expect(cancelled.operation?.status).toBe("cancelled");
      expect(host.requests).toBe(1);
      expect(bridge).toHaveBeenCalledTimes(1);
      await runtime.stop();
      expect(Reflect.get(runtime, "planControl")).toBeUndefined();
    } finally { await host.close(); }
  });

  it("rejects stale operation identity before connecting and never falls back to slash", async () => {
    const host = await localControl();
    try {
      const runtime = new OmpRuntime(vi.fn());
      const bridge = vi.spyOn(runtime as unknown as { bridge(): Promise<unknown> }, "bridge")
        .mockResolvedValue({ ...running, _planControl: { endpoint: host.endpoint, token: host.token } });
      await runtime.plan({ op: "status" });
      await expect(runtime.plan({ op: "cancel", identity: { ...identity, epoch: "stale" }, operationId: "operation" })).rejects.toThrow("身份已失效");
      expect(host.requests).toBe(0);
      expect(bridge).toHaveBeenCalledTimes(1);
      expect(host.compaction.signal.aborted).toBe(false);
    } finally { await host.close(); }
  });

  it("rejects unauthorized requests, mismatched replies, incomplete and oversized responses", async () => {
    const host = await localControl();
    const action = { op: "cancel", identity, operationId: "operation" } as const;
    try {
      await expect(cancelPlanOperation({ endpoint: host.endpoint, token: "0".repeat(64) }, action, new AbortController().signal)).rejects.toThrow("unauthorized");
      expect(host.compaction.signal.aborted).toBe(false);
      for (const [mode, message] of [["wrongIdentity", "身份不匹配"], ["incomplete", "不完整"], ["oversized", "过大"]] as const) {
        host.setMode(mode);
        await expect(cancelPlanOperation(host, action, new AbortController().signal)).rejects.toThrow(message);
      }
    } finally { await host.close(); }
  });

  it("bounds requests before connecting and cancels an in-flight connection on disconnect", async () => {
    const host = await localControl();
    try {
      await expect(cancelPlanOperation(host, { op: "cancel", identity: { ...identity, epoch: "x".repeat(8192) }, operationId: "operation" }, new AbortController().signal)).rejects.toThrow("请求过大");
      expect(host.requests).toBe(0);
      host.setMode("silent");
      const lifetime = new AbortController();
      const pending = cancelPlanOperation(host, { op: "cancel", identity, operationId: "operation" }, lifetime.signal);
      lifetime.abort();
      await expect(pending).rejects.toThrow("连接已结束");
    } finally { await host.close(); }
  });

  it("rejects nonlocal endpoint namespaces and credentials from state frames", async () => {
    for (const endpoint of ["localhost:1234", "\\\\\\\\remote\\\\pipe\\\\ompgui-plan-any", join(tmpdir(), "other", "control.sock")])
      expect(() => readPlanControl({ endpoint, token: "0".repeat(64) })).toThrow("受信本机地址");
    const frames: RpcFrame[] = [];
    const runtime = new OmpRuntime((frame) => frames.push(frame));
    const transport = runtime as unknown as { dispatch(frame: RpcFrame): void };
    transport.dispatch({
      type: "extension_ui_request", method: "notify",
      message: JSON.stringify({ namespace: "ompgui-plan-state", snapshot: { ...running, _planControl: { endpoint: "secret", token: "secret" } } }),
    });
    expect(frames).toEqual([{ type: "plan_state", snapshot: running }]);
    transport.dispatch({
      type: "extension_ui_request", method: "notify",
      message: JSON.stringify({ namespace: "ompgui", requestId: "expired-plan-request", ok: true,
        data: { ...running, _planControl: { endpoint: "secret", token: "secret" } } }),
    });
    expect(frames).toEqual([{ type: "plan_state", snapshot: running }]);
    expect(Reflect.get(runtime, "planControl")).toBeUndefined();
    await expect(runtime.plan({ op: "cancel", identity, operationId: "operation" })).rejects.toThrow("取消通道未就绪");
  });

  it("times out a silent native endpoint after five seconds without aborting maintenance", async () => {
    const host = await localControl();
    try {
      host.setMode("silent");
      await expect(cancelPlanOperation(host, { op: "cancel", identity, operationId: "operation" }, new AbortController().signal)).rejects.toThrow("操作超时");
      expect(host.requests).toBe(1);
      expect(host.compaction.signal.aborted).toBe(false);
    } finally { await host.close(); }
  }, 10_000);
});
