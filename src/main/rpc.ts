import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type {
  ConnectionInfo,
  LaunchOptions,
  ModelRole,
  RoleModelCycle,
  RpcCommand,
  RpcFrame,
  SessionOperationRequest,
  TreeDeletionRequest,
} from "../shared/protocol";
import { readSessionHeader } from "./sessions";
import type { TreeNavigationOptions } from "../shared/native-tree";
import type { PlanAction, PlanSnapshot } from "../shared/native-plan";
import { cancelPlanOperation, readPlanControl, type PlanControl } from "./plan-control";

const PHYSICAL_LIMIT = 1024 * 1024;
const LOGICAL_LIMIT = 64 * 1024 * 1024;
const CHUNK_LIMIT = 256 * 1024;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  command: string;
  output?: string[]; // prompt 响应前到达的本地 slash command_output 文本。
};
type ChunkSequence = {
  id: string;
  count: number;
  byteLength: number;
  next: number;
  bytes: number;
  parts: Buffer[];
};

/**
 * 检查可执行文件候选是否可访问。
 * 参数：[in] file 文件路径。
 * 返回值：存在且可执行时为 true，缺失时为 false，其他文件系统错误抛出。
 */
async function executableExists(file: string): Promise<boolean> {
  try {
    await access(
      file,
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    );
    return true;
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR"].includes(
        (error as NodeJS.ErrnoException).code || "",
      )
    )
      return false;
    throw error;
  }
}

/**
 * 从显式路径、安装目录或 PATH 解析真正的 omp 可执行程序。
 * 参数：[in] selected 用户选定的引擎路径或命令名。
 * 返回值：shell:false 可直接启动的程序绝对路径。
 */
export async function resolveEngine(selected: string): Promise<string> {
  const candidates: string[] = [];
  if (isAbsolute(selected) || /[\\/]/.test(selected))
    candidates.push(resolve(selected));
  else {
    const names =
      process.platform === "win32" && !extname(selected)
        ? [`${selected}.exe`, selected, `${selected}.cmd`]
        : [selected];
    if (/^omp(?:\.exe)?$/i.test(selected))
      candidates.push(
        join(
          process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
          "omp",
          "omp.exe",
        ),
      );
    for (const directory of (process.env.PATH || "").split(delimiter)) {
      if (directory)
        for (const name of names) candidates.push(join(directory, name));
    }
  }
  for (const candidate of candidates) {
    if (!(await executableExists(candidate))) continue;
    // Windows npm/bun 包装脚本不能被 shell:false 当作 PE 文件执行。
    if (
      process.platform === "win32" &&
      extname(candidate).toLowerCase() !== ".exe"
    ) {
      const sibling = join(resolve(candidate, ".."), "omp.exe");
      if (await executableExists(sibling)) return sibling;
      throw new Error(
        `所选引擎是脚本启动器（${candidate}）。请安装 omp 的 Windows 原生版本并选择 omp.exe；GUI 不通过 shell 执行 .cmd/.ps1/Bun 脚本。`,
      );
    }
    if (/^bun(?:\.exe)?$/i.test(basename(candidate)))
      throw new Error(
        "请选择 omp.exe，而不是 Bun 本身；omp 原生安装已内置运行时。",
      );
    return candidate;
  }
  throw new Error(
    `找不到 omp 引擎：${selected}。请安装 oh-my-pi Windows 原生版本，或选择 C:\\Users\\<用户名>\\AppData\\Local\\omp\\omp.exe。`,
  );
}

/**
 * 管理真实 omp RPC 子进程、严格传输解码与原生扩展桥接。
 */
