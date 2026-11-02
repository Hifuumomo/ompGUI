import type {
  LaunchOptions,
  ModelSelection,
  ModelState,
  RpcCommand,
  RpcFrame,
  SessionOperationRequest,
} from "../shared/protocol";
import { OmpRuntime } from "./rpc";
import { getPerformanceLogger } from "./performance-log";

/** 显式选择必须全部应用成功才可发送，失败不静默退回其他模型。 */
export async function applyModelSelection(
  runtime: OmpRuntime,
  selection?: ModelSelection,
): Promise<void> {
  if (!selection) return;
  await runtime.request({
    type: "set_model",
    provider: selection.provider,
    modelId: selection.modelId,
  });
  if (selection.thinkingLevel)
    await runtime.request({
      type: "set_thinking_level",
      level: selection.thinkingLevel,
    });
}

/** 独立内存会话服务模型选择与代理配置；不接受聊天 prompt 或历史导航。 */
export class ModelRuntime {
  constructor(private readonly emit: (frame: RpcFrame) => void) {}
  private key?: string;
  private queue: Promise<unknown> = Promise.resolve();
  private perfQueueDepth = 0; // 仅启用诊断时维护排队深度。
  private perfOperationSequence = 0; // 诊断专用队列项标识。
  private readonly runtime = new OmpRuntime((frame) => {
    if (["extension_ui_request", "agents_hub_progress"].includes(frame.type))
      this.emit(frame);
    if (
      frame.type === "desktop_status" &&
      ["error", "disconnected"].includes(String(frame.status))
    )
      this.key = undefined;
  });

  private serial<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const perf = getPerformanceLogger();
    if (perf) {
      const enqueued = performance.now();
      const operationId = ++this.perfOperationSequence;
      const depth = ++this.perfQueueDepth;
      perf.event("queue.enqueue", { queue: "model", operation: name, operationId, depth });
      const run = async (): Promise<T> => {
        const started = performance.now();
        perf.event("queue.start", { queue: "model", operation: name, operationId, depth: this.perfQueueDepth, waitMs: started - enqueued });
        let outcome = "success";
        try { return await operation(); }
        catch (error) { outcome = "error"; throw error; }
        finally {
          this.perfQueueDepth--;
          perf.event("queue.end", { queue: "model", operation: name, operationId, depth: this.perfQueueDepth, runMs: performance.now() - started, outcome });
        }
      };
      const next = this.queue.then(run, run);
      this.queue = next.catch(() => undefined);
      return next;
    }
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  prepare(
    options: LaunchOptions,
    extension: string,
    selection?: ModelSelection,
  ): Promise<ModelState> {
    return this.serial("prepare", async () => {
      const { sessionPath: _ignored, ...independent } = options;
      const key = JSON.stringify(independent);
      if (key !== this.key) {
        await this.runtime.stop();
        const perf = getPerformanceLogger();
        if (perf) perf.event("engine.owner", { runtimeId: this.runtime.performanceId, role: "model" });
        await this.runtime.start(independent, extension, true);
        this.key = key;
      }
      await applyModelSelection(this.runtime, selection);
      const state = await this.runtime.request<ModelState>({
        type: "get_state",
      });
      return { model: state.model, thinkingLevel: state.thinkingLevel };
    });
  }

  subagentHistory(action: Record<string, unknown>): Promise<unknown> {
    return this.serial("subagent-history", () => this.runtime.subagentHistory(action));
  }

  /** 配置进程仅提供只读来源检查，绝不在内存配置会话中运行历史代理。 */
  seance<T = unknown>(action: { op: "inspect"; sourceSession: string }): Promise<T> {
    if (action.op !== "inspect")
      return Promise.reject(new Error("配置进程仅允许只读检查 seance 来源"));
    return this.serial("seance-inspect", () => this.runtime.seance<T>({
      op: "inspect",
      sourceSession: action.sourceSession,
    }));
  }

  /** 会话改名/删除在无会话的配置进程中执行，避免与用户会话争用租约。 */
  sessionOperation(request: SessionOperationRequest): Promise<void> {
    return this.serial("session-operation", () => this.runtime.sessionOperation(request));
  }

  request(command: RpcCommand): Promise<unknown> {
    if (command.type === "agents_hub")
      return this.serial("agents-hub", () =>
        this.runtime.agentsHub(command.action as Record<string, unknown>),
      );
    if (command.type === "model_hub")
      return this.serial("model-hub", () =>
        this.runtime.modelHub(command.action as Record<string, unknown>),
      );
    if (command.type === "cycle_role_model")
      return this.serial("cycle-role-model", () =>
        this.runtime.cycleRoleModel(String(command.direction)),
      );
    const fields: Record<string, string[]> = {
      get_state: [],
      get_available_models: [],
      get_available_thinking_levels: [],
      login: ["providerId"],
      set_model: ["provider", "modelId"],
      cycle_model: [],
      set_thinking_level: ["level"],
      cycle_thinking_level: [],
    };
    if (!Object.hasOwn(fields, command.type))
      return Promise.reject(
        new Error("配置准备进程仅接受模型、思考等级和代理管理操作"),
      );
    const safe: RpcCommand = { type: command.type };
    for (const field of fields[command.type]) {
      const value = command[field];
      if (typeof value !== "string" || !value.trim() || value.includes("\0"))
        return Promise.reject(new Error(`无效的模型参数：${field}`));
      safe[field] = value;
    }
    return this.serial("request", () => this.runtime.request(safe));
  }

  stop(): Promise<void> {
    return this.serial("stop", async () => {
      this.key = undefined;
      await this.runtime.stop();
    });
  }

  ownsUIRequest(id: string): boolean {
    return this.runtime.ownsUIRequest(id);
  }

  respondUI(response: { id: string; [key: string]: unknown }): Promise<void> {
    return this.runtime.respondUI(response);
  }
}
