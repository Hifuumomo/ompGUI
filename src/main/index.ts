import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  clipboard,
  shell,
  type IpcMainInvokeEvent,
  type IpcMainEvent,
} from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as projectFileSystem from "node:fs/promises";
import { createProjectBrowser } from "./project-browser";
import { inspectProjectFileLink } from "./message-file-link";
import { createFileActions } from "./file-actions";
import type { FileAction } from "../shared/file-actions";
import { createBrowserPanel, createBrowserSession, type BrowserPanelController } from "./browser-panel";
import { browserURL } from "./browser-url";
import { registerPdfViewerIPC } from "./browser-pdf-view";
import { Worker } from "node:worker_threads";
import { ProjectWorkerClient } from "./project-worker-client";
import { listChanges } from "./project-changes";
import { runProjectGit } from "./project-git";
import { projectDiffRequest } from "./project-diff-request";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { parsePlanAction } from "./plan-action";
import type { PlanSnapshot } from "../shared/native-plan";
import type {
  LaunchOptions,
  ModelSelection,
  RpcCommand,
  RpcFrame,
  SessionState,
  SeanceSource,
  SeanceLaunch,
  SeanceBatchItem,
  SeanceConsultation,
} from "../shared/protocol";
import { ModelRuntime, applyModelSelection } from "./model-runtime";
import { formatCommand } from "./command-format";
import { SessionEngines } from "./session-engines";
import { SessionReader } from "./session-reader";
import { sessionMainContent } from "./session-export";
import { readSubagentHistory } from "./subagent-history";
import {
  listNativeSessions,
  readSessionHeader,
  sessionsRoot,
} from "./sessions";
import { changesToolSession } from "./tool-preview";

const here = __dirname;
const channels = {
  preferences: "desktop:preferences",
  start: "desktop:start",
  prepareModels: "desktop:prepare-models",
  modelRequest: "desktop:model-request",
  stop: "desktop:stop",
  request: "desktop:request",
  plan: "desktop:plan",
  sessions: "desktop:sessions",
  openSession: "desktop:open-session",
  sessionEngines: "desktop:session-engines",
  startSessionEngine: "desktop:start-session-engine",
  stopSessionEngine: "desktop:stop-session-engine",
  readSession: "desktop:read-session",
  subagentHistory: "desktop:subagent-history",
  choose: "desktop:choose",
  roles: "desktop:roles",
  promptPrediction: "desktop:prompt-prediction",
  role: "desktop:role",
  tree: "desktop:tree",
  treeLabel: "desktop:tree-label",
  treeDelete: "desktop:tree-delete",
  sessionRename: "desktop:session-rename",
  sessionDelete: "desktop:session-delete",
  sessionCopy: "desktop:session-copy",
  seanceInspect: "desktop:seance-inspect",
  seanceRun: "desktop:seance-run",
  seanceRunBatch: "desktop:seance-run-batch",
  formatCommand: "desktop:format-command",
  treeCancel: "desktop:tree-cancel",
  ui: "desktop:ui",
  external: "desktop:external",
  browserOpen: "desktop:browser-open",
  browserLayout: "desktop:browser-layout",
  browserAction: "desktop:browser-action",
  browserState: "desktop:browser-state",
  browserUpdated: "desktop:browser-updated",
  browserContextScope: "desktop:browser-context-scope",
  browserPickElement: "desktop:browser-pick-element",
  browserPickCancel: "desktop:browser-pick-cancel",
  browserContext: "desktop:browser-context",
  browserCommentEditor: "desktop:browser-comment-editor",
  browserCommentMarkers: "desktop:browser-comment-markers",
  browserCommentReveal: "desktop:browser-comment-reveal",
  browserCommentRevealCancel: "desktop:browser-comment-reveal-cancel",
  browserCommentEvent: "desktop:browser-comment-event",
  copyText: "desktop:copy-text",
  toolFile: "desktop:tool-file",
  projectDirectory: "desktop:project-directory",
  projectFile: "desktop:project-file",
  projectImage: "desktop:project-image",
  projectFileLink: "desktop:resolve-project-file-link",
  projectChanges: "desktop:project-changes",
  projectDiff: "desktop:project-diff",
  frame: "desktop:frame",
  fileOpeners: "desktop:file-openers",
  fileAction: "desktop:file-action",
  mentionFiles: "desktop:search-mention-files",
};
const allowedCommands: Record<string, true> = Object.fromEntries(
  [
    "prompt",
    "steer",
    "follow_up",
    "remove_queued_message",
    "promote_queued_message",
    "abort",
    "abort_and_prompt",
    "abort_and_restore_queue",
    "new_session",
    "open_session",
    "get_state",
    "set_fast_mode",
    "set_slow_mode",
    "goal",
    "set_ask_dialog",
    "get_available_commands",
    "get_entries",
    "get_tree",
    "set_todos",
    "set_subagent_subscription",
    "set_event_filter",
    "get_subagents",
    "get_subagent_messages",
    "cancel_subagent",
    "steer_subagent",
    "set_model",
    "cycle_model",
    "get_available_models",
    "set_thinking_level",
    "cycle_thinking_level",
    "get_available_thinking_levels",
    "set_steering_mode",
    "set_follow_up_mode",
    "set_interrupt_mode",
    "compact",
    "set_auto_compaction",
    "set_cache_warming",
    "set_auto_retry",
    "abort_retry",
    "bash",
    "abort_bash",
    "get_session_stats",
    "export_html",
    "switch_session",
    "branch",
    "fork",
    "get_branch_messages",
    "get_last_assistant_text",
    "set_session_name",
    "handoff",
    "get_messages",
    "get_messages_page",
    "get_login_providers",
    "login",
    "get_logout_accounts",
    "logout",
    "predict_word",
    "predict_word_feedback",
    "btw",
    "get_btw_history",
    "btw_cancel",
  ].map((type) => [type, true] as const),
);
let window: BrowserWindow | undefined;
let browserSession: Electron.Session;
let browserPanel: BrowserPanelController | undefined;
let trustedURL = "";
let quitting = false;
let launchPreferences: LaunchOptions & { autoConnect?: boolean };
let lifecycle: Promise<unknown> = Promise.resolve();
let planDirty = false;
let planCloseRequest: { id: string; owner: BrowserWindow; quit: boolean } | undefined;
let planCloseAllowed = false;

