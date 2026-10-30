import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type {
  RpcFrame,
  ToolFilePreview,
  ToolFilePreviewRequest,
} from "../shared/protocol";
import { describeToolCall } from "../shared/tool-presentation";
import {
  sessionHistoryMessages,
  type SessionHistorySnapshot,
} from "../shared/session-history";

const PREVIEW_LIMIT = 512 * 1024;
const SESSION_COMMANDS = new Set([
  "new_session",
  "open_session",
  "switch_session",
  "branch",
  "fork",
  "handoff",
  "compact",
]);

/**
 * 识别会改变原生会话或上下文 leaf 的命令。
 * 参数：[in] type 原生 RPC 命令类型。
 * 返回值：命令开始前是否必须撤销旧工具授权。
 */
export function changesToolSession(type: string): boolean {
  return SESSION_COMMANDS.has(type);
}

/**
 * 仅将普通对象作为原生帧载荷读取，不把文本或数组伪装成工具参数。
 * 参数：[in] value 原生载荷。
 * 返回值：普通记录或 undefined。
 */
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * 拒绝设备命名空间、Windows 保留设备名、备用数据流和 NUL 路径。
 * 参数：[in] path 已由原生工具明确引用的磁盘路径。
 * 返回值：无；不适合普通文件预览时抛出错误。
 */
function assertDiskPath(path: string): void {
  if (!path || path.includes("\0") || /^[/\\]{2}[?.][/\\]/.test(path))
    throw new Error("不支持设备或无效文件路径");
  if (process.platform === "win32") {
    const withoutDrive = path.replace(/^[a-z]:/i, "");
    if (withoutDrive.includes(":")) throw new Error("不支持文件备用数据流");
    for (const component of withoutDrive.split(/[/\\]/)) {
      if (
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]|$)/i.test(
          component,
        )
      )
        throw new Error("不支持 Windows 设备文件");
    }
  }
}

/**
 * 从真实普通文件有界读取当前 UTF-8 文本，始终关闭只读句柄。
 * 参数：[in] path 已解析的绝对文件路径。
 * 返回值：最多 512 KiB 的当前文本、真实大小与截断标识；二进制和文件系统错误拒绝。
 */
async function readPreview(path: string): Promise<ToolFilePreview> {
  // 先检查类型，再以非阻塞方式打开；FIFO 替换竞态不能让预览挂起。
  const before = await fs.stat(path);
  if (!before.isFile()) throw new Error("工具对象不是普通文件，无法预览");
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("工具对象不是普通文件，无法预览");
    const buffer = Buffer.allocUnsafe(
      Math.min(stat.size + 1, PREVIEW_LIMIT + 1),
    );
    let bytes = 0;
    while (bytes < buffer.length) {
      const chunk = await handle.read(
        buffer,
        bytes,
        buffer.length - bytes,
        bytes,
      );
      if (chunk.bytesRead === 0) break;
      bytes += chunk.bytesRead;
    }
    const byteSize = (await handle.stat()).size;
    // 文件在 stat 后增长或报告零大小但仍有内容时，也不能把未到 EOF 的前缀声称为完整文本。
    const truncated =
      bytes === buffer.length || byteSize > Math.min(bytes, PREVIEW_LIMIT);
    const visible = buffer.subarray(0, Math.min(bytes, PREVIEW_LIMIT));
    if (
      visible.some(
        (byte) => byte < 9 || byte === 11 || (byte > 13 && byte < 32),
      )
    )
      throw new Error("工具文件是二进制内容，无法作为 UTF-8 文本预览");
    let content: string;
    try {
      // 截断时允许末尾 UTF-8 字符尚未完整，绝不制造替换字符或隐藏中间编码错误。
      content = new TextDecoder("utf-8", { fatal: true }).decode(visible, {
        stream: truncated,
      });
    } catch {
      throw new Error("工具文件不是有效的 UTF-8 文本，无法预览");
    }
    return { path, content, truncated, byteSize };
  } finally {
    await handle.close();
  }
}

