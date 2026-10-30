import { describe, expect, it, vi, type Mock } from "vitest";
import { resolve } from "node:path";
import type { ConnectionInfo, LaunchOptions, RpcFrame, SessionState } from "../shared/protocol";
import type { OmpRuntime } from "./rpc";
import { SessionEngines } from "./session-engines";

function fixture() {
  const children: { emit: (frame: RpcFrame) => void; start: Mock<(options: LaunchOptions) => Promise<ConnectionInfo>>; stop: Mock<() => Promise<void>>; request: Mock<() => Promise<SessionState>>; respondUI: Mock<() => Promise<undefined>>; path: string }[] = [];
  const send = vi.fn();
  const observe = vi.fn();
  const manager = new SessionEngines(send, observe, (emit) => {
    const child = {
      emit, path: "",
      start: vi.fn(async (options: LaunchOptions) => {
        child.path = resolve(options.sessionPath ?? "new.jsonl");
        return { executable: "omp", cwd: options.cwd, protocolVersion: 1 };
      }),
      stop: vi.fn(async () => { emit({ type: "desktop_status", status: "disconnected" }); }),
      request: vi.fn(async () => ({ sessionId: child.path, sessionFile: child.path, isStreaming: false, isSettled: true }) as SessionState),
      respondUI: vi.fn(async () => undefined),
    };
    children.push(child);
    return child as unknown as OmpRuntime;
  });
  const start = (path: string, active = true, initialize?: Parameters<SessionEngines["start"]>[3]) => manager.start({ executable: "omp", cwd: resolve("."), sessionPath: path }, "extension", active, initialize);
  return { manager, children, send, observe, start };
}

const answer: RpcFrame = { type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "answer" }] } };