export class OmpRuntime {
  private child?: ChildProcessWithoutNullStreams; // 当前原生 CLI 进程。
  private pending = new Map<string, Pending>(); // RPC 响应相关请求。
  private extensionPending = new Map<string, Pending>(); // 原生 notify 相关扩展请求。
  private internalIds = new Set<string>(); // 不向 UI 发送的桥接 prompt 标识。
  private uiRequests = new Set<string>(); // 尚未响应的原生交互请求。
  private promptOrder: string[] = []; // 未响应 prompt 的发送顺序；原生普通命令串行执行，据此归属 command_output。
  private commands = new Set<string>(); // 原生已注册 slash 命令。
  private parts: Buffer[] = []; // 跨 stdout 数据块的物理帧片段。
  private lineBytes = 0; // 当前物理帧累计字节。
  private sequence?: ChunkSequence; // 当前不可交错的 v2 逻辑帧。
  private physicalLimit = PHYSICAL_LIMIT; // ready 宣告且受本地上限约束的物理帧限制。
  private logicalLimit = LOGICAL_LIMIT; // ready 宣告且受本地上限约束的逻辑帧限制。
  private protocolVersion = 1; // 协商后的输出协议版本。
  private readyPending?: {
    resolve: (frame: RpcFrame) => void;
    reject: (error: Error) => void;
  }; // 启动握手等待器。
  private closePromise?: Promise<void>; // 进程关闭且 stdout 已排空的等待器。
  private closing = false; // 是否由 GUI 正常停止进程。
  private fault?: Error; // 终止传输或进程的真实错误。
  private connected = false; // 是否完成握手和原生扩展就绪。
  private planSnapshot?: PlanSnapshot;
  private planControl?: PlanControl; // 原生私有取消凭据，禁止进入 renderer 帧。
  private planControlLifetime = new AbortController(); // 断线时终止独立 socket 请求。
  private shutdownPromise?: Promise<void>; // 串行化同一个进程的停止操作。
  private readonly emit: (frame: RpcFrame) => void; // 将原生事件送至受信窗口。

  /**
   * 创建原生进程运行器。
   * 参数：[in] emit UI 帧分发回调。
   * 返回值：无。
   */
  constructor(emit: (frame: RpcFrame) => void) {
    this.emit = emit;
  }

