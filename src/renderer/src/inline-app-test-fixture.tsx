import { offPlanBridge } from "./plan-test-fixture";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { onTestFinished, vi } from "vitest";
import type {
  AgentMessage,
  DesktopBridge,
  RpcCommand,
  RpcFrame,
  SessionState,
} from "../../shared/protocol";
import App from "./App";
import type { SessionHistorySnapshot } from "../../shared/session-history";

/** 构造原生会话加载所需的固定响应。[in] messages：原生历史消息。返回值：按 RPC 类型索引的真实协议样本。 */
function nativeResponses(
  messages: AgentMessage[],
  history?: SessionHistorySnapshot,
): Record<string, unknown> {
  const state: SessionState = {
    sessionId: "inline-app",
    isStreaming: false,
    isCompacting: false,
    isSettled: true,
    messageCount: messages.length,
    queuedMessageCount: 0,
  };
  return {
    get_state: state,
    get_messages_page: { messages, totalMessages: messages.length },
    get_entries: history ?? {
      entries: messages.map((message, index) => ({
        type: "message",
        id: `entry-${index}`,
        parentId: index ? `entry-${index - 1}` : null,
        timestamp: "2026-10-13T00:00:00Z",
        message,
      })),
      leafId: messages.length ? `entry-${messages.length - 1}` : null,
    },
    get_btw_history: { records: [] },
    get_available_models: { models: [] },
    get_available_thinking_levels: { levels: [] },
  };
}

/** 提供隔离的启动配置。参数：无。返回值：固定测试配置。 */
async function preferences() {
  return { executable: "test-only", cwd: "D:/isolated" };
}

/** 提供空会话目录或角色配置。参数：无。返回值：空列表。 */
async function emptyList() {
  return [];
}

/** 创建真实 App 所需的原生会话边界。[in] messages：固定原生历史。返回值：桥、调用记录和事件入口。 */
function nativeBoundary(
  messages: AgentMessage[],
  history?: SessionHistorySnapshot,
) {
  const commands: string[] = [];
  const listeners = new Set<(frame: RpcFrame) => void>();
  const responses = nativeResponses(messages, history);
  /** 返回已定义的原生协议响应，未知调用立即失败。[in] command：原生命令。返回值：该命令的协议结果。 */
  async function request<T>(command: RpcCommand): Promise<T> {
    commands.push(command.type);
    if (!Object.hasOwn(responses, command.type))
      throw new Error(`意外 RPC：${command.type}`);
    return responses[command.type] as T;
  }
  /** 注册 App 原生事件消费者。[in] listener：事件监听器。返回值：取消注册函数。 */
  function onFrame(listener: (frame: RpcFrame) => void) {
    listeners.add(listener);
    /** 取消当前原生事件消费者。参数：无。返回值：无。 */
    function unsubscribe() {
      listeners.delete(listener);
    }
    return unsubscribe;
  }
  const previewToolFile = vi.fn();
  const bridge = {
    ...offPlanBridge,
    setZoomFactor: () => {},
    preferences,
    listSessions: emptyList,
    getRoles: emptyList,
    onFrame,
    request,
    previewToolFile,
  } satisfies Pick<
    DesktopBridge,
    | "setZoomFactor"
    | "preferences"
    | "listSessions"
    | "getRoles"
    | "onFrame"
    | "request"
    | "previewToolFile"
    | keyof typeof offPlanBridge
  >;
  /** 通过真实 App 事件入口交付原生帧。[in] frame：原生事件。返回值：React 消费完成 Promise。 */
  async function emit(frame: RpcFrame) {
    await act(async () => {
      for (const listener of listeners) listener(frame);
    });
  }
  return { bridge, commands, previewToolFile, emit };
}

/** 挂载真实 App 并加载原生历史。[in] messages：原生历史消息。返回值：DOM、原生调用记录与交互入口。 */
export async function createAppFixture(
  messages: AgentMessage[],
  history?: SessionHistorySnapshot,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const boundary = nativeBoundary(messages, history);
  const previousBridge = Object.getOwnPropertyDescriptor(window, "desktop");
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: boundary.bridge,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  /** 卸载真实 App 并恢复桥与运行环境。参数：无。返回值：清理完成 Promise。 */
  async function cleanup() {
    await act(() => root.unmount());
    container.remove();
    if (previousBridge)
      Object.defineProperty(window, "desktop", previousBridge);
    else Reflect.deleteProperty(window, "desktop");
    vi.unstubAllGlobals();
  }
  onTestFinished(cleanup);
  await act(async () => root.render(<App />));
  await boundary.emit({ type: "desktop_status", status: "connected" });
  await boundary.emit({ type: "session_info_update" });
  /** 点击真实 App 中的用户目标。[in] node：目标元素。返回值：交互提交完成 Promise。 */
  async function click(node: HTMLElement) {
    await act(() => node.click());
  }
  return {
    container,
    click,
    commands: boundary.commands,
    previewToolFile: boundary.previewToolFile,
    emit: boundary.emit,
  };
}
