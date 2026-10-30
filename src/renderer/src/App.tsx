import { useProjectDrag } from "./useProjectDrag";
import { useSelectionBoundary } from "./useSelectionBoundary";
import { SidebarResizeHandle, useSidebarWidth } from "./SidebarResizeHandle";
import {
  useConversationSpacing,
  DEFAULT_CONVERSATION_GUTTER,
} from "./useConversationSpacing";
import { DEFAULT_INTERFACE_FONT_SIZE, MAX_INTERFACE_FONT_SIZE, MIN_INTERFACE_FONT_SIZE, useInterfaceFontSize } from "./useInterfaceFontSize";
import {
  usePromptPrediction,
  usePromptPredictionSetting,
} from "./usePromptPrediction";
import { useFileMentions } from "./useFileMentions";
import { ComposerFileReferences } from "./ComposerFileReferences";
import { ContextMeter } from "./ContextMeter";
import { FastToggle } from "./FastToggle";
import { FAST_SHORTCUT } from "./fast-mode";
import { FileReferencePreview } from "./FileReferenceLink";
import { OutputFileProbe } from "./output-file-links";
import { commandIcon } from "../../shared/command-icons";
import { sessionTree } from "../../shared/session-tree";
import { RewindMode } from "./RewindMode";
import { SessionMenu, type SessionMenuTarget, type SessionDeletionResult } from "./SessionMenu";
import { SeanceForm } from "./SeanceForm";
import { BatchSeanceForm } from "./BatchSeanceForm";
import { parseSeanceCommand, type SeanceCommandArgs } from "./seance-command";
import { FileContextMenu, type FileMenuTarget } from "./FileContextMenu";
import { NativeModelHub } from "./NativeModelHub";
import { NativeAgentsHub } from "./NativeAgentsHub";
import { SubagentActivityHub } from "./SubagentActivityHub";
import { useSubagentShortcut } from "./subagent-shortcut";
import type { AgentsAction, AgentsSnapshot } from "../../shared/native-agents";
import { SessionTreeScreen } from "./SessionTreeScreen";
import { CodeReviewPanel } from "./CodeReviewPanel";
import { JobsPane } from "./JobsPane";
import { BtwPanel, BtwStatusBar } from "./BtwPanel";
import { createBtwScope, sameBtwIdentity, consumeBtwDraft, getBtwCopyText, BTW_NEW_TOPIC, type BtwIdentity, type BtwScopeState, type BtwDraft, type BtwSelection } from "./btw-state";
import "./btw-panel.css";
import { BrowserPanel } from "./BrowserPanel";
import { PlanPanel } from "./PlanPanel";
import { NotifiedPlanError, usePlan } from "./usePlan";
import { Toasts, useToasts } from "./Toasts";
import { WebLinks } from "./WebLinks";
import { PromptContexts, type PromptContextActions } from "./PromptContexts";
import { ContextCommentPopover } from "./ContextCommentPopover";
import { formatPromptContext } from "./prompt-context";
import { stripCommentPreamble, validatePromptContext, type PromptContext } from "../../shared/prompt-context";
import type { CommentSourceAnchor } from "../../shared/comment-anchor";
import { useCommentDraft } from "./useCommentDraft";
import { activeDraftComments, prepareCommentSubmission, type DraftComment } from "./comment-draft";
import { LocalCommentMarkers } from "./LocalCommentMarkers";
import { PendingComments } from "./PendingComments";
import type { BrowserCommentEditor, BrowserCommentEvent } from "../../shared/comment-overlay";
import type { ProjectEntry } from "../../shared/project-browser";
import type { LocalCommentRevealRequest, LocalCommentRevealResult } from "./local-comment-reveal";
import { MessageFileLinks, MessageFileMenu } from "./MessageFileLinks";
import { messageFileHref, sameProjectPath } from "../../shared/message-file-link";
import type { TreeNavigation, TreeLabelChange } from "./native-tree-types";
import type { TreeDeletion } from "./native-tree-types";
import type { TreeNavigationOptions } from "../../shared/native-tree";
import { modelHubSelection } from "./model-hub-selection";
import type {
  NativeModelAction,
  NativeModelSnapshot,
} from "../../shared/native-model";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  AgentMessage,
  BtwRecord,
  ConnectionInfo,
  LaunchOptions,
  MessageContent,
  ModelInfo,
  ModelRole,
  ModelSelection,
  ModelState,
  RoleModelCycle,
  RpcCommand,
  RpcFrame,
  ReadOnlySession,
  SessionEntry,
  SessionState,
  SeanceConsultation,
  SeanceBatchItem,
  SessionSummary,
  SessionEngineStatus,
  SlashCommand,
  TreeNode,
} from "../../shared/protocol";
import { RichContent } from "./RichContent";
import { TodoPanel } from "./TodoPanel";
import {
  sessionHistoryMessages,
  sessionHistoryTodos,
  type SessionHistorySnapshot,
} from "../../shared/session-history";
import { NativeImage, Transcript } from "./Transcript";
import {
  displayMessageText,
  initialSession,
  messageText,
  readable,
  sessionReducer,
} from "./session";

type Modal =
  | "agent-activity"
  | "settings"
  | "model-hub"
  | "agents"
  | "roles"
  | "checkpoint"
  | "rewind"
  | "tree"
  | "sessions"
  | "commands"
  | "shake"
  | "seance"
  | "seance-batch"
  | "clear"
  | "connection-error"
  | "session-required"
  | null;
interface ExtensionQuestion {
  id: string;
  question: string;
  header?: string;
  options: { label: string; description?: string; preview?: string }[];
  multi?: boolean;
  recommended?: number;
}
interface ExtensionRequest extends RpcFrame {
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  optionDetails?: { description?: string }[];
  questions?: ExtensionQuestion[];
  placeholder?: string;
  prefill?: string;
}
const DOUBLE_ESCAPE_WINDOW_MS = 500;

const builtinCommands: SlashCommand[] = [
  { name: "model", description: "原生模型管理：角色、提供商与预设" },
  { name: "plan", description: "进入／暂停原生计划模式" },
  { name: "new", description: "新建原生会话，保留当前会话" },
  { name: "resume", description: "查找和继续 CLI 会话" },
  { name: "fork", description: "将完整会话复制到新文件" },
  { name: "clear", description: "确认后新建空会话，不删除历史" },
  { name: "tree", description: "浏览所有分支，切换同文件上下文" },
  { name: "rewind", description: "进入回退模式，与双 Esc 相同" },
  { name: "btw", description: "原生旁问；/btw history 查看主题历史" },
  { name: "agents", description: "管理子代理：启停、模型、Prewalk 与 Advisor" },
  { name: "jobs", description: "在右侧侧栏查看后台任务；/jobs full 显示详情" },
  { name: "shake", description: "清理重内容（改写历史及展示，执行前确认）；elide / images / thinking" },
  { name: "seance", description: "只读咨询历史会话；[会话 ID 或路径] [--model selector]" },
];
const roleLabels: Record<string, string> = {
  default: "默认",
  smol: "快速",
  slow: "深度推理",
  plan: "规划",
  vision: "视觉",
  task: "子任务",
  advisor: "顾问",
  commit: "提交",
  tiny: "轻量",
  memory: "记忆",
  image: "图像生成",
  speech: "语音",
  dictation: "听写",
  web: "网页",
  judge: "评判",
};

/** 显示可访问的模态窗口并管理焦点。[in] title：标题；[in] children：内容；[in] onClose：取消；[in] wide：宽版。返回值：对话框节点。 */
function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = dialog.current?.querySelector<HTMLElement>(
      'input,textarea,select,button:not([disabled]),[tabindex="0"]',
    );
    first?.focus();
    /** 限制焦点在当前窗口。[in] event：键盘事件。返回值：无。 */
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ) ?? []),
      ].filter((node) => node.getClientRects().length > 0);
      const firstNode = nodes[0];
      const lastNode = nodes.at(-1);
      if (event.shiftKey && document.activeElement === firstNode) {
        event.preventDefault();
        lastNode?.focus();
      } else if (!event.shiftKey && document.activeElement === lastNode) {
        event.preventDefault();
        firstNode?.focus();
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialog}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="关闭窗口"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** 呈现真实扩展交互，答案保持原生标签及顺序。[in] request：请求；[in] onReply：回复；[in] onCancel：取消。返回值：扩展模态内容。 */
function ExtensionDialog({
  request,
  onReply,
  onCancel,
}: {
  request: ExtensionRequest;
  onReply: (response: { id: string; [key: string]: unknown }) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(request.prefill ?? "");
  const [answers, setAnswers] = useState<
    Record<string, { selectedOptions: string[]; customInput: string }>
  >({});
  const questions = request.questions ?? [];
  return (
    <Dialog
      title={request.title ?? "omp 需要你的输入"}
      onClose={onCancel}
      wide={request.method === "ask"}
    >
      <div className="modal-body">
        <p className="muted">来自原生 CLI / 扩展 · {request.method}</p>
        {request.message && <RichContent text={request.message} />}
        {request.method === "confirm" ? (
          <div className="action-row">
            <button
              onClick={() => onReply({ id: request.id, confirmed: false })}
            >
              拒绝
            </button>
            <button
              className="primary"
              onClick={() => onReply({ id: request.id, confirmed: true })}
            >
              确认
            </button>
          </div>
        ) : request.method === "select" ? (
          <div className="option-list">
            {request.options?.map((option, index) => (
              <button
                key={`${index}:${option}`}
                onClick={() => onReply({ id: request.id, value: option })}
              >
                <strong>{option}</strong>
                {request.optionDetails?.[index]?.description && (
                  <small>{request.optionDetails[index].description}</small>
                )}
              </button>
            ))}
          </div>
        ) : request.method === "ask" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onReply({
                id: request.id,
                answers: questions.map((question) => ({
                  id: question.id,
                  selectedOptions: answers[question.id]?.selectedOptions ?? [],
                  ...(answers[question.id]?.customInput.trim()
                    ? { customInput: answers[question.id].customInput.trim() }
                    : {}),
                })),
              });
            }}
          >
            {questions.map((question) => (
              <fieldset key={question.id}>
                <legend>
                  {question.header && `${question.header} · `}
                  {question.question}
                </legend>
                {question.options.map((option, index) => (
                  <label className="ask-option" key={option.label}>
                    <input
                      type={question.multi ? "checkbox" : "radio"}
                      name={question.id}
                      checked={
                        answers[question.id]?.selectedOptions.includes(
                          option.label,
                        ) ?? false
                      }
                      onChange={(event) =>
                        setAnswers((old) => ({
                          ...old,
                          [question.id]: {
                            customInput: question.multi
                              ? (old[question.id]?.customInput ?? "")
                              : "",
                            selectedOptions: question.multi
                              ? event.target.checked
                                ? [
                                    ...(old[question.id]?.selectedOptions ??
                                      []),
                                    option.label,
                                  ]
                                : (
                                    old[question.id]?.selectedOptions ?? []
                                  ).filter((label) => label !== option.label)
                              : [option.label],
                          },
                        }))
                      }
                    />
                    <span>
                      <strong>
                        {option.label}
                        {question.recommended === index && (
                          <small> · 推荐</small>
                        )}
                      </strong>
                      {option.description && (
                        <small>{option.description}</small>
                      )}
                      {option.preview && <pre>{option.preview}</pre>}
                    </span>
                  </label>
                ))}
                <label>
                  其他回答
                  <input
                    placeholder="自由输入"
                    value={answers[question.id]?.customInput ?? ""}
                    onChange={(event) =>
                      setAnswers((old) => ({
                        ...old,
                        [question.id]: {
                          selectedOptions: question.multi
                            ? (old[question.id]?.selectedOptions ?? [])
                            : [],
                          customInput: event.target.value,
                        },
                      }))
                    }
                  />
                </label>
              </fieldset>
            ))}
            <div className="action-row">
              <button type="button" onClick={onCancel}>
                取消
              </button>
              <button
                className="primary"
                type="submit"
                disabled={questions.some(
                  (question) =>
                    !question.multi &&
                    !(
                      answers[question.id]?.selectedOptions.length ||
                      answers[question.id]?.customInput.trim()
                    ),
                )}
              >
                提交答案
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onReply({ id: request.id, value });
            }}
          >
            <label>
              {request.title ?? "输入"}
              {request.method === "editor" ? (
                <textarea
                  rows={8}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              ) : (
                <input
                  value={value}
                  placeholder={request.placeholder}
                  onChange={(event) => setValue(event.target.value)}
                />
              )}
            </label>
            <div className="action-row">
              <button type="button" onClick={onCancel}>
                取消
              </button>
              <button className="primary" type="submit">
                提交
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}

/** 提取仅供显示的项目短名。[in] cwd：原始工作目录。返回值：末级目录名，缺失目录时返回明确提示。 */
function projectName(cwd: string): string {
  return (
    cwd
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ||
    cwd ||
    "未记录工作目录"
  );
}

/** 为同名项目提取最短可区分父路径。[in] cwd：原始工作目录；[in] peers：全部同名项目的原始目录。返回值：父路径标识，非同名项目不返回标识。 */
function projectParentCaption(
  cwd: string,
  peers: string[],
): string | undefined {
  if (peers.length === 1) return undefined;

  /** 截取父路径尾部而保留原始分隔符及完整根标识。[in] path：原始工作目录；[in] depth：父路径尾部段数。返回值：对应父路径后缀。 */
  function parentSuffix(path: string, depth: number): string {
    const trimmed = path.replace(/[\\/]+$/, "");
    const end = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    const root = trimmed.slice(0, end + 1);
    const parent =
      end === 0 || /^[A-Za-z]:[\\/]$/.test(root)
        ? root
        : trimmed.slice(0, Math.max(0, end));
    const segments = Array.from(parent.matchAll(/[^\\/]+/g));
    const start = segments.length - depth;
    return start > 0 ? parent.slice(segments[start].index) : parent;
  }

  // 从最近父目录逐层向上扩展；判重涵盖未被搜索显示的同名项目。
  const depthLimit = cwd.split(/[\\/]/).length;
  for (let depth = 1; depth <= depthLimit; depth += 1) {
    const caption = parentSuffix(cwd, depth);
    if (
      peers.every(
        (peer) => peer === cwd || parentSuffix(peer, depth) !== caption,
      )
    ) {
      return caption;
    }
  }
  // 原始目录仅分隔符等文本不同的情况下，仍显示真实身份，不合并原生键。
  return cwd;
}

interface PendingCommentReveal {
  requestId: string;
  entry: DraftComment;
  draftId: string;
  epoch: number;
  scope: string;
  anchor: { x: number; y: number };
  trigger?: HTMLElement;
  browserScope?: string;
  fileSequence: number;
  panel?: "local" | "web";
}

const SESSION_ENGINE_LABELS: Record<SessionEngineStatus["state"], string> = {
  starting: "omp 正在开启", active: "omp 正在工作", unread: "omp 有未读回答",
  idle: "omp 等待输入", stopping: "omp 正在关闭",
};