/** 保存当前真实连接、会话与已完成原生工具参数的最小只读授权账本。 */
export class ToolFilePreviewLedger {
  private cwd?: string; // runtime.start 返回的实际 CLI 工作目录。
  private sessionId?: string; // 最近一次可信 get_state 的原生会话标识。
  private epoch = 0; // 所有连接、leaf 与会话失效的单调代数。
  private transitions = 0; // 尚未结束的会话/树导航操作，期间不接纳新授权。
  private autoCompacting = false; // 原生自动维护 start/end 之间禁止建立或使用授权。
  private nativeCompacting = false; // 最近可信 get_state 观察到的手动/自动压缩状态。
  private backgroundMaintenance = false; // 已启动的后台 slash 维护，只有真实空闲 state 才可结束。
  private cwdUnverified = false; // 已知目录变动后禁止沿用旧 cwd 解析相对文件。
  private workspaceHeaderNeeded = false; // 已知 move/worktree 可由真实新会话头重新核实 cwd。
  private readonly targets = new Map<string, Set<string>>(); // 原生工具 id 对应显式磁盘目标。

  /**
   * 绑定已成功启动的实际 CLI 工作目录，不接受 renderer 预览参数中的 cwd。
   * 参数：[in] cwd runtime.start 的实际工作目录。
   * 返回值：无。
   */
  connect(cwd: string): void {
    this.invalidate();
    this.cwd = cwd;
    this.autoCompacting = false;
    this.nativeCompacting = false;
    this.backgroundMaintenance = false;
    this.cwdUnverified = false;
    this.workspaceHeaderNeeded = false;
  }

  /**
   * 撤销全部工具和会话绑定，使已开始的异步读取同样失效。
   * 参数：无。
   * 返回值：无。
   */
  invalidate(): void {
    this.epoch += 1;
    this.sessionId = undefined;
    this.targets.clear();
  }

  /**
   * 在会话或树导航开始前撤销证据，并冻结迟到的旧请求与实时帧。
   * 参数：无。
   * 返回值：无。
   */
  beginTransition(): void {
    this.transitions += 1;
    this.invalidate();
  }

  /**
   * 结束会话或树导航；成功、取消与失败均需重新读取真实原生状态。
   * 参数：无。
   * 返回值：无。
   */
  endTransition(): void {
    this.transitions -= 1;
    this.invalidate();
  }

  /**
   * 从 compact/handoff slash 开始保持授权失效，不把早到 admission 回执当作维护完成。
   * 参数：无。
   * 返回值：无。
   */
  beginBackgroundMaintenance(): void {
    this.backgroundMaintenance = true;
    this.invalidate();
  }

  /** 计划转换已取得非压缩的真实状态，执行回合不再延长压缩授权冻结。 */
  endPlanMaintenance(): void {
    this.backgroundMaintenance = false;
    this.invalidate();
  }

  /**
   * 记录已知可能改变 CLI cwd 的原生命令，禁止继续猜测旧目录。
   * 参数：[in] canVerifyHeader move/worktree 是否可通过已落盘原生头确认新目录。
   * 返回值：无。
   */
  invalidateWorkspace(canVerifyHeader: boolean): void {
    this.cwdUnverified = true;
    this.workspaceHeaderNeeded = canVerifyHeader;
    this.invalidate();
  }

  /**
   * 告知可信请求包装器是否需要从实际 get_state.sessionFile 核实工作目录。
   * 参数：无。
   * 返回值：当前可恢复的 workspace 变动是否尚未核实。
   */
  needsWorkspaceHeader(): boolean {
    return this.workspaceHeaderNeeded && this.transitions === 0;
  }

  /**
   * 接纳已由真实 get_state 指向、且在同一代数读取完成的原生会话头。
   * 参数：[in] header 只读原生文件头；[in] sessionId 对应 get_state 的真实会话 id；[in] epoch 状态请求发起时的代数。
   * 返回值：无；旧响应被忽略，头标识或 cwd 缺失明确拒绝。
   */
  acceptWorkspace(
    header: { id: string; cwd: string },
    sessionId: string,
    epoch: number,
  ): void {
    if (epoch !== this.epoch || this.transitions || !this.workspaceHeaderNeeded)
      return;
    if (header.id !== sessionId || !header.cwd.trim())
      throw new Error(
        "原生工作目录未能通过当前会话头核实，请重新连接后预览相对路径",
      );
    this.cwd = resolve(header.cwd);
    this.cwdUnverified = false;
    this.workspaceHeaderNeeded = false;
  }