  /**
   * 启动指定工作目录或会话，协商协议并确认 GUI 原生扩展可用。
   * 参数：[in] options 启动参数；[in] extensionPath 应用拥有的原生扩展路径。
   * 返回值：实际可执行路径、原生会话 cwd 和协议版本。
   */
  async start(
    options: LaunchOptions,
    extensionPath: string,
    memoryOnly = false,
  ): Promise<ConnectionInfo> {
    if (memoryOnly && options.sessionPath)
      throw new Error("模型准备进程不能打开历史会话");
    if (this.child) throw new Error("引擎已启动，请先停止当前连接");
    this.emit({ type: "desktop_status", status: "starting" });
    const executable = await resolveEngine(options.executable);
    let cwd = resolve(options.cwd);
    let sessionId: string | undefined;
    if (options.sessionPath) {
      const header = await readSessionHeader(options.sessionPath);
      if (!header.cwd)
        throw new Error(
          "旧会话没有保存工作目录；请先使用 omp 终端恢复并确认目录，而不是猜测工具执行路径。",
        );
      cwd = resolve(header.cwd);
      sessionId = header.id;
    }
    await access(cwd);
    await access(extensionPath);
    const args = ["--mode", "rpc-ui", "--extension", extensionPath];
    if (memoryOnly) args.push("--no-session");
    if (options.profile) args.push("--profile", options.profile);
    // 有目标会话时先在应用私有临时目录启动，禁止启动阶段自动恢复/写入原文件。
    const bootstrapDir = await mkdtemp(join(tmpdir(), "ompgui-bootstrap-"));
    const configFile = join(bootstrapDir, "startup.yml");
    await writeFile(configFile, "autoResume: false\n", { flag: "wx" });
    args.push("--config", configFile);
    if (options.sessionPath) {
      const bootstrapFile = join(bootstrapDir, "bootstrap.jsonl");
      await writeFile(
        bootstrapFile,
        `${JSON.stringify({ type: "session", version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd })}\n`,
        { flag: "wx" },
      );
      args.push(
        "--session",
        bootstrapFile,
        "--session-dir",
        dirname(resolve(options.sessionPath!)),
      );
    }
    const env = { ...process.env };
    if (options.agentDir) env.PI_CODING_AGENT_DIR = resolve(options.agentDir);
    this.closing = false;
    this.fault = undefined;
    this.protocolVersion = 1;
    this.physicalLimit = PHYSICAL_LIMIT;
    this.logicalLimit = LOGICAL_LIMIT;
    const ready = new Promise<RpcFrame>((resolveReady, reject) => {
      this.readyPending = { resolve: resolveReady, reject };
    });
    const timer = setTimeout(
      () =>
        this.fail(
          new Error(
            "omp 启动握手超时，请检查引擎路径、原生配置与 stderr 日志。",
          ),
        ),
      60_000,
    );
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: "pipe",
    });
    this.child = child;
    const stderr = new StringDecoder("utf8");
    child.stdout.on("data", (data: Buffer) => {
      try {
        this.consume(data);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdout.on("end", () => {
      if (this.lineBytes || this.sequence)
        this.fail(new Error("omp stdout 在未完成的 JSONL/chunk 帧中结束"));
    });
    child.stderr.on("data", (data: Buffer) => {
      const text = stderr.write(data);
      if (text) this.emit({ type: "desktop_log", text });
    });
    child.stderr.on("end", () => {
      const text = stderr.end();
      if (text) this.emit({ type: "desktop_log", text });
    });
    child.on("error", (error) =>
      this.fail(new Error(`omp 子进程失败：${error.message}`)),
    );
    child.stdin.on("error", (error) =>
      this.fail(new Error(`omp stdin 失败：${error.message}`)),
    );
    child.stdout.on("error", (error) =>
      this.fail(new Error(`omp stdout 失败：${error.message}`)),
    );
    child.stderr.on("error", (error) =>
      this.fail(new Error(`omp stderr 失败：${error.message}`)),
    );
    this.closePromise = new Promise<void>((resolveClose) => {
      child.once("close", (code, signal) => {
        if (bootstrapDir)
          void rm(bootstrapDir, { recursive: true, force: true }).catch(
            () => {},
          );
        const error =
          this.fault ||
          (code !== 0
            ? new Error(
                `omp 已退出（code=${code}, signal=${signal || "无"}）；请检查日志中的持久化/引擎错误。`,
              )
            : new Error("omp 连接已结束"));
        this.rejectAll(error);
        this.readyPending?.reject(error);
        this.readyPending = undefined;
        this.child = undefined;
        this.planControl = undefined;
        this.planControlLifetime.abort();
        this.connected = false;
        this.parts = [];
        this.lineBytes = 0;
        this.sequence = undefined;
        this.commands.clear();
        this.internalIds.clear();
        this.promptOrder = [];
        this.uiRequests.clear();
        this.emit({
          type: "desktop_status",
          status: this.fault || code !== 0 ? "error" : "disconnected",
          error: this.fault || code !== 0 ? error.message : undefined,
        });
        resolveClose();
      });
    });
    try {
      const frame = await ready;
      if (
        Array.isArray(frame.supportedProtocolVersions) &&
        frame.supportedProtocolVersions.includes(2)
      ) {
        await this.request({ type: "negotiate_protocol", protocolVersion: 2 });
        this.protocolVersion = 2;
      }
      await this.request({ type: "set_ask_dialog", enabled: true });
      // 不依赖 autoResume：无显式文件就让引擎创建真正的新会话。
      if (!options.sessionPath) {
        const result = await this.request<{ cancelled?: boolean }>({
          type: "new_session",
        });
        if (result?.cancelled) throw new Error("原生扩展取消了新会话创建");
      }
      const result = await this.request<{ commands: { name: string }[] }>({
        type: "get_available_commands",
      });
      this.commands = new Set(result.commands.map((command) => command.name));
      if (
        !this.commands.has("ompgui-roles") ||
        !this.commands.has("ompgui-tree")
      ) {
        throw new Error(
          "GUI 原生扩展未成功注册；请检查 extension_error 日志或引擎扩展设置。未发送任何桥接 prompt。",
        );
      }
      this.connected = true;
      if (options.sessionPath) {
        await this.bridge("ompgui-resume", {
          path: resolve(options.sessionPath),
          sessionId,
        });
      }
      await this.plan({ op: "status" });
      this.emit({ type: "desktop_status", status: "connected" });
      return { executable, cwd, protocolVersion: this.protocolVersion };
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      await this.stop();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 严格按物理字节限制拆分 stdout JSONL，保留半行。
   * 参数：[in] data stdout 原始字节。
   * 返回值：无。
   */
  private consume(data: Buffer): void {
    let offset = 0;
    while (offset < data.length) {
      const newline = data.indexOf(10, offset);
      const end = newline < 0 ? data.length : newline + 1;
      const piece = data.subarray(offset, end);
      this.lineBytes += piece.length;
      if (this.lineBytes > this.physicalLimit)
        throw new Error("omp 物理帧超过传输限制");
      this.parts.push(piece);
      offset = end;
      if (newline < 0) break;
      const bytes =
        this.parts.length === 1
          ? this.parts[0]
          : Buffer.concat(this.parts, this.lineBytes);
      this.parts = [];
      this.lineBytes = 0;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const frame = this.decode(JSON.parse(text));
      if (frame) this.dispatch(frame);
    }
  }

  /**
   * 验证物理帧和连续 v2 chunk，严格重组字节及 UTF-8。
   * 参数：[in] value 解析后的物理 JSON 对象。
   * 返回值：完整逻辑 RPC 帧；中间 chunk 返回 undefined。
   */
  private decode(value: unknown): RpcFrame | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("omp RPC 帧必须是对象");
    const frame = value as RpcFrame;
    if (typeof frame.type !== "string") throw new Error("omp RPC 帧缺少 type");
    if (frame.type !== "rpc_chunk") {
      if (this.sequence) throw new Error("omp chunk 序列被其他帧打断");
      return frame;
    }
    if (this.protocolVersion !== 2) throw new Error("收到未协商的 v2 chunk");
    const { chunkId, index, count, byteLength, data } = frame;
    if (
      typeof chunkId !== "string" ||
      !chunkId ||
      chunkId.length > 128 ||
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(count) ||
      !Number.isSafeInteger(byteLength) ||
      (index as number) < 0 ||
      (count as number) < 2 ||
      (count as number) > Math.ceil(this.logicalLimit / CHUNK_LIMIT) ||
      (index as number) >= (count as number) ||
      (byteLength as number) < this.physicalLimit ||
      (byteLength as number) > this.logicalLimit
    ) {
      throw new Error("omp chunk 元数据无效");
    }
    if (
      typeof data !== "string" ||
      !data ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        data,
      )
    ) {
      throw new Error("omp chunk base64 无效");
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > CHUNK_LIMIT || bytes.toString("base64") !== data)
      throw new Error("omp chunk 字节无效");
    if (!this.sequence) {
      if (index !== 0) throw new Error("omp chunk 必须从 index=0 开始");
      this.sequence = {
        id: chunkId,
        count: count as number,
        byteLength: byteLength as number,
        next: 0,
        bytes: 0,
        parts: [],
      };
    }
    const sequence = this.sequence;
    if (
      sequence.id !== chunkId ||
      sequence.next !== index ||
      sequence.count !== count ||
      sequence.byteLength !== byteLength
    ) {
      throw new Error("omp chunk 交错或索引/长度不一致");
    }
    sequence.parts.push(bytes);
    sequence.bytes += bytes.length;
    sequence.next++;
    if (sequence.bytes > sequence.byteLength)
      throw new Error("omp chunk 超过声明长度");
    if (sequence.next < sequence.count) return undefined;
    if (sequence.bytes !== sequence.byteLength)
      throw new Error("omp chunk 重组长度不一致");
    this.sequence = undefined;
    const logical = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(sequence.parts, sequence.bytes),
      ),
    ) as RpcFrame;
    if (
      !logical ||
      typeof logical !== "object" ||
      Array.isArray(logical) ||
      typeof logical.type !== "string" ||
      logical.type === "rpc_chunk"
    ) {
      throw new Error("omp chunk 重组结果不是逻辑 RPC 对象");
    }
    return logical;
  }

  /**
   * 关联 ready/response/扩展 notify，其余原生事件保持原样转发。
   * 参数：[in] frame 完整原生 RPC 帧。
   * 返回值：无。
   */
  private dispatch(frame: RpcFrame): void {
    if (frame.type === "ready") {
      if (!this.readyPending) throw new Error("omp 重复发送 ready");
      if (frame.maxFrameBytes !== undefined) {
        if (
          !Number.isSafeInteger(frame.maxFrameBytes) ||
          (frame.maxFrameBytes as number) <= 0
        )
          throw new Error("omp ready 物理限制无效");
        this.physicalLimit = Math.min(
          PHYSICAL_LIMIT,
          frame.maxFrameBytes as number,
        );
      }
      if (frame.maxReassembledFrameBytes !== undefined) {
        if (
          !Number.isSafeInteger(frame.maxReassembledFrameBytes) ||
          (frame.maxReassembledFrameBytes as number) < this.physicalLimit
        )
          throw new Error("omp ready 重组限制无效");
        this.logicalLimit = Math.min(
          LOGICAL_LIMIT,
          frame.maxReassembledFrameBytes as number,
        );
      }
      this.readyPending.resolve(frame);
      this.readyPending = undefined;
    }
    if (
      frame.type === "available_commands_update" &&
      Array.isArray(frame.commands)
    ) {
      this.commands = new Set(
        frame.commands.map((command: { name: string }) => command.name),
      );
    }
    if (frame.type === "extension_ui_request") {
      if (frame.method === "cancel" && typeof frame.targetId === "string")
        this.uiRequests.delete(frame.targetId);
      if (
        frame.method === "notify" &&
        typeof frame.message === "string" &&
        frame.message.startsWith("{")
      ) {
        let envelope:
          | {
              namespace?: string;
              requestId?: string;
              ok?: boolean;
              data?: unknown;
              error?: string;
              text?: string;
              snapshot?: PlanSnapshot;
            }
          | undefined;
        try {
          envelope = JSON.parse(frame.message);
        } catch {
          /* 普通 notify 文本不是桥接协议。 */
        }
        if (envelope?.namespace === "ompgui-plan-state" && envelope.snapshot) {
          if (this.closing) return;
          const { _planControl: _ignored, ...incoming } = envelope.snapshot as PlanSnapshot & { _planControl?: unknown };
          const current = this.planSnapshot;
          if (incoming.operation?.status === "running" && current?.operation &&
              incoming.operation.id === current.operation.id &&
              current.operation.status !== "running") return;
          this.planSnapshot = incoming;
          this.emit({ type: "plan_state", snapshot: incoming });
          return;
        }
        if (envelope?.namespace === "ompgui-agents-progress") {
          this.emit({ type: "agents_hub_progress", text: envelope.text });
          return;
        }
        if (envelope?.namespace === "ompgui" && envelope.requestId) {
          const pending = this.extensionPending.get(envelope.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.extensionPending.delete(envelope.requestId);
            if (envelope.ok === true) pending.resolve(envelope.data);
            else
              pending.reject(
                new Error(envelope.error || "原生 GUI 扩展操作失败"),
              );
            return;
          }
          // 迟到的私有桥接回复也不能作为普通 UI notify 泄露取消凭据。
          return;
        }
      }
      if (
        typeof frame.id === "string" &&
        ["select", "confirm", "input", "editor", "ask", "custom"].includes(
          String(frame.method),
        )
      ) {
        this.uiRequests.add(frame.id);
        if (frame.method === "custom") {
          void this.respondUI({ id: frame.id, cancelled: true }).catch(
            (error) => this.fail(error),
          );
          this.emit({
            type: "desktop_log",
            text: "当前 GUI 不支持此扩展的自定义 TUI 组件；已明确取消请求，请使用原生终端。",
          });
          return;
        }
      }
    }
    if (frame.type === "command_output" && typeof frame.text === "string") {
      // 帧不带 id：原生队列串行执行，输出属于最早尚未响应的 prompt。
      this.pending.get(this.promptOrder[0] ?? "")?.output?.push(frame.text);
    }
    if (frame.type === "response" && typeof frame.id === "string") {
      const pending = this.pending.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(frame.id);
        this.dropPrompt(frame.id);
        if (frame.success === true) {
          // 在同一 stdout 数据块内后续帧解码前立即激活协商版本。
          if (pending.command === "negotiate_protocol")
            this.protocolVersion = 2;
          pending.resolve(
            pending.output?.length
              ? {
                  ...(frame.data as Record<string, unknown> | undefined),
                  output: pending.output.join("\n"),
                }
              : frame.data,
          );
        } else
          pending.reject(
            new Error(
              `[${pending.command}] ${String(frame.error || "RPC 操作失败")}${frame.code ? ` (${String(frame.code)})` : ""}`,
            ),
          );
      }
    }
    if (typeof frame.id === "string" && this.internalIds.has(frame.id)) {
      if (
        frame.type === "prompt_result" ||
        (frame.type === "response" &&
          (frame.data as { agentInvoked?: boolean } | undefined)
            ?.agentInvoked === false)
      )
        this.internalIds.delete(frame.id);
      return;
    }
    this.emit(frame);
  }

  /**
   * 写入单条不分块的原生协议输入并等待流接受。
   * 参数：[in] frame 待发送协议对象。
   * 返回值：写入完成的 Promise。
   */
  private async write(frame: RpcCommand): Promise<void> {
    const child = this.child;
    if (!child || child.stdin.destroyed || child.stdin.writableEnded)
      throw new Error("omp 未连接");
    const line = `${JSON.stringify(frame)}\n`;
    if (Buffer.byteLength(line, "utf8") > this.physicalLimit)
      throw new Error("请求超过 omp 单帧限制，请缩小消息或附件");
    await new Promise<void>((resolveWrite, reject) =>
      child.stdin.write(line, (error) =>
        error ? reject(error) : resolveWrite(),
      ),
    );
  }

  /**
   * 发送原生 RPC，成功仅返回响应 data；prompt completion 继续走事件流。
   * 参数：[in] command 原生 RPC 命令；[in] internal 是否应用桥接命令。
   * 返回值：相关成功响应的数据，失败/超时明确拒绝。
   */
  async request<T = unknown>(
    command: RpcCommand,
    internal = false,
  ): Promise<T> {
    if (!this.child || this.closing || this.fault)
      throw new Error("omp 未连接或正在关闭");
    if (!internal && this.planSnapshot?.operation?.status === "running") {
      if (command.type === "abort") {
        return await this.plan({
          op: "cancel", identity: this.planSnapshot.operation.origin,
          operationId: this.planSnapshot.operation.id,
        }) as T;
      }
      if (!command.type.startsWith("get_") && !["abort_bash", "abort_retry", "btw_cancel", "set_subagent_subscription", "set_event_filter"].includes(command.type))
        throw new Error("计划正在转换，请先停止或等待完成");
    }
    const id = `desktop-rpc-${randomUUID()}`;
    if (internal) this.internalIds.add(id);
    const result = new Promise<unknown>((resolveResult, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          this.dropPrompt(id);
          this.internalIds.delete(id);
          reject(
            new Error(
              `omp 请求超时：${command.type}。引擎仍可能在执行，请查看事件/日志后决定是否中止。`,
            ),
          );
        },
        ["bash", "compact", "handoff", "login", "export_html"].includes(
          command.type,
        )
          ? 600_000
          : 120_000,
      );
      this.pending.set(id, {
        resolve: resolveResult,
        reject,
        timer,
        command: command.type,
        ...(command.type === "prompt" ? { output: [] } : {}),
      });
      if (command.type === "prompt") this.promptOrder.push(id);
    });
    try {
      await this.write({ ...command, id });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        this.dropPrompt(id);
        this.internalIds.delete(id);
        pending.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
    return (await result) as T;
  }

  /**
   * 等待原生扩展的相关 notify，而非把 prompt admission 当完成。
   * 参数：[in] command 已验证注册的应用命令；[in] payload 结构化操作参数。
   * 返回值：扩展真实操作完成后的数据。
   */
  private async bridge<T>(
    command: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    if (this.planSnapshot?.operation?.status === "running" &&
        command !== "ompgui-plan" &&
        !(command === "ompgui-model" && ["list", "search"].includes(String(payload.op))) &&
        !(command === "ompgui-roles" && payload.op === "list"))
      throw new Error("计划正在转换，请先停止或等待完成");
    if (!this.connected || !this.commands.has(command))
      throw new Error(`原生 GUI 扩展命令未就绪：${command}`);
    const requestId = `desktop-extension-${randomUUID()}`;
    const result = new Promise<unknown>((resolveResult, reject) => {
      const timer = setTimeout(() => {
        this.extensionPending.delete(requestId);
        reject(new Error(`原生扩展操作超时：${command}`));
      }, 120_000);
      this.extensionPending.set(requestId, {
        resolve: resolveResult,
        reject,
        timer,
        command,
      });
    });
    try {
      const [, data] = await Promise.all([
        this.request(
          {
            type: "prompt",
            message: `/${command} ${JSON.stringify({ ...payload, requestId })}`,
          },
          true,
        ),
        result,
      ]);
      return data as T;
    } finally {
      const pending = this.extensionPending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.extensionPending.delete(requestId);
      }
    }
  }

  /** 只在真实租约连接上调用原生计划控制器；保存路径只能由主进程传入。 */
  async plan(action: PlanAction, savePath?: string): Promise<PlanSnapshot> {
    // 压缩期间 slash 也会等待 maintenance；只读取已发布状态，不重建控制器。
    if (action.op === "status" && this.planSnapshot?.operation?.status === "running")
      return this.planSnapshot;
    let snapshot: PlanSnapshot;
    if (action.op === "cancel") {
      const operation = this.planSnapshot?.operation;
      if (!operation || operation.status !== "running" || operation.id !== action.operationId ||
          operation.origin.sessionId !== action.identity.sessionId ||
          operation.origin.sessionFile !== action.identity.sessionFile ||
          operation.origin.epoch !== action.identity.epoch)
        throw new Error("计划取消操作身份已失效");
      if (!this.planControl) throw new Error("原生计划独立取消通道未就绪");
      const reply = await cancelPlanOperation(this.planControl, action, this.planControlLifetime.signal);
      const { _planControl: _ignored, ...publicSnapshot } = reply as PlanSnapshot & { _planControl?: unknown };
      snapshot = publicSnapshot;
    } else {
      const reply = await this.bridge<PlanSnapshot & { _planControl?: unknown }>("ompgui-plan", {
        ...action, ...(savePath === undefined ? {} : { savePath }),
      });
      const { _planControl, ...publicSnapshot } = reply;
      if (_planControl !== undefined) {
        this.planControl = readPlanControl(_planControl);
        if (this.planControlLifetime.signal.aborted) this.planControlLifetime = new AbortController();
      }
      snapshot = publicSnapshot;
    }
    // 独立任务可能先完成再返回 admission，不允许迟到 running 覆盖终态。
    const current = this.planSnapshot;
    if (snapshot.operation?.status === "running" && current?.operation &&
        current.operation.id === snapshot.operation.id &&
        current.operation.status !== "running") return current;
    this.planSnapshot = snapshot;
    return snapshot;
  }

  get currentPlan(): PlanSnapshot | undefined { return this.planSnapshot; }

  /**
   * 获取真实原生模型角色配置。
   * 参数：无。
   * 返回值：原生 Settings 当前角色列表。
   */
  getRoles(): Promise<ModelRole[]> {
    return this.bridge("ompgui-roles", { op: "list" });
  }

  /** 原生 composer prediction 的桌面版：活动模型预测下一条提示词，无预测返回 null。 */
  async predictPrompt(): Promise<string | null> {
    const result = await this.bridge<{ text: string | null }>(
      "ompgui-predict",
      {},
    );
    return result.text;
  }

  agentsHub(action: Record<string, unknown>): Promise<unknown> {
    return this.bridge("ompgui-agents", action);
  }
  subagentHistory(action: Record<string, unknown>): Promise<unknown> {
    return this.bridge("ompgui-subagents", action);
  }

  /** 只读历史咨询使用独立原生扩展命令，不将斜杠文本发送给模型。 */
  seance<T = unknown>(action: Record<string, unknown>): Promise<T> {
    return this.bridge<T>("ompgui-seance", action);
  }

  /** 模型管理页通过原生扩展读取和修改配置。 */
  async modelHub(action: Record<string, unknown>): Promise<unknown> {
    if (this.planSnapshot?.operation?.status === "running" && !["list", "search"].includes(String(action.op)))
      throw new Error("计划正在转换，请先停止或等待完成");
    const result = await this.bridge<Record<string, unknown>>(
      "ompgui-model",
      action,
    );
    if (["list", "search"].includes(String(action.op))) return result;
    // ExtensionContext.model 是命令开始时的快照；另一次命令才取得切换后的模型。
    const current = await this.bridge<Record<string, unknown>>("ompgui-model", {
      op: "list",
    });
    return { ...current, notice: result.notice };
  }

  /** 通过内部扩展循环预设角色，保留原生 selector 解析和思考等级。 */
  cycleRoleModel(direction: string): Promise<RoleModelCycle | null> {
    if (!["forward", "backward"].includes(direction))
      return Promise.reject(new Error("无效的角色切换方向"));
    return this.bridge("ompgui-roles", { op: "cycle", direction });
  }

  /**
   * 设置或清除原生模型角色，并等待持久化完成。
   * 参数：[in] role 角色名称；[in] value 模型 selector，undefined 表示重置；[in] scope 配置作用域。
   * 返回值：更新后的原生角色列表。
   */
  setRole(
    role: string,
    value: string | undefined,
    scope: "global" | "project",
  ): Promise<ModelRole[]> {
    return this.bridge("ompgui-roles", {
      op: value === undefined ? "clear" : "set",
      role,
      value,
      scope,
    });
  }

  /**
   * 调用原生上下文树导航，同文件而非文件系统回滚。
   * 参数：[in] entryId 目标原生 entry 标识。
   * 返回值：导航完成的 Promise；取消明确拒绝。
   */
  async navigateTree(
    entryId: string,
    options?: TreeNavigationOptions,
  ): Promise<void> {
    const result = await this.bridge<{ cancelled: boolean }>("ompgui-tree", {
      entryId,
      ...options,
    });
    if (result.cancelled) throw new Error("树导航已取消");
    await this.plan({ op: "status" });
  }

  /** 标签直接落入当前原生会话文件，不改变当前分支。 */
  async setTreeLabel(
    entryId: string,
    label: string | undefined,
  ): Promise<void> {
    await this.bridge("ompgui-tree", {
      op: "label",
      entryId,
      label: label ?? "",
    });
  }

  /** 删除用户已确认的完整子树，并由原生会话管理器持久化。 */
  async deleteTree(request: TreeDeletionRequest): Promise<void> {
    await this.bridge("ompgui-tree", { ...request, op: "delete" });
  }

  /** 侧边栏会话改名或删除；由不持有任何会话的进程取得租约后执行。 */
  async sessionOperation(request: SessionOperationRequest): Promise<void> {
    await this.bridge("ompgui-session", { ...request });
  }

  /** 分支摘要使用独立控制器，不能由普通 agent abort 代替。 */
  async cancelTreeNavigation(): Promise<void> {
    const result = await this.bridge<{ cancelRequested: boolean }>(
      "ompgui-tree",
      { op: "cancel" },
    );
    if (!result.cancelRequested) throw new Error("当前没有进行中的树导航");
  }

  /**
   * 响应尚未完成的原生交互请求，无需等待 RPC response。
   * 参数：[in] response 含原生 id 的 dialog 响应。
   * 返回值：stdin 写入完成的 Promise。
   */
  async respondUI(response: {
    id: string;
    [key: string]: unknown;
  }): Promise<void> {
    if (!this.uiRequests.has(response.id))
      throw new Error("原生 UI 请求已取消、结束或不存在");
    await this.write({ ...response, type: "extension_ui_response" });
    this.uiRequests.delete(response.id);
  }

  ownsUIRequest(id: string): boolean {
    return this.uiRequests.has(id);
  }

  /**
   * 拒绝并清理进程的全部未完成相关请求。
   * 参数：[in] error 真实进程/关闭错误。
   * 返回值：无。
   */
  private rejectAll(error: Error): void {
    for (const map of [this.pending, this.extensionPending]) {
      for (const pending of map.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      map.clear();
    }
    this.promptOrder = [];
  }

  /**
   * 移除已响应或已放弃 prompt 的输出归属位置。
   * 参数：[in] id 原生请求标识。
   * 返回值：无。
   */
  private dropPrompt(id: string): void {
    const index = this.promptOrder.indexOf(id);
    if (index >= 0) this.promptOrder.splice(index, 1);
  }

  /**
   * 记录致命进程或传输错误并终止不可信传输。
   * 参数：[in] error 真实错误。
   * 返回值：无。
   */
  private fail(error: Error): void {
    if (this.fault) return;
    this.fault = error;
    this.planControl = undefined;
    this.planControlLifetime.abort();
    this.emit({
      type: "desktop_status",
      status: "error",
      error: error.message,
    });
    this.rejectAll(error);
    this.readyPending?.reject(error);
    this.readyPending = undefined;
    this.child?.kill();
  }

  /**
   * 关闭 stdin 后持续排空 stdout，必要时明确报告强制终止。
   * 参数：无。
   * 返回值：进程 close（包含 stdio 关闭）后完成的 Promise。
   */
  async stop(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    const child = this.child;
    if (!child) {
      this.planControl = undefined;
      this.planControlLifetime.abort();
      return;
    }
    if (this.planSnapshot?.operation?.status === "running") {
      await this.plan({ op: "cancel", identity: this.planSnapshot.operation.origin,
        operationId: this.planSnapshot.operation.id }).catch(() => undefined);
    }
    this.planSnapshot = undefined;
    this.planControl = undefined;
    this.planControlLifetime.abort();
    this.closing = true;
    this.rejectAll(new Error("omp 连接正在关闭"));
    const close = this.closePromise!;
    this.shutdownPromise = (async () => {
      const timer = setTimeout(() => {
        this.fault = new Error(
          "omp 未在 30 秒内完成 stdout/持久化排空，已强制终止；请检查 CLI 会话保存状态。",
        );
        this.emit({
          type: "desktop_status",
          status: "error",
          error: this.fault.message,
        });
        child.kill();
      }, 30_000);
      // 让原生引擎取消主回复、原生 bash 和侧题，再以 EOF 触发持久化与输出排空。
      if (!this.fault && !child.stdin.destroyed && !child.stdin.writableEnded) {
        child.stdin.write(
          `${JSON.stringify({ type: "abort", id: `desktop-stop-${randomUUID()}` })}\n`,
        );
        child.stdin.write(
          `${JSON.stringify({ type: "abort_bash", id: `desktop-stop-${randomUUID()}` })}\n`,
        );
        child.stdin.write(
          `${JSON.stringify({ type: "btw_cancel", id: `desktop-stop-${randomUUID()}` })}\n`,
        );
      }
      child.stdin.end();
      try {
        await close;
      } finally {
        clearTimeout(timer);
        this.shutdownPromise = undefined;
      }
    })();
    return this.shutdownPromise;
  }
}
