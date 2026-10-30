import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AgentMessage, ConnectionInfo, LaunchOptions, RpcFrame, SessionEngineStatus, SessionState } from "../shared/protocol";
import { OmpRuntime } from "./rpc";
import { ToolFilePreviewLedger } from "./tool-preview";
import { streamedMessage } from "../shared/streamed-message";

export interface SessionEngine {
  id: string;
  runtime: OmpRuntime;
  toolFiles: ToolFilePreviewLedger;
  connection?: ConnectionInfo;
  sessionPath?: string;
  sessionId?: string;
  state: SessionEngineStatus["state"];
  planTransition: boolean;
  planRefresh?: Promise<void>;
  identityRefresh?: Promise<void>;
  planSaveDialogPending: boolean;
  pendingUI: Map<string, RpcFrame>;
  replay: Map<string, RpcFrame>;
  finalAnswer: boolean;
  unread: boolean;
}

/** 会话级进程与恢复状态；仅管理 GUI 自己创建的子进程。 */
export class SessionEngines {
  private readonly engines = new Map<string, SessionEngine>();
  private selected?: SessionEngine;
  constructor(
    private readonly send: (frame: RpcFrame) => void,
    private readonly observe: (owner: SessionEngine, frame: RpcFrame) => void,
    private readonly createRuntime: (emit: (frame: RpcFrame) => void) => OmpRuntime = (emit) => new OmpRuntime(emit),
  ) {}
  get active(): SessionEngine | undefined { return this.selected; }
  requireActive(): SessionEngine {
    if (!this.selected) throw new Error("当前没有连接的会话");
    return this.selected;
  }
  find(path: string): SessionEngine | undefined {
    const absolute = resolve(path);
    const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
    for (const engine of this.engines.values()) {
      const candidate = process.platform === "win32" ? engine.sessionPath?.toLowerCase() : engine.sessionPath;
      if (candidate === key) return engine;
    }
  }
  list(): SessionEngineStatus[] {
    return [...this.engines.values()].flatMap((engine) => engine.sessionPath ? [{ id: engine.id, sessionPath: engine.sessionPath, sessionId: engine.sessionId, state: engine.state }] : []);
  }
  private publish(): void { this.send({ type: "session_engines", engines: this.list() }); }
  activate(owner?: SessionEngine): void {
    this.selected = owner;
    if (owner) {
      owner.unread = false;
      owner.finalAnswer = false;
      if (owner.state === "unread") owner.state = "idle";
    }
    this.publish();
  }
  bind(owner: SessionEngine, state: SessionState): void {
    if (!this.engines.has(owner.id)) return;
    const previousPath = owner.sessionPath;
    const previousId = owner.sessionId;
    const previousState = owner.state;
    if (state.sessionFile) owner.sessionPath = resolve(state.sessionFile);
    owner.sessionId = state.sessionId;
    // 不让延迟的空闲快照覆盖刚开始的新一轮；计划结束后则解除纯维护活跃状态。
    if (owner.state === "active" && !state.isStreaming && !state.isCompacting &&
        state.isSettled !== false && !owner.planTransition && !owner.replay.has("agent") &&
        !owner.replay.has("auto_compaction_start") && !owner.replay.has("auto_retry_start"))
      owner.state = owner.unread ? "unread" : "idle";
    if (previousPath !== owner.sessionPath || previousId !== owner.sessionId || previousState !== owner.state)
      this.publish();
  }
  async start(options: LaunchOptions, extension: string, activate: boolean, initialize?: (owner: SessionEngine) => Promise<void>): Promise<SessionEngine> {
    const existing = options.sessionPath ? this.find(options.sessionPath) : undefined;
    if (existing) {
      if (activate) this.activate(existing);
      return existing;
    }
    let owner: SessionEngine;
    const runtime = this.createRuntime((frame) => this.receive(owner, frame));
    owner = {
      id: randomUUID(), runtime,
      toolFiles: new ToolFilePreviewLedger(), sessionPath: options.sessionPath ? resolve(options.sessionPath) : undefined,
      state: "starting", planTransition: false, planSaveDialogPending: false,
      pendingUI: new Map(), replay: new Map(), finalAnswer: false, unread: false,
    };
    this.engines.set(owner.id, owner);
    if (activate) this.activate(owner); else this.publish();
    try {
      const connection = await owner.runtime.start(options, extension);
      owner.connection = { ...connection, engineId: owner.id };
      owner.toolFiles.connect(connection.cwd);
      this.bind(owner, await owner.runtime.request<SessionState>({ type: "get_state" }));
      await initialize?.(owner);
      if (owner.state === "starting") owner.state = "idle";
      this.publish();
      return owner;
    } catch (error) {
      await this.stop(owner);
      throw error;
    }
  }
  async stop(owner?: SessionEngine): Promise<void> {
    if (!owner || !this.engines.has(owner.id)) return;
    owner.state = "stopping";
    owner.toolFiles.beginTransition();
    this.publish();
    try { await owner.runtime.stop(); }
    finally {
      this.engines.delete(owner.id);
      owner.pendingUI.clear(); owner.replay.clear();
      if (this.selected === owner) this.selected = undefined;
      this.publish();
    }
  }
  async stopAll(): Promise<void> { await Promise.all([...this.engines.values()].map((owner) => this.stop(owner))); }
  frames(owner: SessionEngine): RpcFrame[] {
    return [...owner.replay.values(), ...owner.pendingUI.values()];
  }
  async respondUI(response: { id: string; [key: string]: unknown }): Promise<void> {
    const owner = [...this.engines.values()].find((engine) => engine.pendingUI.has(response.id));
    if (!owner) throw new Error("原生 UI 请求已取消、结束或不存在");
    const frame = owner.pendingUI.get(response.id)!;
    await owner.runtime.respondUI({ ...response, id: String(frame.nativeId) });
    owner.pendingUI.delete(response.id);
    if (!owner.pendingUI.size && owner.state === "idle")
      owner.state = owner.replay.has("agent") || owner.planTransition ? "active" : "idle";
    this.publish();
  }
  private receive(owner: SessionEngine, native: RpcFrame): void {
    if (!this.engines.has(owner.id)) return;
    this.observe(owner, native);
    let frame: RpcFrame = { ...native, engineId: owner.id };
    const previous = owner.state;
    if (native.type === "extension_ui_request") {
      const id = typeof native.id === "string" ? `${owner.id}:${native.id}` : undefined;
      if (native.method === "cancel") {
        const targetId = `${owner.id}:${native.targetId}`;
        owner.pendingUI.delete(targetId);
        if (!owner.pendingUI.size && owner.state === "idle")
          owner.state = owner.replay.has("agent") || owner.planTransition ? "active" : "idle";
        frame = { ...frame, targetId };
      } else if (id && ["select", "confirm", "input", "editor", "ask"].includes(String(native.method))) {
        frame = { ...frame, id, nativeId: native.id };
        owner.pendingUI.set(id, frame);
        owner.state = "idle";
      }
    }
    if (native.type === "agent_start") {
      owner.finalAnswer = false;
      owner.state = "active";
      owner.replay.clear();
      owner.replay.set("agent", frame);
    }
    if (native.type === "message_start" || native.type === "message_update") {
      owner.state = owner.pendingUI.size ? "idle" : "active";
      const old = owner.replay.get("message");
      frame = { ...frame, message: streamedMessage(old?.message as AgentMessage | undefined, native) };
      owner.replay.set("message", frame);
    }
    if (native.type === "message_end") {
      owner.replay.delete("message");
      const message = native.message as { role?: string; stopReason?: string; errorMessage?: string; content?: unknown } | undefined;
      if (message?.role === "assistant") owner.finalAnswer = owner !== this.selected && !message.errorMessage && message.stopReason === "stop" &&
        (typeof message.content === "string" ? !!message.content.trim() : Array.isArray(message.content) && message.content.some((block) => block.type === "text" && block.text?.trim()) && !message.content.some((block) => block.type === "toolCall"));
    }
    if (native.type.startsWith("tool_execution_") || native.type === "tool_stream_update") {
      const key = `tool:${native.toolCallId}`;
      const previousTool = owner.replay.get(key);
      if (native.type === "tool_execution_end") owner.replay.delete(key);
      else {
        const tool: RpcFrame = { ...previousTool, ...frame, type: "tool_execution_start" };
        if (native.delta !== undefined && native.result === undefined && native.partialResult === undefined)
          tool.partialResult = String(previousTool?.partialResult ?? previousTool?.result ?? "") + String(native.delta);
        owner.replay.set(key, tool);
      }
    }
    if (native.type === "plan_state" || native.type === "queue_update")
      owner.replay.set(native.type, frame);
    if (native.type === "auto_compaction_start" || native.type === "auto_retry_start") {
      owner.replay.set(native.type, frame);
      owner.state = owner.pendingUI.size ? "idle" : "active";
    }
    if (native.type === "auto_compaction_end" || native.type === "auto_retry_end") {
      owner.replay.delete(native.type.replace(/_end$/, "_start"));
      if (!owner.replay.has("agent") && !owner.planTransition &&
          !owner.replay.has("auto_compaction_start") && !owner.replay.has("auto_retry_start"))
        owner.state = owner.unread ? "unread" : "idle";
    }
    const plan = native.snapshot;
    if (native.type === "plan_state" && plan && typeof plan === "object" && "operation" in plan &&
        plan.operation && typeof plan.operation === "object" && "status" in plan.operation &&
        plan.operation.status === "running") owner.state = "active";
    if (["session_info_update", "session_settled"].includes(native.type) && !owner.identityRefresh) {
      owner.identityRefresh = owner.runtime.request<SessionState>({ type: "get_state" })
        .then((state) => { this.bind(owner, state); })
        .catch(() => undefined)
        .finally(() => { owner.identityRefresh = undefined; });
    }
    if (native.type === "session_settled") {
      owner.unread ||= owner.finalAnswer && owner !== this.selected;
      owner.state = owner.unread ? "unread" : "idle";
      owner.finalAnswer = false;
      owner.replay.delete("agent");
      owner.replay.delete("message");
    }
    if (native.type === "prompt_result" && (native.error || (native.status && native.status !== "completed"))) {
      owner.finalAnswer = false;
      owner.state = owner.unread ? "unread" : "idle";
    }
    if (native.type === "desktop_status" && ["disconnected", "error"].includes(String(native.status))) {
      owner.pendingUI.clear(); owner.replay.clear();
      if (owner.state !== "starting" && owner.state !== "stopping") this.engines.delete(owner.id);
    }
    if (owner === this.selected) this.send(frame);
    if (owner === this.selected && !this.engines.has(owner.id)) this.selected = undefined;
    if (owner.state !== previous || !this.engines.has(owner.id)) this.publish();
  }
}