/** 关闭批准只匹配当次窗口与请求，dirty=false 本身不构成批准。 */
function requestPlanClose(owner: BrowserWindow, quit: boolean): void {
  if (planCloseRequest) { planCloseRequest.quit ||= quit; return; }
  const request = { id: randomUUID(), owner, quit };
  planCloseRequest = request;
  if (owner.webContents.isCrashed()) {
    void dialog.showMessageBox(owner, {
      type: "warning", message: "放弃未保存的计划修改并退出？",
      buttons: ["取消", "放弃修改并退出"], defaultId: 0, cancelId: 0,
    }).then(({ response }) => {
      if (planCloseRequest !== request) return;
      planCloseRequest = undefined;
      if (response !== 1) return;
      planCloseAllowed = true;
      if (request.quit) app.quit(); else owner.close();
    });
  } else owner.webContents.send("desktop:plan-close-request", request.id);
}

const projectBrowser = createProjectBrowser(projectFileSystem);
const projectReader = new ProjectWorkerClient(
  () => new Worker(join(here, "project-worker.js")),
);
app.on("will-quit", () => {
  void projectReader.close();
});
/**
 * 将真实原生帧发送给唯一受信应用窗口。
 * 参数：[in] frame 原生事件或桌面连接状态。
 * 返回值：无。
 */
function forwardFrame(frame: RpcFrame): void {
  if (window && !window.isDestroyed())
    window.webContents.send(channels.frame, frame);
}
const engines = new SessionEngines(forwardFrame, (owner, frame) => {
  const { runtime, toolFiles } = owner;
  if (frame.type === "plan_state") {
    const snapshot = frame.snapshot as PlanSnapshot;
    if (snapshot.operation?.status === "running" && !owner.planTransition) {
      owner.planTransition = true;
      toolFiles.beginTransition();
      if (snapshot.operation.choice === "compact") toolFiles.beginBackgroundMaintenance();
    } else if (owner.planTransition && snapshot.operation?.status !== "running" && !owner.planRefresh) {
      const operationId = snapshot.operation?.id;
      owner.planRefresh = runtime.request<SessionState>({ type: "get_state" }).then((state) => {
        if (!owner.planTransition || runtime.currentPlan?.operation?.status === "running" || runtime.currentPlan?.operation?.id !== operationId) return;
        owner.planTransition = false;
        toolFiles.endTransition();
        if (snapshot.operation?.choice === "compact" && !state.isCompacting) toolFiles.endPlanMaintenance();
        toolFiles.acceptResponse("get_state", state, toolFiles.requestEpoch());
        engines.bind(owner, state);
      }).catch(() => {
        if (!owner.planTransition || runtime.currentPlan?.operation?.status === "running") return;
        owner.planTransition = false;
        toolFiles.endTransition();
      }).finally(() => { owner.planRefresh = undefined; });
    }
  }
  if (frame.type === "desktop_status" && frame.status !== "connected" && owner.planTransition) {
    owner.planTransition = false;
    toolFiles.endTransition();
  }
  toolFiles.observe(frame);
});
const modelRuntime = new ModelRuntime(forwardFrame);
function bridgePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "gui-bridge.mjs")
    : join(app.getAppPath(), "resources", "gui-bridge.mjs");
}

function parseModelSelection(input: unknown): ModelSelection | undefined {
  if (input === undefined) return;
  const value = object(input);
  return {
    provider: text(value.provider, "模型提供商")!,
    modelId: text(value.modelId, "模型")!,
    thinkingLevel: text(value.thinkingLevel, "思考等级", true),
  };
}
let sessionReader = new SessionReader();
let readOnlyPath: string | undefined;

/**
 * 检查 IPC 来自应用自身的主 frame，而非嵌入或其他窗口。
 * 参数：[in] event Electron 调用来源。
 * 返回值：无；未授权来源抛出错误。
 */
function assertSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame?.url !== trustedURL
  ) {
    throw new Error("拒绝非应用主窗口的 IPC 请求");
  }
}

/**
 * 验证跨进程输入为普通对象。
 * 参数：[in] value 来自 renderer 的结构化数据。
 * 返回值：已验证对象；非法数据抛出错误。
 */
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("IPC 参数必须是对象");
  return value as Record<string, unknown>;
}

/**
 * 验证跨 IPC 文本，禁止 NUL 和空必填值。
 * 参数：[in] value 输入值；[in] label 错误提示字段；[in] optional 是否允许 undefined。
 * 返回值：验证后的字符串或可选 undefined。
 */
function text(
  value: unknown,
  label: string,
  optional = false,
): string | undefined {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new Error(`${label}必须是非空字符串`);
  return value;
}

/**
 * 仅选择 DesktopBridge 允许的启动字段，拒绝额外进程参数。
 * 参数：[in] input renderer 或偏好文件传入的启动设置。
 * 返回值：经过校验的 LaunchOptions。
 */
