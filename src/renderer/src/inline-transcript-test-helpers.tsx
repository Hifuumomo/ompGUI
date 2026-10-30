import { act } from "react";
import { createRoot } from "react-dom/client";
import { onTestFinished, vi } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import { Transcript } from "./Transcript";
import type { ToolActivity } from "./session";

/** 创建原生工具调用证据。[in] id：调用标识；[in] name：原生工具名；[in] args：原始调用参数。返回值：助手工具调用消息。 */
export function toolCall(
  id: string,
  name: string,
  args: unknown,
): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: args }],
  };
}

/** 创建原生命令调用。[in] id：调用标识；[in] command：命令原文。返回值：助手执行命令消息。 */
export function commandCall(id: string, command: string): AgentMessage {
  return toolCall(id, "bash", { command });
}

/** 挂载真实 React 根并登记测试清理。参数：无。返回值：挂载容器与 React 根。 */
function mountTranscript() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  /** 卸载测试消费者并恢复运行环境。参数：无。返回值：清理完成 Promise。 */
  async function cleanup() {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
  onTestFinished(cleanup);
  return { container, root };
}

/** 创建真实 React 时间线消费者并注册清理。参数：无。返回值：DOM 查询、渲染与交互入口。 */
export function createTranscriptView() {
  const { container, root } = mountTranscript();
  /** 更新真实组件的历史消息、实时结果和会话。[in] options：原生消息、实时工具、会话标识、消息键和生成状态。返回值：提交完成 Promise。 */
  async function render(options: {
    messages: AgentMessage[];
    tools?: ToolActivity[];
    sessionId?: string;
    messageKeys?: string[];
    streaming?: boolean;
  }) {
    await act(() =>
      root.render(
        <Transcript
          messages={options.messages.map((message, index) => ({
            key: options.messageKeys?.[index] ?? `message:${index}`,
            message,
            streaming: options.streaming ?? false,
          }))}
          tools={options.tools ?? []}
          sessionId={options.sessionId ?? "session-a"}
        />,
      ),
    );
  }
  /** 按用户路径先展开所属过程组，再点击工具行目标。[in] node：目标元素。返回值：React 事件处理完成 Promise。 */
  async function click(node: HTMLElement) {
    const group = node
      .closest(".tool-row")
      ?.closest<HTMLDetailsElement>(".process-group");
    if (group && !group.open)
      await act(() =>
        group.querySelector<HTMLElement>(":scope > summary")!.click(),
      );
    await act(() => node.click());
  }
  /** 读取唯一工具行。[in] id：原生工具调用标识。返回值：对应工具详情节点。 */
  function row(id: string) {
    return container.querySelector<HTMLDetailsElement>(
      `.tool-row[data-tool-id="${id}"]`,
    )!;
  }
  /** 查找展开后工具行中的目标按钮。[in] id：工具调用标识。返回值：工具行目标按钮。 */
  function target(id: string) {
    return container.querySelector<HTMLButtonElement>(
      `.tool-row[data-tool-id="${id}"] > summary button[data-tool-id="${id}"]`,
    )!;
  }
  return { container, render, click, row, target };
}

/** 构建结构化、未知内容、错误和取消的真实协议样本。参数：无。返回值：对话消息与配对实时结果。 */
export function structuredScenario() {
  const tools: ToolActivity[] = [
    {
      id: "structured",
      name: "bash",
      args: {},
      running: false,
      result: { content: [], structuredContent: { count: 17 } },
    },
    {
      id: "unknown",
      name: "bash",
      args: {},
      running: false,
      result: { content: [{ type: "futureBlock", value: "native-evidence" }] },
    },
  ];
  const messages: AgentMessage[] = [
    commandCall("structured", "echo structured"),
    commandCall("unknown", "echo unknown"),
    commandCall("failed", "exit 1"),
    {
      role: "toolResult",
      toolCallId: "failed",
      isError: true,
      content: [{ type: "text", text: "failure output" }],
    },
    commandCall("cancelled", "long running"),
    {
      role: "toolResult",
      toolCallId: "cancelled",
      cancelled: true,
      content: [{ type: "text", text: "cancelled output" }],
    },
  ];
  return { messages, tools };
}