  /**
   * 记录发起 native request 时的连接/会话代数，防止旧响应重新绑定新连接。
   * 参数：无。
   * 返回值：当前代数。
   */
  requestEpoch(): number {
    return this.epoch;
  }

  /**
   * 接纳当前代数的真实成功 RPC 返回值，历史消息不使用 renderer 提供的数据。
   * 参数：[in] command 发起的原生命令；[in] data runtime.request 返回的原生数据；[in] epoch 请求发起时的代数。
   * 返回值：无。
   */
  acceptResponse(command: string, data: unknown, epoch: number): void {
    if (epoch !== this.epoch || !this.cwd || this.transitions) return;
    const value = record(data);
    if (command === "get_state" && typeof value?.sessionId === "string") {
      const compacting = value.isCompacting === true;
      if (compacting !== this.nativeCompacting) {
        this.nativeCompacting = compacting;
        this.invalidate();
      }
      // isSettled 本身不包含 RPC 后台任务；手动 compact/handoff 的 cleanup 被 isCompacting 覆盖。
      if (
        this.backgroundMaintenance &&
        !this.autoCompacting &&
        value.isCompacting === false &&
        value.isSettled === true
      ) {
        this.backgroundMaintenance = false;
        this.invalidate();
      }
      if (
        this.autoCompacting ||
        this.nativeCompacting ||
        this.backgroundMaintenance
      )
        return;
      if (this.sessionId !== value.sessionId) {
        this.invalidate();
        this.sessionId = value.sessionId;
      }
    } else if (
      !this.autoCompacting &&
      !this.nativeCompacting &&
      !this.backgroundMaintenance &&
      (command === "get_messages" ||
        command === "get_messages_page" ||
        command === "get_entries") &&
      this.sessionId &&
      (command === "get_entries"
        ? Array.isArray(value?.entries)
        : Array.isArray(value?.messages))
    ) {
      const messages =
        command === "get_entries"
          ? sessionHistoryMessages(value as unknown as SessionHistorySnapshot)
          : value?.messages;
      if (Array.isArray(messages))
        for (const message of messages) this.addMessage(message);
    }
  }

  /**
   * 只读取真实 forwarded native live 帧；不从任意 response、子代理或工具结果猜测路径。
   * 参数：[in] frame OmpRuntime 实际转发的原生帧或连接状态。
   * 返回值：无。
   */
  observe(frame: RpcFrame): void {
    if (frame.type === "desktop_status" && frame.status !== "connected") {
      this.invalidate();
      this.cwd = undefined;
      this.autoCompacting = false;
      this.nativeCompacting = false;
      this.backgroundMaintenance = false;
      return;
    }
    if (
      frame.type === "auto_compaction_start" ||
      frame.type === "auto_compaction_end"
    ) {
      this.autoCompacting = frame.type === "auto_compaction_start";
      // 开始与结束都改变代数；跨压缩期间的迟到 state/history 不能重新提供授权。
      this.invalidate();
      return;
    }
    if (frame.type === "session_info_update") {
      this.invalidate();
      return;
    }
    if (
      !this.cwd ||
      !this.sessionId ||
      this.transitions ||
      this.autoCompacting ||
      this.nativeCompacting ||
      this.backgroundMaintenance
    )
      return;
    if (frame.type === "message_end") this.addMessage(frame.message);
    if (frame.type === "message_update") {
      const event = record(frame.assistantMessageEvent);
      if (
        event?.type === "toolcall_end" &&
        (record(frame.message)?.role === "assistant" ||
          record(event.partial)?.role === "assistant")
      )
        this.addCall(event.toolCall);
    }
    if (frame.type === "tool_execution_start") {
      this.addCall({
        id: frame.toolCallId,
        name: frame.toolName,
        arguments: frame.args,
      });
    }
  }