/** 运行与原生 omp RPC 独占绑定的桌面界面，并展示所选会话的原生回顾。参数：无。返回值：应用界面。 */
export default function App() {
  useSelectionBoundary();
  const [view, dispatch] = useReducer(sessionReducer, initialSession);
  const [launch, setLaunch] = useState<LaunchOptions>({
    executable: "",
    cwd: "",
  });
  const [connection, setConnection] = useState<ConnectionInfo>();
  const [readOnlyPath, setReadOnlyPath] = useState<string>();
  const readOnlyRef = useRef<string | undefined>(undefined);
  const [connectionError, setConnectionError] = useState("");
  const [preparedModel, setPreparedModel] = useState<ModelState>();
  const modelChoice = useRef<ModelSelection | undefined>(undefined);
  const taskModelChoice = useRef<string | undefined>(undefined);
  const modelLoad = useRef(0);
  // 启动仅准备独立模型进程，不恢复历史会话或显示连接提示。
  const [modal, setModal] = useState<Modal>(null);
  const [shakeRequest, setShakeRequest] = useState<{
    mode: "elide" | "images" | "thinking";
    sessionId?: string;
    sessionFile?: string;
  }>();
  const [seanceArgs, setSeanceArgs] = useState<SeanceCommandArgs>({});
  const [seanceSources, setSeanceSources] = useState<readonly SessionSummary[]>([]);
  const [transcriptEpoch, setTranscriptEpoch] = useState(0);
  const [planCardStates, setPlanCardStates] = useState(new Map<string, Map<string, boolean>>());
  const [pending, setPending] = useState(false);
  const [fastPending, setFastPending] = useState(false);
  const fastPendingRef = useRef(false);
  const fastPendingState = useRef<SessionState | undefined>(undefined);
  const [runStart, setRunStart] = useState<{
    time: number;
    messageCount: number;
  }>();
  const [promptSubmitting, setPromptSubmitting] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionPaths, setSelectedSessionPaths] = useState<ReadonlySet<string>>(new Set());
  const [sessionEngines, setSessionEngines] = useState<SessionEngineStatus[]>([]);
  const enginesByPath = useMemo<Record<string, SessionEngineStatus | undefined>>(
    () => Object.fromEntries(sessionEngines.map((engine) => [engine.sessionPath, engine])),
    [sessionEngines],
  );
  const engineStatusEpoch = useRef(0);
  useEffect(() => {
    const existing = new Set(sessions.map((session) => session.path));
    setSelectedSessionPaths((previous) => {
      const next = new Set([...previous].filter((path) => existing.has(path)));
      return next.size === previous.size ? previous : next;
    });
  }, [sessions]);
  const multiSelectSessions = selectedSessionPaths.size > 1;
  const hasSessionSelection = selectedSessionPaths.size > 0;
  const [selectedProject, setSelectedProject] = useState<string>();
  // 点击会话条目、会话右键菜单及其确认框之外的任意位置即取消选择。
  useEffect(() => {
    if (!hasSessionSelection) return;
    const clear = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".session-item, .session-menu, .confirm-backdrop")) return;
      setSelectedSessionPaths(new Set());
    };
    document.addEventListener("pointerdown", clear, true);
    return () => document.removeEventListener("pointerdown", clear, true);
  }, [hasSessionSelection]);
  const [readOnlySummary, setReadOnlySummary] = useState<SessionSummary>();
  const [sessionSearch, setSessionSearch] = useState("");
  const [projectOrder, setProjectOrder] = useState<string[] | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const [searchCollapsedProjects, setSearchCollapsedProjects] = useState<
    Set<string>
  >(() => new Set());
  const projectId = useId();
  const projectRegionIds = useRef(new Map<string, string>());
  const suppressProjectClick = useRef(false);
  const projectFocusAfterMove = useRef<HTMLButtonElement | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelHub, setModelHub] = useState<NativeModelSnapshot>();
  const [agentsHub, setAgentsHub] = useState<AgentsSnapshot>();
  const [temporaryModelHub, setTemporaryModelHub] = useState(false);
  const [roles, setRoles] = useState<ModelRole[]>([]);
  const [roleCycle, setRoleCycle] = useState<RoleModelCycle | null>(null);
  const roleCyclePending = useRef(false);
  const rewindOpening = useRef(false);
  const restoreComposerFocus = useRef(false);
  const [roleName, setRoleName] = useState("default");
  const [roleScope, setRoleScope] = useState<"project" | "global">("project");
  const [roleValue, setRoleValue] = useState("");
  const [roleModel, setRoleModel] = useState("");
  const [roleThinking, setRoleThinking] = useState("");
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [leaf, setLeaf] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<SessionEntry>();
  const [treeSearch, setTreeSearch] = useState("");
  const commentDraft = useCommentDraft();
  const { draft, setDraft, resetDraft } = commentDraft;
  const [draftImages, setDraftImages] = useState<MessageContent[]>([]);
  const draftImagesRef = useRef(draftImages);
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  draftImagesRef.current = draftImages;
  const [btwUI, setBtwUI] = useState({ open: false, surface: "history" as "inline" | "history", mode: "history" as "compose" | "history", historyDetail: false, focusRequest: 0, focusTarget: "panel" as "panel" | "editor" | "list" | "reader", scopeKey: "" });
  const btwUIRef = useRef(btwUI);
  const btwScopes = useRef(new Map<string, BtwScopeState>());
  const btwContextEpoch = useRef(0);
  const btwScopeGeneration = useRef(0);
  const btwNavigation = useRef(0);
  const btwLoadSequence = useRef(0);
  const btwLoad = useRef<{ promise: Promise<void>; again: boolean } | undefined>(undefined);
  const btwOwners = useRef(new Map<string, { scope: string; epoch: number }>());
  const btwFrames = useRef<RpcFrame[]>([]);
  const btwRequestSequence = useRef(0);
  const submissionRef = useRef<{ requestId: number; scope: string; epoch: number; generation: number; slot?: string; revision?: number; selectedSlotAtSubmit: string; navigation: number; question: string } | undefined>(undefined);
  const [, renderBtw] = useReducer((value: number) => value + 1, 0);
  const [btwStopping, setBtwStopping] = useState<string>();
  const btwStoppingRef = useRef<string | undefined>(undefined);
  const [btwCopy, setBtwCopy] = useState<{ id: string; label: string }>();
  const [btwMenuOpen, setBtwMenuOpen] = useState(false);
  const btwEscapeUntil = useRef(0);
  const btwMainSelection = useRef<(BtwSelection & { top: number }) | undefined>(undefined);
  const btwRestoreFocus = useRef(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [jobsOutput, setJobsOutput] = useState<string>();
  const [jobsPending, setJobsPending] = useState(false);
  const [codeReviewOpen, setCodeReviewOpen] = useState(false);
  const [browserStarted, setBrowserStarted] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const browserButton = useRef<HTMLButtonElement>(null);
  const browserTrigger = useRef<HTMLElement | null>(null);
  const [linkedFile, setLinkedFile] = useState<{
    scope: string;
    file: ProjectEntry;
  }>();
  const fileLinkSequence = useRef(0);
  const fileLinkScope = JSON.stringify([readOnlyPath, view.state?.sessionId, view.state?.sessionFile, launch.cwd]);
  const fileLinkScopeRef = useRef(fileLinkScope);
  fileLinkScopeRef.current = fileLinkScope;
  const [extensionRequests, setExtensionRequests] = useState<
    ExtensionRequest[]
  >([]);
  const [jumpVisible, setJumpVisible] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<SessionMenuTarget>();
  const closeSessionMenu = useCallback(() => setSessionMenu(undefined), []);
  const spacing = useConversationSpacing();
  const interfaceFont = useInterfaceFontSize();
  const sidebarSize = useSidebarWidth();
  const scroll = useRef<HTMLDivElement>(null);
  const transcriptScrollTop = useRef(0);
  const stickToBottom = useRef(true);
  const userDragging = useRef(false);
  const scrollIntentAt = useRef(-Infinity);
  /** 仅在跟随且没有指针交互时贴底；程序滚动不构成新的用户意图。 */
  const followTranscript = useCallback(() => {
    const element = scroll.current;
    if (!element || !stickToBottom.current || userDragging.current) return;
    scrollIntentAt.current = -Infinity;
    if (element.scrollHeight - element.scrollTop - element.clientHeight > 1)
      element.scrollTop = element.scrollHeight;
    setJumpVisible(false);
  }, []);
  const resumeTranscript = useCallback(() => {
    stickToBottom.current = true;
    scrollIntentAt.current = -Infinity;
    setJumpVisible(false);
    followTranscript();
  }, [followTranscript]);
  const markScrollIntent = useCallback(() => {
    scrollIntentAt.current = performance.now();
  }, []);
  // 回退界面独立挂载，退出时恢复普通正文原来的阅读位置。
  const attachTranscript = useCallback((element: HTMLDivElement | null) => {
    if (scroll.current) transcriptScrollTop.current = scroll.current.scrollTop;
    userDragging.current = false;
    scrollIntentAt.current = -Infinity;
    scroll.current = element;
    if (element) element.scrollTop = transcriptScrollTop.current;
  }, []);
  const composer = useRef<HTMLTextAreaElement>(null);
  const viewRef = useRef(view);
  const launchRef = useRef(launch);
  const connectionRef = useRef(connection);
  const extensionRequestsRef = useRef(extensionRequests);
  const generation = useRef(0);
  const sessionDrafts = useRef(new Map<string, { state: typeof commentDraft.state; images: MessageContent[]; selection?: BtwSelection }>());
  const frameHandler = useRef<(frame: RpcFrame) => void>(() => {});
  const [contextComment, setContextComment] = useState<{
    context: PromptContext; anchor: { x: number; y: number }; trigger?: HTMLElement;
    sourceAnchor?: CommentSourceAnchor; entryId?: string; editorId: string; comment: string;
    scope: string; epoch: number; draftId: string;
    unavailableReason?: string; snapshotOnly?: boolean;
  }>();
  const contextCommentRef = useRef(contextComment);
  contextCommentRef.current = contextComment;
  const commentRevealRef = useRef<PendingCommentReveal | undefined>(undefined);
  const [revealingCommentId, setRevealingCommentId] = useState<string>();
  const [localCommentReveal, setLocalCommentReveal] = useState<LocalCommentRevealRequest>();
  const [browserContextScope, setBrowserContextScope] = useState<string | null>(null);
  const browserContextScopeRef = useRef<string | null>(null);
  const contextActionsRef = useRef<PromptContextActions | undefined>(undefined);
  const focusAppendedContext = useRef(false);
  const restoreContextFocus = useRef<HTMLElement | null>(null);
  const contextEpoch = generation.current;
  const btwEpoch = useRef(0);
  const messageEpoch = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshAgain = useRef(false);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const escapeAt = useRef<number | null>(null);
  viewRef.current = view;
  launchRef.current = launch;
  connectionRef.current = connection;
  extensionRequestsRef.current = extensionRequests;
  const connected = view.connection === "connected";
  const [fileMenu, setFileMenu] = useState<FileMenuTarget>();
  const { items: notices, push: pushNotice, dismiss: dismissNotice } = useToasts();
  const plan = usePlan({
    connected,
    sessionId: view.state?.sessionId,
    sessionFile: view.state?.sessionFile,
    blocked: Boolean(contextComment || extensionRequests.length || modal || sessionMenu || fileMenu),
    onOpen: () => { if (browserOpen) hideBrowser(); setCodeReviewOpen(false); closeBtw(false); setJobsOpen(false); },
    onTransition: async () => {
      const token = generation.current;
      await refresh();
      // 执行已进入流式回合时不能替换整个历史，仅补入已落盘的计划状态。
      if (token !== generation.current || viewRef.current.connection !== "connected") return;
      const before = await window.desktop.request<SessionState>({ type: "get_state" });
      const history = await window.desktop.request<SessionHistorySnapshot>({ type: "get_entries" });
      const after = await window.desktop.request<SessionState>({ type: "get_state" });
      if (token !== generation.current || before.sessionId !== after.sessionId || before.sessionFile !== after.sessionFile) return;
      dispatch({ type: "plan-status", sessionId: after.sessionId, messages: sessionHistoryMessages(history) });
      await reloadSessions();
    },
    onError: (error) => report(error),
    onNotice: pushNotice,
  });
  const [planRefining, setPlanRefining] = useState(false);
  useEffect(() => {
    if (plan.snapshot?.phase !== "review") setPlanRefining(false);
  }, [plan.snapshot?.phase]);
  useSubagentShortcut({
    enabled: !modal && !(btwUI.open && btwUI.surface === "history") && !extensionRequests.length && !contextComment && !draft && !document.querySelector('[role="menu"]'),
    onOpen: () => { if (!contextCommentRef.current && !document.querySelector('[role="menu"]')) setModal("agent-activity"); },
  });
  const needsSessionConnection = !connected && Boolean(readOnlyPath);
  const canCompose =
    connected || !!readOnlyPath || !!(launch.executable && launch.cwd);
  const transitionDisabled =
    !connected || view.busy || plan.snapshot?.phase === "applying" || pending || Boolean(loadingHistory);
  /** 用户点击后解析文件，忽略较早点击及会话切换前的延迟响应。 */
  const openMessageFile = useCallback(
    async (href: string): Promise<void> => {
      if (commentRevealRef.current) cancelCommentReveal();
      plan.hide();
      const sequence = ++fileLinkSequence.current;
      const scope = fileLinkScope;
      const epoch = generation.current;
      const file = await window.desktop.resolveProjectFileLink(
        href,
        launch.cwd,
        true,
      );
      if (
        sequence !== fileLinkSequence.current ||
        scope !== fileLinkScopeRef.current ||
        epoch !== generation.current
      )
        return;
      if (sameProjectPath(file.path, launch.cwd)) return;
      setLinkedFile({ scope, file });
      setBrowserOpen(false);
      setCodeReviewOpen(true);
      if (btwUIRef.current.open && btwUIRef.current.surface === "history") closeBtw(false);
    },
    [fileLinkScope, launch.cwd],
  );
  /** 通过当前项目解析图片引用并读取白名单图片；会话变化会更换入口以失效旧悬停。[in] href：编码后的文件链接。返回值：真实图片字节与类型。 */
  const previewMessageFile = useCallback(
    async (href: string) => {
      const file = await window.desktop.resolveProjectFileLink(href, launch.cwd);
      return window.desktop.readProjectImage(file.path);
    },
    [fileLinkScope, launch.cwd],
  );
  /** 确认工具输出里的路径是当前项目中的真实文件；不存在或无法访问时按 false 处理，输出保持纯文本。[in] path：输出中的路径。返回值：是否为存在的文件。 */
  const probeOutputFile = useCallback(
    async (path: string) => {
      try {
        const entry = await window.desktop.resolveProjectFileLink(messageFileHref(path), launch.cwd);
        return entry.kind === "file";
      } catch {
        return false;
      }
    },
    [fileLinkScope, launch.cwd],
  );
  const closeFileMenu = useCallback(() => setFileMenu(undefined), []);
  /** 右键文件链接：主进程核实路径后在指针处弹出菜单。 */
  const openFileMenu = useCallback(
    async (href: string, x: number, y: number): Promise<void> => {
      const entry = await window.desktop.resolveProjectFileLink(
        href,
        launch.cwd,
      );
      setFileMenu({ href, entry, x, y });
    },
    [launch.cwd],
  );
  useEffect(() => setFileMenu(undefined), [launch.cwd, fileLinkScope]);
  const browserSuspended = Boolean(modal || extensionRequests.length || sessionMenu || fileMenu || sidebarOpen || btwMenuOpen || (btwUI.open && btwUI.surface === "history"));
  /** 网页导航独立于引擎；新点击使先前的文件解析失效。 */
  const openWebLink = useCallback(async (url: string): Promise<"opened" | "deferred"> => {
    const overview = btwUIRef.current.open && btwUIRef.current.surface === "history" ? btwUIRef.current : undefined;
    if (commentRevealRef.current) cancelCommentReveal();
    plan.hide();
    fileLinkSequence.current += 1;
    browserTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBrowserStarted(true);
    setBrowserOpen(true);
    await window.desktop.openBrowser(url);
    if (overview && btwUIRef.current === overview) { closeBtw(false); return "opened"; }
    return browserSuspended ? "deferred" : "opened";
  }, [browserSuspended]);
  function hideBrowser() {
    if (commentRevealRef.current?.panel === "web") cancelCommentReveal();
    setBrowserOpen(false);
    const trigger = browserTrigger.current;
    (trigger?.isConnected ? trigger : browserButton.current)?.focus();
  }
  const predictionSetting = usePromptPredictionSetting();
  const predicted = usePromptPrediction({
    enabled: predictionSetting.enabled && !contextComment,
    connected,
    view,
    draft,
  });
  const modelDisabled =
    !canCompose || view.busy || plan.snapshot?.phase === "applying" || pending || Boolean(loadingHistory);
  const displayedModel = connected ? view.state : preparedModel;
  useEffect(() => {
    if (!roleCycle) return;
    const timer = window.setTimeout(() => setRoleCycle(null), 4000);
    return () => window.clearTimeout(timer);
  }, [roleCycle]);
  useEffect(() => {
    setRoleCycle(null);
  }, [launch.cwd, readOnlyPath, view.state?.sessionId, view.busy]);
  useEffect(() => {
    if (!pending && !modal && !btwUIRef.current.open && restoreComposerFocus.current) {
      restoreComposerFocus.current = false;
      composer.current?.focus();
    }
  }, [pending, modal, btwUI.open]);
  const activePath = new Set<string>();
  let ancestor = leaf;
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  while (ancestor && !activePath.has(ancestor)) {
    activePath.add(ancestor);
    ancestor = entryMap.get(ancestor)?.parentId ?? null;
  }
  const btwScope = ensureBtwScope();
  const btwOpen = btwUI.open;
  const btwRecords = view.records.filter((record) => {
    const owner = btwOwners.current.get(record.id);
    return owner?.scope === btwScope.key && owner.epoch === btwContextEpoch.current;
  });
  const btwSlot = btwScope.selectedId ?? BTW_NEW_TOPIC;
  const btwDraft = getBtwDraft(btwScope, btwSlot);
  const currentTopic = btwRecords.find((record) => record.id === btwScope.selectedId);
  const runningTopic = btwRecords.find((record) => (record.followUps?.at(-1) ?? record).status === "running");
  const btwSubmitting = submissionRef.current?.scope === btwScope.key;
  const btwMissing = Boolean(btwScope.selectedId && btwScope.history === "ready" && !currentTopic);
  const btwError = btwMissing ? "该旁问主题已不存在，请新建主题后重试" : btwScope.operationError ?? btwScope.errors.get(btwSlot) ?? btwScope.historyError ?? (currentTopic?.followUps?.at(-1) ?? currentTopic)?.error;
  const btwStatus = btwSubmitting ? "旁问 · 正在提交" : runningTopic ? `旁问 · 回答中（后台继续）${btwScope.storageError ? " · 旁问历史保存失败" : ""}${btwScope.operationError ? " · 操作失败，请展开查看" : ""}` : btwScope.storageError ? "旁问历史保存失败" : btwError ? "旁问失败" : btwDraft.text.trim() ? "旁问 · 草稿已保留" : (() => {
    const record = currentTopic ?? btwRecords[0];
    if (!record) return "";
    const status = (record.followUps?.at(-1) ?? record).status;
    return status === "complete" ? "" : status === "cancelled" ? "旁问 · 已停止" : status === "error" ? "旁问失败" : "旁问 · 进程中断";
  })();
  const commandList = [
    ...builtinCommands,
    ...view.commands.filter(
      (command) =>
        !builtinCommands.some((builtin) => builtin.name === command.name),
    ),
  ];
  const [slashSelection, setSlashSelection] = useState({ query: "", index: 0 });
  const slashMatches =
    draft.startsWith("/") && !draft.includes("\n") && !draft.includes(" ")
      ? commandList
          .filter(
            (command) =>
              command.name.startsWith(draft.slice(1)) ||
              command.aliases?.some((alias) =>
                alias.startsWith(draft.slice(1)),
              ),
          )
          .slice(0, 8)
      : [];
  const slashIndex =
    slashSelection.query === draft
      ? Math.min(slashSelection.index, Math.max(0, slashMatches.length - 1))
      : 0;
  useEffect(() => {
    document
      .querySelector('.slash-menu [aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [draft, slashIndex]);
  // 只读快照直接携带最新回顾；连接后按当前会话身份取目录摘要，避免跨会话复用。
  const selectedSummary =
    view.connection === "readonly"
      ? readOnlySummary
      : sessions.find(
          (session) =>
            session.path === view.state?.sessionFile &&
            session.id === view.state?.sessionId &&
            session.cwd === launch.cwd,
        );
  const recap =
    selectedSummary &&
    selectedSummary.path === view.state?.sessionFile &&
    selectedSummary?.id === view.state?.sessionId
      ? selectedSummary.recap
      : undefined;
  const visibleSessions = sessions.filter((session) =>
    `${session.title} ${session.cwd} ${session.path}`
      .toLowerCase()
      .includes(sessionSearch.toLowerCase()),
  );
  // 分组和排序始终使用完整原始目录；搜索只决定显示哪些组及组内会话。
  const sessionGroups = new Map<
    string,
    { cwd: string; name: string; caption?: string; sessions: SessionSummary[] }
  >();
  const catalogueOrder = Array.from(
    new Set(sessions.map((session) => session.cwd)),
  );
  const liveProjects = new Set(catalogueOrder);
  const knownProjects = new Set(projectOrder ?? []);
  const liveProjectOrder =
    projectOrder === null
      ? catalogueOrder
      : [
          ...projectOrder.filter((cwd) => liveProjects.has(cwd)),
          ...catalogueOrder.filter((cwd) => !knownProjects.has(cwd)),
        ];
  const projectRoots = new Map<string, string[]>();
  // 同名目录集合来自全部会话，保证搜索前后的可见项目标识一致。
  for (const cwd of catalogueOrder) {
    const name = projectName(cwd);
    const roots = projectRoots.get(name) ?? [];
    roots.push(cwd);
    projectRoots.set(name, roots);
    if (!projectRegionIds.current.has(cwd)) {
      projectRegionIds.current.set(
        cwd,
        `${projectId}-project-${projectRegionIds.current.size}`,
      );
    }
  }
  for (const session of visibleSessions) {
    let group = sessionGroups.get(session.cwd);
    if (!group) {
      const name = projectName(session.cwd);
      group = {
        cwd: session.cwd,
        name,
        caption: projectParentCaption(session.cwd, projectRoots.get(name)!),
        sessions: [],
      };
      sessionGroups.set(session.cwd, group);
    }
    group.sessions.push(session);
  }

  useEffect(
    /** 保留手动次序并追加新目录，缺失目录仅暂时隐藏。参数：无。返回值：无。 */
    function reconcileProjectOrder() {
      setProjectOrder((order) => {
        if (order === null) return order;
        const known = new Set(order);
        const added = Array.from(
          new Set(sessions.map((session) => session.cwd)),
        ).filter((cwd) => !known.has(cwd));
        return added.length ? [...order, ...added] : order;
      });
    },
    [sessions],
  );

  useLayoutEffect(
    /** 在目录移动提交后保持键盘焦点。参数：无。返回值：无。 */
    function restoreProjectFocus() {
      projectFocusAfterMove.current?.focus();
      projectFocusAfterMove.current = null;
    },
    [projectOrder],
  );

  /** 更新共享搜索并清空本次搜索的折叠覆盖。[in] query：新搜索文本。返回值：无。 */
  function changeSessionSearch(query: string) {
    setSessionSearch(query);
    setSearchCollapsedProjects(new Set());
    setSelectedSessionPaths(new Set());
    setSessionMenu(undefined);
  }

  /** 切换目录会话显示，不改变原生会话。[in] event：按钮点击事件；[in] cwd：完整原始目录。返回值：无。 */
  function toggleProject(
    event: ReactMouseEvent<HTMLButtonElement>,
    cwd: string,
  ) {
    // 拖动产生的尾随点击不可折叠；新的指针按下或键盘点击仍正常工作。
    if (event.detail > 0 && suppressProjectClick.current) {
      suppressProjectClick.current = false;
      return;
    }
    setSelectedProject(cwd);
    const setCollapsed = sessionSearch
      ? setSearchCollapsedProjects
      : setCollapsedProjects;
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  }

  /** 仅移动完整目录列表中的显示位置。[in] source：源目录；[in] target：目标目录；[in] position：目标前或后。返回值：无。 */
  function moveProject(
    source: string,
    target: string,
    position: "before" | "after",
  ) {
    if (
      source === target ||
      !liveProjects.has(source) ||
      !liveProjects.has(target)
    )
      return;
    // 过滤搜索时仍在完整列表中移动，未移动目录保持彼此的相对顺序。
    const next = liveProjectOrder.filter((cwd) => cwd !== source);
    const index = next.indexOf(target) + (position === "after" ? 1 : 0);
    next.splice(index, 0, source);
    setProjectOrder(next);
  }

  /** 用键盘移动当前目录并保留焦点。[in] event：按钮键盘事件；[in] cwd：完整原始目录。返回值：无。 */
  function reorderProjectByKey(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    cwd: string,
  ) {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown"))
      return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === "ArrowUp" ? -1 : 1;
    const target = liveProjectOrder[liveProjectOrder.indexOf(cwd) + direction];
    if (target === undefined) return;
    projectFocusAfterMove.current = event.currentTarget;
    moveProject(cwd, target, direction < 0 ? "before" : "after");
  }

  const {
    list: projectList,
    start: startProjectPointer,
    draggedProject,
    projectDrop,
  } = useProjectDrag(moveProject, suppressProjectClick);

  /** 将真实失败记录到会话日志并显示于现有连接提示。[in] error：异常。返回值：无。 */
  const report = useCallback((error: unknown) => {
    if (error instanceof NotifiedPlanError) return;
    dispatch({
      type: "log",
      text: error instanceof Error ? error.message : String(error),
      error: true,
    });
  }, []);
  const mentions = useFileMentions({
    draft,
    cwd: launch.cwd,
    scope: JSON.stringify([readOnlyPath, view.state?.sessionId, view.state?.sessionFile]),
    input: composer,
    setDraft,
    report,
    enabled: canCompose && !btwOpen && !pending && !loadingHistory && !modal && !contextComment,
  });
  /** 只在本会话仍可编辑时追加快照；不经过发送、连接或附件修改路径。 */
  const appendPromptContext = (context: PromptContext) => {
    if (fileLinkScope !== fileLinkScopeRef.current || contextEpoch !== generation.current) throw new Error("会话已变化，请重新选择引用");
    if (!canCompose || pending || loadingHistory) throw new Error("当前无法编辑提示词，请稍后重试");
    const formatted = formatPromptContext(context);
    focusAppendedContext.current = true;
    closeBtw(false);
    setDraft((current) => current ? current + (current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n") + formatted : formatted);
  };
  const promptContextActions: PromptContextActions = {
    append: (context) => {
      if (contextCommentRef.current) throw new Error("请先完成或取消当前评论");
      if (modal || extensionRequests.length) throw new Error("请先关闭当前对话框");
      appendPromptContext(context);
    },
    comment: (context, anchor, trigger, sourceAnchor) => {
      if (contextCommentRef.current) throw new Error("请先完成或取消当前评论");
      if (modal || extensionRequests.length) throw new Error("请先关闭当前对话框");
      if (fileLinkScope !== fileLinkScopeRef.current || contextEpoch !== generation.current) throw new Error("会话已变化，请重新选择引用");
      if (!canCompose || pending || loadingHistory) throw new Error("当前无法编辑提示词，请稍后重试");
      validatePromptContext(context);
      // 快照仅含可序列化数据；Range 等来源锚点单独保存。
      const snapshot: PromptContext = structuredClone(context);
      const value = { context: snapshot, anchor, trigger, sourceAnchor, editorId: crypto.randomUUID(), comment: "", scope: fileLinkScope, epoch: generation.current, draftId: commentDraft.current.current.id };
      contextCommentRef.current = value;
      if (commentRevealRef.current) cancelCommentReveal();
      setContextComment(value);
      setNativeCommentError(undefined);
    },
  };
  contextActionsRef.current = promptContextActions;
  const cancelContextComment = () => {
    const previous = contextCommentRef.current;
    contextCommentRef.current = undefined;
    setContextComment(undefined);
    restoreContextFocus.current = previous && ["web", "pdf", "web-region"].includes(previous.context.kind) ? browserButton.current : previous?.trigger ?? null;
  };
  const editPendingComment = (entry: DraftComment, anchor: { x: number; y: number }, trigger?: HTMLElement, unavailableReason?: string, snapshotOnly = false) => {
    if (contextCommentRef.current) return;
    if (commentRevealRef.current) cancelCommentReveal();
    const value = { context: entry.context, anchor, trigger, sourceAnchor: entry.sourceAnchor, entryId: entry.id, editorId: crypto.randomUUID(), comment: entry.comment, scope: fileLinkScopeRef.current, epoch: generation.current, draftId: commentDraft.current.current.id, unavailableReason, snapshotOnly };
    contextCommentRef.current = value;
    setContextComment(value);
    setNativeCommentError(unavailableReason);
    if ((entry.sourceAnchor?.kind === "web" || entry.sourceAnchor?.kind === "pdf") && !snapshotOnly) { setBrowserStarted(true); setBrowserOpen(true); }
  };
  const cancelCommentReveal = () => {
    const previous = commentRevealRef.current;
    commentRevealRef.current = undefined;
    setRevealingCommentId(undefined);
    setLocalCommentReveal(undefined);
    if (previous?.browserScope) void window.desktop.cancelBrowserCommentReveal(previous.requestId).catch(report);
  };
  const currentReveal = (request: PendingCommentReveal) => {
    const current = commentDraft.current.current;
    return commentRevealRef.current === request && current.id === request.draftId &&
      request.epoch === generation.current && request.scope === fileLinkScopeRef.current && request.fileSequence === fileLinkSequence.current &&
      activeDraftComments(current).some((entry) => entry.id === request.entry.id && entry.revision === request.entry.revision);
  };
  const finishCommentReveal = (request: PendingCommentReveal, anchor = request.anchor, trigger = request.trigger, reason?: string, snapshotOnly = false) => {
    if (!currentReveal(request)) return;
    commentRevealRef.current = undefined;
    setRevealingCommentId(undefined);
    setLocalCommentReveal(undefined);
    editPendingComment(request.entry, anchor, trigger, reason, snapshotOnly);
  };
  const revealPendingComment = async (entry: DraftComment, anchor: { x: number; y: number }, trigger?: HTMLElement) => {
    if (contextCommentRef.current) { report(new Error("请先保存或取消当前评论")); return; }
    cancelCommentReveal();
    const request: PendingCommentReveal = { requestId: crypto.randomUUID(), entry, draftId: commentDraft.current.current.id, epoch: generation.current, scope: fileLinkScopeRef.current, anchor, trigger, fileSequence: fileLinkSequence.current };
    commentRevealRef.current = request;
    setRevealingCommentId(entry.id);
    try {
      if (entry.sourceAnchor?.kind === "web" || entry.sourceAnchor?.kind === "pdf") {
        const scope = browserContextScopeRef.current;
        if (!scope) { finishCommentReveal(request, anchor, trigger, "来源当前不可定位", true); return; }
        request.browserScope = scope;
        const browserState = await window.desktop.getBrowserState();
        if (!currentReveal(request)) { if (commentRevealRef.current === request) cancelCommentReveal(); return; }
        if (!browserState.url) { finishCommentReveal(request, anchor, trigger, "原网页已关闭", true); return; }
        request.panel = "web";
        plan.hide();
        setBrowserStarted(true);
        setBrowserOpen(true);
        const result = await window.desktop.revealBrowserComment({ scope, requestId: request.requestId, entryId: entry.id, documentId: entry.sourceAnchor.documentId, anchorId: entry.sourceAnchor.anchorId });
        if (!currentReveal(request)) { if (commentRevealRef.current === request) cancelCommentReveal(); return; }
        finishCommentReveal(request, anchor, trigger, result.status === "unavailable" ? result.reason : undefined);
      } else if (entry.sourceAnchor?.kind === "local") {
        const file = await window.desktop.resolveProjectFileLink(messageFileHref(entry.sourceAnchor.path), launchRef.current.cwd, true);
        if (!currentReveal(request)) { if (commentRevealRef.current === request) cancelCommentReveal(); return; }
        request.panel = "local";
        plan.hide();
        setBrowserOpen(false);
        setCodeReviewOpen(true);
        setLocalCommentReveal({ requestId: request.requestId, entryId: entry.id, file, sourceAnchor: entry.sourceAnchor });
      } else finishCommentReveal(request, anchor, trigger, "此引用没有可定位的来源", true);
    } catch (error) {
      if (currentReveal(request)) finishCommentReveal(request, anchor, trigger, error instanceof Error ? error.message : String(error), true);
    }
  };
  const localRevealResult = useRef<(result: LocalCommentRevealResult) => void>(() => {});
  localRevealResult.current = (result) => {
    const request = commentRevealRef.current;
    if (!request || result.requestId !== request.requestId) return;
    if (result.status === "located") finishCommentReveal(request, result.screenAnchor, result.trigger);
    else if (result.status === "cancelled") cancelCommentReveal();
    else finishCommentReveal(request, request.anchor, request.trigger, result.reason, true);
  };
  const onLocalCommentReveal = useCallback((result: LocalCommentRevealResult) => localRevealResult.current(result), []);
  const removePendingComment = (id: string) => {
    const entries = commentDraft.activeComments;
    const index = entries.findIndex((entry) => entry.id === id);
    const nextId = entries[index + 1]?.id ?? entries[index - 1]?.id;
    const draftId = commentDraft.current.current.id;
    if (commentRevealRef.current?.entry.id === id) cancelCommentReveal();
    if (contextCommentRef.current?.entryId === id) { contextCommentRef.current = undefined; setContextComment(undefined); restoreContextFocus.current = null; }
    commentDraft.removeComment(id);
    requestAnimationFrame(() => {
      if (commentDraft.current.current.id !== draftId) return;
      const next = [...document.querySelectorAll<HTMLButtonElement>("[data-comment-edit]")].find((button) => button.dataset.commentEdit === nextId);
      (next ?? composer.current)?.focus();
    });
  };
  useLayoutEffect(() => {
    const request = commentRevealRef.current;
    if (request && (!currentReveal(request) || modal || extensionRequests.length || (request.panel === "web" && !browserOpen) || (request.panel === "local" && !codeReviewOpen))) cancelCommentReveal();
    const editor = contextCommentRef.current;
    if (editor?.entryId && !commentDraft.activeComments.some((entry) => entry.id === editor.entryId)) {
      contextCommentRef.current = undefined;
      setContextComment(undefined);
    }
  }, [commentDraft.state, fileLinkScope, contextEpoch, browserOpen, codeReviewOpen, modal, extensionRequests.length]);
  const confirmContextComment = (comment: string) => {
    const current = contextCommentRef.current;
    if (!current || current.draftId !== commentDraft.current.current.id) throw new Error("草稿已变化，请重新选择引用");
    if (!canCompose || pending || loadingHistory || modal || extensionRequests.length) throw new Error("当前无法编辑提示词");
    if (current.entryId) commentDraft.editComment(current.entryId, comment);
    else commentDraft.addComment(current.context, comment, current.sourceAnchor);
    focusAppendedContext.current = true;
    closeBtw(false);
    contextCommentRef.current = undefined;
    setContextComment(undefined);
  };
  const [nativeCommentError, setNativeCommentError] = useState<string>();
  const nativeComment = contextComment && (contextComment.sourceAnchor?.kind === "web" || contextComment.sourceAnchor?.kind === "pdf") && !contextComment.snapshotOnly;
  const browserCommentHandler = useRef<(event: BrowserCommentEvent) => void>(() => {});
  browserCommentHandler.current = (event) => {
    if (event.scope !== browserContextScopeRef.current) return;
    if (event.type === "marker") {
      const entry = commentDraft.activeComments.find((item) => item.id === event.id);
      if (entry) editPendingComment(entry, { x: 16, y: 48 });
      return;
    }
    const current = contextCommentRef.current;
    if (!current || current.editorId !== event.editorId || current.draftId !== commentDraft.current.current.id) return;
    if (event.type === "change") {
      const next = { ...current, comment: event.comment };
      contextCommentRef.current = next;
      // 原生编辑器持有即时输入；不按键回传整张不可变截图，避免重复复制最高 20MiB。
      setNativeCommentError(undefined);
    } else if (event.type === "cancel") cancelContextComment();
    else {
      try { confirmContextComment(event.comment); setNativeCommentError(undefined); }
      catch (error) { setNativeCommentError(error instanceof Error ? error.message : String(error)); }
    }
  };
  useEffect(() => window.desktop.onBrowserCommentEvent?.((event) => browserCommentHandler.current(event)), []);
  useEffect(() => {
    if (!window.desktop.setBrowserCommentEditor) return;
    const current = contextCommentRef.current;
    const payload: BrowserCommentEditor | null = nativeComment && browserOpen && (current?.sourceAnchor?.kind === "web" || current?.sourceAnchor?.kind === "pdf") && browserContextScope
      ? { scope: browserContextScope, editorId: current.editorId, sourceAnchor: current.sourceAnchor, source: "url" in current.context ? current.context.title || current.context.url : "", ...("image" in current.context && current.context.image ? { image: current.context.image } : {}), comment: current.comment, editing: Boolean(current.entryId), theme: "light", fontSize: interfaceFont.fontSize, error: nativeCommentError }
      : null;
    void window.desktop.setBrowserCommentEditor(payload).catch(report);
  }, [nativeComment, browserOpen, contextComment, browserContextScope, interfaceFont.fontSize, nativeCommentError, report]);
  useEffect(() => {
    if (!window.desktop.syncBrowserCommentMarkers) return;
    const markers = browserContextScope ? commentDraft.activeComments.flatMap((entry) => entry.sourceAnchor?.kind === "web" || entry.sourceAnchor?.kind === "pdf" ? [{ scope: browserContextScope, id: entry.id, number: entry.number, sourceAnchor: entry.sourceAnchor }] : []) : [];
    void window.desktop.syncBrowserCommentMarkers(markers).catch(report);
  }, [commentDraft.state, browserContextScope, report]);
  useLayoutEffect(() => {
    if (!contextComment && restoreContextFocus.current) {
      const trigger = restoreContextFocus.current;
      restoreContextFocus.current = null;
      if (trigger.isConnected) trigger.focus();
    }
  }, [contextComment]);
  useLayoutEffect(() => {
    if (!focusAppendedContext.current || !composer.current || btwUIRef.current.open || composer.current.disabled) return;
    focusAppendedContext.current = false;
    const input = composer.current;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    mentions.observe(input);
  }, [draft, commentDraft.state.revision, mentions.observe, btwOpen, pending, loadingHistory]);
  useLayoutEffect(() => {
    const input = composer.current;
    if (btwOpen || !btwRestoreFocus.current || !input || input.disabled) return;
    btwRestoreFocus.current = false;
    const saved = btwMainSelection.current;
    input.focus({ preventScroll: true });
    if (saved) {
      input.setSelectionRange(Math.min(saved.start, input.value.length), Math.min(saved.end, input.value.length), saved.direction);
      input.scrollTop = saved.top;
    }
  }, [btwOpen, pending, connecting, loadingHistory, view.connection, canCompose]);
  useEffect(() => {
    const cancel = (event: FocusEvent) => {
      if (btwRestoreFocus.current && event.target instanceof HTMLElement && event.target !== composer.current && !event.target.closest("[hidden]")) btwRestoreFocus.current = false;
    };
    document.addEventListener("focusin", cancel);
    return () => document.removeEventListener("focusin", cancel);
  }, []);
  useLayoutEffect(() => {
    const current = contextCommentRef.current;
    if (current && (current.draftId !== commentDraft.state.id || modal || extensionRequests.length)) {
      contextCommentRef.current = undefined;
      setContextComment(undefined);
    }
  }, [commentDraft.state.id, modal, extensionRequests.length]);
  useEffect(() => {
    if (!browserStarted) return;
    const desktop = window.desktop;
    const scope = crypto.randomUUID();
    const epoch = generation.current;
    let active = true;
    browserContextScopeRef.current = scope;
    setBrowserContextScope(null);
    // 先订阅再注册，保证主进程永远不会向尚未监听的 renderer 投递。
    const unsubscribe = desktop.onBrowserContext((value) => {
      if (!active || value.scope !== scope || browserContextScopeRef.current !== scope || epoch !== generation.current || fileLinkScope !== fileLinkScopeRef.current) return;
      const bounds = document.querySelector(".browser-panel")?.getBoundingClientRect();
      try { contextActionsRef.current?.comment(value.context, { x: bounds?.left ?? 16, y: bounds?.top ?? 48 }, browserButton.current ?? undefined, value.sourceAnchor); }
      catch (error) { report(error); }
    });
    void desktop.setBrowserContextScope(scope).then(() => {
      if (active && epoch === generation.current) setBrowserContextScope(scope);
    }).catch((error: unknown) => { if (active) report(error); });
    return () => {
      active = false;
      browserContextScopeRef.current = null;
      unsubscribe();
      void desktop.setBrowserContextScope(null).catch(report);
    };
  }, [browserStarted, fileLinkScope, contextEpoch, report]);

  /** 串行刷新原生状态及当前分支完整历史，保留压缩前的记录；不混合不同 durable snapshot。 */
  const refreshOperation = useCallback(async (token: number) => {
    try {
      do {
        refreshAgain.current = false;
        const messageSnapshot = messageEpoch.current;
        const btwContextSnapshot = btwContextEpoch.current;
        const state = await window.desktop.request<SessionState>({
          type: "get_state",
        });
        if (token !== generation.current) return;
        if (messageSnapshot !== messageEpoch.current) {
          refreshAgain.current = true;
          continue;
        }
        dispatch({ type: "state", state });
        viewRef.current = sessionReducer(viewRef.current, { type: "state", state });
        if (
          state.isStreaming ||
          state.isCompacting ||
          state.isSettled === false
        )
          continue;
        setLoadingHistory("读取原生会话…");
        // get_messages(_page) 是压缩后的模型上下文；聊天历史须按原生 leaf 恢复父链。
        const snapshot = await window.desktop.request<SessionHistorySnapshot>({
          type: "get_entries",
        });
        if (token !== generation.current) return;
        const messages = sessionHistoryMessages(snapshot);
        const btwSnapshot = btwEpoch.current;
        const [after, history] = await Promise.all([
          window.desktop.request<SessionState>({ type: "get_state" }),
          window.desktop.request<{ records: BtwRecord[] }>({
            type: "get_btw_history",
          }).catch((error: unknown) => {
            if (token === generation.current && btwContextSnapshot === btwContextEpoch.current) {
              const scope = ensureBtwScope({ sessionId: state.sessionId, sessionFile: state.sessionFile, cwd: launchRef.current.cwd, agentDir: launchRef.current.agentDir, profile: launchRef.current.profile });
              scope.history = "error"; scope.historyError = error instanceof Error ? error.message : String(error); renderBtw();
            }
            return undefined;
          }),
        ]);
        if (token !== generation.current) return;
        if (messageSnapshot !== messageEpoch.current) {
          refreshAgain.current = true;
          continue;
        }
        // 启动了新流或分支发生变化时，不用旧快照覆盖已接收的消息。
        if (
          after.sessionId !== state.sessionId ||
          after.messageCount !== state.messageCount ||
          after.isStreaming ||
          after.isCompacting ||
          after.isSettled === false
        ) {
          dispatch({ type: "state", state: after });
          if (
            !after.isStreaming &&
            !after.isCompacting &&
            after.isSettled !== false
          )
            refreshAgain.current = true;
          continue;
        }
        if (history && btwEpoch.current === btwSnapshot && btwContextSnapshot === btwContextEpoch.current) {
          const scope = ensureBtwScope({ sessionId: after.sessionId, sessionFile: after.sessionFile, cwd: launchRef.current.cwd, agentDir: launchRef.current.agentDir, profile: launchRef.current.profile });
          applyBtwHistory(scope, history.records);
        }
        dispatch({
          type: "history",
          state: after,
          messages,
          todoPhases: sessionHistoryTodos(snapshot),
        });
      } while (refreshAgain.current && token === generation.current);
    } finally {
      refreshInFlight.current = null;
      if (token === generation.current) setLoadingHistory("");
      else if (
        refreshAgain.current &&
        viewRef.current.connection === "connected"
      ) {
        void refreshRef.current?.().catch(report);
      }
    }
  }, [report]);
  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlight.current) {
      refreshAgain.current = true;
      return refreshInFlight.current;
    }
    if (viewRef.current.connection !== "connected") return Promise.resolve();
    // 所有调用者等待同一轮刷新（包含追加轮次），不能在切换仍未回显时清除 pending。
    const promise = Promise.resolve(generation.current).then(refreshOperation);
    refreshInFlight.current = promise;
    return promise;
  }, [refreshOperation]);
  refreshRef.current = refresh;

  /**
   * 枚举所有工作区的 CLI 会话并更新真实摘要。
   * [in] options：当前 CLI 配置；[in] order：最近修改排序，或恢复会话时保留已有路径次序。
   * 返回值：目录读取完成并提交状态更新请求的 Promise。
   */
  async function reloadSessions(
    options = launchRef.current,
    order: "recent" | "preserve" = "recent",
  ) {
    const result = await window.desktop.listSessions(options.agentDir);
    if (order === "recent") {
      setSessions(result.sort((a, b) => b.modified - a.modified));
      return;
    }
    // 原生修改时间变化时仅替换摘要，避免把正在点击的行及项目移到前面。
    setSessions(
      /** 按现有路径协调新目录，删除缺失项并追加新增项。[in] current：当前会话目录。返回值：使用新摘要的稳定次序目录。 */
      function reconcileSessions(current) {
        const remaining = new Map<string, SessionSummary>();
        for (const session of result) {
          remaining.set(session.path, session);
        }
        const reconciled: SessionSummary[] = [];
        for (const session of current) {
          const fresh = remaining.get(session.path);
          if (fresh) {
            reconciled.push(fresh);
            remaining.delete(session.path);
          }
        }
        reconciled.push(...remaining.values());
        return reconciled;
      },
    );
  }

  /** 重命名侧边栏会话；租约与持久化由主进程和原生会话管理器负责。 */
  async function renameSession(session: SessionSummary, name: string) {
    await window.desktop.renameSession(
      session.path,
      name,
      launchRef.current.agentDir,
    );
    await reloadSessions(launchRef.current, "preserve");
  }

  /** 批量逐项沿用原生租约删除；单项失败不阻断其他项，只刷新一次目录。 */
  async function deleteSessions(targets: readonly SessionSummary[]): Promise<SessionDeletionResult[]> {
    const results: SessionDeletionResult[] = [];
    const currentPath = viewRef.current.state?.sessionFile;
    if (currentPath && targets.some((session) => sameProjectPath(session.path, currentPath))) invalidateBtw();
    for (const session of targets) {
      try {
        await window.desktop.deleteSession(session.path, launchRef.current.agentDir);
        results.push({ path: session.path });
      } catch (error) {
        results.push({ path: session.path, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const deleted = new Set(results.filter((result) => !result.error).map((result) => result.path));
    for (const [key, scope] of btwScopes.current) {
      if (scope.identity.sessionFile && [...deleted].some((path) => sameProjectPath(path, scope.identity.sessionFile!))) btwScopes.current.delete(key);
    }
    setSelectedSessionPaths((previous) => new Set([...previous].filter((path) => !deleted.has(path))));
    if (currentPath && deleted.has(currentPath)) {
      generation.current += 1;
      readOnlyRef.current = undefined;
      setReadOnlyPath(undefined);
      setConnection(undefined);
      connectionRef.current = undefined;
      setRunStart(undefined);
      setTranscriptEpoch((current) => current + 1);
      viewRef.current = sessionReducer(viewRef.current, { type: "reset" });
      dispatch({ type: "reset" });
    }
    try { await reloadSessions(launchRef.current, "preserve"); } catch (error) { report(error); }
    return results;
  }

  /** 右键咨询只选择源会话，不切换当前输出目标。 */
  async function openSeance(source?: string, model?: string) {
    setSeanceArgs({ source, model });
    setModal("seance");
  }

  async function openSessionConsultation(targets: readonly SessionSummary[]) {
    if (targets.length === 1) {
      await openSeance(targets[0].path);
    } else {
      setSeanceSources(targets);
      setModal("seance-batch");
    }
  }

  /** 一次批量 admission，原生分别派生子代理并遵守自身并发上限。 */
  async function launchSeances(requests: readonly SeanceConsultation[]): Promise<SeanceBatchItem[]> {
    if (viewRef.current.busy || loadingHistory)
      throw new Error("请等待当前会话完全空闲后再启动批量咨询。");
    if (viewRef.current.connection !== "connected") await connectCurrentSession(true);
    const token = generation.current;
    const results = await window.desktop.runSeances(requests);
    if (token === generation.current) await refresh();
    return results;
  }

  const loadSeanceModels = useCallback(async () => {
    await window.desktop.prepareModels({ ...launchRef.current, sessionPath: undefined });
    const result = await window.desktop.modelRequest<{ models: ModelInfo[] }>({
      type: "get_available_models",
    });
    return result.models;
  }, []);

  /** 按用户确认连接输出目标，源会话仅由原生 seance 子代理只读派生。 */
  async function launchSeance(source: string, model?: string) {
    if (viewRef.current.busy || loadingHistory)
      throw new Error("请等待当前会话完全空闲后再启动咨询。");
    if (viewRef.current.connection !== "connected" && !(await connectCurrentSession()))
      throw new Error("未连接输出会话，咨询未启动。");
    const token = generation.current;
    await window.desktop.runSeance(source, model);
    if (token !== generation.current) return;
    await refresh();
    setModal(null);
  }

  /** 包装需要独占交互的动作并显式报告错误。[in] action：真实引擎动作。返回值：完成的 Promise。 */
  async function perform(action: () => Promise<unknown>, exclusive = true) {
    if (exclusive) setPending(true);
    try {
      await action();
    } catch (error) {
      report(error);
    } finally {
      if (exclusive) setPending(false);
    }
  }

  function saveSessionDraft() {
    const key = readOnlyRef.current ?? viewRef.current.state?.sessionFile ?? "";
    const input = composer.current;
    sessionDrafts.current.set(key, { state: commentDraft.current.current, images: draftImagesRef.current,
      selection: input ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : undefined });
  }

  function restoreSessionDraft(path: string) {
    const saved = sessionDrafts.current.get(path);
    if (saved) { commentDraft.restore(saved.state); setDraftImages(saved.images); }
    else { resetDraft(); setDraftImages([]); }
    requestAnimationFrame(() => {
      if ((readOnlyRef.current ?? viewRef.current.state?.sessionFile ?? "") !== path || !saved?.selection) return;
      composer.current?.setSelectionRange(saved.selection.start, saved.selection.end, saved.selection.direction);
    });
  }

  /** 连接真实子进程并重置旧会话及内嵌审阅；恢复时保持导航次序。[in] options：启动参数（可含导入路径）。返回值：完成的 Promise。 */
  async function connect(options: LaunchOptions, behavior: { preserveDraft?: boolean; preserveModal?: boolean; preserveBtwRequestId?: number } = {}) {
    if (connectingRef.current) throw new Error("会话正在连接，请稍后重试");
    connectingRef.current = true;
    setConnecting(true);
    try {
    const { preserveDraft = false } = behavior;
    if (!(await plan.protect())) throw new Error("已取消切换会话");
    if (!preserveDraft) saveSessionDraft();
    plan.hide();
    const admission = submissionRef.current;
    const preservedScope = admission && behavior.preserveBtwRequestId === admission.requestId && admission.scope === btwUIRef.current.scopeKey
      ? btwScopes.current.get(admission.scope) : undefined;
    if (!preservedScope) invalidateBtw();
    setTranscriptEpoch((current) => current + 1);
    setRunStart(undefined);
    generation.current += 1;
    const token = generation.current;
    if (!preserveDraft) {
      setConnection(undefined);
      connectionRef.current = undefined;
    }
    setExtensionRequests([]);
    if (!preserveDraft) {
      resetDraft();
      setDraftImages([]);
    }
    setLoadingHistory("");
    stickToBottom.current = true;
    if (!preserveDraft) dispatch({ type: "reset" });
    const result = taskModelChoice.current
      ? await window.desktop.start(
          options,
          modelChoice.current,
          taskModelChoice.current,
        )
      : modelChoice.current
        ? await window.desktop.start(options, modelChoice.current)
        : await window.desktop.start(options);
    taskModelChoice.current = undefined;
    if (token !== generation.current) return;
    readOnlyRef.current = undefined;
    setReadOnlyPath(undefined);
    dispatch({ type: "reset" });
    const actual = { ...options, cwd: result.cwd, sessionPath: undefined };
    setLaunch(actual);
    launchRef.current = actual;
    setConnection(result);
    connectionRef.current = result;
    viewRef.current = { ...initialSession, connection: "connected" };
    dispatch({
      type: "frame",
      frame: { type: "desktop_status", status: "connected" },
    });
    if (!behavior.preserveModal) setModal(null);
    if (preservedScope && admission && submissionRef.current?.requestId === admission.requestId) {
      const state = await window.desktop.request<SessionState>({ type: "get_state" });
      if (token !== generation.current || admission.epoch !== btwContextEpoch.current) return;
      const identity = { ...preservedScope.identity, sessionId: state.sessionId, sessionFile: state.sessionFile, cwd: result.cwd };
      if (preservedScope.identity.sessionId && !sameBtwIdentity(preservedScope.identity, identity)) throw new Error("旁问连接的会话身份已变化，问题未发送");
      preservedScope.identity = identity;
      btwScopeGeneration.current = generation.current;
      const action = { type: "state" as const, state };
      viewRef.current = sessionReducer(viewRef.current, action);
      dispatch(action);
    }
    await refresh();
    const commands = await window.desktop.request<{ commands: SlashCommand[] }>(
      { type: "get_available_commands" },
    );
    if (token !== generation.current) return;
    dispatch({
      type: "frame",
      frame: { type: "available_commands_update", commands: commands.commands },
    });
    await reloadSessions(actual, options.sessionPath ? "preserve" : "recent");
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }

  /** 执行原生状态变更，成功后重置内嵌审阅并重新读取结果。[in] command：RPC 命令。返回值：完成的 Promise。 */
  async function transition(command: RpcCommand) {
    if (command.type === "new_session") {
      await connect({ ...launchRef.current, sessionPath: undefined });
      return;
    }
    if (
      viewRef.current.connection !== "connected" ||
      viewRef.current.busy ||
      loadingHistory
    )
      throw new Error("请等待会话完全空闲后再切换上下文。");
    if (!(await plan.protect())) return;
    plan.hide();
    invalidateBtw();
    let result: { cancelled?: boolean } | undefined;
    try {
      result = await window.desktop.request<{ cancelled?: boolean } | undefined>(command);
    } catch (error) {
      await refresh().catch(report);
      throw error;
    }
    if (result?.cancelled) {
      await refresh();
      throw new Error("原生扩展取消了会话切换；当前会话保持不变。");
    }
    setTranscriptEpoch((current) => current + 1);
    setRunStart(undefined);
    resetDraft();
    setDraftImages([]);
    stickToBottom.current = true;
    await refresh();
    await reloadSessions();
    setModal(null);
  }

  /** 新会话使用独立进程，保留旧会话的执行与待答请求。 */
  async function newProjectSession() {
    const options = launchRef.current;
    const cwd = selectedProject ?? options.cwd;
    await connect({ ...options, cwd, sessionPath: undefined });
    setSelectedSessionPaths(new Set());
    setSessionMenu(undefined);
  }

  /** 导入/继续会话，并使用其原生 header 工作目录启动。[in] session：会话摘要或路径。返回值：完成的 Promise。 */
  async function openSession(session: SessionSummary | string) {
    if (!(await plan.protect())) return;
    plan.hide();
    invalidateBtw();
    const path = typeof session === "string" ? session : session.path;
    saveSessionDraft();
    const previous = readOnlyRef.current;
    readOnlyRef.current = path;
    const token = ++generation.current;
    setLoadingHistory("");
    setPromptSubmitting(false);
    try {
      const { snapshot, engine } = await window.desktop.openSession(path);
      if (token !== generation.current) return;
      setExtensionRequests([]);
      extensionRequestsRef.current = [];
      setReadOnlyPath(engine ? undefined : snapshot.summary.path);
      readOnlyRef.current = engine ? undefined : snapshot.summary.path;
      showReadOnly(snapshot);
      setSelectedProject(snapshot.summary.cwd);
      setConnection(engine?.connection);
      connectionRef.current = engine?.connection;
      if (engine) {
        let restored = sessionReducer(initialSession, { type: "readonly", snapshot });
        restored = { ...restored, connection: "connected" };
        for (const frame of engine.frames) {
          if (frame.type !== "extension_ui_request" && frame.type !== "plan_state")
            restored = sessionReducer(restored, { type: "frame", frame });
        }
        restored = sessionReducer(restored, { type: "state", state: engine.state });
        viewRef.current = restored;
        dispatch({ type: "reset" });
        dispatch({ type: "readonly", snapshot });
        dispatch({ type: "frame", frame: { type: "desktop_status", status: "connected" } });
        for (const frame of engine.frames) frameHandler.current(frame);
        dispatch({ type: "state", state: engine.state });
      }
      restoreSessionDraft(snapshot.summary.path);
      closeBtw(false);
      setJobsOpen(false);
      setRunStart(undefined);
      setTranscriptEpoch((current) => current + 1);
      setModal(null);
      if (engine) {
        const { commands } = await window.desktop.request<{ commands: SlashCommand[] }>({ type: "get_available_commands" });
        if (token !== generation.current) return;
        dispatch({ type: "frame", frame: { type: "available_commands_update", commands } });
        await loadBtwHistory();
        if (token !== generation.current) return;
        await refresh();
      }
      if (token !== generation.current) return;
      await reloadSessions(launchRef.current, "preserve");
    } catch (error) {
      if (token === generation.current) readOnlyRef.current = previous;
      throw error;
    }
    setSidebarOpen(false);
  }

  async function changeSessionEngines(targets: readonly SessionSummary[], start: boolean) {
    const currentPath = readOnlyRef.current ?? viewRef.current.state?.sessionFile;
    const affectsCurrent = targets.some((session) => session.path === currentPath);
    if (!start && affectsCurrent && !(await plan.protect())) return;
    const token = generation.current;
    for (const session of targets) {
      const engines = start
        ? await window.desktop.startSessionEngine({ ...launchRef.current, cwd: session.cwd, sessionPath: session.path })
        : await window.desktop.stopSessionEngine(session.path);
      setSessionEngines(engines);
    }
    if (affectsCurrent && token === generation.current && currentPath) await openSession(currentPath);
  }

  /** 只读刷新替换展示快照及回顾，不创建原生引擎或发送 RPC。[in] snapshot：原生会话快照。返回值：无。 */
  function showReadOnly(snapshot: ReadOnlySession) {
    setReadOnlySummary(snapshot.summary);
    const action = { type: "readonly" as const, snapshot };
    viewRef.current = sessionReducer(viewRef.current, action);
    dispatch(action);
    launchRef.current = { ...launchRef.current, cwd: snapshot.summary.cwd };
    setLaunch(launchRef.current);
  }

  useEffect(() => {
    if (!readOnlyPath || pending) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastError = "";
    async function poll() {
      try {
        const snapshot = await window.desktop.readSession();
        lastError = "";
        if (!disposed && snapshot && readOnlyRef.current === readOnlyPath)
          showReadOnly(snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!disposed && message !== lastError) report(error);
        lastError = message;
      } finally {
        if (!disposed) timer = setTimeout(poll, 1000);
      }
    }
    timer = setTimeout(poll, 1000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [readOnlyPath, pending, report]);

  /** 获取目录/可执行文件选择结果。[in] kind：选择种类。返回值：完成的 Promise。 */
  async function browse(kind: "engine" | "workspace" | "agentDir") {
    const path = await window.desktop.choosePath(kind);
    if (path)
      setLaunch((old) => ({
        ...old,
        [kind === "engine"
          ? "executable"
          : kind === "workspace"
            ? "cwd"
            : "agentDir"]: path,
      }));
  }

  /** 打开会话树或 inclusive checkpoint 列表。[in] target：界面模式。返回值：完成的 Promise。 */
  async function openTree(target: "tree" | "checkpoint" | "rewind") {
    if (
      viewRef.current.connection !== "connected" ||
      viewRef.current.busy ||
      loadingHistory
    )
      throw new Error("请先停止当前工作并等待会话空闲。");
    const history = await window.desktop.request<SessionHistorySnapshot>({
      type: "get_entries",
    });
    setEntries(history.entries);
    setTree(sessionTree(history.entries));
    setLeaf(history.leafId);
    setSelectedEntry(undefined);
    setTreeSearch("");
    setModal(target);
  }

  /** 命令和双 Esc 共用入口，先通过原生租约恢复所选只读会话。 */
  async function openRewind(): Promise<boolean> {
    if (rewindOpening.current) return false;
    rewindOpening.current = true;
    try {
      let resumed = false;
      if (viewRef.current.connection !== "connected" && readOnlyRef.current) {
        if (!(await connectCurrentSession())) return false;
        resumed = true;
      }
      if (
        viewRef.current.connection !== "connected" ||
        (!resumed && !viewRef.current.state?.sessionId)
      ) {
        setModal("session-required");
        return false;
      }
      await openTree("rewind");
      return true;
    } finally {
      rewindOpening.current = false;
    }
  }

  /** 准备独立模型进程；列表允许重新选择，只有循环操作需要先恢复旧选择。 */
  async function prepareModels(
    options = launchRef.current,
    restoreChoice = false,
  ): Promise<void> {
    const token = ++modelLoad.current;
    const state = await window.desktop.prepareModels(
      { ...options, sessionPath: undefined },
      restoreChoice ? modelChoice.current : undefined,
    );
    if (token === modelLoad.current && !modelChoice.current)
      setPreparedModel(state);
  }

  function requestModel<T = unknown>(command: RpcCommand): Promise<T> {
    return viewRef.current.connection === "connected"
      ? window.desktop.request<T>(command)
      : window.desktop.modelRequest<T>(command);
  }

  async function modelHubAction(
    action: NativeModelAction,
  ): Promise<NativeModelSnapshot> {
    if (action.op === "login") {
      await requestModel({ type: "login", providerId: action.provider });
      return modelHubAction({ op: "list" });
    }
    const snapshot = await requestModel<NativeModelSnapshot>({
      type: "model_hub",
      action,
    });
    if (action.op === "search") return snapshot;
    const state = await requestModel<ModelState>({ type: "get_state" });
    setPreparedModel(state);
    const choice = modelHubSelection({
      action,
      snapshot,
      current: state,
      previous: displayedModel,
      connected,
    });
    if (choice.task) taskModelChoice.current = choice.task;
    if (choice.session) {
      modelChoice.current = choice.session;
      if (viewRef.current.connection === "connected") await refresh();
    }
    setModelHub(snapshot);
    return snapshot;
  }

  async function openModelHub(temporary = false) {
    if (viewRef.current.busy || loadingHistory)
      throw new Error("模型设置需要会话空闲。");
    if (viewRef.current.connection !== "connected") {
      try {
        await prepareModels(launchRef.current, true);
      } catch (error) {
        if (!modelChoice.current) throw error;
        // 目录切换后仍允许替换失效选择，不连接聊天或改写历史会话。
        await prepareModels();
        report(error);
      }
    }
    await modelHubAction({ op: "list" });
    setTemporaryModelHub(temporary);
    setModal("model-hub");
  }

  function agentsHubAction(action: AgentsAction): Promise<AgentsSnapshot> {
    return requestModel<AgentsSnapshot>({ type: "agents_hub", action });
  }

  async function openAgentsHub() {
    if (viewRef.current.busy || loadingHistory) throw new Error("请等待会话空闲后管理代理。");
    if (viewRef.current.connection !== "connected") await prepareModels(launchRef.current, true);
    setAgentsHub(await agentsHubAction({ op: "list" }));
    setModal("agents");
  }

  async function openModels() {
    if (
      viewRef.current.connection !== "connected" ||
      viewRef.current.busy ||
      loadingHistory
    )
      throw new Error("模型设置需要会话空闲。");
    const available = await requestModel<{ models: ModelInfo[] }>({
      type: "get_available_models",
    });
    setModels(available.models);
    const assignments = await window.desktop.getRoles();
    setRoles(assignments);
    const selected = assignments.find((role) => role.role === roleName);
    setRoleValue(
      (roleScope === "project" ? selected?.project : selected?.global) ?? "",
    );
    setRoleModel("");
    setRoleThinking("");
    setModal("roles");
  }

  /** 修改 session 临时选择，不写模型角色。[in] command：模型/思考 RPC。返回值：完成的 Promise。 */
  async function changeModel(command: RpcCommand) {
    if (viewRef.current.busy || loadingHistory)
      throw new Error("请等待会话空闲后切换模型。");
    const active = viewRef.current.connection === "connected";
    if (!active)
      await prepareModels(launchRef.current, command.type !== "set_model");
    const result = await requestModel(command);
    if (result === null)
      dispatch({
        type: "log",
        text:
          command.type === "cycle_role_model"
            ? "当前只有一个或没有可用的预设角色模型。"
            : "原生 CLI 当前没有可循环的候选。",
      });
    const state = await requestModel<ModelState>({ type: "get_state" });
    setPreparedModel(state);
    if (result !== null && state.model) {
      modelChoice.current = {
        provider: state.model.provider,
        modelId: state.model.id,
        thinkingLevel: state.thinkingLevel,
      };
    }
    if (active) await refresh();
    setRoleCycle(
      command.type === "cycle_role_model" && result !== null
        ? (result as RoleModelCycle)
        : null,
    );
  }

  /** 切换 Fast；状态以刷新回显为准，请求及刷新完成前保持原有显示并阻止重入。 */
  async function toggleFast() {
    if (fastPendingRef.current) return;
    if (modelDisabled || viewRef.current.busy || loadingHistory || viewRef.current.connection !== "connected")
      throw new Error("请等待会话连接且空闲后切换 Fast。");
    fastPendingRef.current = true;
    fastPendingState.current = viewRef.current.state;
    setFastPending(true);
    try {
      const enabled = viewRef.current.state?.fastModeEnabled !== true;
      await window.desktop.request({ type: "set_fast_mode", enabled });
      await refresh();
    } finally {
      fastPendingRef.current = false;
      setFastPending(false);
      fastPendingState.current = undefined;
    }
  }

  /** 快速切换只改变会话选择；请求期间阻止重入，完成后保留输入焦点。 */
  async function cyclePreset(direction: "forward" | "backward") {
    if (modelDisabled || roleCyclePending.current) return;
    roleCyclePending.current = true;
    restoreComposerFocus.current = document.activeElement === composer.current;
    try {
      await perform(() => changeModel({ type: "cycle_role_model", direction }));
    } finally {
      roleCyclePending.current = false;
    }
  }

  /** 同文件导航前重置内嵌审阅，并恢复 user 节点的文字及图片草稿。[in] entry：原生树节点。返回值：完成的 Promise。 */
  async function navigate(
    entry: SessionEntry,
    options?: TreeNavigationOptions,
  ) {
    if (
      viewRef.current.connection !== "connected" ||
      viewRef.current.busy ||
      loadingHistory
    )
      throw new Error("树导航需要会话空闲。");
    if (!(await plan.protect())) return;
    plan.hide();
    // 同一 sessionId 的树导航也改变上下文，原生请求前撤销旧审阅。
    invalidateBtw();
    generation.current += 1;
    setTranscriptEpoch((current) => current + 1);
    setRunStart(undefined);
    const user = entry.message?.role === "user" ? entry.message : undefined;
    const images =
      user && Array.isArray(user.content)
        ? user.content.filter((part) => part.type === "image")
        : [];
    if (options) await window.desktop.navigateTree(entry.id, options);
    else await window.desktop.navigateTree(entry.id);
    await refresh();
    await reloadSessions();
    resetDraft(user ? messageText(user) : "");
    setDraftImages(images);
    // 等输入区重新显示且独占操作结束后再恢复焦点。
    restoreComposerFocus.current = true;
    setModal(null);
    stickToBottom.current = true;
  }

  /** 普通 Enter 遵循原生摘要设置，Shift Enter 明确请求摘要。 */
  async function navigateFromTree(request: TreeNavigation) {
    const entry = entries.find((candidate) => candidate.id === request.entryId);
    if (!entry) throw new Error(`会话树中不存在节点：${request.entryId}`);
    await navigate(
      entry,
      request.summarize ? { summarize: true } : { askSummary: true },
    );
  }

  /** 保存标签后读取原生树，使当前筛选与标签立即同步。 */
  async function labelTree(request: TreeLabelChange) {
    await window.desktop.setTreeLabel(request.entryId, request.label);
    const history = await window.desktop.request<SessionHistorySnapshot>({
      type: "get_entries",
    });
    setEntries(history.entries);
    setTree(sessionTree(history.entries));
    setLeaf(history.leafId);
  }

  /** 删除后重读原生上下文和显示树，旧工具预览随会话刷新失效。 */
  async function deleteTree(request: TreeDeletion) {
    const sessionId = viewRef.current.state?.sessionId;
    if (!sessionId) throw new Error("请先连接具体会话");
    await window.desktop.deleteTree({
      sessionId,
      entryId: request.entryId,
      entryIds: [...request.entryIds],
    });
    setTranscriptEpoch((current) => current + 1);
    await refresh();
    const history = await window.desktop.request<SessionHistorySnapshot>({
      type: "get_entries",
    });
    setEntries(history.entries);
    setTree(sessionTree(history.entries));
    setLeaf(history.leafId);
  }

  /** 统一更新旁问 UI 与同步事件引用，连续按键不读取陈旧展开状态。 */
  function updateBtwUI(patch: Partial<typeof btwUI>) {
    btwUIRef.current = { ...btwUIRef.current, ...patch };
    setBtwUI(btwUIRef.current);
  }

  /** 按真实会话身份复用内存草稿；无 ID 的新会话只复用自己的临时槽。 */
  function ensureBtwScope(identity?: BtwIdentity): BtwScopeState {
    const current = btwScopes.current.get(btwUIRef.current.scopeKey);
    if (!identity && current && submissionRef.current?.scope === current.key && (!viewRef.current.state?.sessionId || viewRef.current.connection === "starting")) return current;
    const state = viewRef.current.state;
    const options = launchRef.current;
    const target = identity ?? {
      sessionId: state?.sessionId, sessionFile: readOnlyRef.current ?? state?.sessionFile,
      cwd: readOnlyRef.current ? readOnlySummary?.cwd ?? options.cwd : options.cwd,
      agentDir: options.agentDir, profile: options.profile,
    };
    if (current && sameBtwIdentity(current.identity, target)) {
      if (identity) btwScopeGeneration.current = generation.current;
      return current;
    }
    if (current && !target.sessionId && !current.identity.sessionId && btwScopeGeneration.current === generation.current) return current;
    if (current && current.identity.sessionId === target.sessionId && target.sessionId &&
        !current.identity.sessionFile && target.sessionFile && btwScopeGeneration.current === generation.current &&
        sameBtwIdentity({ ...current.identity, sessionFile: target.sessionFile }, target)) {
      current.identity = target;
      return current;
    }
    let scope = target.sessionId ? [...btwScopes.current.values()].find((candidate) => sameBtwIdentity(candidate.identity, target)) : undefined;
    if (!scope) {
      scope = createBtwScope(target, crypto.randomUUID());
      btwScopes.current.set(scope.key, scope);
    }
    btwScopeGeneration.current = generation.current;
    btwUIRef.current = { ...btwUIRef.current, scopeKey: scope.key };
    return scope;
  }

  function getBtwDraft(scope: BtwScopeState, slot: string): BtwDraft {
    let value = scope.drafts.get(slot);
    if (!value) {
      value = { text: "", revision: 0, selection: { start: 0, end: 0, direction: "none" } };
      scope.drafts.set(slot, value);
    }
    return value;
  }

  /** 关闭不取消原生任务；只有真实上下文变化才撤销异步视图权限。 */
  function closeBtw(restoreFocus = true) {
    if (!btwUIRef.current.open) return;
    btwRestoreFocus.current = restoreFocus;
    updateBtwUI({ open: false });
    setBtwMenuOpen(false);
  }
  /** 编辑态 Esc 返回阅读；总览保留详情栏，不跳回历史列表。 */
  function browseBtw() {
    const scope = ensureBtwScope();
    const count = viewRef.current.records.filter((record) => {
      const owner = btwOwners.current.get(record.id);
      return owner?.scope === scope.key && owner.epoch === btwContextEpoch.current;
    }).length;
    escapeAt.current = null;
    const overview = btwUIRef.current.surface === "history";
    updateBtwUI({ mode: "history", historyDetail: overview || count <= 1, focusTarget: overview ? "reader" : "panel", focusRequest: btwUIRef.current.focusRequest + 1 });
  }
  function invalidateBtw() {
    btwContextEpoch.current += 1;
    btwScopeGeneration.current = -1;
    btwLoadSequence.current += 1;
    btwLoad.current = undefined;
    btwFrames.current = [];
    submissionRef.current = undefined;
    btwRestoreFocus.current = false;
    restoreComposerFocus.current = false;
    closeBtw(false);
    renderBtw();
  }
  function selectBtw(id?: string, mode: "compose" | "history" = "compose") {
    const scope = ensureBtwScope();
    if (id && id !== scope.selectedId && btwUIRef.current.surface === "history") scope.scrolls.set(id, { top: 0, follow: false });
    scope.selectedId = id;
    btwNavigation.current += 1;
    const fromList = mode === "history" && Boolean(document.activeElement?.closest(".btw-panel-list"));
    const fromPanel = mode === "history" && Boolean(document.activeElement?.matches(".btw-panel"));
    updateBtwUI({ scopeKey: scope.key, mode, historyDetail: fromPanel || fromList ? btwUIRef.current.historyDetail : Boolean(id), focusTarget: mode === "compose" ? "editor" : fromPanel ? "panel" : fromList ? "list" : "reader", focusRequest: btwUIRef.current.focusRequest + 1 });
  }

  /** 立即打开，历史读取独立进行，绝不等网络后抢回焦点。 */
  async function openBtw(mode: "compose" | "history" = "history"): Promise<void> {
    plan.hide();
    const scope = ensureBtwScope();
    if (!btwUIRef.current.open && composer.current) {
      const input = composer.current;
      btwMainSelection.current = { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection, top: input.scrollTop };
    }
    const records = viewRef.current.records.filter((record) => {
      const owner = btwOwners.current.get(record.id);
      return owner?.scope === scope.key && owner.epoch === btwContextEpoch.current;
    });
    const running = records.find((record) => (record.followUps?.at(-1) ?? record).status === "running");
    if (mode === "compose" && running) scope.selectedId = running.id;
    if (mode === "history" && !records.some((record) => record.id === scope.selectedId) && records.length) scope.selectedId = records[0].id;
    updateBtwUI({ open: true, surface: mode === "history" ? "history" : "inline", mode, scopeKey: scope.key, historyDetail: records.length <= 1,
      focusTarget: mode === "compose" ? "editor" : "panel",
      focusRequest: btwUIRef.current.focusRequest + 1 });
    if (viewRef.current.connection === "connected") void loadBtwHistory();
    else { scope.history = "unavailable"; renderBtw(); }
  }

  /** 授权快照中的主题；未知事件不能认领另一个会话的记录。 */
  function applyBtwHistory(scope: BtwScopeState, records: BtwRecord[]) {
    btwScopeGeneration.current = generation.current;
    for (const [id, owner] of btwOwners.current) {
      if (owner.scope === scope.key && owner.epoch === btwContextEpoch.current && !records.some((record) => record.id === id)) btwOwners.current.delete(id);
    }
    for (const record of records) btwOwners.current.set(record.id, { scope: scope.key, epoch: btwContextEpoch.current });
    const action = { type: "records" as const, records };
    viewRef.current = sessionReducer(viewRef.current, action);
    dispatch(action);
    scope.history = "ready";
    scope.historyError = undefined;
  }
  async function loadBtwHistory(manual = false): Promise<void> {
    if (viewRef.current.connection !== "connected") return;
    if (btwLoad.current) {
      if (manual) btwLoad.current.again = true;
      return btwLoad.current.promise;
    }
    const scope = ensureBtwScope();
    const epoch = btwContextEpoch.current, token = generation.current, sequence = ++btwLoadSequence.current;
    const snapshot = btwEpoch.current;
    const initializeHistory = !scope.selectedId;
    const navigation = btwNavigation.current, focusRequest = btwUIRef.current.focusRequest;
    scope.history = "loading";
    renderBtw();
    const request = { promise: Promise.resolve(), again: false };
    request.promise = (async () => {
      try {
        const history = await window.desktop.request<{ records: BtwRecord[] }>({ type: "get_btw_history" });
        if (epoch !== btwContextEpoch.current || token !== generation.current || sequence !== btwLoadSequence.current || ensureBtwScope().key !== scope.key) return;
        if (snapshot === btwEpoch.current) applyBtwHistory(scope, history.records);
        else { scope.history = "ready"; scope.historyError = undefined; }
        if (manual) scope.storageError = undefined;
        const ui = btwUIRef.current;
        if (initializeHistory && navigation === btwNavigation.current && focusRequest === ui.focusRequest && ui.mode === "history" && !scope.selectedId) {
          if (history.records.length) scope.selectedId = history.records[0].id;
          updateBtwUI({ historyDetail: history.records.length <= 1 });
        }
      } catch (error) {
        if (epoch !== btwContextEpoch.current || token !== generation.current || sequence !== btwLoadSequence.current) return;
        scope.history = "error";
        scope.historyError = error instanceof Error ? error.message : String(error);
      } finally {
        if (btwLoad.current === request) {
          btwLoad.current = undefined;
          renderBtw();
          if (request.again && epoch === btwContextEpoch.current && token === generation.current) void loadBtwHistory(true);
        }
      }
    })();
    btwLoad.current = request;
    return request.promise;
  }

  /** 唯一 admission 锁跨越连接与接受；草稿只按提交版本消费。 */
  async function askBtw(question: string, recordId?: string, origin?: { kind: "command"; accepted: () => void }): Promise<boolean> {
    if (!question.trim() || submissionRef.current || pending || loadingHistory || plan.snapshot?.phase === "applying" || !canCompose) return false;
    const scope = ensureBtwScope();
    if (viewRef.current.records.some((record) => btwOwners.current.get(record.id)?.scope === scope.key && (record.followUps?.at(-1) ?? record).status === "running")) return false;
    let slot: string | undefined = recordId ?? BTW_NEW_TOPIC;
    if (origin) {
      void openBtw("compose");
      scope.selectedId = undefined;
      recordId = undefined;
      const empty = getBtwDraft(scope, BTW_NEW_TOPIC);
      if (empty.text.trim()) slot = undefined;
      else scope.drafts.set(BTW_NEW_TOPIC, { text: question, revision: empty.revision + 1, selection: { start: question.length, end: question.length, direction: "none" } });
    }
    const owned = slot === undefined ? undefined : getBtwDraft(scope, slot);
    const request = { requestId: ++btwRequestSequence.current, scope: scope.key, epoch: btwContextEpoch.current, generation: generation.current,
      slot, revision: owned?.revision, selectedSlotAtSubmit: origin ? BTW_NEW_TOPIC : scope.selectedId ?? BTW_NEW_TOPIC, navigation: btwNavigation.current, focusRequest: btwUIRef.current.focusRequest, question };
    submissionRef.current = request;
    btwFrames.current = [];
    scope.operationError = undefined;
    if (slot !== undefined) scope.errors.delete(slot);
    renderBtw();
    const valid = () => submissionRef.current?.requestId === request.requestId && btwContextEpoch.current === request.epoch && btwUIRef.current.scopeKey === scope.key;
    try {
      if (viewRef.current.connection !== "connected") {
        if (!(await connectCurrentSession(false, request.requestId)) || !valid()) return false;
        request.generation = generation.current;
      }
      if (!valid() || request.generation !== generation.current) return false;
      if (recordId) {
        await loadBtwHistory();
        if (!valid() || scope.history !== "ready" || !viewRef.current.records.some((record) => record.id === recordId)) throw new Error("该旁问主题已不存在，请新建主题后重试");
      }
      scope.scrolls.set(recordId ?? BTW_NEW_TOPIC, { top: 0, follow: true });
      const result = await window.desktop.request<{ record: BtwRecord }>({ type: "btw", question, ...(recordId ? { recordId } : {}) });
      if (!valid() || request.generation !== generation.current) return false;
      btwOwners.current.set(result.record.id, { scope: scope.key, epoch: request.epoch });
      const apply = (frame: RpcFrame) => {
        const action = { type: "frame" as const, frame };
        viewRef.current = sessionReducer(viewRef.current, action);
        dispatch(action);
        btwEpoch.current += 1;
      };
      apply({ type: "btw_record", record: result.record });
      for (const frame of btwFrames.current) {
        const id = frame.type === "btw_record" ? (frame.record as BtwRecord).id : String(frame.recordId);
        if (id === result.record.id) apply(frame);
      }
      if (slot !== undefined && request.revision !== undefined) {
        const remaining = consumeBtwDraft(getBtwDraft(scope, slot), request.revision);
        if (slot === BTW_NEW_TOPIC) {
          scope.drafts.set(result.record.id, remaining);
          scope.drafts.delete(BTW_NEW_TOPIC);
        } else scope.drafts.set(slot, remaining);
      } else getBtwDraft(scope, result.record.id);
      if (!recordId) scope.scrolls.set(result.record.id, { top: 0, follow: true });
      if (request.navigation === btwNavigation.current && (scope.selectedId ?? BTW_NEW_TOPIC) === request.selectedSlotAtSubmit) {
        scope.selectedId = result.record.id;
        const ui = btwUIRef.current;
        // 接受后回到原生阅读态；离开编辑器或继续修改草稿后，迟到响应不能抢焦点。
        if (ui.open && ui.surface === "history" && ui.focusTarget === "editor" &&
            ui.focusRequest === request.focusRequest && !getBtwDraft(scope, result.record.id).text &&
            document.activeElement?.matches(".btw-panel textarea")) {
          updateBtwUI({ mode: "history", historyDetail: true, focusTarget: "reader", focusRequest: ui.focusRequest + 1 });
        }
      }
      scope.history = "ready";
      origin?.accepted();
      return true;
    } catch (error) {
      if (valid()) {
        const message = error instanceof Error ? error.message : String(error);
        if (slot === undefined) scope.operationError = message;
        else scope.errors.set(slot, message);
        await loadBtwHistory();
      }
      return false;
    } finally {
      if (submissionRef.current?.requestId === request.requestId) {
        submissionRef.current = undefined;
        btwFrames.current = [];
        renderBtw();
      }
    }
  }

  async function stopBtw(recordId: string): Promise<void> {
    if (btwStoppingRef.current) return;
    const scope = ensureBtwScope(), epoch = btwContextEpoch.current;
    btwStoppingRef.current = recordId;
    setBtwStopping(recordId);
    try {
      await window.desktop.request({ type: "btw_cancel", recordId });
      if (epoch === btwContextEpoch.current) await loadBtwHistory();
    } catch (error) {
      if (epoch === btwContextEpoch.current) { scope.operationError = error instanceof Error ? error.message : String(error); scope.errors.set(recordId, scope.operationError); renderBtw(); }
    } finally {
      if (btwStoppingRef.current === recordId) btwStoppingRef.current = undefined;
      setBtwStopping((current) => current === recordId ? undefined : current);
    }
  }

  async function copyBtw(record: BtwRecord): Promise<void> {
    const text = getBtwCopyText(record);
    if (text === undefined) return;
    const scope = ensureBtwScope(), epoch = btwContextEpoch.current;
    try {
      if (text.length > 65536) throw new Error("答案超过系统剪贴板的 65536 字符限制，未复制");
      await window.desktop.copyText(text);
      if (epoch === btwContextEpoch.current && scope.selectedId === record.id) setBtwCopy({ id: record.id, label: "已复制" });
    } catch (error) {
      if (epoch === btwContextEpoch.current) { scope.errors.set(record.id, error instanceof Error ? error.message : String(error)); renderBtw(); }
    }
  }

  /** 打开右侧后台任务侧栏并读取原生 /jobs 输出。[in] args：原样转交的子命令参数。返回值：完成的 Promise。 */
  async function openJobs(args = "") {
    plan.hide();
    if (browserOpen) setCodeReviewOpen(false);
    setBrowserOpen(false);
    const token = generation.current;
    setJobsOpen(true);
    setJobsPending(true);
    try {
      // 主进程把本地命令响应前的 command_output 附在 data.output。
      const result = await window.desktop.request<{ output?: string }>({
        type: "prompt",
        message: args ? `/jobs ${args}` : "/jobs",
      });
      if (token === generation.current) setJobsOutput(result?.output ?? "");
    } finally {
      setJobsPending(false);
    }
  }

  /** 主动连接当前会话，保留草稿；失败时继续只读并允许重试。 */
  async function connectCurrentSession(preserveModal = false, preserveBtwRequestId?: number): Promise<boolean> {
    if (connectingRef.current) return false;
    try {
      await connect(
        { ...launchRef.current, sessionPath: readOnlyRef.current },
        { preserveDraft: true, preserveModal, preserveBtwRequestId },
      );
      return true;
    } catch (error) {
      if (preserveBtwRequestId !== undefined) throw error;
      if (preserveModal) throw error;
      setConnectionError(
        error instanceof Error ? error.message : String(error),
      );
      setModal("connection-error");
      return false;
    }
  }

  /** 输入框主操作：只读会话先连接，连接后才发送草稿。 */
  async function submitComposer(behavior: "steer" | "followUp" = "steer") {
    if (connectingRef.current) return;
    if (/^\/(?:btw|model|rewind|agents|seance|plan)(?:\s|$)/.test(draft.trim())) {
      await send();
      return;
    }
    if (needsSessionConnection) {
      await connectCurrentSession();
      return;
    }
    // 原生：运行中空输入框 Enter 且有待处理消息时中断当前执行，队列中的引导随后继续投递。
    if (viewRef.current.busy && !draft.trim() && !draftImages.length) {
      const queued = viewRef.current.state?.queuedMessages;
      if (
        behavior === "steer" &&
        (queued?.steering.length ?? 0) +
          (queued?.followUp.length ?? 0) +
          (queued?.liveSteered ?? 0) >
          0
      )
        await window.desktop.request({ type: "abort" });
      return;
    }
    await send({ behavior });
  }

  /** 原生 Alt+↑ / Shift+↑：取回最后一条排队消息到输入框重新编辑。 */
  async function dequeueLast() {
    const queued = viewRef.current.state?.queuedMessages;
    const queue = queued?.followUp.length
      ? "followUp"
      : queued?.steering.length
        ? "steering"
        : undefined;
    if (!queue) return;
    const message = queued![queue].at(-1)!;
    await window.desktop.request({
      type: "remove_queued_message",
      message,
      queue,
    });
    setDraft((current) =>
      current.trim() ? `${message}\n\n${current}` : message,
    );
  }

  /** 激活候选命令；已连接时立即执行，未连接时保留补全草稿。 */
  async function selectCommand(name: string) {
    prepareCommentSubmission(commentDraft.current.current);
    const text = `/${name} `;
    resetDraft(text);
    setModal(null);
    composer.current?.focus();
    if (connected || name === "btw" || name === "agents" || name === "seance" || name === "plan") await send({ text });
  }

  /** 发送文字或路由 GUI slash；旁问转入主聊天时保留原草稿及附件。 */
  async function send({
    text = draft,
    consumeDraft = true,
    behavior = "steer",
  }: {
    text?: string;
    consumeDraft?: boolean;
    /** 运行中提交方式：原生 Enter 为引导，Ctrl+Enter / Ctrl+Q 为排队到本轮结束后。 */
    behavior?: "steer" | "followUp";
  } = {}) {
    if (!text.trim() && !draftImages.length) return;
    const originalImages = draftImagesRef.current;
    const submission = consumeDraft ? prepareCommentSubmission(commentDraft.current.current, text, originalImages.length) : undefined;
    const submissionImages = consumeDraft && submission ? [...originalImages, ...submission.images] : originalImages;
    const consumeSubmission = () => {
      setPlanRefining(false);
      if (submission && draftImagesRef.current === originalImages && commentDraft.consume(submission)) setDraftImages([]);
    };
    const btwCommand = /^\/btw(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (btwCommand) {
      const accepted = () => { if (submission) commentDraft.consume(submission); };
      if (!btwCommand[1] || btwCommand[1] === "history") {
        await openBtw("history");
        accepted();
      } else await askBtw(btwCommand[1], undefined, { kind: "command", accepted });
      return;
    }
    const planCommand = /^\/plan(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (planCommand) {
      await plan.flush();
      if (!connected && !(await connectCurrentSession())) return;
      const current = await plan.status();
      if (!current) throw new Error("当前 omp 未提供桌面计划模式");
      const argument = planCommand[1];
      if (current.phase === "planning" || current.phase === "review") {
        if (current.document?.content.trim() && !window.confirm("退出计划模式但不批准计划？")) return;
        await plan.act({ op: "pause", identity: current.identity });
      } else if (current.phase === "paused" && !argument?.trim()) {
        await plan.act({ op: "leave", identity: current.identity });
      } else {
        await plan.act({ op: "enter", identity: current.identity });
        if (argument?.trim()) await sendPrompt(argument, consumeDraft, behavior, consumeSubmission, submissionImages);
      }
      if (consumeDraft) consumeSubmission();
      composer.current?.focus();
      return;
    }
    if (plan.snapshot?.phase === "applying") throw new Error("正在处置计划，请等待或停止");
    const agentsCommand = /^\/agents(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (agentsCommand) {
      if (agentsCommand[1]?.trim()) throw new Error("使用 /agents 打开代理管理，无需参数。");
      await openAgentsHub();
      if (consumeDraft) consumeSubmission();
      return;
    }
    const rewindCommand = /^\/rewind(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (rewindCommand) {
      if (rewindCommand[1]?.trim())
        throw new Error("使用 /rewind 进入回退模式，无需参数。");
      if ((await openRewind()) && consumeDraft) consumeSubmission();
      return;
    }
    const modelCommand = /^\/model(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (modelCommand) {
      const argument = modelCommand[1]?.trim();
      if (argument && argument !== "temporary")
        throw new Error(
          "使用 /model 打开模型管理，或 /model temporary 临时切换模型。",
        );
      await openModelHub(argument === "temporary");
      if (consumeDraft) consumeSubmission();
      return;
    }
    const seanceCommand = /^\/seance(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (seanceCommand) {
      const args = parseSeanceCommand(seanceCommand[1] ?? "");
      await openSeance(args.source, args.model);
      if (consumeDraft) consumeSubmission();
      return;
    }
    if (!connected && !(await connectCurrentSession())) return;
    if (!text.trimStart().startsWith("/") && plan.snapshot?.phase === "review") {
      // 退回与发送由原生同一处置完成，不能在终态通知后再启动独立 prompt。
      await plan.decide("refine", undefined, submission?.text ?? text, undefined,
        consumeDraft ? submissionImages.map(({ data, mimeType }) => ({ type: "image", data: data!, mimeType: mimeType! })) : undefined);
      plan.hide();
      resumeTranscript();
      if (consumeDraft) consumeSubmission();
      return;
    }
    await dispatchCommand(submission?.text ?? text, consumeDraft, behavior, consumeSubmission, submissionImages);
    setPlanRefining(false);
    if (consumeDraft) consumeSubmission();
  }

  /** 路由 GUI 接管的命令；其余文字交给原生引擎解析。 */
  async function dispatchCommand(
    text: string,
    consumeDraft: boolean,
    behavior: "steer" | "followUp",
    accepted?: () => void,
    images: MessageContent[] = draftImages,
  ) {
    const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
    const command = match?.[1];
    const args = match?.[2]?.trim() ?? "";
    if (command === "tree") {
      await openTree("tree");
    } else if (command === "resume") {
      await reloadSessions();
      setModal("sessions");
    } else if (command === "new") {
      await transition({ type: "new_session" });
    } else if (command === "fork") {
      if (args) await openTree("checkpoint");
      else await transition({ type: "fork" });
    } else if (command === "clear") {
      confirmClear();
    } else if (command === "jobs") {
      await openJobs(args);
    } else if (command === "shake") {
      const mode = args || "elide";
      if (mode !== "elide" && mode !== "images" && mode !== "thinking")
        throw new Error("用法：/shake [elide|images|thinking]");
      if (viewRef.current.busy || loadingHistory)
        throw new Error("请等待会话完全空闲后再清理历史。");
      setShakeRequest({
        mode,
        sessionId: viewRef.current.state?.sessionId,
        sessionFile: viewRef.current.state?.sessionFile,
      });
      setModal("shake");
    } else {
      await sendPrompt(text, consumeDraft, behavior, accepted, images);
    }
  }

  /** 确认后才交给原生改写；重新核实身份、空闲状态和命令能力，禁止旧引擎将其当提示词。 */
  async function executeShake() {
    if (!shakeRequest) return;
    const state = await window.desktop.request<SessionState>({ type: "get_state" });
    if (state.sessionId !== shakeRequest.sessionId ||
        state.sessionFile !== shakeRequest.sessionFile ||
        state.isStreaming || state.isCompacting || state.isSettled === false)
      throw new Error("会话已切换或正在运行，请重新执行 /shake。");
    const { commands } = await window.desktop.request<{ commands: SlashCommand[] }>({
      type: "get_available_commands",
    });
    if (!commands.some((command) => command.name === "shake"))
      throw new Error("当前 omp 未提供 /shake，请更新引擎。历史未修改。");
    await window.desktop.request({ type: "prompt", message: `/shake ${shakeRequest.mode}` });
    await refresh();
    await reloadSessions();
    setModal(null);
  }

  function confirmClear() {
    if (
      viewRef.current.connection !== "connected" ||
      viewRef.current.busy ||
      loadingHistory
    )
      throw new Error("请等待会话空闲。");
    setModal("clear");
  }

  async function sendPrompt(
    text: string,
    consumeDraft: boolean,
    behavior: "steer" | "followUp",
    accepted?: () => void,
    images: MessageContent[] = draftImages,
  ) {
    const token = generation.current;
    if (!view.busy) {
      setRunStart({ time: Date.now(), messageCount: view.messages.length });
      setPromptSubmitting(true);
    }
    try {
      const response = await window.desktop.request<{ agentInvoked?: boolean }>(
        {
          type: "prompt",
          message: text,
          ...(images.length && consumeDraft
            ? {
                images: images.map(({ data, mimeType }) => ({
                  type: "image",
                  data,
                  mimeType,
                })),
              }
            : {}),
          ...(view.busy ? { streamingBehavior: behavior } : {}),
        },
      );
      if (token !== generation.current) return;
      accepted?.();
      if (response?.agentInvoked !== false) resumeTranscript();
      if (response?.agentInvoked === false) {
        try { await refresh(); } catch (error) { report(error); }
      }
    } finally {
      if (token === generation.current) setPromptSubmitting(false);
    }
  }

  /** 将旁问主题变成用户明确选择的主会话上下文。[in] record：原生主题。返回值：引用文字。 */
  function topicText(record: BtwRecord): string {
    return [record, ...(record.followUps ?? [])]
      .map((turn) => `旁问：${turn.question}\n\n${turn.answer}`)
      .join("\n\n---\n\n");
  }

  /** 回答最前面的扩展交互并等待真实 stdin 写入。[in] response：原生答复。返回值：完成的 Promise。 */
  async function replyUI(response: { id: string; [key: string]: unknown }) {
    const token = generation.current;
    await window.desktop.respondUI(response);
    if (token !== generation.current) return;
    setExtensionRequests((old) =>
      old.filter((request) => request.id !== response.id),
    );
  }

  /** 取消当前扩展交互，稳定回调供模态焦点管理。参数：无。返回值：无。 */
  const cancelExtension = useCallback(() => {
    const token = generation.current;
    const request = extensionRequestsRef.current[0];
    if (request) {
      void window.desktop
        .respondUI({ id: request.id, cancelled: true })
        .then(() => {
          if (token !== generation.current) return;
          setExtensionRequests((old) => old.filter((item) => item.id !== request.id));
        })
        .catch(report);
    }
  }, [report]);

  /** 关闭模态窗口并保留草稿。参数：无。返回值：无。 */
  const closeModal = useCallback(() => {
    setModal(null);
  }, []);

  useEffect(() => {
    let disposed = false;
    const startupGeneration = generation.current;
    void window.desktop
      .preferences()
      .then(async (preferences) => {
        if (disposed || generation.current !== startupGeneration) return;
        const {
          autoConnect: _autoConnect,
          sessionPath: _sessionPath,
          ...options
        } = preferences;
        setLaunch(options);
        launchRef.current = options;
        // 模型进程只使用内存会话；列表读取与模型准备互不阻塞。
        await Promise.all([
          reloadSessions(preferences),
          preferences.autoConnect ? prepareModels(options) : Promise.resolve(),
        ]);
      })
      .catch(report);
    const statusEpoch = engineStatusEpoch.current;
    void window.desktop.listSessionEngines().then((engines) => {
      if (!disposed && statusEpoch === engineStatusEpoch.current) setSessionEngines(engines);
    }).catch(report);
    const receiveFrame = (frame: RpcFrame) => {
      if (frame.type === "session_engines") {
        engineStatusEpoch.current += 1;
        setSessionEngines(frame.engines as SessionEngineStatus[]);
        return;
      }
      if (frame.engineId && frame.engineId !== connectionRef.current?.engineId) return;
      if (readOnlyRef.current && frame.type !== "extension_ui_request") return;
      if (frame.type === "plan_state") return;
      if (frame.type === "extension_ui_request") {
        const request = frame as ExtensionRequest;
        if (request.method === "cancel") {
          setExtensionRequests((old) =>
            old.filter((item) => item.id !== frame.targetId),
          );
          return;
        }
        if (
          ["select", "confirm", "input", "editor", "ask"].includes(
            request.method,
          )
        ) {
          setExtensionRequests((old) => [
            ...old.filter((item) => item.id !== request.id),
            request,
          ]);
          return;
        }
        if (request.method === "set_editor_text") {
          if (readOnlyRef.current) return;
          resetDraft(String(frame.text ?? ""));
          return;
        }
        if (request.method === "open_url") {
          dispatch({
            type: "log",
            text: `授权链接：${String(frame.launchUrl ?? frame.url)}\n${String(frame.instructions ?? "")}`,
          });
          void window.desktop
            .openExternal(String(frame.launchUrl ?? frame.url))
            .catch(report);
          return;
        }
        if (
          ["notify", "setStatus", "setWidget", "setTitle"].includes(
            request.method,
          )
        ) {
          const message = String(
            frame.message ??
              frame.text ??
              (Array.isArray(frame.content)
                ? frame.content.join("\n")
                : readable(frame)),
          );
          dispatch({
            type: "log",
            text: message,
            error: frame.notifyType === "error",
          });
          if (request.method === "notify" && (frame.notifyType === "info" || frame.notifyType === "warning")) {
            pushNotice({ level: frame.notifyType, title: message });
          }
          return;
        }
        report(
          new Error(
            `无法呈现扩展自定义界面“${request.method}”，已明确取消；请在 omp 终端使用该扩展。`,
          ),
        );
        void window.desktop
          .respondUI({ id: request.id, cancelled: true })
          .catch(report);
        return;
      }
      if (frame.type === "btw_delta" || frame.type === "btw_record") {
        const id = frame.type === "btw_record" ? (frame.record as BtwRecord).id : String(frame.recordId);
        const owner = btwOwners.current.get(id);
        if (!owner) {
          if (submissionRef.current) btwFrames.current.push(frame);
          return;
        }
        if (owner.scope !== btwUIRef.current.scopeKey || owner.epoch !== btwContextEpoch.current) return;
        if (submissionRef.current?.scope === owner.scope) { btwFrames.current.push(frame); return; }
        btwEpoch.current += 1;
        viewRef.current = sessionReducer(viewRef.current, { type: "frame", frame });
      }
      if (frame.type === "notice" && frame.source === "btw-history" && viewRef.current.connection === "connected") {
        const scope = btwScopes.current.get(btwUIRef.current.scopeKey);
        if (scope && btwScopeGeneration.current === generation.current) {
          scope.storageError = String(frame.message ?? frame.text ?? "旁问历史保存失败");
          renderBtw();
        }
      }
      if (
        [
          "tool_execution_end",
          "todo_auto_clear",
          "todo_reminder",
          "message_start",
          "message_update",
          "message_end",
          "agent_start",
          "session_info_update",
          "queue_update",
          "model_changed",
          "thinking_level_changed",
        ].includes(frame.type)
      )
        messageEpoch.current += 1;
      if (frame.type === "desktop_status" && frame.status !== "connected") {
        // 断线事件立即撤销审阅，即使重连帧同批提交也不保留旧展开状态。
        setTranscriptEpoch((current) => current + 1);
        setRunStart(undefined);
        setExtensionRequests([]);
      }
      dispatch({ type: "frame", frame });
    };
    frameHandler.current = receiveFrame;
    const unsubscribe = window.desktop.onFrame(receiveFrame);
    return () => {
      disposed = true;
      unsubscribe();
      generation.current += 1;
      btwFrames.current = [];
      btwContextEpoch.current += 1;
      submissionRef.current = undefined;
    };
  }, [report, pushNotice]);

  useEffect(() => {
    if (view.revision && connected) void refresh().catch(report);
  }, [view.revision, connected, refresh, report]);

  useLayoutEffect(() => {
    followTranscript();
    setJumpVisible(!stickToBottom.current);
  }, [view.messages, view.tools, followTranscript]);

  const transcriptMounted = modal !== "rewind";
  useLayoutEffect(() => {
    const element = scroll.current;
    const content = element?.firstElementChild;
    if (!element || !content || typeof ResizeObserver === "undefined") return;
    // 同时覆盖异步富文本增高和输入区、面板挤压造成的可视高度变化。
    const observer = new ResizeObserver(followTranscript);
    observer.observe(content);
    observer.observe(element);
    return () => observer.disconnect();
  }, [transcriptMounted, followTranscript]);

  useEffect(() => {
    const release = () => {
      if (!userDragging.current) return;
      userDragging.current = false;
      scrollIntentAt.current = -Infinity;
      followTranscript();
    };
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    document.addEventListener("lostpointercapture", release, true);
    window.addEventListener("blur", release);
    return () => {
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      document.removeEventListener("lostpointercapture", release, true);
      window.removeEventListener("blur", release);
    };
  }, [followTranscript]);

  useEffect(() => {
    /** 路由原生快捷键：真实模态独占，忙时 Esc 中止，空闲双 Esc 打开检查点。[in] event：键盘事件。返回值：无。 */
    function shortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (document.activeElement?.closest(".plan-pane") || (event.target instanceof Element && event.target.closest(".plan-pane"))) return;
      if (modal || extensionRequests.length || contextComment || document.querySelector('[role="menu"]') || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : document.activeElement;
      const inConversation = Boolean(target?.closest(".conversation")) || target === document.body || target === document.documentElement || target === null;
      if (btwUIRef.current.open && event.key === "/") return;
      if (btwUIRef.current.open && target?.closest(".btw-panel") && event.key === "Tab") return;
      if (event.key === "Escape" && (inConversation || (btwUIRef.current.open && btwUIRef.current.surface === "history"))) {
        if (btwUIRef.current.open) {
          event.preventDefault(); event.stopPropagation(); escapeAt.current = null;
          if (!event.repeat) {
            if (target?.matches(".btw-panel textarea")) browseBtw();
            else {
              const ui = btwUIRef.current;
              const selectedId = btwScopes.current.get(ui.scopeKey)?.selectedId;
              const selected = viewRef.current.records.find((record) => record.id === selectedId && btwOwners.current.get(record.id)?.scope === ui.scopeKey);
              // 总览遵循原生终端：先停止所选旁问；不可误停主任务或另一个主题。
              if (ui.surface === "history" && selected && (selected.followUps?.at(-1) ?? selected).status === "running") void stopBtw(selected.id);
              else { btwEscapeUntil.current = Date.now() + DOUBLE_ESCAPE_WINDOW_MS; closeBtw(); }
            }
          }
          return;
        }
        if (Date.now() < btwEscapeUntil.current) {
          event.preventDefault(); event.stopPropagation(); escapeAt.current = null; return;
        }
      }
      if (btwUIRef.current.open && btwUIRef.current.surface === "history") return;
      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.repeat &&
        !event.defaultPrevented &&
        (readOnlyPath || viewRef.current.state?.sessionId) &&
        !document.activeElement?.closest(
          'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
        ) &&
        composer.current &&
        !composer.current.disabled
      ) {
        event.preventDefault();
        const input = composer.current;
        input.focus();
        input.setRangeText(
          "/",
          input.selectionStart,
          input.selectionEnd,
          "end",
        );
        setDraft(input.value);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (event.repeat) return;
        if (viewRef.current.busy) {
          escapeAt.current = null;
          void window.desktop.request({ type: "abort" }).catch(report);
          return;
        }
        if (
          pending ||
          loadingHistory ||
          viewRef.current.connection === "starting"
        ) {
          escapeAt.current = null;
          return;
        }
        const now = Date.now();
        if (
          escapeAt.current !== null &&
          now - escapeAt.current < DOUBLE_ESCAPE_WINDOW_MS
        ) {
          escapeAt.current = null;
          void perform(async () => {
            await openRewind();
          });
        } else escapeAt.current = now;
      } else if (
        event.key.toLowerCase() === "p" &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        if (!event.repeat)
          void cyclePreset(event.shiftKey ? "backward" : "forward");
      } else if (event.key.toLowerCase() === "p" && event.altKey) {
        event.preventDefault();
        if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.shiftKey && !modelDisabled)
          void perform(() => openModelHub(true));
      } else if (event.key.toLowerCase() === "m" && event.altKey) {
        event.preventDefault();
        if (!transitionDisabled) void perform(() => openModels());
      } else if (event.key.toLowerCase() === "f" && event.altKey) {
        event.preventDefault();
        if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.shiftKey && !modelDisabled && connected && !fastPendingRef.current)
          void perform(() => toggleFast());
      } else if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        if (!modelDisabled)
          void perform(() => changeModel({ type: "cycle_thinking_level" }));
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });

  /** 切换角色/作用域时展示原生配置值。[in] name：角色；[in] scope：配置作用域。返回值：无。 */
  function selectRole(name: string, scope: "global" | "project") {
    setRoleName(name);
    setRoleScope(scope);
    const selected = roles.find((role) => role.role === name);
    setRoleValue(
      (scope === "project" ? selected?.project : selected?.global) ?? "",
    );
    setRoleModel("");
    setRoleThinking("");
  }

  const sessionBrowser = (
    <>
      <div className="modal-body">
        <label>
          搜索所有工作区会话
          <input
            value={sessionSearch}
            onChange={(event) => changeSessionSearch(event.target.value)}
            placeholder="标题、工作目录或文件路径"
          />
        </label>
        <div className="action-row">
          <button
            disabled={pending}
            onClick={() =>
              void perform(async () => {
                const path = await window.desktop.choosePath("session");
                if (path) await openSession(path);
              })
            }
          >
            导入 JSONL 会话
          </button>
          <button
            disabled={pending}
            onClick={() => void perform(() => reloadSessions())}
          >
            刷新列表
          </button>
        </div>
        <div className="session-browser">
          {visibleSessions.length ? (
            visibleSessions.map((session) => (
              <button
                key={session.path}
                className="session-browser-item"
                disabled={pending}
                onClick={() => void perform(() => openSession(session))}
              >
                <strong>{session.title || "未命名会话"}</strong>
                <span>{session.cwd}</span>
                <small>
                  {new Date(session.modified).toLocaleString("zh-CN")} ·{" "}
                  {session.path}
                </small>
              </button>
            ))
          ) : (
            <p className="empty-note">
              没有匹配的 CLI 会话。可以导入会话文件或连接后新建。
            </p>
          )}
        </div>
      </div>
    </>
  );

  return (
    <PromptContexts.Provider value={promptContextActions}>
    <LocalCommentMarkers.Provider value={{ entries: commentDraft.activeComments, edit: (id, anchor, trigger) => { const entry = commentDraft.activeComments.find((item) => item.id === id); if (entry) editPendingComment(entry, anchor, trigger); } }}>
    <WebLinks.Provider value={openWebLink}>
    <FileReferencePreview.Provider value={previewMessageFile}>
    <OutputFileProbe.Provider value={probeOutputFile}>
    <div
      className="desktop-shell"
      style={
        {
          "--conversation-gutter": `${spacing.gutter}px`,
          "--sidebar-width": `${sidebarSize.width}px`,
        } as CSSProperties
      }
    >
      <aside
        className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}
        aria-label="会话导航"
      >
        <SidebarResizeHandle
          width={sidebarSize.width}
          onWidth={sidebarSize.setWidth}
        />
        <div className="sidebar-actions">
          <button
            className="mobile-only icon-button"
            aria-label="收起导航"
            onClick={() => setSidebarOpen(false)}
          >
            ×
          </button>
        </div>
        <button
          className="new-session"
          disabled={pending || Boolean(loadingHistory) || !launch.executable || !(selectedProject ?? launch.cwd)}
          title={`在 ${selectedProject ?? launch.cwd} 中新建会话`}
          onClick={() =>
            void perform(newProjectSession)
          }
        >
          <span aria-hidden="true">＋</span> 新建会话
        </button>
        <label className="sidebar-search">
          <span className="sr-only">搜索会话</span>
          <input
            value={sessionSearch}
            onChange={(event) => changeSessionSearch(event.target.value)}
            placeholder="搜索所有工作区…"
          />
        </label>
        <div className="sidebar-section">
          <span>项目</span>
          <button
            className="text-button"
            disabled={pending}
            onClick={() => void perform(() => reloadSessions())}
          >
            刷新
          </button>
        </div>
        <nav ref={projectList} className="session-list">
          {liveProjectOrder
            .filter((cwd) => sessionGroups.has(cwd))
            .map((cwd) => {
              const group = sessionGroups.get(cwd)!;
              const collapsed = (
                sessionSearch ? searchCollapsedProjects : collapsedProjects
              ).has(cwd);
              const regionId = projectRegionIds.current.get(cwd)!;
              return (
                <section
                  className={`project-group${draggedProject === cwd ? " project-dragging" : ""}${projectDrop?.cwd === cwd ? ` project-drop-${projectDrop.position}` : ""}`}
                  key={group.cwd}
                  aria-label={group.cwd}
                >
                  <h2 className="project-heading" title={group.cwd}>
                    <button
                      className="project-toggle"
                      type="button"
                      aria-expanded={!collapsed}
                      aria-controls={regionId}
                      aria-pressed={selectedProject === cwd}
                      title={`${group.cwd}\n点击折叠或展开；拖动排序；Alt+↑/↓ 调整位置`}
                      draggable={false}
                      onClick={(event) => toggleProject(event, cwd)}
                      onPointerDown={(event) => startProjectPointer(event, cwd)}
                      onKeyDown={(event) => reorderProjectByKey(event, cwd)}
                      onDragStart={(event) => event.preventDefault()}
                    >
                      <svg
                        className="project-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1" />
                        <path d="M5 10h15a1 1 0 0 1 1 1.3l-2 7a2 2 0 0 1-2 1.7H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" />
                      </svg>
                      <span>
                        {group.name}
                        {group.caption && <small>{group.caption}</small>}
                      </span>
                      <svg
                        className="project-chevron"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m4 6 4 4 4-4" />
                      </svg>
                    </button>
                  </h2>
                  <div
                    className="project-sessions"
                    id={regionId}
                    hidden={collapsed}
                  >
                    {group.sessions.map((session) => (
                      <button
                        className={`session-item ${session.path === view.state?.sessionFile ? "selected" : ""}${multiSelectSessions && selectedSessionPaths.has(session.path) ? " multi-selected" : ""}`}
                        key={session.path}
                        title={`${session.title || "未命名会话"}\n${session.cwd}\n${new Date(session.modified).toLocaleString("zh-CN")}${session.parentSession ? " · 派生会话" : ""}\n${session.path}`}
                        aria-pressed={multiSelectSessions && selectedSessionPaths.has(session.path)}
                        aria-description="普通单击打开；Ctrl+单击切换批量选择，右键操作已选会话"
                        aria-current={
                          session.path === view.state?.sessionFile
                            ? "page"
                            : undefined
                        }
                        disabled={pending}
                        onClick={(event) => {
                          setSessionMenu(undefined);
                          if (event.ctrlKey || event.metaKey) {
                            setSelectedSessionPaths((previous) => {
                              const next = new Set(previous);
                              if (next.has(session.path)) next.delete(session.path);
                              else next.add(session.path);
                              return next;
                            });
                            return;
                          }
                          setSelectedSessionPaths(new Set([session.path]));
                          void perform(() => openSession(session));
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          const targets = selectedSessionPaths.has(session.path)
                            ? sessions.filter((item) => selectedSessionPaths.has(item.path))
                            : [session];
                          if (!selectedSessionPaths.has(session.path))
                            setSelectedSessionPaths(new Set([session.path]));
                          // 键盘菜单键没有指针坐标，改用条目位置。
                          const rect = event.currentTarget.getBoundingClientRect();
                          setSessionMenu({
                            sessions: targets,
                            x: event.clientX || rect.left + 12,
                            y: event.clientY || rect.bottom,
                          });
                        }}
                      >
                        {enginesByPath[session.path] && <span
                          className={`session-engine-light ${enginesByPath[session.path]!.state}`}
                          role="img"
                          aria-label={SESSION_ENGINE_LABELS[enginesByPath[session.path]!.state]}
                          title={SESSION_ENGINE_LABELS[enginesByPath[session.path]!.state]}
                        />}
                        <span className="session-title">{session.title || "未命名会话"}</span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          {!visibleSessions.length && (
            <p className="sidebar-empty">
              {sessionSearch
                ? "没有匹配的会话，请尝试其他标题或路径。"
                : "暂无会话。可在设置中配置工作目录，发送提示词开始新会话。"}
            </p>
          )}
        </nav>
        {sessionMenu && (
          <SessionMenu
            key={sessionMenu.sessions.map((session) => session.path).join("\u0000")}
            target={sessionMenu}
            current={sessionMenu.sessions.some((session) => session.path === view.state?.sessionFile)}
            onClose={closeSessionMenu}
            onRename={renameSession}
            onDelete={deleteSessions}
            onCopy={(targets, kind) => window.desktop.copySession(targets.map((session) => session.path), kind, launchRef.current.agentDir)}
            onSeance={openSessionConsultation}
            engines={sessionEngines}
            onEngine={changeSessionEngines}
          />
        )}
        <div className="sidebar-footer">
          <button onClick={() => { setSidebarOpen(false); setModal("settings"); }} disabled={pending}>
            设置
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div className="workspace-title">
            <button
              className="mobile-only icon-button"
              aria-label="打开会话导航"
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
            <div>
              <h1>{view.state?.sessionName || "你的编程工作台"}</h1>
              <p title={launch.cwd}>
                {launch.cwd || "选择真实工作目录，不使用模拟后端"}
              </p>
              {connected && plan.snapshot?.phase === "planning" && <small role="status">计划模式 · 在主对话调研和编写计划，正式提案后审阅</small>}
              {connected && plan.snapshot?.phase === "paused" && <small role="status">计划模式已暂停</small>}
            </div>
          </div>
          <div className="header-actions">
            <button
              className="icon-button"
              aria-label="子代理活动"
              title="子代理活动 · 空输入框连按两次 → 或 ←"
              onClick={() => setModal("agent-activity")}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="12" cy="5" r="3" />
                <circle cx="5" cy="19" r="3" />
                <circle cx="19" cy="19" r="3" />
                <path d="M12 8v4M5 16v-4h14v4" />
              </svg>
            </button>
            <button
              className="icon-button"
              aria-label="文件与变更"
              title="文件与变更"
              aria-expanded={codeReviewOpen && !browserOpen}
              aria-controls="project-code-review"
              disabled={!launch.cwd}
              onClick={() => {
                plan.hide();
                setCodeReviewOpen(browserOpen || !codeReviewOpen);
                setBrowserOpen(false);
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6" />
              </svg>
            </button>
            {plan.snapshot && ["review", "applying"].includes(plan.snapshot.phase) && (
              <button className="icon-button" aria-label="计划待审阅" title="打开／收起计划审阅" onClick={() => plan.visible ? plan.hide() : plan.show()}>▤</button>
            )}
            <button
              ref={browserButton}
              className="icon-button"
              aria-label="浏览器"
              title="浏览器"
              aria-expanded={browserOpen}
              aria-controls="web-browser-panel"
              onClick={() => {
                if (browserOpen) hideBrowser();
                else {
                  plan.hide();
                  browserTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                  setBrowserStarted(true);
                  setBrowserOpen(true);
                }
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <ellipse cx="12" cy="12" rx="4" ry="9" />
                <path d="M3 12h18" />
              </svg>
            </button>
            <button
              className="icon-button"
              disabled={transitionDisabled}
              aria-label="重新读取原生会话历史"
              title="重新读取状态及完整分页历史"
              onClick={() => void perform(refresh)}
            >
              ↻
            </button>
            <button
              className="icon-button"
              aria-label="查看全部命令"
              onClick={() => setModal("commands")}
            >
              ⌘
            </button>
          </div>
        </header>
        {view.error && (
          <div className="connection-banner" role="status">
            <span>{view.error}</span>
            <button disabled={pending} onClick={() => setModal("settings")}>
              查看设置
            </button>
          </div>
        )}
        <div className="workspace-columns">
          <section className="conversation" aria-label="主会话">
            {modal === "rewind" ? (
              <RewindMode
                entries={entries}
                leafId={leaf}
                disabled={pending}
                onNavigate={(entry) => void perform(() => navigate(entry))}
                onCancel={() => {
                  restoreComposerFocus.current = true;
                  closeModal();
                }}
                sessionId={view.state?.sessionId ?? ""}
              />
            ) : (
              <div
                className="transcript"
                ref={attachTranscript}
                onWheelCapture={markScrollIntent}
                onTouchMoveCapture={markScrollIntent}
                onClickCapture={markScrollIntent}
                onPointerDownCapture={() => {
                  userDragging.current = true;
                  markScrollIntent();
                }}
                onKeyDown={(event) => {
                  if (event.defaultPrevented || event.nativeEvent.isComposing ||
                    (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable='true']"))) return;
                  if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key))
                    markScrollIntent();
                }}
                onScroll={() => {
                  const element = scroll.current;
                  if (!element) return;
                  // 浏览器夹紧、锚定或历史重挂载产生的 scroll 不能取消跟随。
                  if (userDragging.current || performance.now() - scrollIntentAt.current < 250) {
                    stickToBottom.current =
                      element.scrollHeight - element.scrollTop - element.clientHeight < 90;
                    setJumpVisible(!stickToBottom.current);
                  } else followTranscript();
                }}
              >
                <div className="transcript-content">
                {loadingHistory && (
                  <div className="history-loading" role="status">
                    {loadingHistory}
                  </div>
                )}
                {!view.messages.length && !loadingHistory && (
                  <div className="welcome">
                    <span className="welcome-mark">π</span>
                    <h2>在这里，继续你的下一步。</h2>
                    <p>选择已有会话，或输入任务开始聊天。</p>
                    <div className="welcome-actions">
                      {!canCompose && (
                        <button
                          className="primary"
                          onClick={() => setModal("settings")}
                        >
                          配置工作目录
                        </button>
                      )}
                      <button onClick={() => setModal("sessions")}>
                        打开已有会话
                      </button>
                    </div>
                    <div className="shortcut-grid">
                      <span>
                        <kbd>Ctrl P</kbd> 切换预设角色模型
                      </span>
                      <span>
                        <kbd>Alt P</kbd> 明确选择模型
                      </span>
                      <span>
                        <kbd>Alt M</kbd> 持久化模型角色
                      </span>
                      <span>
                        <kbd>Shift Tab</kbd> 循环思考等级
                      </span>
                      <span>
                        <kbd>{FAST_SHORTCUT.replace("+", " ")}</kbd> 切换 Fast 模式
                      </span>
                      <span>
                        <kbd>Esc Esc</kbd> 回退会话上下文
                      </span>
                      <span>
                        <kbd>/tree</kbd> 同文件分支导航
                      </span>
                    </div>
                  </div>
                )}
                <MessageFileMenu.Provider value={openFileMenu}>
                  <Transcript
                    key={`${view.state?.sessionId}:${transcriptEpoch}`}
                    messages={view.messages}
                    tools={view.tools}
                    busy={view.busy || promptSubmitting}
                    runStart={runStart}
                    sessionId={view.state?.sessionId ?? ""}
                    onOpenFile={openMessageFile}
                    planCardState={planCardStates.get(view.state?.sessionFile ?? view.state?.sessionId ?? "")}
                    onPlanCardToggle={(id, expanded) => {
                      const scope = view.state?.sessionFile ?? view.state?.sessionId ?? "";
                      setPlanCardStates((previous) => {
                        const next = new Map(previous);
                        next.set(scope, new Map(previous.get(scope)).set(id, expanded));
                        return next;
                      });
                    }}
                    onOpenPlanSession={async (id) => {
                      try {
                        const available = await window.desktop.listSessions(launchRef.current.agentDir);
                        const target = available.find((session) => session.id === id);
                        if (!target) throw new Error("目标会话已不存在");
                        await openSession(target);
                      } catch (error) { report(error); }
                    }}
                    outline
                  />
                </MessageFileMenu.Provider>
                {view.busy && view.state?.isCompacting && (
                  <div className="agent-status" role="status">
                    <span className="spinner" />
                    正在压缩上下文…
                  </div>
                )}
                </div>
              </div>
            )}
            {jumpVisible && modal !== "rewind" && (
              <button
                className="jump-button"
                onClick={resumeTranscript}
              >
                ↓ 跳至最新消息
              </button>
            )}
            <div className={`composer-area${btwOpen && btwUI.surface === "inline" ? " btw-expanded" : ""}`} hidden={modal === "rewind"}>
              <div className="btw-shared-content">
              <Toasts items={notices} dismiss={dismissNotice} />
              <TodoPanel
                key={view.state?.sessionFile ?? view.state?.sessionId ?? "new"}
                phases={view.todoPhases}
                recap={recap}
              />
              </div>
              {btwOpen && (
                <WebLinks value={openWebLink}>
                  <MessageFileLinks value={openMessageFile}>
                    <MessageFileMenu value={openFileMenu}>
                      <BtwPanel records={btwRecords} selectedId={btwScope.selectedId} surface={btwUI.surface} mode={btwUI.mode}
                        historyDetail={btwUI.historyDetail} draft={btwDraft} history={btwScope.history}
                        error={btwError} storageError={btwScope.storageError} connected={connected}
                        submitting={btwSubmitting} runningId={runningTopic?.id} stopping={Boolean(btwStopping)}
                        blocked={pending || Boolean(loadingHistory) || plan.snapshot?.phase === "applying" || !canCompose || btwMissing}
                        focusRequest={btwUI.focusRequest} focusTarget={btwUI.focusTarget}
                        scroll={btwScope.scrolls.get(btwSlot) ?? { top: 0, follow: false }}
                        onScroll={(value) => { const previous = btwScope.scrolls.get(btwSlot); btwScope.scrolls.set(btwSlot, value); if (!previous || previous.top !== value.top || previous.follow !== value.follow) renderBtw(); }}
                        onDraft={(text, selection) => { const previous = getBtwDraft(btwScope, btwSlot); btwScope.drafts.set(btwSlot, { text, revision: previous.revision + 1, selection }); setBtwCopy(undefined); renderBtw(); }}
                        onSelection={(selection) => { const previous = getBtwDraft(btwScope, btwSlot); btwScope.drafts.set(btwSlot, { ...previous, selection }); }}
                        onSelect={(id) => selectBtw(id, "history")}
                        onHistoryDetail={(value) => updateBtwUI({ historyDetail: value, focusTarget: value ? "reader" : "list", focusRequest: btwUIRef.current.focusRequest + 1 })}
                        onNew={() => selectBtw(undefined)} onHistory={() => { void openBtw("history"); }}
                        onRefresh={() => { void loadBtwHistory(true); }}
                        onSubmit={() => { if (!btwMissing) void askBtw(getBtwDraft(btwScope, btwSlot).text, btwScope.selectedId); }}
                        onClose={() => closeBtw()} onStop={() => { if (runningTopic) void stopBtw(runningTopic.id); }}
                        onCopy={() => { if (currentTopic) void copyBtw(currentTopic); }}
                        copyLabel={btwCopy?.id === currentTopic?.id ? btwCopy?.label : undefined}
                        transferDisabled={!connected || pending || Boolean(loadingHistory)}
                        onBrowse={browseBtw}
                        onCompose={() => {
                          if (btwUI.surface === "history") btwScope.scrolls.set(btwSlot, { top: 0, follow: true });
                          updateBtwUI({ historyDetail: true, focusTarget: "editor", focusRequest: btwUIRef.current.focusRequest + 1 });
                        }}
                        onInsert={() => { if (!currentTopic || !connected) return; const text = topicText(currentTopic); resetDraft(text); setDraftImages([]); btwMainSelection.current = { start: text.length, end: text.length, direction: "none", top: 0 }; closeBtw(); }}
                        onSendMain={() => { if (currentTopic && connected && !pending && !loadingHistory) void perform(() => send({ text: topicText(currentTopic), consumeDraft: false })); }}
                        onMenuOpenChange={setBtwMenuOpen}
                      />
                    </MessageFileMenu>
                  </MessageFileLinks>
                </WebLinks>
              )}
              {!btwOpen && btwStatus && <BtwStatusBar label={btwStatus} canStop={Boolean(runningTopic)} stopping={Boolean(btwStopping)} onOpen={() => { void openBtw("history"); }} onStop={() => { if (runningTopic) void stopBtw(runningTopic.id); }} />}
              <div className="main-composer-region" hidden={btwOpen}>
              <PendingComments entries={commentDraft.activeComments} revealingId={revealingCommentId} onEdit={(entry, anchor, trigger) => { void revealPendingComment(entry, anchor, trigger); }} onDelete={removePendingComment} />
              {view.state?.queuedMessages && (
                <div className="queued-messages">
                  {(["steering", "followUp"] as const).flatMap((queue) =>
                    view.state!.queuedMessages![queue].map((message, index) => (
                      <div className="queue-chip" key={`${queue}:${index}`}>
                        <span>
                          {queue === "steering" ? "引导" : "后续"}：{stripCommentPreamble(message)}
                        </span>
                        <button
                          aria-label={`移除队列消息 ${stripCommentPreamble(message)}`}
                          onClick={() =>
                            void window.desktop
                              .request({
                                type: "remove_queued_message",
                                message,
                                queue,
                              })
                              .catch(report)
                          }
                        >
                          ×
                        </button>
                      </div>
                    )),
                  )}
                </div>
              )}
              {draftImages.length > 0 && (
                <div className="draft-images">
                  {draftImages.map((image, index) => (
                    <div key={index}>
                      <NativeImage
                        image={image}
                        label={`恢复的图片 ${index + 1}`}
                      />
                      <button
                        aria-label="移除草稿图片"
                        onClick={() =>
                          setDraftImages((old) =>
                            old.filter((_, i) => i !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <small>从原生树节点恢复的图片会连同草稿发送。</small>
                </div>
              )}
              {roleCycle && (
                <div
                  className="model-cycle-track"
                  role="status"
                  aria-label="预设角色模型切换"
                >
                  <div className="model-cycle-segments">
                    {roleCycle.order.map((role, index) => (
                      <span
                        key={`${role}:${index}`}
                        className={role === roleCycle.role ? "active" : ""}
                        aria-current={
                          role === roleCycle.role ? "true" : undefined
                        }
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                  <small>Ctrl+P 下一角色 · Ctrl+Shift+P 上一角色</small>
                </div>
              )}
              <div className="composer-box">
                <ComposerFileReferences
                  draft={draft}
                  input={composer}
                  editingToken={mentions.editingToken}
                  confirmedPaths={mentions.confirmedPaths}
                  composing={mentions.composing}
                  onOpen={openMessageFile}
                  onSelectionChange={mentions.observe}
                >
                <textarea
                  ref={composer}
                  rows={3}
                  aria-label="输入任务或原生 slash 命令"
                  placeholder={
                    planRefining && plan.snapshot?.phase === "review"
                      ? "输入完善意见，发送即退回规划"
                      : predicted ??
                        (canCompose
                          ? "描述任务，或输入 / 查看命令…"
                          : "请先在设置中配置工作目录…")
                  }
                  data-prediction={predicted ? "true" : undefined}
                  title={predicted ? "Tab 或 → 采用预测的提示词" : undefined}
                  value={draft}
                  aria-autocomplete="list"
                  aria-controls={
                    mentions.active ? "mention-suggestions" : slashMatches.length ? "slash-suggestions" : undefined
                  }
                  aria-activedescendant={
                    mentions.paths.length
                      ? `mention-option-${mentions.index}`
                      : slashMatches.length
                        ? `slash-option-${slashIndex}`
                        : undefined
                  }
                  disabled={!canCompose || pending || connecting || Boolean(loadingHistory)}
                  onChange={(event) => mentions.change(event.currentTarget)}
                  onSelect={(event) => mentions.observe(event.currentTarget)}
                  onFocus={(event) => mentions.focus(event.currentTarget)}
                  onBlur={mentions.blur}
                  onCompositionStart={(event) => mentions.composition(true, event.currentTarget)}
                  onCompositionEnd={(event) => mentions.composition(false, event.currentTarget)}
                  onKeyDown={(event) => {
                    if (mentions.composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                    if (mentions.keyDown(event)) return;
                    if (
                      predicted &&
                      !draft &&
                      (event.key === "Tab" || event.key === "ArrowRight") &&
                      !event.ctrlKey &&
                      !event.altKey &&
                      !event.metaKey &&
                      !event.shiftKey
                    ) {
                      // 与原生一致：只放入输入框，不自动发送。
                      event.preventDefault();
                      setDraft(predicted);
                      return;
                    }
                    const queued = view.state?.queuedMessages;
                    if (
                      event.key === "ArrowUp" &&
                      (event.altKey || event.shiftKey) &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      (queued?.steering.length || queued?.followUp.length)
                    ) {
                      event.preventDefault();
                      if (!pending) void perform(dequeueLast);
                      return;
                    }
                    if (
                      event.ctrlKey &&
                      !event.altKey &&
                      !event.metaKey &&
                      !event.shiftKey &&
                      (event.key === "Enter" || event.key.toLowerCase() === "q")
                    ) {
                      event.preventDefault();
                      if (!pending && !loadingHistory)
                        void perform(() => submitComposer("followUp"), !/^\s*\/btw(?:\s|$)/.test(draft));
                      return;
                    }
                    if (
                      slashMatches.length &&
                      (event.key === "ArrowDown" || event.key === "ArrowUp")
                    ) {
                      event.preventDefault();
                      setSlashSelection({
                        query: draft,
                        index: Math.max(
                          0,
                          Math.min(
                            slashMatches.length - 1,
                            slashIndex + (event.key === "ArrowDown" ? 1 : -1),
                          ),
                        ),
                      });
                      return;
                    }
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      if (!pending && !loadingHistory)
                        void perform(
                          slashMatches.length &&
                            draft !== `/${slashMatches[slashIndex].name}`
                            ? () => selectCommand(slashMatches[slashIndex].name)
                            : () => submitComposer("steer"),
                          !(slashMatches.length && draft !== `/${slashMatches[slashIndex].name}` ? slashMatches[slashIndex].name === "btw" : /^\s*\/btw(?:\s|$)/.test(draft)),
                        );
                    }
                  }}
                />
                </ComposerFileReferences>
                {mentions.active && (
                  <div
                    className="slash-menu mention-menu"
                    id="mention-suggestions"
                    role="listbox"
                    aria-label="引用文件补全"
                    aria-busy={mentions.loading}
                  >
                    {mentions.paths.map((path, index) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === mentions.index}
                        id={`mention-option-${index}`}
                        key={path}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => mentions.select(index)}
                        onClick={() => mentions.choose(path)}
                        title={path}
                      >
                        <strong>{path}</strong>
                      </button>
                    ))}
                    {mentions.loading && <div className="mention-status" role="status">正在搜索文件…</div>}
                    {mentions.error && <div className="mention-status" role="alert">{mentions.error}</div>}
                    {!mentions.loading && !mentions.error && !mentions.paths.length && (
                      <div className="mention-status" role="status">没有匹配的文件</div>
                    )}
                  </div>
                )}
                {slashMatches.length > 0 && (
                  <div
                    className="slash-menu"
                    id="slash-suggestions"
                    role="listbox"
                    aria-label="slash 命令补全"
                  >
                    {slashMatches.map((command, index) => (
                      <button
                        role="option"
                        aria-selected={index === slashIndex}
                        id={`slash-option-${index}`}
                        onMouseEnter={() =>
                          setSlashSelection({ query: draft, index })
                        }
                        key={command.name}
                        onClick={() =>
                          void perform(() => selectCommand(command.name), command.name !== "btw")
                        }
                      >
                        <span className="command-icon" aria-hidden="true">
                          {commandIcon(command)}
                        </span>
                        <strong>/{command.name}</strong>
                        <span>{command.description}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="composer-toolbar">
                  <div>
                    <button
                      className="model-button"
                      disabled={modelDisabled}
                      title="Alt+P · 当前会话明确模型选择"
                      onClick={() => void perform(() => openModelHub(true))}
                    >
                      {displayedModel?.model?.name ??
                        displayedModel?.model?.id ??
                        "未配置模型"}{" "}
                      <span>⌄</span>
                    </button>
                    <button
                      className="text-button"
                      disabled={modelDisabled}
                      title="Shift+Tab · 循环原生思考等级"
                      onClick={() =>
                        void perform(() =>
                          changeModel({ type: "cycle_thinking_level" }),
                        )
                      }
                    >
                      思考：{displayedModel?.thinkingLevel ?? "继承"}
                    </button>
                    <FastToggle
                      state={fastPending ? fastPendingState.current : view.state}
                      disabled={modelDisabled || !connected}
                      pending={fastPending}
                      onToggle={() => {
                        if (!fastPendingRef.current) void perform(() => toggleFast());
                      }}
                    />
                  </div>
                  <div>
                    {(view.busy || plan.snapshot?.phase === "applying") && (
                      <button
                        className="stop-button"
                        onClick={() =>
                          void window.desktop
                            .request({ type: "abort" })
                            .catch(report)
                        }
                      >
                        ■ 停止
                      </button>
                    )}
                    <button
                      className="primary send-button"
                      disabled={
                        !canCompose ||
                        plan.snapshot?.phase === "applying" ||
                        pending ||
                        connecting ||
                        Boolean(loadingHistory) ||
                        (!needsSessionConnection &&
                          !draft.trim() &&
                          !draftImages.length)
                      }
                      onClick={() => void perform(() => submitComposer(), !/^\s*\/btw(?:\s|$)/.test(draft))}
                    >
                      {needsSessionConnection
                        ? pending
                          ? "连接中…"
                          : "连接"
                        : `${view.busy ? "引导" : "发送"} ↑`}
                    </button>
                  </div>
                </div>
                <ContextMeter usage={view.state?.contextUsage} />
              </div>
              <div className="composer-caption">
                <span>
                  {view.busy
                    ? "Enter 引导当前任务 · Ctrl+Enter / Ctrl+Q 排队到下一轮 · Alt+↑ 取回排队消息 · Esc 停止"
                    : "Enter 发送 · Shift+Enter 换行 · Esc 停止"}
                </span>
              </div>
              </div>
            </div>
          </section>
          {plan.snapshot?.document && ["review", "applying"].includes(plan.snapshot.phase) && (
            <WebLinks value={openWebLink}>
              <MessageFileLinks value={openMessageFile}>
                <PlanPanel plan={plan} catalog={modelHub} onCatalog={async () => { setModelHub(await window.desktop.request<NativeModelSnapshot>({ type: "model_hub", action: { op: "list" } })); }} onRefine={() => { pushNotice({ level: "info", title: "继续完善计划：在下方输入意见，发送后退回规划" }); setPlanRefining(true); composer.current?.focus(); }} onError={report} />
              </MessageFileLinks>
            </WebLinks>
          )}
          {browserStarted && (
            <BrowserPanel
              active={browserOpen}
              suspended={browserSuspended}
              contextScope={browserContextScope}
              zoomFactor={interfaceFont.fontSize / DEFAULT_INTERFACE_FONT_SIZE}
              onClose={async () => { hideBrowser(); }}
            />
          )}
          {!browserOpen && codeReviewOpen && launch.cwd && (
            <CodeReviewPanel
              key={fileLinkScope}
              cwd={launch.cwd}
              requestedFile={
                linkedFile?.scope === fileLinkScope
                  ? linkedFile.file
                  : undefined
              }
              browser={window.desktop}
              commentReveal={localCommentReveal}
              onCommentReveal={onLocalCommentReveal}
              suspended={Boolean(modal || extensionRequests.length || contextComment)}
              onClose={() => {
                cancelCommentReveal();
                fileLinkSequence.current += 1;
                setCodeReviewOpen(false);
              }}
            />
          )}
          {!browserOpen && jobsOpen && !codeReviewOpen && modal !== "rewind" && (
            <JobsPane
              output={jobsOutput}
              tools={view.tools}
              pending={jobsPending}
              disabled={!connected}
              onRefresh={() => void openJobs().catch(report)}
              onClose={() => setJobsOpen(false)}
            />
          )}
        </div>
      </main>
      {modal === "tree" && (
        <SessionTreeScreen
          tree={tree}
          leafId={leaf}
          sessionName={view.state?.sessionName}
          suspended={Boolean(extensionRequests.length)}
          onNavigate={navigateFromTree}
          onCancelNavigation={() => window.desktop.cancelTreeNavigation()}
          onLabel={labelTree}
          onDelete={deleteTree}
          onClose={closeModal}
        />
      )}
      {extensionRequests[0] ? (
        <ExtensionDialog
          key={extensionRequests[0].id}
          request={extensionRequests[0]}
          onReply={(response) => void replyUI(response).catch(report)}
          onCancel={cancelExtension}
        />
      ) : modal === "session-required" ? (
        <Dialog title="需要连接会话" onClose={closeModal}>
          <div className="modal-body">
            <p role="alert">连接具体会话 omp 后才能使用此功能。</p>
            <div className="action-row">
              <button onClick={closeModal}>知道了</button>
            </div>
          </div>
        </Dialog>
      ) : modal === "connection-error" ? (
        <Dialog title="无法启动会话" onClose={closeModal}>
          <div className="modal-body">
            <p role="alert">{connectionError}</p>
            <p>
              {readOnlyPath
                ? "草稿已保留，继续只读查看。请解决上述问题后再次连接。"
                : "草稿已保留。请检查连接配置后再次发送。"}
            </p>
          </div>
        </Dialog>
      ) : modal === "settings" ? (
        <Dialog title="设置" onClose={closeModal}>
          <form
            className="modal-body"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(() =>
                connect({ ...launch, sessionPath: undefined }),
              );
            }}
          >
            <fieldset className="display-settings">
              <legend>显示</legend>
              <label>
                界面字体大小：{interfaceFont.fontSize}px
                <input
                  aria-label="界面字体大小"
                  type="range"
                  min={MIN_INTERFACE_FONT_SIZE}
                  max={MAX_INTERFACE_FONT_SIZE}
                  step={1}
                  value={interfaceFont.fontSize}
                  onChange={(event) => interfaceFont.setFontSize(Number(event.target.value))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => interfaceFont.setFontSize(DEFAULT_INTERFACE_FONT_SIZE)}
              >
                恢复默认字号
              </button>
              <p className="muted">按比例缩放整个界面（文字、间距和控件），即时生效并记住此设备的设置。</p>
              <label>
                会话左右留白：{spacing.gutter}px
                <input
                  aria-label="会话左右留白"
                  type="range"
                  min={12}
                  max={160}
                  step={4}
                  value={spacing.gutter}
                  onChange={(event) =>
                    spacing.setGutter(Number(event.target.value))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => spacing.setGutter(DEFAULT_CONVERSATION_GUTTER)}
              >
                恢复默认留白
              </button>
              <p className="muted">
                即时应用到消息和提示词输入区，并记住此设备的设置。
              </p>
              <label className="checkbox-setting">
                <input
                  type="checkbox"
                  checked={predictionSetting.enabled}
                  onChange={(event) =>
                    predictionSetting.setEnabled(event.target.checked)
                  }
                />
                提示词预测
              </label>
              <p className="muted">
                与 omp 的 Composer Predictions
                相同：每轮正常结束后让当前模型预测你的下一条消息，在空输入框中以浅色显示，按
                Tab 或 → 放入输入框（不会自动发送）。每轮会额外发送一次计费请求。
              </p>
            </fieldset>
            <fieldset className="connection-settings">
              <legend>本机 omp 连接</legend>
              <p className="muted">
                直接运行本机 CLI
                子进程。不会自动恢复上次会话；引擎管理模型、认证、工具及磁盘会话。
              </p>
              <label>
                omp 可执行文件
                <div className="path-field">
                  <input
                    value={launch.executable}
                    required
                    onChange={(event) =>
                      setLaunch((old) => ({
                        ...old,
                        executable: event.target.value,
                      }))
                    }
                    placeholder="C:\\…\\omp.exe"
                  />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void browse("engine").catch(report)}
                  >
                    浏览
                  </button>
                </div>
              </label>
              <label>
                工作目录
                <div className="path-field">
                  <input
                    value={launch.cwd}
                    required
                    onChange={(event) =>
                      setLaunch((old) => ({ ...old, cwd: event.target.value }))
                    }
                    placeholder="项目的绝对路径"
                  />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void browse("workspace").catch(report)}
                  >
                    浏览
                  </button>
                </div>
              </label>
              <label>
                Profile（可选）
                <input
                  value={launch.profile ?? ""}
                  onChange={(event) =>
                    setLaunch((old) => ({
                      ...old,
                      profile: event.target.value || undefined,
                    }))
                  }
                  placeholder="使用 CLI 原生 profile"
                />
              </label>
              <label>
                Agent 配置目录（可选）
                <div className="path-field">
                  <input
                    value={launch.agentDir ?? ""}
                    onChange={(event) =>
                      setLaunch((old) => ({
                        ...old,
                        agentDir: event.target.value || undefined,
                      }))
                    }
                    placeholder="留空使用 CLI 默认目录"
                  />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void browse("agentDir").catch(report)}
                  >
                    浏览
                  </button>
                </div>
              </label>
              {view.error && (
                <p className="inline-error" role="alert">
                  {view.error}
                </p>
              )}
              <p className="notice">
                重连会结束旧进程并等待原生保存。运行中的任务请先停止；导入会话会使用文件记录的真实工作目录。
              </p>
              <div className="action-row">
                {connected && (
                  <button
                    type="button"
                    disabled={pending || view.busy}
                    onClick={() =>
                      void perform(async () => {
                        generation.current += 1;
                        invalidateBtw();
                        await window.desktop.stop();
                        setConnection(undefined);
                      })
                    }
                  >
                    断开
                  </button>
                )}
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    pending ||
                    view.busy ||
                    !launch.cwd.trim() ||
                    !launch.executable.trim()
                  }
                >
                  {pending
                    ? "正在连接…"
                    : connected
                      ? "保存并重新连接"
                      : "连接引擎"}
                </button>
              </div>
            </fieldset>
          </form>
        </Dialog>
      ) : modal === "sessions" ? (
        <Dialog title="导入与继续原生会话" onClose={closeModal} wide>
          {sessionBrowser}
        </Dialog>
      ) : modal === "seance" ? (
        <Dialog title="咨询历史会话 · /seance" onClose={closeModal} wide>
          <SeanceForm sessions={sessions} initialSource={seanceArgs.source} initialModel={seanceArgs.model}
            onInspect={window.desktop.inspectSeance} onModels={loadSeanceModels}
            onLaunch={launchSeance} onCancel={closeModal} />
        </Dialog>
      ) : modal === "seance-batch" ? (
        <Dialog title="批量咨询历史会话 · /seance" onClose={closeModal} wide>
          <BatchSeanceForm sessions={seanceSources} onInspect={window.desktop.inspectSeance}
            onModels={loadSeanceModels} onLaunch={launchSeances} onCancel={closeModal} />
        </Dialog>
      ) : modal === "agents" && agentsHub ? (
        <NativeAgentsHub snapshot={agentsHub} onAction={agentsHubAction} onClose={() => setModal(null)} />
      ) : modal === "model-hub" && modelHub ? (
        <NativeModelHub
          snapshot={modelHub}
          onAction={modelHubAction}
          onClose={() => {
            if (temporaryModelHub) restoreComposerFocus.current = true;
            closeModal();
          }}
          temporary={temporaryModelHub}
        />
      ) : modal === "roles" ? (
        <Dialog title="持久化模型角色 · Alt+M" onClose={closeModal} wide>
          <div className="modal-body">
            <p className="notice">
              角色是 CLI 的模型分工，不是人格提示词。更改写入原生项目 /
              全局配置，不会偷偷切换当前会话模型。
            </p>
            <div className="form-grid">
              <label>
                角色
                <select
                  value={roleName}
                  onChange={(event) =>
                    selectRole(event.target.value, roleScope)
                  }
                >
                  {roles.map((role) => (
                    <option value={role.role} key={role.role}>
                      {role.role} · {roleLabels[role.role] ?? "自定义角色"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                作用域
                <select
                  value={roleScope}
                  onChange={(event) =>
                    selectRole(
                      roleName,
                      event.target.value as "project" | "global",
                    )
                  }
                >
                  <option value="project">当前项目</option>
                  <option value="global">全局</option>
                </select>
              </label>
            </div>
            <div className="role-provenance">
              <span>
                当前有效值：
                <code>
                  {roles.find((role) => role.role === roleName)?.value ??
                    "未设置"}
                </code>
              </span>
              <span>
                全局：
                <code>
                  {roles.find((role) => role.role === roleName)?.global ??
                    "继承默认"}
                </code>
              </span>
              <span>
                项目：
                <code>
                  {roles.find((role) => role.role === roleName)?.project ??
                    "继承全局"}
                </code>
              </span>
            </div>
            <div className="form-grid">
              <label>
                从原生 chat 模型选择（可选）
                <select
                  value={roleModel}
                  onChange={(event) => {
                    const model = event.target.value;
                    setRoleModel(model);
                    setRoleThinking("");
                    if (model) setRoleValue(model);
                  }}
                >
                  <option value="">使用下面的原生 selector</option>
                  {models.map((model) => (
                    <option
                      value={`${model.provider}/${model.id}`}
                      key={`${model.provider}/${model.id}`}
                    >
                      {model.provider} / {model.name || model.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                选中模型的思考 effort
                <select
                  value={roleThinking}
                  disabled={!roleModel}
                  onChange={(event) => {
                    setRoleThinking(event.target.value);
                    setRoleValue(
                      `${roleModel}${event.target.value ? `:${event.target.value}` : ""}`,
                    );
                  }}
                >
                  <option value="">继承模型默认</option>
                  {[
                    "off",
                    ...(models.find(
                      (model) => `${model.provider}/${model.id}` === roleModel,
                    )?.thinking?.efforts ?? []),
                  ]
                    .filter((value, index, all) => all.indexOf(value) === index)
                    .map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                </select>
              </label>
            </div>
            <label>
              原生模型 selector
              <input
                value={roleValue}
                onChange={(event) => {
                  setRoleValue(event.target.value);
                  setRoleModel("");
                  setRoleThinking("");
                }}
                placeholder="provider/modelId:effort 或其他原生 selector"
              />
            </label>
            <p className="muted">
              image、speech、dictation、web 等角色可能使用非 chat
              模型，请直接输入其合法 selector；保留完整 :effort。
            </p>
            <div className="action-row">
              <button
                disabled={pending}
                onClick={() =>
                  void perform(async () => {
                    const result = await window.desktop.setRole(
                      roleName,
                      undefined,
                      roleScope,
                    );
                    setRoles(result);
                    setRoleValue("");
                    setRoleModel("");
                    setRoleThinking("");
                  })
                }
              >
                重置
                {roleScope === "project" ? "项目覆盖（继承全局）" : "全局覆盖"}
              </button>
              <button
                className="primary"
                disabled={pending || !roleValue.trim()}
                onClick={() =>
                  void perform(async () => {
                    setRoles(
                      await window.desktop.setRole(
                        roleName,
                        roleValue.trim(),
                        roleScope,
                      ),
                    );
                    await refresh();
                  })
                }
              >
                保存原生角色配置
              </button>
            </div>
          </div>
        </Dialog>
      ) : modal === "checkpoint" ? (
        <Dialog
          title="保留检查点并创建新会话 · /fork"
          onClose={closeModal}
          wide
        >
          <div className="modal-body">
            <p className="notice">
              原生 fork
              将保留选中的消息（含该消息），复制到新会话文件。原会话不截断、不删除。工具批次会保留必要结果。此操作不是磁盘
              / 文件系统回滚。
            </p>
            <label>
              搜索消息
              <input
                value={treeSearch}
                onChange={(event) => setTreeSearch(event.target.value)}
                placeholder="消息内容或 entry id"
              />
            </label>
            <div className="checkpoint-list">
              {entries
                .filter(
                  (entry) =>
                    entry.type === "message" &&
                    entry.message &&
                    activePath.has(entry.id) &&
                    `${entry.id} ${displayMessageText(entry.message)}`
                      .toLowerCase()
                      .includes(treeSearch.toLowerCase()),
                )
                .reverse()
                .map((entry) => (
                  <button
                    className={selectedEntry?.id === entry.id ? "selected" : ""}
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <span>
                      {entry.message?.role} · <code>{entry.id}</code>
                    </span>
                    <p>
                      {displayMessageText(entry.message!).slice(0, 240) ||
                        readable(entry.message).slice(0, 240)}
                    </p>
                  </button>
                ))}
            </div>
            {selectedEntry?.message && (
              <div className="entry-preview">
                <h3>将保留的消息</h3>
                <Transcript
                  key={`${view.state?.sessionId}:${transcriptEpoch}`}
                  messages={[
                    {
                      key: selectedEntry.id,
                      message: selectedEntry.message,
                      streaming: false,
                    },
                  ]}
                  tools={[]}
                  sessionId={view.state?.sessionId ?? ""}
                />
              </div>
            )}
            <div className="action-row">
              <button onClick={closeModal}>取消</button>
              <button
                className="primary"
                disabled={!selectedEntry || pending || transitionDisabled}
                onClick={() =>
                  void perform(() =>
                    transition({ type: "fork", entryId: selectedEntry!.id }),
                  )
                }
              >
                保留此消息并 Fork 到新文件
              </button>
            </div>
          </div>
        </Dialog>
      ) : modal === "commands" ? (
        <Dialog title="快捷键与原生命令" onClose={closeModal} wide>
          <div className="modal-body">
            <div className="shortcut-grid">
              <span>
                <kbd>Ctrl P</kbd> 切换预设角色模型
              </span>
              <span>
                <kbd>Alt P</kbd> 选择会话模型
              </span>
              <span>
                <kbd>Alt M</kbd> 持久化模型角色
              </span>
              <span>
                <kbd>Shift Tab</kbd> 循环思考等级
              </span>
              <span>
                <kbd>{FAST_SHORTCUT.replace("+", " ")}</kbd> 切换 Fast 模式
              </span>
              <span>
                <kbd>Esc</kbd> 忙时停止任务
              </span>
              <span>
                <kbd>Esc Esc</kbd> 空闲时回退会话上下文
              </span>
            </div>
            <p className="muted">
              GUI 接管
              /new、/resume、/fork、/clear、/tree、/rewind、/btw。其他命令原样交给
              CLI，CLI 的拒绝和错误会明确呈现。
            </p>
            <div className="command-list">
              {commandList.map((command) => (
                <button
                  key={command.name}
                  onClick={() =>
                    void perform(() => selectCommand(command.name))
                  }
                >
                  <span className="command-icon" aria-hidden="true">
                    {commandIcon(command)}
                  </span>
                  <strong>/{command.name}</strong>
                  <span>
                    {command.description ?? command.source ?? "CLI 原生命令"}
                  </span>
                  {command.aliases?.length ? (
                    <small>别名：{command.aliases.join(", ")}</small>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </Dialog>
      ) : modal === "clear" ? (
        <Dialog title="新建空会话，而不是删除历史" onClose={closeModal}>
          <div className="modal-body">
            <p>
              GUI 的 /clear 会开启独立的 omp 空会话，原会话进程和全部历史保留，
              不会只隐藏消息，也不会删除任何文件。
            </p>
            <div className="action-row">
              <button onClick={closeModal}>取消</button>
              <button
                className="primary"
                disabled={pending || transitionDisabled}
                onClick={() =>
                  void perform(() => transition({ type: "new_session" }))
                }
              >
                确认新建空会话
              </button>
            </div>
          </div>
        </Dialog>
      ) : modal === "shake" && shakeRequest ? (
        <Dialog title="清理会话重内容（将改写历史）" onClose={closeModal}>
          <div className="modal-body">
            <p>这不是仅对模型隐藏内容：原生 /shake 会改写已保存的会话历史，当前界面和重新打开后的内容都会改变。</p>
            <p>
              {shakeRequest.mode === "elide"
                ? "elide：将符合原生清理规则的工具结果与大段代码／XML 替换为带恢复产物链接的占位内容。"
                : shakeRequest.mode === "images"
                  ? "images：移除历史中的图片块，原有图片将不再展示。"
                  : "thinking：移除模型的思考内容，原有思考过程将不再展示。"}
            </p>
            <p>不会调用模型生成摘要。若需要保留完整展示，请取消；不要把此操作当作无损压缩。</p>
            <div className="action-row">
              <button disabled={pending} onClick={closeModal}>取消</button>
              <button className="primary" disabled={transitionDisabled}
                onClick={() => void perform(executeShake)}>确认改写历史</button>
            </div>
          </div>
        </Dialog>
      ) : null}
      <SubagentActivityHub
        key={`${view.connection}:${view.state?.sessionId ?? ""}`}
        transport={window.desktop}
        sessionId={view.state?.sessionId}
        connected={connected && !readOnlyPath}
        open={modal === "agent-activity"}
        onClose={() => setModal(null)}
      />
      {fileMenu && (
        <FileContextMenu
          key={`${fileMenu.href}\u0000${fileMenu.x}\u0000${fileMenu.y}`}
          target={fileMenu}
          cwd={launch.cwd}
          onClose={closeFileMenu}
        />
      )}
      {contextComment && !nativeComment && (
        <ContextCommentPopover
          key={contextComment.editorId}
          context={contextComment.context}
          anchor={contextComment.anchor}
          unavailableReason={contextComment.unavailableReason}
          confirmLabel={contextComment.entryId ? "保存评论" : "添加到提示词"}
          initialValue={contextComment.comment}
          value={contextComment.comment}
          onChange={(comment) => { const current = contextCommentRef.current; if (current) { const next = { ...current, comment }; contextCommentRef.current = next; setContextComment(next); } }}
          disabled={!canCompose || pending || Boolean(loadingHistory)}
          onCancel={cancelContextComment}
          onConfirm={confirmContextComment}
        />
      )}
    </div>
    </OutputFileProbe.Provider>
    </FileReferencePreview.Provider>
    </WebLinks.Provider>
    </LocalCommentMarkers.Provider>
    </PromptContexts.Provider>
  );
}