function parseLaunch(input: unknown): LaunchOptions {
  const value = object(input);
  return {
    executable: text(value.executable, "引擎路径")!,
    cwd: text(value.cwd, "工作目录")!,
    agentDir: text(value.agentDir, "代理目录", true),
    profile: text(value.profile, "Profile", true),
    sessionPath: text(value.sessionPath, "会话路径", true),
  };
}

/**
 * 读取 app-owned 偏好，不自动恢复最后一个会话。
 * 参数：无。
 * 返回值：上次启动目录/引擎/profile 或当前平台默认设置。
 */
async function loadPreferences(): Promise<
  LaunchOptions & { autoConnect?: boolean }
> {
  try {
    const parsed = parseLaunch(
      JSON.parse(
        await readFile(
          join(app.getPath("userData"), "launch-preferences.json"),
          "utf8",
        ),
      ),
    );
    delete parsed.sessionPath;
    return { ...parsed, autoConnect: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      executable:
        process.platform === "win32"
          ? join(
              process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
              "omp",
              "omp.exe",
            )
          : "omp",
      cwd: homedir(),
    };
  }
}

/**
 * 原子持久化应用启动偏好，不写原生 CLI 配置或会话。
 * 参数：[in] options 已成功连接的真实启动参数。
 * 返回值：偏好写入完成的 Promise。
 */
async function savePreferences(options: LaunchOptions): Promise<void> {
  const { sessionPath: _sessionPath, ...preferences } = options;
  const directory = app.getPath("userData");
  await mkdir(directory, { recursive: true });
  const target = join(directory, "launch-preferences.json");
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(preferences, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, target);
  launchPreferences = { ...preferences, autoConnect: true };
}

/**
 * 串行化进程启停以避免 IPC 重入产生两个 CLI writer。
 * 参数：[in] operation 生命周期操作。
 * 返回值：该操作的真实结果。
 */
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = lifecycle.then(operation, operation);
  lifecycle = result.catch(() => undefined);
  return result;
}

/**
 * 从真实 RPC 响应建立当前代数证据；会话命令和本地 slash admission 期间冻结旧授权。
 * 参数：[in] command 已校验的原生 RPC 命令。
 * 返回值：原生响应数据，失败原样拒绝。
 */
