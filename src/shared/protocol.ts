import type {
  ProjectBrowser,
  ProjectEntry,
  ProjectReview,
} from "./project-browser";
import type { TodoPhase } from "./todo";
import type { FileAction, FileOpener } from "./file-actions";
import type { BrowserPanelAction, BrowserPanelLayout, BrowserPanelState, BrowserSelectionMode } from "./browser";
import type { BrowserPromptContext } from "./prompt-context";
import type { BrowserCommentEditor, BrowserCommentMarker, BrowserCommentEvent, BrowserCommentRevealRequest, BrowserCommentRevealResult } from "./comment-overlay";
import type { PlanAction, PlanSnapshot } from "./native-plan";

export type RpcCommand = { type: string; [key: string]: unknown };
export type RpcFrame = { type: string; [key: string]: unknown };

export interface LaunchOptions {
  executable: string;
  cwd: string;
  agentDir?: string;
  profile?: string;
  sessionPath?: string;
}

export interface ConnectionInfo {
  executable: string;
  cwd: string;
  protocolVersion: number;
  /** 仅 GUI 管理的会话连接携带；模型准备进程及底层 RPC 连接不携带。 */
  engineId?: string;
}

/** 用户明确选择的临时模型；恢复会话成功后、发送前应用。 */
export interface ModelSelection {
  provider: string;
  modelId: string;
  thinkingLevel?: string;
}
export type ModelState = Pick<SessionState, "model" | "thinkingLevel">;

export interface RoleModelCycle extends ModelState {
  order: string[];
  role: string;
}

export interface SessionSummary {
  path: string;
  id: string;
  cwd: string;
  title: string;
  timestamp: string;
  modified: number;
  parentSession?: string;
  recap?: { text: string; createdAt: number };
}

export interface ReadOnlySession {
  summary: SessionSummary;
  messages: AgentMessage[];
  todoPhases?: TodoPhase[];
}

/** GUI 自身持有的会话进程；未列出的会话没有运行指示灯。 */
export interface SessionEngineStatus {
  id: string;
  sessionPath: string;
  sessionId?: string;
  state: "starting" | "active" | "unread" | "idle" | "stopping";
}

/** 打开历史时附带已有进程的实时状态，不重启或重新应用模型配置。 */
export interface SessionOpenResult {
  snapshot: ReadOnlySession;
  engine?: {
    id: string;
    connection: ConnectionInfo;
    state: SessionState;
    frames: RpcFrame[];
  };
}

export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  reasoning?: boolean;
  contextWindow?: number;
  thinking?: { mode?: string; efforts?: string[] };
}

export interface MessageContent {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  data?: string;
  mimeType?: string;
}

/**
 * 原生 RPC 消息保留各角色的独立载荷；执行、摘要和文件消息不要求 content。
 * 角色契约：https://github.com/can1357/oh-my-pi/blob/v18.8.9/packages/tui/src/chat/messages.ts
 * 未识别的角色和字段原样保留，按需在紧凑会话审阅中展示，不为每条消息追加原始数据面板。
 */
export interface AgentMessage {
  role: string;
  content?: string | MessageContent[];
  timestamp?: number;
  provider?: string;
  model?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  stopReason?: string;
  errorMessage?: string;
  command?: string; // bashExecution 的原始命令。
  code?: string; // pythonExecution 的原始代码。
  output?: string; // bashExecution/pythonExecution 的执行输出。
  exitCode?: number; // 执行结束码，取消或尚未完成时可缺省。
  cancelled?: boolean; // 执行是否被用户取消。
  truncated?: boolean; // 原生输出是否被截断。
  summary?: string; // branchSummary/compactionSummary 的摘要正文。
  files?: {
    path: string; // 被提及的文件路径。
    content: string; // 原生自动读取的文件正文。
    lineCount?: number; // 已读取的行数。
    byteSize?: number; // 已知文件字节数。
    skippedReason?: "tooLarge" | "binary"; // 原生未读取文件正文的原因。
    image?: MessageContent; // 文件附带的原生图片。
    [key: string]: unknown; // 保留新版原生文件字段。
  }[];
  images?: MessageContent[]; // bashExecution 输出中的原生图片。
  [key: string]: unknown; // 保留未识别角色及扩展字段供原始数据展示。
}

export interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: AgentMessage;
  label?: string;
  [key: string]: unknown;
}

export interface TreeNode {
  entry: SessionEntry;
  children: TreeNode[];
  label?: string; // 原生会话树节点的显示与搜索标签。
}
export interface TreeDeletionRequest {
  sessionId: string;
  entryId: string;
  entryIds: string[];
}

