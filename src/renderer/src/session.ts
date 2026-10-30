import type {
  AgentMessage,
  BtwRecord,
  MessageContent,
  RpcFrame,
  SessionState,
  SlashCommand,
  ReadOnlySession,
} from "../../shared/protocol";
import {
  parseTodoPhases,
  todoPhasesFromMessages,
  todoResultPhases,
  type TodoPhase,
} from "../../shared/todo";
import { parsePlanStatus } from "./plan-status";
import { streamedMessage } from "../../shared/streamed-message";
import { stripCommentPreamble } from "./prompt-context";

export interface TimelineMessage {
  key: string;
  message: AgentMessage;
  streaming: boolean;
}

export interface ToolActivity {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
  error?: boolean;
  running: boolean;
}

export interface SessionView {
  connection: "starting" | "connected" | "disconnected" | "error" | "readonly";
  error?: string;
  state?: SessionState;
  messages: TimelineMessage[];
  activeMessage?: string;
  tools: ToolActivity[];
  todoPhases: TodoPhase[];
  records: BtwRecord[];
  commands: SlashCommand[];
  logs: { id: number; text: string; error: boolean }[];
  revision: number;
  busy: boolean;
}

export type SessionAction =
  | { type: "readonly"; snapshot: ReadOnlySession }
  | { type: "reset" }
  | { type: "frame"; frame: RpcFrame }
  | {
      type: "history";
      messages: AgentMessage[];
      state: SessionState;
      records?: BtwRecord[];
      todoPhases?: TodoPhase[];
    }
  | { type: "state"; state: SessionState }
  | { type: "records"; records: BtwRecord[] }
  | { type: "plan-status"; sessionId: string; messages: AgentMessage[] }
  | { type: "log"; text: string; error?: boolean };

export const initialSession: SessionView = {
  connection: "disconnected",
  messages: [],
  tools: [],
  todoPhases: [],
  records: [],
  commands: [],
  logs: [],
  revision: 0,
  busy: false,
};

/** 界面显示和检索用的消息文本：用户消息去掉评论开头说明。只影响显示，会话数据和发给模型的文本不变。 */
export function displayMessageText(message: AgentMessage): string {
  const text = messageText(message);
  return message.role === "user" ? stripCommentPreamble(text) : text;
}

