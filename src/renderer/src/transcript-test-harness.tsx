import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import { Transcript, type ToolInspection } from "./Transcript";
import type { TimelineMessage, ToolActivity } from "./session";
export let container: HTMLDivElement;
export let root: Root;
export let previousActEnvironment: PropertyDescriptor | undefined;
export const image = {
  type: "image",
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bLEAAAAASUVORK5CYII=",
};
export const args = {
  input:
    "*** Begin Patch\n[~/.omp/agent/agents/committer.md#398A]\nPUT 3.=4:\n+description: Honest edit\n*** End Patch\n",
};

/** 创建独立真实 React 消费者。参数：无。返回值：无。 */
export function setup() {
  previousActEnvironment = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

/** 卸载消费者并恢复全局环境。参数：无。返回值：清理 Promise。 */
export async function cleanup() {
  /** 卸载真实组件。参数：无。返回值：无。 */
  function unmount() {
    root.unmount();
  }
  await act(unmount);
  container.remove();
  if (previousActEnvironment)
    Object.defineProperty(
      globalThis,
      "IS_REACT_ACT_ENVIRONMENT",
      previousActEnvironment,
    );
  else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
}

/** 向真实 React 根提交节点。[in] node：组件节点。返回值：渲染完成 Promise。 */
export async function render(node: ReactNode) {
  /** 异步 act 同时提交节点及 effect 启动的原生 Promise 链。参数：无。返回值：提交 Promise。 */
  async function commit() {
    root.render(node);
  }
  await act(commit);
}

/** 为输入消息赋予稳定时间线键。[in] messages：原生消息。返回值：时间线视图。 */
export function timeline(messages: AgentMessage[]): TimelineMessage[] {
  return messages.map((message, index) => ({
    key: `message:${index}`,
    message,
    streaming: false,
  }));
}

/** 呈现真实对话消费者。[in] messages：原生消息；[in] tools：实时工具。返回值：渲染完成 Promise。 */
export async function conversation(
  messages: AgentMessage[],
  tools: ToolActivity[] = [],
) {
  await render(
    <Transcript
      messages={timeline(messages)}
      tools={tools}
      sessionId="session-a"
    />,
  );
}

/** 按用户路径展开所属过程组并点击真实 DOM 节点。[in] node：目标节点。返回值：事件完成 Promise。 */
export async function click(node: HTMLElement) {
  const group = node
    .closest(".tool-row")
    ?.closest<HTMLDetailsElement>(".process-group");
  if (group && !group.open)
    await act(() =>
      group.querySelector<HTMLElement>(":scope > summary")!.click(),
    );
  /** 发出真实点击。参数：无。返回值：无。 */
  function activate() {
    node.click();
  }
  await act(activate);
}

/** 读取真实源码行的非正文行号并确保不污染可复制文本。[in] row：源码或差异行。返回值：可访问性隐藏的空文本 gutter。 */
export function codeGutter(row: Element): HTMLElement {
  const gutter = row.querySelector<HTMLElement>(".file-code-gutter")!;
  expect(gutter).not.toBeNull();
  expect(gutter.getAttribute("aria-hidden")).toBe("true");
  expect(gutter.textContent).toBe("");
  return gutter;
}

/** 查找对应工具的唯一逻辑行。[in] id：实际 toolCallId。返回值：工具行。 */
export function toolRow(id: string): HTMLDetailsElement {
  const rows = [
    ...container.querySelectorAll<HTMLDetailsElement>(".tool-row"),
  ].filter((row) => row.dataset.toolId === id);
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** 创建测试需要的真实工具调用消息。[in] id：工具 id；[in] name：工具名；[in] argumentsValue：原始参数。返回值：助手消息。 */
export function call(
  id: string,
  name = "edit",
  argumentsValue: unknown = args,
): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: argumentsValue }],
  };
}

/** 创建显式选中对象的证据。[in] path：路径；[in] sessionId：会话 id。返回值：文件点击证据。 */
export function selection(
  path: string,
  sessionId = "session-a",
): ToolInspection {
  return {
    sessionId,
    toolCallId: "tool-file",
    toolName: "read",
    status: "已完成",
    target: { kind: "file", label: path, path },
    args: { path },
    result: { content: [{ type: "text", text: "历史读取，不是当前文件" }] },
  };
}
beforeEach(setup);
afterEach(cleanup);