async function requestNative(command: RpcCommand, owner = engines.requireActive()): Promise<unknown> {
  const { runtime, toolFiles } = owner;
  if (owner.planTransition && command.type !== "abort" && !command.type.startsWith("get_") &&
      !["abort_bash", "abort_retry", "btw_cancel", "set_subagent_subscription", "set_event_filter"].includes(command.type))
    throw new Error("计划正在转换，请先停止或等待完成");
  if (command.type === "abort" && runtime.currentPlan?.operation?.status === "running")
    return runtime.plan({ op: "cancel", identity: runtime.currentPlan.operation.origin,
      operationId: runtime.currentPlan.operation.id });
  // 扩展 slash 同样可能改变上下文；仅冻结本次 admission，不把普通回复整个流冻结。
  const slash =
    (command.type === "prompt" || command.type === "abort_and_prompt") &&
    typeof command.message === "string" &&
    command.message.trimStart().startsWith("/");
  const transition = changesToolSession(command.type) || slash;
  // Native slash 名称在最早空白或冒号处分隔；compact/handoff 的 ack 早于后台维护结束。
  const slashName = slash
    ? /^\/([^\s:]+)/.exec((command.message as string).trimStart())?.[1]
    : undefined;
  if (slashName === "compact" || slashName === "handoff")
    toolFiles.beginBackgroundMaintenance();
  if (slashName === "move" || slashName === "wt" || slashName === "worktree")
    toolFiles.invalidateWorkspace(true);
  if (command.type === "open_session" || command.type === "switch_session")
    toolFiles.invalidateWorkspace(false);
  if (transition) toolFiles.beginTransition();
  const epoch = toolFiles.requestEpoch();
  try {
    const data = await runtime.request(command);
    if (command.type === "get_state") engines.bind(owner, data as SessionState);
    if (
      command.type === "get_state" &&
      epoch === toolFiles.requestEpoch() &&
      toolFiles.needsWorkspaceHeader()
    ) {
      const state = object(data);
      if (state.isCompacting !== true) {
        // 只读取当前真实 Native 状态指向的 sessionFile，不读取 renderer 指定的 metadata。
        try {
          const header = await readSessionHeader(
            text(state.sessionFile, "原生会话文件")!,
          );
          toolFiles.acceptWorkspace(
            header,
            text(state.sessionId, "原生会话 id")!,
            epoch,
          );
        } catch (error) {
          throw new Error(
            `原生工作目录尚未核实，请重新连接后预览相对路径：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    toolFiles.acceptResponse(command.type, data, epoch);
    if (["new_session", "switch_session", "open_session", "branch", "fork"].includes(command.type)) {
      engines.bind(owner, await runtime.request<SessionState>({ type: "get_state" }));
      await runtime.plan({ op: "status" });
    }
    return data;
  } finally {
    if (transition) toolFiles.endTransition();
  }
}

/**
 * 仅打开 HTTP(S) 外链，拒绝本地文件、命令协议和 URL 凭据。
 * 参数：[in] input renderer 或扩展提供的外部链接。
 * 返回值：系统浏览器接受链接后的 Promise。
 */
async function openExternal(input: unknown): Promise<void> {
  await shell.openExternal(browserURL(input));
}

/**
 * 安装受信发送者校验下的窄 DesktopBridge IPC。
 * 参数：无。
 * 返回值：无。
 */
function registerIPC(): void {
  ipcMain.on("desktop:plan-dirty", (event, dirty: unknown) => {
    assertSender(event);
    if (typeof dirty !== "boolean") return;
    planDirty = dirty;
  });
  ipcMain.on("desktop:plan-close-response", (event, id: unknown, allow: unknown) => {
    assertSender(event);
    const request = planCloseRequest;
    if (!request || id !== request.id || request.owner !== window || typeof allow !== "boolean") return;
    planCloseRequest = undefined;
    if (!allow) return;
    planCloseAllowed = true;
    if (request.quit) app.quit(); else request.owner.close();
  });
  /**
   * 包装所有 IPC handler 以统一校验调用窗口。
   * 参数：[in] channel 私有 IPC 名称；[in] handler 对应 DesktopBridge 操作。
   * 返回值：无。
   */
  function handle(
    channel: string,
    handler: (...args: unknown[]) => unknown,
  ): void {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      assertSender(event);
      const active = engines.active;
      if ((active?.planTransition || active?.runtime.currentPlan?.operation?.status === "running") &&
          [channels.tree, channels.treeDelete, channels.role, channels.seanceRun, channels.seanceRunBatch].includes(channel))
        throw new Error("计划正在转换，请先停止或等待完成");
      if (
        readOnlyPath &&
        ![
          channels.preferences,
          channels.sessions,
          channels.choose,
          channels.openSession,
          channels.readSession,
          channels.sessionEngines,
          channels.startSessionEngine,
          channels.stopSessionEngine,
          channels.ui,
          channels.subagentHistory,
          channels.external,
          channels.browserOpen,
          channels.browserLayout,
          channels.browserAction,
          channels.browserState,
          channels.browserContextScope,
          channels.browserPickElement,
          channels.browserPickCancel,
          channels.browserCommentEditor,
          channels.browserCommentMarkers,
          channels.browserCommentReveal,
          channels.browserCommentRevealCancel,
          channels.copyText,
          channels.projectDirectory,
          channels.projectFile,
          channels.projectImage,
          channels.mentionFiles,
          channels.projectFileLink,
          channels.fileOpeners,
          channels.fileAction,
          channels.projectChanges,
          channels.projectDiff,
          channels.start,
          channels.stop,
          channels.prepareModels,
          channels.modelRequest,
          channels.formatCommand,
          channels.sessionRename,
          channels.sessionDelete,
          channels.sessionCopy,
          channels.seanceInspect,
        ].includes(channel)
      )
        throw new Error("当前会话为只读状态，请发送提示词以尝试连接");
      return handler(...args);
    });
  }
  handle(channels.plan, async (input) => {
    const owner = engines.requireActive();
    const { runtime, toolFiles } = owner;
    const action = parsePlanAction(input);
    if (action.op === "decide" && (owner.planTransition || owner.planSaveDialogPending))
      throw new Error("计划处置已在进行中，请勿重复提交");
    let savePath: string | undefined;
    if (action.op === "decide" && action.choice === "save") {
      const snapshot = await runtime.plan({ op: "status" });
      if (snapshot.phase !== "review" || snapshot.reviewId !== action.reviewId ||
          snapshot.document?.revision !== action.revision ||
          snapshot.identity.sessionId !== action.identity.sessionId ||
          snapshot.identity.sessionFile !== action.identity.sessionFile ||
          snapshot.identity.epoch !== action.identity.epoch)
        throw new Error("计划审阅已变化，请重新确认");
      if (owner.planSaveDialogPending) throw new Error("计划保存对话框已打开");
      owner.planSaveDialogPending = true;
      try {
        const result = await dialog.showSaveDialog(window!, {
          title: "保存计划并新建会话", defaultPath: snapshot.document.saveFileName,
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (result.canceled || !result.filePath) return null;
        savePath = result.filePath;
      } finally { owner.planSaveDialogPending = false; }
    }
    const admission = action.op === "decide";
    if (admission && !owner.planTransition) { owner.planTransition = true; toolFiles.beginTransition(); }
    if (action.op === "decide" && action.choice === "compact") toolFiles.beginBackgroundMaintenance();
    try { return await runtime.plan(action, savePath); }
    catch (error) {
      if (admission && runtime.currentPlan?.operation?.status !== "running" && owner.planTransition) {
        owner.planTransition = false;
        toolFiles.endTransition();
        await requestNative({ type: "get_state" }, owner).catch(() => undefined);
      }
      throw error;
    }
  });
  handle(channels.preferences, () => ({ ...launchPreferences }));
  handle(channels.subagentHistory, (input) => {
    const owner = engines.active;
    const path = readOnlyPath;
    return readSubagentHistory(input, {
      current: async () => {
        if (path) {
          const summary = await readSessionHeader(path);
          return { id: summary.id, path };
        }
        if (!owner) return undefined;
        const state = await owner.runtime.request<SessionState>({ type: "get_state" });
        return state.sessionFile
          ? { id: state.sessionId, path: state.sessionFile }
          : undefined;
      },
      prepare: () => modelRuntime.prepare(launchPreferences, bridgePath()),
      read: (action) => modelRuntime.subagentHistory(action),
    });
  });
  handle(channels.formatCommand, (toolName, command) =>
    formatCommand(text(toolName, "工具名称")!, text(command, "命令")!),
  );
  handle(channels.prepareModels, (input, selection) =>
    modelRuntime.prepare(
      parseLaunch(input),
      bridgePath(),
      parseModelSelection(selection),
    ),
  );
  handle(channels.modelRequest, (input) => {
    const command = object(input);
    return modelRuntime.request({
      ...command,
      type: text(command.type, "模型命令")!,
    });
  });
  /**
   * 在排队启停前撤销预览能力，再使用真实启动结果绑定 CLI cwd。
   * 参数：[in] input renderer 的启动设置。
   * 返回值：串行原生连接完成的 Promise。
   */
  handle(channels.start, (input, selected, selectedTask) => {
    const options = parseLaunch(input);
    const selection = parseModelSelection(selected);
    const taskModel = text(selectedTask, "任务模型", true);
    return serial(async () => {
      const owner = await engines.start(options, bridgePath(), true, async ({ runtime }) => {
        await applyModelSelection(runtime, selection);
        if (taskModel) await runtime.modelHub({ op: "temporary", selector: taskModel, target: "task" });
      });
      readOnlyPath = undefined;
      const connection = owner.connection!;
      await savePreferences({ ...options, executable: connection.executable, cwd: connection.cwd });
      return connection;
    });
  });
  handle(channels.sessionEngines, () => engines.list());
  handle(channels.startSessionEngine, (input) => {
    const options = parseLaunch(input);
    if (!options.sessionPath) throw new Error("缺少会话路径");
    return serial(async () => {
      await engines.start(options, bridgePath(), false);
      return engines.list();
    });
  });
  handle(channels.stopSessionEngine, (input) => {
    const path = resolve(text(input, "会话路径")!);
    return serial(async () => {
      await engines.stop(engines.find(path));
      return engines.list();
    });
  });
  handle(channels.stop, () => {
    const owner = engines.active;
    return serial(() => engines.stop(owner));
  });
  /**
   * 校验命令白名单，并在真实响应的原始代数内更新只读工具证据。
   * 参数：[in] input renderer 的原生 RPC 命令。
   * 返回值：成功响应数据；原生错误拒绝。
   */
  handle(channels.request, (input) => {
    const owner = engines.requireActive();
    const { runtime } = owner;
    if (readOnlyPath)
      throw new Error("当前会话仅供只读查看，请提交提示词以尝试连接");
    const command = object(input);
    const type = text(command.type, "RPC type")!;
    if (owner.planTransition && ["model_hub", "agents_hub", "cycle_role_model"].includes(type) &&
        !(type === "model_hub" && ["list", "search"].includes(String(object(command.action).op))))
      throw new Error("计划正在转换，请先停止或等待完成");
    if (type === "model_hub") return runtime.modelHub(object(command.action));
    if (type === "agents_hub") return runtime.agentsHub(object(command.action));
    if (type === "cycle_role_model")
      return runtime.cycleRoleModel(text(command.direction, "角色切换方向")!);
    if (!Object.hasOwn(allowedCommands, type))
      throw new Error(`不允许此 RPC 输入类型：${type}`);
    if (
      typeof command.message === "string" &&
      /^\s*\/ompgui-(?:roles|tree|resume|model|agents|subagents|seance|plan)(?:[\s:]|$)/.test(
        command.message,
      )
    ) {
      throw new Error("内部桥接命令仅可通过对应 DesktopBridge 方法调用");
    }
    return requestNative(command as RpcCommand);
  });
  handle(channels.openSession, (input) =>
    serial(async () => {
      const path = resolve(text(input, "会话路径")!);
      // 先校验可读性，再切换查看目标；保留本应用的其他连接，绝不接管外部 omp。
      await readSessionHeader(path);
      const reader = new SessionReader(
        join(
          dirname(
            sessionsRoot(launchPreferences.agentDir, launchPreferences.profile),
          ),
          "blobs",
        ),
        /**
         * 报告非致命 recap 数据库错误，保留历史打开能力。
         * 参数：[in] database 失败的数据库路径；[in] error 原始读取错误。
         * 返回值：无。
         */
        (database, error) =>
          forwardFrame({
            type: "desktop_log",
            text: `警告：无法读取原生 recap ${database}：${error instanceof Error ? error.message : String(error)}`,
          }),
      );
      const snapshot = await reader.read(path, true);
      if (!snapshot) throw new Error("无法读取会话快照");
      const owner = engines.find(path);
      if (owner) {
        const state = await owner.runtime.request<SessionState>({ type: "get_state" });
        engines.bind(owner, state);
        engines.activate(owner);
        readOnlyPath = undefined;
        return { snapshot, engine: { id: owner.id, connection: owner.connection!, state, frames: engines.frames(owner) } };
      }
      engines.activate(undefined);
      readOnlyPath = path;
      sessionReader = reader;
      return { snapshot };
    }),
  );
  handle(channels.readSession, () =>
    readOnlyPath ? sessionReader.read(readOnlyPath) : null,
  );
  handle(channels.sessions, (agentDir) =>
    listNativeSessions(
      text(agentDir, "代理目录", true) ?? launchPreferences.agentDir,
      launchPreferences.profile,
      /**
       * 将会话文件或 recap 数据库错误转发为桌面可见警告。
       * 参数：[in] path 失败路径；[in] error 文件系统、解析或数据库错误。
       * 返回值：无。
       */
      (path, error) =>
        forwardFrame({
          type: "desktop_log",
          text: `警告：读取原生会话数据 ${path} 失败：${error instanceof Error ? error.message : String(error)}。历史文件错误仅跳过该文件；recap 错误不影响历史。`,
        }),
    ),
  );
  handle(channels.choose, async (kind) => {
    if (!["workspace", "engine", "session", "agentDir"].includes(String(kind)))
      throw new Error("未知路径选择类别");
    const directory = kind === "workspace" || kind === "agentDir";
    const result = await dialog.showOpenDialog(window!, {
      title: directory
        ? "选择本地目录"
        : kind === "engine"
          ? "选择 omp 引擎"
          : "选择原生 omp 会话",
      properties: directory ? ["openDirectory"] : ["openFile"],
      filters: directory
        ? undefined
        : kind === "session"
          ? [{ name: "omp 原生会话", extensions: ["jsonl"] }]
          : process.platform === "win32"
            ? [{ name: "原生程序", extensions: ["exe"] }]
            : undefined,
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle(channels.roles, () => engines.requireActive().runtime.getRoles());
  handle(channels.promptPrediction, () => engines.requireActive().runtime.predictPrompt());
  handle(channels.role, (role, value, scope) => {
    if (scope !== "global" && scope !== "project")
      throw new Error("未知模型角色作用域");
    return engines.requireActive().runtime.setRole(
      text(role, "角色")!,
      text(value, "模型 selector", true),
      scope,
    );
  });
  /**
   * 导航原生上下文树，连相同 sessionId 的旧 leaf 授权也立即撤销。
   * 参数：[in] entryId renderer 选中的原生树节点。
   * 返回值：树导航完成的 Promise。
   */
  handle(channels.tree, async (entryId, input) => {
    const { runtime, toolFiles } = engines.requireActive();
    const id = text(entryId, "树节点")!;
    const options = input === undefined ? {} : object(input);
    for (const key of ["summarize", "askSummary"]) {
      if (options[key] !== undefined && typeof options[key] !== "boolean")
        throw new Error(`无效的树导航选项：${key}`);
    }
    toolFiles.beginTransition();
    try {
      await runtime.navigateTree(id, {
        summarize: options.summarize as boolean | undefined,
        askSummary: options.askSummary as boolean | undefined,
      });
    } finally {
      toolFiles.endTransition();
    }
  });
  handle(channels.treeLabel, (entryId, label) =>
    engines.requireActive().runtime.setTreeLabel(
      text(entryId, "树节点")!,
      text(label, "节点标签", true),
    ),
  );
  handle(channels.treeCancel, () => engines.requireActive().runtime.cancelTreeNavigation());
  handle(channels.treeDelete, (input) => {
    const { runtime, toolFiles } = engines.requireActive();
    return serial(async () => {
      const request = object(input);
      if (!Array.isArray(request.entryIds)) throw new Error("缺少待删除子树");
      const value = {
        sessionId: text(request.sessionId, "会话 id")!,
        entryId: text(request.entryId, "树节点")!,
        entryIds: request.entryIds.map((id) => text(id, "子树节点")!),
      };
      toolFiles.beginTransition();
      try {
        await runtime.deleteTree(value);
      } finally {
        toolFiles.endTransition();
      }
    });
  });
  /**
   * 解析侧边栏会话路径，只接受原生会话目录内的 JSONL 文件。
   * 参数：[in] input 会话路径；[in] agentDir 可选原生代理目录。
   * 返回值：规范化的绝对路径。
   */
  function sessionFile(input: unknown, agentDir: unknown): string {
    const path = resolve(text(input, "会话路径")!);
    const root = resolve(
      sessionsRoot(
        text(agentDir, "代理目录", true) ?? launchPreferences.agentDir,
        launchPreferences.profile,
      ),
    );
    const inside = relative(root, path);
    if (
      !path.endsWith(".jsonl") ||
      !inside ||
      inside.startsWith("..") ||
      isAbsolute(inside)
    )
      throw new Error("只能操作原生会话目录内的会话文件");
    return path;
  }
  handle(channels.seanceInspect, async (input) => {
    const sourceSession = text(input, "历史会话")!;
    await modelRuntime.prepare(launchPreferences, bridgePath());
    return modelRuntime.seance<SeanceSource>({ op: "inspect", sourceSession });
  });
  handle(channels.seanceRun, (input, selectedModel) => {
    const sourceSession = text(input, "历史会话")!;
    const model = text(selectedModel, "历史代理模型", true);
    return runSeanceAction<SeanceLaunch>({
      op: "run",
      sourceSession,
      ...(model ? { model } : {}),
    });
  });
  handle(channels.seanceRunBatch, (input) => {
    if (!Array.isArray(input) || input.length === 0)
      throw new Error("请选择历史咨询来源");
    const requests: SeanceConsultation[] = input.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        throw new Error("无效的历史咨询请求");
      const sourceSession = text(
        "sourceSession" in item ? item.sourceSession : undefined,
        "历史会话",
      )!;
      const model = text("model" in item ? item.model : undefined, "历史代理模型", true);
      return { sourceSession, ...(model ? { model } : {}) };
    });
    return runSeanceAction<SeanceBatchItem[]>({ op: "runBatch", requests });
  });
  // 共享生命周期队列内只读取一次当前状态和文件头，再发送一个原生批量命令。
  function runSeanceAction<T>(
    action:
      | { op: "run"; sourceSession: string; model?: string }
      | { op: "runBatch"; requests: SeanceConsultation[] },
  ): Promise<T> {
    const { runtime } = engines.requireActive();
    return serial(async () => {
      if (readOnlyPath) throw new Error("请先连接当前目标会话再运行 seance");
      const state = await runtime.request<SessionState>({ type: "get_state" });
      if (
        !state.sessionId ||
        !state.sessionFile ||
        state.isStreaming ||
        state.isCompacting ||
        state.isSettled !== true ||
        state.queuedMessageCount > 0
      )
        throw new Error("seance 只能在已连接且完全空闲的真实会话中运行");
      const header = await readSessionHeader(state.sessionFile);
      if (header.id !== state.sessionId)
        throw new Error("当前原生会话身份已变化，请重新连接");
      return runtime.seance<T>(action);
    });
  }
  handle(channels.sessionCopy, async (input, kind, agentDir) => {
    if (!Array.isArray(input) || input.length === 0)
      throw new Error("请选择需要复制的会话");
    if (kind !== "paths" && kind !== "content")
      throw new Error("无效的会话复制类型");
    const paths = input.map((path) => sessionFile(path, agentDir));
    const parts: string[] = [];
    // 独立 reader 保持当前只读快照、活动连接与分支完全不变。
    const reader = new SessionReader(
      join(
        dirname(sessionsRoot(
          text(agentDir, "代理目录", true) ?? launchPreferences.agentDir,
          launchPreferences.profile,
        )),
        "blobs",
      ),
    );
    for (const path of paths) {
      await readSessionHeader(path);
      if (kind === "paths") {
        parts.push(path);
      } else {
        const snapshot = await reader.read(path, true);
        if (!snapshot) throw new Error("无法读取会话快照");
        parts.push(sessionMainContent(snapshot.messages));
      }
    }
    // 任一文件读取失败都不会覆盖用户原有剪贴板。
    clipboard.writeText(parts.join(kind === "paths" ? "\n" : "\n\n"));
  });
  handle(channels.sessionRename, (input, name, agentDir) =>
    serial(async () => {
      const path = sessionFile(input, agentDir);
      const title = text(name, "会话名称")!.trim();
      if (!title) throw new Error("会话名称不能为空");
      // 自身引擎持有租约时走原生改名，运行中的会话状态同步更新。
      const owner = engines.find(path);
      if (owner) {
        await owner.runtime.request({ type: "set_session_name", name: title });
        return;
      }
      const { id } = await readSessionHeader(path);
      await modelRuntime.prepare(launchPreferences, bridgePath());
      await modelRuntime.sessionOperation({
        op: "rename",
        path,
        sessionId: id,
        name: title,
      });
    }),
  );
  handle(channels.sessionDelete, (input, agentDir) =>
    serial(async () => {
      const path = sessionFile(input, agentDir);
      const { id } = await readSessionHeader(path);
      // 自身连接持有租约会使删除被拒；只排空本应用连接，绝不停止外部 omp。
      await engines.stop(engines.find(path));
      await modelRuntime.prepare(launchPreferences, bridgePath());
      await modelRuntime.sessionOperation({
        op: "delete",
        path,
        sessionId: id,
      });
      if (readOnlyPath === path) readOnlyPath = undefined;
    }),
  );
  handle(channels.ui, (input) => {
    const response = object(input);
    const id = text(response.id, "UI 请求 id")!;
    const allowed = ["value", "confirmed", "cancelled", "timedOut", "answers"];
    const fields: Record<string, unknown> = { id };
    for (const key of allowed)
      if (Object.hasOwn(response, key)) fields[key] = response[key];
    const target = modelRuntime.ownsUIRequest(String(fields.id))
      ? modelRuntime
      : engines;
    return target.respondUI(fields as { id: string; [key: string]: unknown });
  });
  handle(channels.external, openExternal);
  registerPdfViewerIPC();
  handle(channels.browserOpen, (url) => browserPanel!.open(url));
  handle(channels.browserLayout, (layout) => browserPanel!.setLayout(layout));
  handle(channels.browserAction, (action) => browserPanel!.action(action));
  handle(channels.browserState, () => browserPanel!.getState());
  handle(channels.browserContextScope, (scope) => browserPanel!.setContextScope(scope));
  handle(channels.browserPickElement, (scope, mode) => browserPanel!.pickElement(scope, mode));
  handle(channels.browserPickCancel, () => browserPanel!.cancelElementPick());
  handle(channels.browserCommentEditor, (editor) => browserPanel!.setCommentEditor(editor));
  handle(channels.browserCommentMarkers, (markers) => browserPanel!.syncCommentMarkers(markers));
  handle(channels.browserCommentReveal, (request) => browserPanel!.revealComment(request));
  handle(channels.browserCommentRevealCancel, (requestId) => browserPanel!.cancelCommentReveal(requestId));
  handle(channels.copyText, (value) => {
    if (typeof value !== "string" || !value.length) throw new Error("复制内容不能为空");
    if (value.length > 65536) throw new Error("所选内容过长，请缩小范围");
    return clipboard.writeText(value);
  });
  handle(channels.projectFileLink, (href, cwd, allowMissing) =>
    inspectProjectFileLink(
      text(href, "文件链接")!,
      text(cwd, "会话工作目录")!,
      projectFileSystem.stat,
      allowMissing === true,
    ),
  );
  const fileActions = createFileActions({
    openPath: shell.openPath,
    showItemInFolder: shell.showItemInFolder,
    openExternal: shell.openExternal,
    writeClipboard: (value) => clipboard.writeText(value),
    readTextFile: (path) => projectReader.source(path),
    async chooseSavePath(name) {
      const result = await dialog.showSaveDialog(window!, {
        title: "另存为",
        defaultPath: join(app.getPath("downloads"), name),
      });
      return result.canceled ? undefined : result.filePath;
    },
  });
  handle(channels.fileOpeners, () => fileActions.listOpeners());
  // 路径由主进程按会话工作目录重新解析并核实存在，不信任渲染进程传入的绝对路径。
  handle(channels.fileAction, async (href, cwd, input) => {
    const entry = await inspectProjectFileLink(
      text(href, "文件链接")!,
      text(cwd, "会话工作目录")!,
      projectFileSystem.stat,
    );
    const request = object(input);
    const type = text(request.type, "文件操作")!;
    // run() 拒绝未知操作与未知程序 id，此处只组装结构。
    const action = (
      type === "open-with"
        ? { type, opener: text(request.opener, "打开方式")! }
        : { type }
    ) as FileAction;
    return fileActions.run(action, entry);
  });
  /**
   * 校验文件补全 IPC 参数并交给文件线程，不检查当前引擎状态。
   * 参数：[in] cwd 搜索根目录；[in] query 可为空的模糊查询。
   * 返回值：工作目录内匹配的真实文件相对路径。
   */
  handle(channels.mentionFiles, (cwd, query) => {
    if (typeof query !== "string" || query.includes("\0"))
      throw new Error("文件引用查询必须是不含 NUL 的字符串");
    return projectReader.searchMentionFiles(text(cwd, "项目目录")!, query);
  });
  handle(channels.projectDirectory, (path) =>
    projectBrowser.listProjectDirectory(text(path, "项目目录")!),
  );
  handle(channels.projectFile, (path) =>
    projectReader.source(text(path, "项目文件")!),
  );
  handle(channels.projectImage, (path) =>
    projectBrowser.readProjectImage(text(path, "项目图片")!),
  );
  handle(channels.projectChanges, (cwd) =>
    listChanges(
      { stat: projectFileSystem.stat, run: runProjectGit },
      text(cwd, "项目目录")!,
    ),
  );
  handle(channels.projectDiff, (input) =>
    projectReader.diff(projectDiffRequest(input)),
  );
  /**
   * 只接受精确文件预览三元组，通过统一 assertSender handler 进入可信账本。
   * 参数：[in] input renderer 的当前会话、原生工具 id 与明确文件目标。
   * 返回值：当前文件的有界只读预览；所有失败明确拒绝。
   */
  handle(channels.toolFile, (input) => {
    const { runtime, toolFiles } = engines.requireActive();
    const value = object(input);
    for (const key of Object.keys(value)) {
      if (!["sessionId", "toolCallId", "path"].includes(key))
        throw new Error("工具预览只接受会话、工具调用 id 与文件路径");
    }
    return toolFiles.preview(
      {
        sessionId: text(value.sessionId, "会话 id")!,
        toolCallId: text(value.toolCallId, "工具调用 id")!,
        path: text(value.path, "工具文件路径")!,
      },
      /**
       * 从当前真实 CLI 读取会话，不把 renderer 的状态作为文件读取凭证。
       * 参数：无。
       * 返回值：原生 get_state 成功数据，失败拒绝。
       */
      () => runtime.request({ type: "get_state" }),
    );
  });
}

/**
 * 创建隔离且禁止远程导航的桌面窗口。
 * 参数：无。
 * 返回值：完成页面加载的 Promise。
 */
async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1000,
    minHeight: 680,
    title: "oh-my-pi 桌面工作台",
    backgroundColor: "#101418",
    show: false,
    webPreferences: {
      preload: join(here, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  const owner = window;
  const controller = createBrowserPanel(owner, browserSession, (state) => {
    if (!owner.isDestroyed()) owner.webContents.send(channels.browserUpdated, state);
  }, (value) => {
    if (!owner.isDestroyed()) owner.webContents.send(channels.browserContext, value);
  }, (event) => {
    if (!owner.isDestroyed()) owner.webContents.send(channels.browserCommentEvent, event);
  });
  browserPanel = controller;
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  owner.once("ready-to-show", () => owner.show());
  owner.webContents.on("render-process-gone", () => {
    const request = planCloseRequest;
    if (request?.owner === owner) {
      planCloseRequest = undefined;
      requestPlanClose(owner, request.quit);
    }
  });
  owner.on("close", (event) => {
    if (planDirty && !planCloseAllowed) {
      event.preventDefault();
      requestPlanClose(owner, false);
    }
  });
  owner.on("closed", () => {
    planDirty = false;
    planCloseRequest = undefined;
    planCloseAllowed = false;
    controller.dispose();
    if (browserPanel === controller) browserPanel = undefined;
    if (window === owner) window = undefined;
  });
  const devURL = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devURL) {
    const url = new URL(devURL);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error("开发 renderer URL 必须是本机 HTTP 服务");
    trustedURL = url.href;
    await window.loadURL(trustedURL);
  } else {
    const rendererPath = resolve(here, "../renderer/index.html");
    trustedURL = pathToFileURL(rendererPath).href;
    await window.loadFile(rendererPath);
  }
}

// 单实例让应用拥有一个明确的 CLI 生命周期；另一窗口无法通过 IPC 注入进程参数。
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      browserSession = createBrowserSession();
      launchPreferences = await loadPreferences();
      registerIPC();
      await createWindow();
    })
    .catch((error: unknown) => {
      dialog.showErrorBox(
        "桌面端启动失败",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
  app.on("activate", () => {
    if (!window)
      void createWindow().catch((error: Error) =>
        dialog.showErrorBox("窗口打开失败", error.message),
      );
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
    else void Promise.all([serial(() => engines.stopAll()), modelRuntime.stop()]);
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (planDirty && !planCloseAllowed && window && !window.isDestroyed()) {
      requestPlanClose(window, true);
      return;
    }
    quitting = true;
    browserPanel?.dispose();
    void Promise.all([
      serial(() => engines.stopAll()),
      modelRuntime.stop(),
    ]).finally(() => app.quit());
  });
}
