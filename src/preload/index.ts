import type { BrowserCommentEditor, BrowserCommentMarker, BrowserCommentEvent, BrowserCommentRevealRequest } from "../shared/comment-overlay";
import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from "electron";
import type { TreeNavigationOptions } from "../shared/native-tree";
import type { ProjectDiffRequest } from "../shared/project-browser";
import type { FileAction } from "../shared/file-actions";
import type { BrowserPanelAction, BrowserPanelLayout, BrowserPanelState, BrowserSelectionMode } from "../shared/browser";
import type { BrowserPromptContext } from "../shared/prompt-context";
import type {
  DesktopBridge,
  LaunchOptions,
  ModelSelection,
  RpcCommand,
  RpcFrame,
  ToolFilePreviewRequest,
  TreeDeletionRequest,
} from "../shared/protocol";

const desktop: DesktopBridge = {
  plan: (action) => ipcRenderer.invoke("desktop:plan", action),
  setPlanDirty: (dirty) => ipcRenderer.send("desktop:plan-dirty", dirty),
  onPlanCloseRequest(listener) {
    const receive = (_event: IpcRendererEvent, requestId: string) => listener(requestId);
    ipcRenderer.on("desktop:plan-close-request", receive);
    return () => ipcRenderer.removeListener("desktop:plan-close-request", receive);
  },
  respondPlanClose: (requestId, allow) => ipcRenderer.send("desktop:plan-close-response", requestId, allow),
  setZoomFactor(factor: number) {
    webFrame.setZoomFactor(factor);
  },
  /**
   * 通过受信窄 IPC 搜索工作目录文件，不开放任意文件读取能力。
   * 参数：[in] cwd 当前工作目录；[in] query 文件名或相对路径查询，可为空。
   * 返回值：最多三十条正斜线相对文件路径。
   */
  searchMentionFiles(cwd: string, query: string): Promise<string[]> {
    return ipcRenderer.invoke("desktop:search-mention-files", cwd, query);
  },
  subagentHistory(request) {
    return ipcRenderer.invoke("desktop:subagent-history", request);
  },
  resolveProjectFileLink(href: string, cwd: string, allowMissing?: boolean) {
    return ipcRenderer.invoke("desktop:resolve-project-file-link", href, cwd, allowMissing);
  },
  listFileOpeners() {
    return ipcRenderer.invoke("desktop:file-openers");
  },
  runFileAction(href: string, cwd: string, action: FileAction) {
    return ipcRenderer.invoke("desktop:file-action", href, cwd, action);
  },
  listProjectChanges(cwd: string) {
    return ipcRenderer.invoke("desktop:project-changes", cwd);
  },
  readProjectDiff(request: ProjectDiffRequest) {
    return ipcRenderer.invoke("desktop:project-diff", request);
  },
  listProjectDirectory(path: string) {
    return ipcRenderer.invoke("desktop:project-directory", path);
  },
  readProjectFile(path: string) {
    return ipcRenderer.invoke("desktop:project-file", path);
  },
  readProjectImage(path: string) {
    return ipcRenderer.invoke("desktop:project-image", path);
  },
  formatCommand(toolName: string, command: string) {
    return ipcRenderer.invoke("desktop:format-command", toolName, command);
  },
  /**
   * 获取应用启动偏好，不自动打开旧会话。
   * 参数：无。
   * 返回值：引擎和工作目录等启动设置。
   */
  preferences() {
    return ipcRenderer.invoke("desktop:preferences");
  },
  /**
   * 启动真实原生 CLI 连接。
   * 参数：[in] options 经过主进程校验的启动设置。
   * 返回值：实际工作目录、引擎路径和协议版本。
   */
  start(
    options: LaunchOptions,
    selection?: ModelSelection,
    taskModel?: string,
  ) {
    return ipcRenderer.invoke("desktop:start", options, selection, taskModel);
  },
  prepareModels(options: LaunchOptions, selection?: ModelSelection) {
    return ipcRenderer.invoke("desktop:prepare-models", options, selection);
  },
  modelRequest<T = unknown>(command: RpcCommand): Promise<T> {
    return ipcRenderer.invoke("desktop:model-request", command);
  },
  /**
   * 关闭 CLI 输入并等待原生输出和进程排空。
   * 参数：无。
   * 返回值：正常关闭完成的 Promise。
   */
  stop() {
    return ipcRenderer.invoke("desktop:stop");
  },
  openSession(path: string) {
    return ipcRenderer.invoke("desktop:open-session", path);
  },
  listSessionEngines() {
    return ipcRenderer.invoke("desktop:session-engines");
  },
  startSessionEngine(options: LaunchOptions) {
    return ipcRenderer.invoke("desktop:start-session-engine", options);
  },
  stopSessionEngine(path: string) {
    return ipcRenderer.invoke("desktop:stop-session-engine", path);
  },
  readSession() {
    return ipcRenderer.invoke("desktop:read-session");
  },
  inspectSeance(sourceSession: string) {
    return ipcRenderer.invoke("desktop:seance-inspect", sourceSession);
  },
  runSeance(sourceSession: string, model?: string) {
    return ipcRenderer.invoke("desktop:seance-run", sourceSession, model);
  },
  runSeances(requests) {
    return ipcRenderer.invoke("desktop:seance-run-batch", requests);
  },
  copySession(paths: readonly string[], kind: "paths" | "content", agentDir?: string) {
    return ipcRenderer.invoke("desktop:session-copy", paths, kind, agentDir);
  },
  /**
   * 发送允许的原生 RPC 命令，不暴露任意 IPC 通道。
   * 参数：[in] command 原生 RPC 命令。
   * 返回值：成功响应的 data，错误通过 Promise 拒绝。
   */
  request<T = unknown>(command: RpcCommand): Promise<T> {
    return ipcRenderer.invoke("desktop:request", command);
  },
  /**
   * 订阅原生事件与桌面状态，隐藏 Electron event 对象。
   * 参数：[in] listener 帧监听回调。
   * 返回值：只移除此监听器的取消订阅函数。
   */
  onFrame(listener: (frame: RpcFrame) => void) {
    /**
     * 仅将协议数据传给 renderer，不泄露 event/sender 对象。
     * 参数：[in] _event 内部 Electron 事件；[in] frame 结构化协议帧。
     * 返回值：无。
     */
    function receive(_event: IpcRendererEvent, frame: RpcFrame): void {
      listener(frame);
    }
    ipcRenderer.on("desktop:frame", receive);
    /**
     * 移除本次订阅，保留其他 UI 监听器。
     * 参数：无。
     * 返回值：无。
     */
    return function unsubscribe(): void {
      ipcRenderer.removeListener("desktop:frame", receive);
    };
  },
  /**
   * 只读列出原生 CLI 会话摘要。
   * 参数：[in] agentDir 可选原生代理目录。
   * 返回值：按修改时间排序的原生会话列表。
   */
  listSessions(agentDir?: string) {
    return ipcRenderer.invoke("desktop:sessions", agentDir);
  },
  /**
   * 请求主进程显示系统本地文件/目录选择器。
   * 参数：[in] kind DesktopBridge 限定的选择类别。
   * 返回值：选定路径或取消时 null。
   */
  choosePath(kind: "workspace" | "engine" | "session" | "agentDir") {
    return ipcRenderer.invoke("desktop:choose", kind);
  },
  /**
   * 读取 CLI Settings 的真实模型角色。
   * 参数：无。
   * 返回值：原生有效/全局/项目角色配置。
   */
  getRoles() {
    return ipcRenderer.invoke("desktop:roles");
  },
  predictPrompt() {
    return ipcRenderer.invoke("desktop:prompt-prediction");
  },
  /**
   * 设置或清除原生模型角色并等待 flush。
   * 参数：[in] role 角色名；[in] value 模型 selector 或 undefined 重置；[in] scope 全局或项目配置。
   * 返回值：更新后的角色配置列表。
   */
  setRole(
    role: string,
    value: string | undefined,
    scope: "global" | "project",
  ) {
    return ipcRenderer.invoke("desktop:role", role, value, scope);
  },
  /**
   * 请求 CLI 在当前文件中导航原生上下文树。
   * 参数：[in] entryId 原生目标 entry 标识。
   * 返回值：操作完成的 Promise，取消或错误拒绝。
   */
  navigateTree(entryId: string, options?: TreeNavigationOptions) {
    return ipcRenderer.invoke("desktop:tree", entryId, options);
  },
  setTreeLabel(entryId: string, label: string | undefined) {
    return ipcRenderer.invoke("desktop:tree-label", entryId, label);
  },
  deleteTree(request: TreeDeletionRequest) {
    return ipcRenderer.invoke("desktop:tree-delete", request);
  },
  /**
   * 取得原生独占租约后重命名侧边栏会话。
   * 参数：[in] path 会话文件；[in] name 新名称；[in] agentDir 可选原生代理目录。
   * 返回值：原生持久化完成的 Promise，占用时拒绝。
   */
  renameSession(path: string, name: string, agentDir?: string) {
    return ipcRenderer.invoke("desktop:session-rename", path, name, agentDir);
  },
  /**
   * 取得原生独占租约后删除会话文件及产物目录。
   * 参数：[in] path 会话文件；[in] agentDir 可选原生代理目录。
   * 返回值：删除完成的 Promise，占用时拒绝。
   */
  deleteSession(path: string, agentDir?: string) {
    return ipcRenderer.invoke("desktop:session-delete", path, agentDir);
  },
  cancelTreeNavigation() {
    return ipcRenderer.invoke("desktop:tree-cancel");
  },
  /**
   * 向 CLI 回传交互选择或取消，不执行 renderer 代码。
   * 参数：[in] response 含原生 dialog id 的响应。
   * 返回值：协议响应写入完成的 Promise。
   */
  respondUI(response: { id: string; [key: string]: unknown }) {
    return ipcRenderer.invoke("desktop:ui", response);
  },
  /**
   * 经主进程 HTTP(S) 白名单验证后打开外链。
   * 参数：[in] url 外部网页 URL。
   * 返回值：系统浏览器接受链接的 Promise。
   */
  openExternal(url: string) {
    return ipcRenderer.invoke("desktop:external", url);
  },
  openBrowser(url: string) {
    return ipcRenderer.invoke("desktop:browser-open", url);
  },
  setBrowserLayout(layout: BrowserPanelLayout) {
    return ipcRenderer.invoke("desktop:browser-layout", layout);
  },
  browserAction(action: BrowserPanelAction) {
    return ipcRenderer.invoke("desktop:browser-action", action);
  },
  getBrowserState() {
    return ipcRenderer.invoke("desktop:browser-state");
  },
  onBrowserState(listener: (state: BrowserPanelState) => void) {
    // 仅转发快照，不向网页或 renderer 暴露 Electron 事件。
    const receive = (_event: IpcRendererEvent, state: BrowserPanelState) => listener(state);
    ipcRenderer.on("desktop:browser-updated", receive);
    return () => ipcRenderer.removeListener("desktop:browser-updated", receive);
  },
  setBrowserContextScope(scope: string | null) {
    return ipcRenderer.invoke("desktop:browser-context-scope", scope);
  },
  pickBrowserElement(scope: string, mode: BrowserSelectionMode) {
    return ipcRenderer.invoke("desktop:browser-pick-element", scope, mode);
  },
  cancelBrowserElementPick() {
    return ipcRenderer.invoke("desktop:browser-pick-cancel");
  },
  onBrowserContext(listener: (value: BrowserPromptContext) => void) {
    const receive = (_event: IpcRendererEvent, value: BrowserPromptContext) => listener(value);
    ipcRenderer.on("desktop:browser-context", receive);
    return () => ipcRenderer.removeListener("desktop:browser-context", receive);
  },
  setBrowserCommentEditor(editor: BrowserCommentEditor | null) {
    return ipcRenderer.invoke("desktop:browser-comment-editor", editor);
  },
  syncBrowserCommentMarkers(markers: BrowserCommentMarker[]) {
    return ipcRenderer.invoke("desktop:browser-comment-markers", markers);
  },
  revealBrowserComment(request: BrowserCommentRevealRequest) {
    return ipcRenderer.invoke("desktop:browser-comment-reveal", request);
  },
  cancelBrowserCommentReveal(requestId: string) {
    return ipcRenderer.invoke("desktop:browser-comment-reveal-cancel", requestId);
  },
  onBrowserCommentEvent(listener: (event: BrowserCommentEvent) => void) {
    const receive = (_event: IpcRendererEvent, value: BrowserCommentEvent) => listener(value);
    ipcRenderer.on("desktop:browser-comment-event", receive);
    return () => ipcRenderer.removeListener("desktop:browser-comment-event", receive);
  },
  copyText(value: string) {
    return ipcRenderer.invoke("desktop:copy-text", value);
  },
  /**
   * 仅预览当前原生工具明确引用的文件，不打开系统窗口或执行工具。
   * 参数：[in] request 当前原生会话、工具调用 id 与提取的文件路径。
   * 返回值：当前文件的有界 UTF-8 文本；授权和读取错误通过 Promise 拒绝。
   */
  previewToolFile(request: ToolFilePreviewRequest) {
    return ipcRenderer.invoke("desktop:tool-file", request);
  },
};

contextBridge.exposeInMainWorld("desktop", desktop);