/** 提取原生角色的可读预览。[in] message：完整原生消息。返回值：正文、执行载荷、摘要、文件内容或未识别载荷的 JSON。 */
export function messageText(message: AgentMessage): string {
  // 执行、摘要和文件消息没有 content，必须先按原生角色读取独立载荷。
  switch (message.role) {
    case "bashExecution":
      if (
        typeof message.command === "string" &&
        typeof message.output === "string"
      )
        return [message.command, message.output].filter(Boolean).join("\n");
      break;
    case "pythonExecution":
      if (
        typeof message.code === "string" &&
        typeof message.output === "string"
      )
        return [message.code, message.output].filter(Boolean).join("\n");
      break;
    case "branchSummary":
    case "compactionSummary":
      if (typeof message.summary === "string") return message.summary;
      break;
    case "fileMention":
      if (Array.isArray(message.files))
        return message.files
          .map((file) =>
            [file.path, file.content, file.skippedReason]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n");
      break;
    case "user":
    case "developer":
    case "assistant":
    case "toolResult":
    case "custom":
    case "hookMessage":
      if (typeof message.content === "string") return message.content;
      if (Array.isArray(message.content))
        return message.content
          .map((part) => {
            if (part.type === "text") return part.text ?? "";
            if (part.type === "thinking")
              return part.thinking ?? part.text ?? "";
            if (
              part.type === "image" ||
              part.type === "toolCall" ||
              part.type === "toolcall"
            )
              return "";
            return readable(part);
          })
          .filter(Boolean)
          .join("\n");
      break;
  }
  // 未识别角色或不符合已知结构的载荷不能变成空白消息。
  return readable(message);
}

/** 将原生对象格式化为可读文本。[in] value：任意 RPC 数据。返回值：原始字符串或缩进 JSON。 */
export function readable(value: unknown): string {
  return typeof value === "string"
    ? value
    : (JSON.stringify(value, null, 2) ?? "");
}

/** 为消息建立稳定标识。[in] message：原生消息；[in] index：历史位置。返回值：界面键值。 */
function historyKey(message: AgentMessage, index: number): string {
  return `history:${index}:${message.role}:${message.timestamp ?? ""}:${message.toolCallId ?? ""}`;
}

/** 追加独立引擎日志并将真实错误提供给现有错误提示，不伪造聊天消息。[in] view：当前视图；[in] text：日志文本；[in] error：是否为真实错误。返回值：保留连接状态并更新日志及错误提示的视图。 */
function appendLog(
  view: SessionView,
  text: string,
  error = false,
): SessionView {
  return {
    ...view,
    // 错误复用现有提示；普通通知不能覆盖尚未清除的错误。
    error: error ? text : view.error,
    logs: [...view.logs, { id: (view.logs.at(-1)?.id ?? 0) + 1, text, error }],
  };
}

/** 更新 BTW 完整记录或流式末轮。[in] records：原生主题；[in] frame：原生 BTW 事件。返回值：主题列表。 */
function updateBtw(records: BtwRecord[], frame: RpcFrame): BtwRecord[] {
  if (frame.type === "btw_record") {
    const record = frame.record as BtwRecord;
    return records.some((item) => item.id === record.id)
      ? records.map((item) => (item.id === record.id ? record : item))
      : [record, ...records];
  }
  return records.map((record) => {
    if (record.id !== frame.recordId) return record;
    const delta = String(frame.delta ?? "");
    if (!record.followUps?.length)
      return { ...record, answer: record.answer + delta };
    return {
      ...record,
      followUps: record.followUps.map((turn, index, turns) =>
        index === turns.length - 1
          ? { ...turn, answer: turn.answer + delta }
          : turn,
      ),
    };
  });
}


/** 归并原生帧及完整历史，agent_end 绝不替换 transcript。[in] view：旧状态；[in] action：原生事件或刷新结果。返回值：新视图。 */
export function sessionReducer(
  view: SessionView,
  action: SessionAction,
): SessionView {
  if (action.type === "readonly") {
    const { summary, messages } = action.snapshot;
    return {
      ...initialSession,
      connection: "readonly",
      todoPhases:
        action.snapshot.todoPhases ?? todoPhasesFromMessages(messages),
      logs: view.logs,
      state: {
        sessionId: summary.id,
        sessionFile: summary.path,
        sessionName: summary.title,
        isStreaming: false,
        isCompacting: false,
        isSettled: true,
        messageCount: messages.length,
        queuedMessageCount: 0,
      },
      messages: messages.map((message, index) => ({
        key: historyKey(message, index),
        message,
        streaming: false,
      })),
    };
  }
  if (action.type === "reset")
    return { ...initialSession, connection: "starting" };
  if (action.type === "log") return appendLog(view, action.text, action.error);
  if (action.type === "state")
    return {
      ...view,
      state: action.state,
      todoPhases:
        parseTodoPhases(action.state.todoPhases) ??
        (view.state?.sessionId === action.state.sessionId
          ? view.todoPhases
          : []),
      busy:
        action.state.isStreaming ||
        action.state.isCompacting ||
        action.state.isSettled === false,
    };
  if (action.type === "records") return { ...view, records: action.records };
  if (action.type === "plan-status") {
    if (view.state?.sessionId !== action.sessionId) return view;
    const known = new Set(view.messages.flatMap(({ message }) => {
      const record = parsePlanStatus(message);
      return record ? [`${record.operationId}:${record.kind}`] : [];
    }));
    const messages = [...view.messages];
    for (const [index, message] of action.messages.entries()) {
      const record = parsePlanStatus(message);
      if (!record) continue;
      const id = `${record.operationId}:${record.kind}`;
      if (known.has(id)) continue;
      known.add(id);
      // 原生快照中紧随其后的消息作为锚点，同毫秒的批准信封也不会排到卡片之前。
      let at = -1;
      for (let next = index + 1; next < action.messages.length && at < 0; next++) {
        const anchor = action.messages[next];
        at = messages.findIndex((item) => item.message.role === anchor.role &&
          item.message.timestamp === anchor.timestamp &&
          JSON.stringify(item.message.content) === JSON.stringify(anchor.content));
      }
      if (at < 0 && Number.isFinite(message.timestamp)) {
        at = messages.findIndex((item) => item.message.timestamp !== undefined && item.message.timestamp > message.timestamp!);
      }
      messages.splice(at < 0 ? messages.length : at, 0, { key: `plan-status:${id}`, message, streaming: false });
    }
    return messages.length === view.messages.length ? view : { ...view, messages };
  }
  if (action.type === "history") {
    return {
      ...view,
      state: action.state,
      todoPhases:
        parseTodoPhases(action.state.todoPhases) ??
        action.todoPhases ??
        todoPhasesFromMessages(action.messages),
      messages: action.messages.map((message, index) => ({
        key: historyKey(message, index),
        message,
        streaming: false,
      })),
      records: action.records ?? view.records,
      tools: [],
      activeMessage: undefined,
      busy:
        action.state.isStreaming ||
        action.state.isCompacting ||
        action.state.isSettled === false,
    };
  }
  const frame = action.frame;
  switch (frame.type) {
    case "desktop_status":
      return {
        ...view,
        connection: frame.status as SessionView["connection"],
        error: frame.error as string | undefined,
        busy: frame.status === "connected" ? view.busy : false,
      };
    case "desktop_log":
      return appendLog(view, String(frame.text ?? ""));
    case "agent_start":
      return { ...view, busy: true };
    case "todo_auto_clear":
      return { ...view, todoPhases: [], revision: view.revision + 1 };
    case "todo_reminder":
      // 提醒只包含未完成项，不能拿它替代包含阶段和已完成项的完整计划。
      return { ...view, revision: view.revision + 1 };
    case "agent_end":
      // 终帧可被传输层压缩；已接收的 message_end 是完整消息的权威来源。
      return {
        ...view,
        activeMessage: undefined,
        messages: view.messages.map((item) => ({ ...item, streaming: false })),
        revision: view.revision + 1,
      };
    case "session_settled":
      return { ...view, busy: false, revision: view.revision + 1 };
    case "prompt_result": {
      const next = {
        ...view,
        busy: frame.sessionSettled === true ? false : view.busy,
        revision: view.revision + 1,
      };
      return frame.error ? appendLog(next, String(frame.error), true) : next;
    }
    case "message_start":
    case "message_update":
    case "message_end": {
      const supplied = frame.message as AgentMessage | undefined;
      const key =
        typeof frame.messageId === "string"
          ? frame.messageId
          : frame.type === "message_start"
            ? `stream:${view.messages.length}:${supplied?.timestamp ?? ""}`
            : (view.activeMessage ?? `stream:${view.messages.length}`);
      const existing = view.messages.find((item) => item.key === key);
      const message = streamedMessage(existing?.message, frame);
      const item = {
        key,
        message,
        streaming: frame.type !== "message_end" && message.role === "assistant",
      };
      return {
        ...view,
        todoPhases:
          frame.type === "message_end" && message.role === "toolResult"
            ? (todoResultPhases(message.toolName, message) ?? view.todoPhases)
            : view.todoPhases,
        messages: existing
          ? view.messages.map((old) => (old.key === key ? item : old))
          : [...view.messages, item],
        activeMessage:
          frame.type === "message_end" && view.activeMessage === key
            ? undefined
            : message.role === "assistant"
              ? key
              : view.activeMessage,
      };
    }
    case "queue_update": {
      const queuedMessages = {
        steering: (frame.steering ?? []) as string[],
        followUp: (frame.followUp ?? []) as string[],
        liveSteered: frame.liveSteered as number | undefined,
      };
      return {
        ...view,
        state: view.state
          ? {
              ...view.state,
              queuedMessages,
              queuedMessageCount:
                queuedMessages.steering.length + queuedMessages.followUp.length,
            }
          : view.state,
      };
    }
    case "btw_record":
    case "btw_delta":
      return { ...view, records: updateBtw(view.records, frame) };
    case "available_commands_update":
      return { ...view, commands: (frame.commands ?? []) as SlashCommand[] };
    case "model_changed":
    case "thinking_level_changed":
    case "session_info_update":
    case "config_update":
      return { ...view, revision: view.revision + 1 };
    case "auto_compaction_start":
    case "auto_retry_start":
      return { ...view, busy: true };
    case "auto_compaction_end":
    case "auto_retry_end":
      return { ...view, revision: view.revision + 1 };
    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_stream_update":
    case "tool_execution_end": {
      const id = String(frame.toolCallId ?? frame.id ?? frame.toolName);
      const previous = view.tools.find((tool) => tool.id === id);
      const tool: ToolActivity = {
        id,
        name: String(frame.toolName ?? previous?.name ?? "工具"),
        args: frame.args ?? previous?.args,
        result:
          frame.result ??
          frame.partialResult ??
          (frame.delta !== undefined
            ? readable(previous?.result) + String(frame.delta)
            : previous?.result),
        error: Boolean(frame.isError),
        running: frame.type !== "tool_execution_end",
      };
      return {
        ...view,
        todoPhases:
          frame.type === "tool_execution_end" && !frame.isError
            ? (todoResultPhases(tool.name, frame.result) ?? view.todoPhases)
            : view.todoPhases,
        tools: previous
          ? view.tools.map((item) => (item.id === id ? tool : item))
          : [...view.tools, tool],
      };
    }
    case "command_output":
      return appendLog(
        view,
        `${frame.command ? `/${String(frame.command)}\n` : ""}${String(frame.text ?? frame.output ?? frame.message ?? readable(frame))}`,
        frame.isError === true,
      );
    case "notice":
    case "extension_error":
    case "rpc_frame_error":
      return appendLog(
        view,
        `${frame.source ? `[${String(frame.source)}] ` : ""}${String(frame.message ?? frame.error ?? readable(frame))}`,
        frame.type !== "notice" || frame.level === "error",
      );
    case "response":
      return frame.success === false
        ? appendLog(
            view,
            `${String(frame.command)}：${String(frame.error)}`,
            true,
          )
        : view;
    default:
      return view;
  }
}
