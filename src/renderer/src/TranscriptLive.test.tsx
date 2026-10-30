// @vitest-environment jsdom

import { expect, it } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import { Transcript } from "./Transcript";

import {
  initialSession,
  sessionReducer,
  type ToolActivity,
  type SessionAction,
} from "./session";
import {
  container,
  render,
  conversation,
  click,
  toolRow,
  call,
  image,
  args,
} from "./transcript-test-harness";

const liveAction1: SessionAction = {
  type: "frame",
  frame: {
    type: "message_start",
    messageId: "assistant",
    message: call("live", "bash", { command: "printf honest" }),
  },
};
const liveAction2: SessionAction = {
  type: "frame",
  frame: {
    type: "tool_execution_start",
    toolCallId: "live",
    toolName: "bash",
    args: { command: "printf honest" },
  },
};
const liveAction3: SessionAction = {
  type: "frame",
  frame: {
    type: "tool_execution_end",
    toolCallId: "live",
    result: {
      content: [
        { type: "text", text: "[not a link](https://evil.invalid)" },
        image,
      ],
    },
  },
};
const liveAction4: SessionAction = {
  type: "frame",
  frame: {
    type: "message_end",
    messageId: "result",
    message: {
      role: "toolResult",
      toolCallId: "live",
      content: [{ type: "text", text: "最终工具结果" }],
    },
  },
};

/** 真正 reducer 的实时工具完成和历史补齐不会复制同一调用。参数：无。返回值：测试 Promise。 */
async function liveCompletion() {
  let view = sessionReducer(initialSession, liveAction1);
  view = sessionReducer(view, liveAction2);
  await render(
    <Transcript
      messages={view.messages}
      tools={view.tools}
      sessionId="session-a"
    />,
  );
  expect(toolRow("live").querySelector("summary")!.textContent).toContain(
    "执行中",
  );
  await click(toolRow("live").querySelector("summary")!);
  view = sessionReducer(view, liveAction3);
  await render(
    <Transcript
      messages={view.messages}
      tools={view.tools}
      sessionId="session-a"
    />,
  );
  expect(toolRow("live").querySelector("summary")!.textContent).not.toContain(
    "已完成",
  );
  expect(toolRow("live").querySelector("a")).toBeNull();
  expect(toolRow("live").querySelector("img")!.getAttribute("src")).toBe(
    `data:image/png;base64,${image.data}`,
  );
  view = sessionReducer(view, liveAction4);
  await render(
    <Transcript
      messages={view.messages}
      tools={view.tools}
      sessionId="session-a"
    />,
  );
  expect(container.querySelectorAll(".tool-row")).toHaveLength(1);
  expect(toolRow("live").textContent).toContain("最终工具结果");
}
it(
  "真实reducer实时开始、完成、历史补齐始终只显示一逻辑行且执行输出是纯文本",
  liveCompletion,
);

const literal = "[literal](https://invalid.test) <script>bad()</script>";
const objectExecutionResultsMessages: AgentMessage[] = [
  call("eval-object", "functions.eval", { code: literal }),
  call("bash-object", "bash", { command: literal }),
  call("python-object", "python", { code: literal }),
];
const objectExecutionResultsTools: ToolActivity[] = [
  {
    id: "eval-object",
    name: "functions.eval",
    args: { code: literal },
    running: false,
    result: {
      content: literal,
      images: [image],
      errorMessage: "对象执行错误",
      metadata: { trace: "保留额外结果证据" },
    },
  },
  {
    id: "bash-object",
    name: "bash",
    args: { command: literal },
    running: false,
    result: { content: literal, cancelled: true },
  },
  {
    id: "python-object",
    name: "python",
    args: { code: literal },
    running: false,
    result: { content: literal, isError: true },
  },
];

/** 执行工具的对象字符串输出保持字面文本，原生对象错误与取消不能伪装完成。参数：无。返回值：测试 Promise。 */
async function objectExecutionResults() {
  await conversation(
    objectExecutionResultsMessages,
    objectExecutionResultsTools,
  );
  for (const id of ["eval-object", "bash-object", "python-object"]) {
    const row = toolRow(id);
    await click(row.querySelector("summary")!);
    expect(
      [...row.querySelectorAll("pre")].some(
        (pre) => pre.textContent === literal,
      ),
    ).toBe(true);
    expect(row.querySelector("a")).toBeNull();
    expect(row.querySelector("script")).toBeNull();
  }
  expect(toolRow("eval-object").classList.contains("process-error")).toBe(true);
  expect(
    toolRow("eval-object").querySelector("summary")!.textContent,
  ).not.toContain("错误");
  expect(
    toolRow("eval-object").querySelector(".inline-error")!.textContent,
  ).toContain("对象执行错误");
  expect(toolRow("eval-object").querySelector("img")!.getAttribute("src")).toBe(
    `data:image/png;base64,${image.data}`,
  );
  expect(toolRow("eval-object").textContent).not.toContain("保留额外结果证据");
  expect(
    toolRow("bash-object").querySelector("summary")!.textContent,
  ).toContain("已取消");
  expect(toolRow("python-object").classList.contains("process-error")).toBe(
    true,
  );
  expect(
    toolRow("python-object").querySelector("summary")!.textContent,
  ).not.toContain("错误");
}
it(
  "eval/bash/python对象content字符串是纯文本且保留图片/额外证据和对象错误/取消状态",
  objectExecutionResults,
);