export interface SessionState {
  todoPhases?: TodoPhase[];
  model?: ModelInfo;
  thinkingLevel?: string;
  fastModeEnabled?: boolean;
  fastModeActive?: boolean;
  tokensPerSecond?: number | null; // 尚无生成速度时，原生 get_state 返回 null。
  isStreaming: boolean;
  isCompacting: boolean;
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  messageCount: number;
  queuedMessageCount: number;
  isSettled?: boolean;
  queuedMessages?: {
    steering: string[];
    followUp: string[];
    liveSteered?: number;
  };
  contextUsage?: { tokens: number; contextWindow: number; percent: number };
}

export interface BtwTurn {
  question: string;
  answer: string;
  status: "running" | "complete" | "cancelled" | "error" | "interrupted";
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface BtwRecord extends BtwTurn {
  id: string;
  leafId: string | null;
  followUps?: BtwTurn[];
}

export interface ModelRole {
  role: string;
  value?: string;
  global?: string;
  project?: string;
}

export interface SlashCommand {
  name: string;
  icon?: string;
  aliases?: string[];
  description?: string;
  source?: string;
}

export interface ToolFilePreviewRequest {
  sessionId: string; // 当前原生会话标识。
  toolCallId: string; // 提供明确文件目标的原生工具调用标识。
  path: string; // 共享工具解析器提取的原始磁盘路径，不是任意读取能力。
}

export interface ToolFilePreview {
  path: string; // 按实际 CLI cwd 与用户 home 解析的绝对路径。
  content: string; // 只读 UTF-8 当前文本，不代表工具执行时的历史内容。
  truncated: boolean; // 超出有界读取范围时明确标识截断。
  byteSize: number; // 文件句柄报告的当前字节大小。
}

/** 侧边栏会话操作；sessionId 取自文件头，用于原生租约与身份校验。 */
export type SessionOperationRequest =
  | { op: "rename"; path: string; sessionId: string; name: string }
  | { op: "delete"; path: string; sessionId: string };

/** 原生只读解析的历史来源及其可用模型选择器。 */
export interface SeanceSource {
  path: string;
  modelSelectors: string[];
}

/** 内置 seance 任务的原生启动结果；异步任务继续通过当前会话报告。 */
export interface SeanceLaunch {
  state: "running" | "completed";
  taskIds: string[];
  jobId?: string;
  model?: string;
  content?: string;
}

/** 单个来源独立恢复保存模型，也可指定仅本次使用的模型。 */
export interface SeanceConsultation {
  sourceSession: string;
  model?: string;
}

/** 批量启动按输入顺序返回，单个来源失败不撤销其他已启动任务。 */
export interface SeanceBatchItem {
  sourceSession: string;
  launch?: SeanceLaunch;
  error?: string;
}

export interface DesktopBridge extends ProjectBrowser, ProjectReview {
  plan(action: PlanAction): Promise<PlanSnapshot | null>;
  setPlanDirty(dirty: boolean): void;
  onPlanCloseRequest(listener: (requestId: string) => void): () => void;
  respondPlanClose(requestId: string, allow: boolean): void;
  /**
   * 搜索工作目录内部真实普通文件，不依赖 OMP 连接或读取文件内容。
   * 参数：[in] cwd 绝对工作目录；[in] query 文件名或相对路径模糊查询，可为空。
   * 返回值：最多三十条确定排序的正斜线相对路径，不遍历 node_modules、.git 或符号链接。
   */
  searchMentionFiles(cwd: string, query: string): Promise<string[]>;
  subagentHistory<T = import("./subagents").SubagentHistoryResult>(
    request: import("./subagents").SubagentHistoryRequest,
  ): Promise<T>;
  /** 按会话目录解析本地链接；allowMissing 仅用于侧栏查看及删除文件的只读引用，读取时仍核实存在。 */
  resolveProjectFileLink(href: string, cwd: string, allowMissing?: boolean): Promise<ProjectEntry>;
  /** 会话文件右键菜单「打开方式」中本机已安装的程序。 */
  listFileOpeners(): Promise<FileOpener[]>;
  /** 主进程重新解析并核实链接后执行打开、另存为、复制或定位操作。 */
  runFileAction(href: string, cwd: string, action: FileAction): Promise<void>;
  /** 设置本窗口页面缩放比例，只影响显示，不改动会话与连接。 */
  setZoomFactor(factor: number): void;
  preferences(): Promise<LaunchOptions & { autoConnect?: boolean }>;
  start(
    options: LaunchOptions,
    selection?: ModelSelection,
    taskModel?: string,
  ): Promise<ConnectionInfo>;
  prepareModels(
    options: LaunchOptions,
    selection?: ModelSelection,
  ): Promise<ModelState>;
  modelRequest<T = unknown>(command: RpcCommand): Promise<T>;
  stop(): Promise<void>;
  openSession(path: string): Promise<SessionOpenResult>;
  listSessionEngines(): Promise<SessionEngineStatus[]>;
  startSessionEngine(options: LaunchOptions): Promise<SessionEngineStatus[]>;
  stopSessionEngine(path: string): Promise<SessionEngineStatus[]>;
  readSession(): Promise<ReadOnlySession | null>;
  request<T = unknown>(command: RpcCommand): Promise<T>;
  onFrame(listener: (frame: RpcFrame) => void): () => void;
  listSessions(agentDir?: string): Promise<SessionSummary[]>;
  choosePath(
    kind: "workspace" | "engine" | "session" | "agentDir",
  ): Promise<string | null>;
  getRoles(): Promise<ModelRole[]>;
  /** 活动模型预测下一条提示词（额外计费一次请求）；无把握时返回 null。 */
  predictPrompt(): Promise<string | null>;
  setRole(
    role: string,
    value: string | undefined,
    scope: "global" | "project",
  ): Promise<ModelRole[]>;
  navigateTree(
    entryId: string,
    options?: import("./native-tree").TreeNavigationOptions,
  ): Promise<void>;
  setTreeLabel(entryId: string, label: string | undefined): Promise<void>;
  deleteTree(request: TreeDeletionRequest): Promise<void>;
  /** 取得原生独占租约后重命名会话；被其他 omp 占用时拒绝。 */
  renameSession(path: string, name: string, agentDir?: string): Promise<void>;
  /** 取得原生独占租约后删除会话文件及其产物目录；被其他 omp 占用时拒绝。 */
  deleteSession(path: string, agentDir?: string): Promise<void>;
  /** 只读检查历史来源，不连接或恢复该历史会话。 */
  inspectSeance(sourceSession: string): Promise<SeanceSource>;
  /** 仅在当前已连接且空闲的真实会话内调用原生内置 seance。 */
  runSeance(sourceSession: string, model?: string): Promise<SeanceLaunch>;
  /** 使用同一原生 task 并发限制器独立启动各历史来源。 */
  runSeances(requests: readonly SeanceConsultation[]): Promise<SeanceBatchItem[]>;
  /** 全部来源读取成功后才修改系统剪贴板，不影响当前会话。 */
  copySession(
    paths: readonly string[],
    kind: "paths" | "content",
    agentDir?: string,
  ): Promise<void>;
  formatCommand(toolName: string, command: string): Promise<string>;
  cancelTreeNavigation(): Promise<void>;
  respondUI(response: { id: string; [key: string]: unknown }): Promise<void>;
  openExternal(url: string): Promise<void>;
  openBrowser(url: string): Promise<void>;
  setBrowserLayout(layout: BrowserPanelLayout): Promise<void>;
  browserAction(action: BrowserPanelAction): Promise<void>;
  getBrowserState(): Promise<BrowserPanelState>;
  onBrowserState(listener: (state: BrowserPanelState) => void): () => void;
  setBrowserContextScope(scope: string | null): Promise<void>;
  pickBrowserElement(scope: string, mode: BrowserSelectionMode): Promise<BrowserPromptContext | null>;
  cancelBrowserElementPick(): Promise<void>;
  onBrowserContext(listener: (value: BrowserPromptContext) => void): () => void;
  setBrowserCommentEditor(editor: BrowserCommentEditor | null): Promise<void>;
  syncBrowserCommentMarkers(markers: BrowserCommentMarker[]): Promise<void>;
  revealBrowserComment(request: BrowserCommentRevealRequest): Promise<BrowserCommentRevealResult>;
  cancelBrowserCommentReveal(requestId: string): Promise<void>;
  onBrowserCommentEvent(listener: (event: BrowserCommentEvent) => void): () => void;
  copyText(text: string): Promise<void>;
  /**
   * 只读预览当前原生工具明确引用文件的当前文本，不打开系统应用。
   * 参数：[in] request 当前原生会话、工具调用 id 和提取的文件路径。
   * 返回值：有界 UTF-8 当前文件预览；失效证据、二进制和读取错误拒绝。
   */
  previewToolFile(request: ToolFilePreviewRequest): Promise<ToolFilePreview>;
}

declare global {
  interface Window {
    desktop: DesktopBridge;
  }
}