  /**
   * 提取完整原生助手消息中的工具调用，不把 toolResult 或未知角色授权为文件。
   * 参数：[in] message 原生历史或 message_end 消息。
   * 返回值：无。
   */
  private addMessage(message: unknown): void {
    const value = record(message);
    if (value?.role !== "assistant" || !Array.isArray(value.content)) return;
    for (const part of value.content) {
      const type = record(part)?.type;
      if (type === "toolCall" || type === "toolcall") this.addCall(part);
    }
  }

  /**
   * 复用共享纯解析器建立精确的原生工具 id 与磁盘目标绑定。
   * 参数：[in] call 已完成参数的原生 toolCall 或 tool_execution_start 对象。
   * 返回值：无。
   */
  private addCall(call: unknown): void {
    const value = record(call);
    if (
      typeof value?.id !== "string" ||
      !value.id ||
      typeof value.name !== "string"
    )
      return;
    const files = new Set<string>();
    for (const target of describeToolCall(value.name, value.arguments)
      .targets) {
      if (target.kind === "file") files.add(target.path);
    }
    this.targets.set(value.id, files);
  }

  /**
   * 检查 renderer 请求严格匹配当前会话、原生工具 id 与提取的原始文件目标。
   * 参数：[in] request 预览请求；[in] epoch 开始读取时的代数。
   * 返回值：无；无证据、旧连接和旧会话一律拒绝。
   */
  private assertAuthority(
    request: ToolFilePreviewRequest,
    epoch: number,
  ): void {
    if (
      epoch !== this.epoch ||
      !this.cwd ||
      this.transitions ||
      this.autoCompacting ||
      this.nativeCompacting ||
      this.backgroundMaintenance ||
      request.sessionId !== this.sessionId
    )
      throw new Error(
        "工具预览所属连接或会话已失效，请重新选择当前会话中的工具对象",
      );
    if (!this.targets.get(request.toolCallId)?.has(request.path))
      throw new Error("此文件未被当前原生工具调用明确授权");
  }

  /**
   * 在读取前后向真实 CLI 核对当前会话，并通过代数阻止等待期间的切换与重连泄露。
   * 参数：[in] request renderer 的会话/id/路径三元组；[in] getState 主进程只读 get_state 操作。
   * 返回值：当前授权文件的有界 UTF-8 预览；所有授权、原生及文件系统错误明确拒绝。
   */
  async preview(
    request: ToolFilePreviewRequest,
    getState: () => Promise<unknown>,
  ): Promise<ToolFilePreview> {
    const epoch = this.epoch;
    this.assertAuthority(request, epoch);
    const before = record(await getState());
    this.assertAuthority(request, epoch);
    if (before?.sessionId !== request.sessionId)
      throw new Error("原生当前会话已改变，工具预览被拒绝");
    if (before.isCompacting === true) {
      this.nativeCompacting = true;
      this.invalidate();
      throw new Error("原生会话正在压缩，工具文件预览暂不可用");
    }
    assertDiskPath(request.path);
    const expanded =
      request.path === "~"
        ? homedir()
        : /^~[/\\]/.test(request.path)
          ? resolve(homedir(), request.path.slice(2))
          : request.path;
    if (this.cwdUnverified && !isAbsolute(expanded))
      throw new Error("原生工作目录已改变且尚未核实，请重新连接后预览相对路径");
    const path = isAbsolute(expanded)
      ? resolve(expanded)
      : resolve(this.cwd!, expanded);
    const preview = await readPreview(path);
    this.assertAuthority(request, epoch);
    const after = record(await getState());
    this.assertAuthority(request, epoch);
    if (after?.sessionId !== request.sessionId)
      throw new Error("读取期间原生会话已改变，工具预览被拒绝");
    if (after.isCompacting === true) {
      this.nativeCompacting = true;
      this.invalidate();
      throw new Error("读取期间原生会话开始压缩，工具文件预览被拒绝");
    }
    return preview;
  }
}
