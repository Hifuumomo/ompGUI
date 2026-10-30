import type {
  LaunchOptions,
  ModelSelection,
  ModelState,
  RpcCommand,
  RpcFrame,
  SessionOperationRequest,
} from "../shared/protocol";
import { OmpRuntime } from "./rpc";

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
  private readonly runtime = new OmpRuntime((frame) => {
    if (["extension_ui_request", "agents_hub_progress"].includes(frame.type))
      this.emit(frame);
    if (
      frame.type === "desktop_status" &&
      ["error", "disconnected"].includes(String(frame.status))
    )
      this.key = undefined;
  });

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  prepare(
    options: LaunchOptions,
    extension: string,
    selection?: ModelSelection,
  ): Promise<ModelState> {
    return this.serial(async () => {
      const { sessionPath: _ignored, ...independent } = options;
      const key = JSON.stringify(independent);
      if (key !== this.key) {
        await this.runtime.stop();
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
    return this.serial(() => this.runtime.subagentHistory(action));
  }

  /** 配置进程仅提供只读来源检查，绝不在内存配置会话中运行历史代理。 */
  seance<T = unknown>(action: { op: "inspect"; sourceSession: string }): Promise<T> {
    if (action.op !== "inspect")
      return Promise.reject(new Error("配置进程仅允许只读检查 seance 来源"));
    return this.serial(() => this.runtime.seance<T>({
      op: "inspect",
      sourceSession: action.sourceSession,
    }));
  }

  /** 会话改名/删除在无会话的配置进程中执行，避免与用户会话争用租约。 */
  sessionOperation(request: SessionOperationRequest): Promise<void> {
    return this.serial(() => this.runtime.sessionOperation(request));
  }

  request(command: RpcCommand): Promise<unknown> {
    if (command.type === "agents_hub")
      return this.serial(() =>
        this.runtime.agentsHub(command.action as Record<string, unknown>),
      );
    if (command.type === "model_hub")
      return this.serial(() =>
        this.runtime.modelHub(command.action as Record<string, unknown>),
      );
    if (command.type === "cycle_role_model")
      return this.serial(() =>
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
    return this.serial(() => this.runtime.request(safe));
  }

  stop(): Promise<void> {
    return this.serial(async () => {
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