describe("session-owned native engines", () => {
  it("keeps A running when selecting B or readonly, and reuses A without model initialization", async () => {
    const f = fixture();
    const initialize = vi.fn(async () => undefined);
    const a = await f.start("a.jsonl", true, initialize);
    f.children[0].emit({ type: "agent_start" });
    await f.start("b.jsonl");
    expect(f.children[0].stop).not.toHaveBeenCalled();
    f.manager.activate(undefined);
    expect(f.children[0].stop).not.toHaveBeenCalled();
    expect(await f.start("a.jsonl", true, initialize)).toBe(a);
    expect(f.children).toHaveLength(2);
    expect(initialize).toHaveBeenCalledOnce();
    expect(f.manager.active).toBe(a);
    expect(a.state).toBe("active");
  });

  it("observes background frames under their owner but forwards only active stamped frames", async () => {
    const f = fixture();
    const a = await f.start("a.jsonl");
    const b = await f.start("b.jsonl");
    f.send.mockClear();
    f.children[0].emit({ type: "message_update", message: { role: "assistant", content: "A" } });
    f.children[1].emit({ type: "message_update", message: { role: "assistant", content: "B" } });
    expect(f.send.mock.calls.filter(([frame]) => frame.type === "message_update")).toEqual([[expect.objectContaining({ engineId: b.id, message: { role: "assistant", content: "B" } })]]);
    expect(f.observe).toHaveBeenCalledWith(a, expect.objectContaining({ type: "message_update" }));
    expect(f.manager.frames(a)).toEqual([expect.objectContaining({ engineId: a.id, message: { role: "assistant", content: "A" } })]);
  });

  it("marks only offscreen successful final answers unread, acknowledging on activation", async () => {
    const f = fixture();
    const a = await f.start("a.jsonl");
    f.children[0].emit({ type: "agent_start" });
    f.children[0].emit(answer);
    f.children[0].emit({ type: "session_settled" });
    expect(a.state).toBe("idle");
    f.manager.activate(undefined);
    for (const message of [
      { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", name: "bash" }] },
      { role: "assistant", stopReason: "aborted", content: "partial" },
      { role: "assistant", stopReason: "error", content: "partial" },
    ]) {
      f.children[0].emit({ type: "agent_start" });
      expect(a.state).toBe("active");
      f.children[0].emit({ type: "message_end", message });
      f.children[0].emit({ type: "session_settled" });
      expect(a.state).toBe("idle");
    }
    f.children[0].emit({ type: "agent_start" });
    f.children[0].emit(answer);
    f.children[0].emit({ type: "session_settled" });
    expect(a.state).toBe("unread");
    f.manager.activate(a);
    expect(a.state).toBe("idle");
  });

  it("cancelled prompt results do not publish unread final output", async () => {
    const f = fixture();
    const a = await f.start("a.jsonl");
    f.manager.activate(undefined);
    f.children[0].emit(answer);
    f.children[0].emit({ type: "prompt_result", status: "cancelled" });
    f.children[0].emit({ type: "session_settled" });
    expect(a.state).toBe("idle");
  });

  it("stops only the chosen background owner and closes all remaining GUI children", async () => {
    const f = fixture();
    const a = await f.start("a.jsonl");
    const b = await f.start("b.jsonl");
    await f.manager.stop(f.manager.find("a.jsonl"));
    expect(f.children[0].stop).toHaveBeenCalledOnce();
    expect(f.children[1].stop).not.toHaveBeenCalled();
    expect(f.manager.active).toBe(b);
    expect(f.manager.list().map((engine) => engine.id)).not.toContain(a.id);
    await f.manager.stopAll();
    expect(f.children[1].stop).toHaveBeenCalledOnce();
    expect(f.manager.list()).toEqual([]);
  });

  it("restores pending UI, namespaces duplicate native IDs and routes responses while another owner is selected", async () => {
    const f = fixture();
    const a = await f.start("a.jsonl");
    f.children[0].emit({ type: "agent_start" });
    f.children[0].emit({ type: "extension_ui_request", method: "ask", id: "same", title: "A" });
    expect(a.state).toBe("idle");
    const b = await f.start("b.jsonl");
    f.children[1].emit({ type: "extension_ui_request", method: "confirm", id: "same", title: "B" });
    const pendingA = f.manager.frames(a).find((frame) => frame.type === "extension_ui_request")!;
    const pendingB = f.manager.frames(b).find((frame) => frame.type === "extension_ui_request")!;
    expect(pendingA.id).not.toBe(pendingB.id);
    f.manager.activate(a);
    expect(f.manager.frames(a)).toContain(pendingA);
    await f.manager.respondUI({ id: String(pendingB.id), confirmed: true });
    expect(f.children[1].respondUI).toHaveBeenCalledWith({ id: "same", confirmed: true });
    expect(f.children[0].respondUI).not.toHaveBeenCalled();
    f.children[0].emit({ type: "extension_ui_request", method: "cancel", targetId: "same" });
    expect(f.manager.frames(a).some((frame) => frame.type === "extension_ui_request")).toBe(false);
    await expect(f.manager.respondUI({ id: String(pendingA.id) })).rejects.toThrow("不存在");
  });

  it("retains only latest live stream/tool state rather than accumulating a transcript", async () => {
    const f = fixture();
    const a = await f.start("a.jsonl");
    f.children[0].emit({ type: "agent_start" });
    for (let i = 0; i < 1000; i++) f.children[0].emit({ type: "message_update", messageId: "m", message: { role: "assistant", content: String(i) } });
    f.children[0].emit({ type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: { command: "sleep" } });
    f.children[0].emit({ type: "tool_execution_update", toolCallId: "t", partialResult: "running" });
    expect(f.manager.frames(a)).toHaveLength(3);
    expect(f.manager.frames(a)).toContainEqual(expect.objectContaining({ message: { role: "assistant", content: "999" } }));
    f.children[0].emit({ type: "tool_execution_end", toolCallId: "t" });
    f.children[0].emit(answer);
    f.children[0].emit({ type: "session_settled" });
    expect(f.manager.frames(a)).toEqual([]);
  });

  it("rebinds native path changes to their owner without stopping a different active process", async () => {
    const f = fixture();
    const a = await f.start("a.jsonl");
    await f.start("b.jsonl");
    f.manager.bind(a, { sessionId: "moved", sessionFile: resolve("moved.jsonl") } as SessionState);
    expect(f.manager.find("a.jsonl")).toBeUndefined();
    expect(f.manager.find("moved.jsonl")).toBe(a);
    await f.manager.stop(f.manager.find("a.jsonl"));
    expect(f.children[1].stop).not.toHaveBeenCalled();
  });

  it("restores partial snapshots and final text deltas using the foreground merge rules", async () => {
    const f = fixture();
    const a = await f.start("a.jsonl");
    f.manager.activate(undefined);
    f.children[0].emit({ type: "message_start", messageId: "m", message: { role: "assistant", content: [{ type: "text", text: "旧" }] } });
    f.children[0].emit({ type: "message_update", messageId: "m", assistantMessageEvent: { type: "text_delta", delta: "不重复追加", partial: { role: "assistant", content: [{ type: "text", text: "完整快照" }] } } });
    expect(f.manager.frames(a)).toContainEqual(expect.objectContaining({ message: { role: "assistant", content: [{ type: "text", text: "完整快照" }] } }));
    f.children[0].emit({ type: "message_update", messageId: "m", assistantMessageEvent: { type: "text_end", content: "最终块" } });
    expect(f.manager.frames(a)).toContainEqual(expect.objectContaining({ message: { role: "assistant", content: [{ type: "text", text: "最终块" }] } }));
  });

  it("tracks native maintenance and does not let a stale idle snapshot hide a running turn", async () => {
    const f = fixture();
    const a = await f.start("a.jsonl");
    f.children[0].emit({ type: "auto_compaction_start" });
    expect(a.state).toBe("active");
    f.children[0].emit({ type: "auto_compaction_end" });
    expect(a.state).toBe("idle");
    f.children[0].emit({ type: "agent_start" });
    f.manager.bind(a, { sessionId: a.sessionId, isStreaming: false, isCompacting: false, isSettled: true } as SessionState);
    expect(a.state).toBe("active");
    f.children[0].emit({ type: "session_settled" });
    a.planTransition = true;
    f.children[0].emit({ type: "plan_state", snapshot: { operation: { status: "running" } } });
    a.planTransition = false;
    f.manager.bind(a, { sessionId: a.sessionId, isStreaming: false, isCompacting: false, isSettled: true } as SessionState);
    expect(a.state).toBe("idle");
  });
});
