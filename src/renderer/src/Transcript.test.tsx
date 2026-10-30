// @vitest-environment jsdom

import { expect, it, vi } from "vitest";
import { act } from "react";
import type { AgentMessage } from "../../shared/protocol";

import { type ToolActivity } from "./session";
import {
  container,
  conversation,
  click,
  toolRow,
  call,
  args,
  render,
  timeline,
} from "./transcript-test-harness";
import { Transcript } from "./Transcript";
import { outlineEntries } from "./ConversationOutline";
import { COMMENT_PROMPT_PREAMBLE } from "./prompt-context";
import { transcriptUnits } from "./transcript-model";

/** 空思考不占位；流式正文到达后显示，正常思考仍保留。 */
it("隐藏空白思考块，流式思考有正文后再显示", async () => {
  for (const thinking of [undefined, "", " \n\t "]) {
    await conversation([
      { role: "assistant", content: [{ type: "thinking", thinking }] },
    ]);
    expect(container.querySelector(".process-group")).toBeNull();
    expect(container.textContent).not.toContain("思考过程");
  }
  const messages = timeline([
    { role: "assistant", content: [{ type: "thinking", thinking: "" }] },
  ]);
  messages[0].streaming = true;
  await render(
    <Transcript sessionId="thinking" messages={messages} tools={[]} busy />,
  );
  expect(container.textContent).not.toContain("思考过程");
  messages[0] = {
    ...messages[0],
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "正在检查文件" }],
    },
  };
  await render(
    <Transcript
      sessionId="thinking"
      messages={[...messages]}
      tools={[]}
      busy
    />,
  );
  expect(container.textContent).not.toContain("思考过程");
  // 思考正文使用 thinking-block 样式类，不再内联斜体。
  const thinkingBlock = container.querySelector<HTMLElement>(".thinking-content");
  expect(thinkingBlock?.classList.contains("thinking-block")).toBe(true);
  expect(thinkingBlock?.style.fontStyle).toBe("");
  expect(
    container
      .querySelector(".thinking-content")
      ?.closest(".transcript-evidence"),
  ).toBeNull();
  expect(container.textContent).toContain("正在检查文件");
});

it("Ctrl+T 切换全部思考正文，保留工具和回复且流式更新不重置开关", async () => {
  const messages: AgentMessage[] = [
    {
      role: "assistant",
      content: [{ type: "thinking", thinking: "第一段思考" }],
    },
    call("toggle-tool", "read", { path: "test.txt" }),
    {
      role: "assistant",
      content: [{ type: "thinking", thinking: "第二段思考" }],
    },
    { role: "assistant", content: "最终回复" },
  ];
  await conversation(messages);
  expect(container.querySelectorAll(".thinking-content")).toHaveLength(2);
  async function press(options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      key: "t",
      ctrlKey: true,
      cancelable: true,
      ...options,
    });
    await act(() => {
      window.dispatchEvent(event);
    });
    return event;
  }
  await press({ ctrlKey: false });
  await press({ isComposing: true });
  expect(container.querySelectorAll(".thinking-content")).toHaveLength(2);
  expect((await press()).defaultPrevented).toBe(true);
  expect(container.querySelectorAll(".thinking-content")).toHaveLength(0);
  expect(container.textContent).not.toContain("第一段思考");
  expect(container.textContent).toContain("最终回复");
  expect(toolRow("toggle-tool")).toBeTruthy();
  await press({ repeat: true });
  await conversation([
    ...messages,
    {
      role: "assistant",
      content: [{ type: "thinking", thinking: "新增思考" }],
    },
  ]);
  expect(container.querySelectorAll(".thinking-content")).toHaveLength(0);
  await press({ key: "T" });
  expect(container.querySelectorAll(".thinking-content")).toHaveLength(3);
});

it("空思考不会打断连续工具分组或影响回复", async () => {
  await conversation([
    call("empty-before", "read", { path: "1.txt" }),
    { role: "assistant", content: [{ type: "thinking", thinking: "" }] },
    call("empty-after", "read", { path: "2.txt" }),
    { role: "assistant", content: "最终回复" },
  ]);
  expect(container.querySelectorAll(".tool-type-group")).toHaveLength(1);
  expect(container.textContent).not.toContain("思考过程");
  expect(container.textContent).toContain("最终回复");
});

const chronologicalGroupsMessages: AgentMessage[] = [
  { role: "user", content: "用户起点" },
  {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "第一段思考" },
      {
        type: "toolCall",
        id: "first",
        name: "read",
        arguments: { path: "one.md" },
      },
      { type: "text", text: "中间说明，不能移到工具之后" },
      { type: "thinking", thinking: "第二段思考" },
      {
        type: "toolCall",
        id: "second",
        name: "read",
        arguments: { path: "two.md" },
      },
    ],
  },
  {
    role: "toolResult",
    toolCallId: "first",
    content: [{ type: "text", text: "first output" }],
  },
  {
    role: "toolResult",
    toolCallId: "second",
    content: [{ type: "text", text: "second output" }],
  },
  { role: "assistant", content: "最后的直接答案" },
];

/** 中途说明与工具统一折叠，展开后保留真实顺序，最终回复独立展示。 */
async function chronologicalGroups() {
  await conversation(chronologicalGroupsMessages);
  const units = [...container.querySelector(".conversation-review")!.children];
  expect(units.map((unit) => unit.tagName)).toEqual([
    "ARTICLE",
    "DETAILS",
    "ARTICLE",
  ]);
  expect(units[0].textContent).toContain("用户起点");
  expect(units[1].textContent).toContain("中间说明");
  expect(units[2].textContent).toContain("最后的直接答案");
  expect(units[1].textContent).not.toContain("最后的直接答案");

  expect(container.querySelectorAll(".process-group")).toHaveLength(1);
  for (const group of container.querySelectorAll<HTMLDetailsElement>(
    ".process-group",
  ))
    expect(group.open).toBe(false);
  expect(container.textContent).not.toContain("原生消息数据");
  await click(toolRow("first").querySelector("summary")!);
  await click(toolRow("second").querySelector("summary")!);
  expect(units[1].textContent).toContain("first output");
  expect(units[1].textContent).toContain("second output");
  const processText = units[1].textContent!;
  expect(processText.indexOf("first output")).toBeLessThan(
    processText.indexOf("中间说明"),
  );
  expect(processText.indexOf("中间说明")).toBeLessThan(
    processText.indexOf("second output"),
  );
}
it("同轮思考、工具和进度说明统一折叠，最终回复独立展示", chronologicalGroups);

/** 结束事件自动收起整轮过程，之后仍可手动展开，刷新不重置用户选择。 */
it("回答结束自动折叠，手动展开可保持，下一轮不影响上一轮", async () => {
  const messages = timeline(chronologicalGroupsMessages);
  await render(
    <Transcript
      sessionId="auto"
      messages={messages.slice(0, -1)}
      tools={[]}
      busy
    />,
  );
  const group = container.querySelector<HTMLDetailsElement>(".process-group")!;
  expect(group.open).toBe(true);
  await render(
    <Transcript sessionId="auto" messages={messages} tools={[]} busy />,
  );
  expect(container.querySelector(".process-group")).toBe(group);
  expect(group.open).toBe(true);
  await render(
    <Transcript sessionId="auto" messages={messages} tools={[]} busy={false} />,
  );
  expect(group.open).toBe(false);
  await click(group.querySelector("summary")!);
  expect(group.open).toBe(true);
  await render(
    <Transcript
      sessionId="auto"
      messages={[...messages]}
      tools={[]}
      busy={false}
    />,
  );
  expect(group.open).toBe(true);
  await render(
    <Transcript
      sessionId="auto"
      messages={timeline([
        ...chronologicalGroupsMessages,
        { role: "user", content: "第二轮" },
        call("next"),
        { role: "assistant", content: "第二轮答案" },
      ])}
      tools={[]}
      busy
    />,
  );
  const groups =
    container.querySelectorAll<HTMLDetailsElement>(".process-group");
  expect(groups).toHaveLength(2);
  expect(groups[0]).toBe(group);
  expect(groups[0].open).toBe(true);
  expect(groups[1].open).toBe(true);
});

const actualIdPairingMessages: AgentMessage[] = [
  call("a"),
  call("b", "edit", { path: "other.md", content: "second" }),
  {
    role: "toolResult",
    toolCallId: "b",
    toolName: "edit",
    content: "B-result",
  },
  {
    role: "toolResult",
    toolCallId: "a",
    toolName: "edit",
    content: "A-result",
  },
];
const actualIdPairingTools: ToolActivity[] = [
  {
    id: "a",
    name: "edit",
    args,
    running: true,
    error: true,
    result: "过期的增量结果",
  },
];

/** 相同工具名称并行时，实际 id 决定配对；旧实时状态不覆盖已完成历史。参数：无。返回值：测试 Promise。 */
async function actualIdPairing() {
  await conversation(actualIdPairingMessages, actualIdPairingTools);
  expect(container.querySelectorAll(".tool-row")).toHaveLength(2);
  const a = toolRow("a");
  const b = toolRow("b");
  await click(a.querySelector("summary")!);
  await click(b.querySelector("summary")!);
  expect(a.textContent).toContain("A-result");
  expect(a.textContent).not.toContain("B-result");
  expect(a.textContent).not.toContain("过期的增量结果");
  expect(a.querySelector("summary")!.textContent).not.toContain("已完成");
  expect(a.classList.contains("process-error")).toBe(false);
  expect(b.textContent).toContain("B-result");
  const summary = container.querySelector(".process-group > summary")!;
  expect(summary.querySelector(".process-summary-label")?.textContent).toBe(
    "执行过程",
  );
  expect(summary.textContent).not.toContain("committer.md");
  expect(summary.textContent).not.toContain("toolCall");
  const button = a.querySelector<HTMLButtonElement>(
    'summary button[data-tool-id="a"]',
  )!;
  await click(a.querySelector("summary")!);
  await click(button);
  expect(
    container.querySelector<HTMLDetailsElement>(".process-group")!.open,
  ).toBe(true);
  expect(toolRow("a").open).toBe(true);
}
it(
  "按实际id配对反序结果和历史/实时证据，文件名可点击且不暴露乱码id",
  actualIdPairing,
);

const meaningfulStatusesMessages: AgentMessage[] = [
  call("missing"),
  call("failed"),
  call("cancelled"),
  {
    role: "toolResult",
    toolCallId: "failed",
    isError: true,
    errorMessage: "权限拒绝的真实错误",
    content: [{ type: "text", text: "详细失败证据" }],
  },
  {
    role: "toolResult",
    toolCallId: "cancelled",
    cancelled: true,
    content: "取消前输出",
  },
];
const meaningfulStatusesTools: ToolActivity[] = [
  {
    id: "running",
    name: "bash",
    args: { command: "sleep 1" },
    running: true,
  },
];

/** 错误、取消、运行同时可见，缺少结果不得虚构完成状态。参数：无。返回值：测试 Promise。 */
async function meaningfulStatuses() {
  await conversation(meaningfulStatusesMessages, meaningfulStatusesTools);
  const summary = container.querySelector(".process-group > summary")!;
  expect(summary.querySelector(".process-summary-label")?.textContent).toBe(
    "执行过程",
  );
  expect(summary.textContent).not.toContain("工具错误");
  expect(summary.textContent).not.toContain("已取消");
  expect(
    summary.closest(".process-group")?.classList.contains("process-error"),
  ).toBe(false);
  expect(toolRow("missing").querySelector("summary")!.textContent).toContain(
    "未记录结果",
  );
  expect(toolRow("failed").open).toBe(false);
  await click(toolRow("failed").querySelector("summary")!);
  expect(toolRow("failed").open).toBe(true);
  expect(toolRow("failed").textContent).toContain("权限拒绝的真实错误");
  await click(toolRow("cancelled").querySelector("summary")!);
  expect(toolRow("cancelled").textContent).toContain("取消前输出");
}
it(
  "错误和取消不会被同组运行遮盖，孤立调用诚实显示未记录结果",
  meaningfulStatuses,
);

/** 同轮主过程、迟到通知和后续工具，原生时间戳保留两分钟等待。 */
function lateResultMessages(): AgentMessage[] {
  return [
    { role: "user", content: "启动测试", timestamp: 1000 },
    { ...call("main", "bash", { command: "npm test" }), stopReason: "toolUse", timestamp: 2000 },
    { role: "toolResult", toolCallId: "main", content: "已启动", timestamp: 3000 },
    { role: "assistant", content: "A1 已提交", stopReason: "stop", timestamp: 5000 },
    { role: "custom", customType: "async-result", details: { jobs: [{ label: "npm test" }] }, content: "后台输出", timestamp: 130000 },
    { ...call("followup", "read", { path: "results.txt" }), stopReason: "toolUse", timestamp: 131000 },
    { role: "toolResult", toolCallId: "followup", content: "测试结果", timestamp: 132000 },
    { role: "assistant", content: "A2 后续结论", stopReason: "stop", timestamp: 135000 },
  ];
}

it("迟到段保留最终正文，独立计时且标签跳回默认收起的触发卡片", async () => {
  const errors = vi.spyOn(console, "error");
  try {
    await conversation(lateResultMessages());
    const children = [...container.querySelector(".conversation-review")!.children];
    expect(children.map((node) => node.tagName)).toEqual([
      "ARTICLE", "DETAILS", "ARTICLE", "DIV", "ARTICLE", "DETAILS", "ARTICLE",
    ]);
    expect(children[2].textContent).toContain("A1 已提交");
    expect(children[2].closest(".process-group")).toBeNull();
    expect(container.querySelector('[role="separator"]')?.textContent).toContain("回复后 2分5秒");
    expect([...container.querySelectorAll(".process-summary-label")].map((node) => node.textContent)).toEqual(["运行了 4秒", "运行了 5秒"]);
    const trigger = container.querySelector<HTMLElement>("[data-late-trigger]")!;
    expect(trigger.querySelector<HTMLDetailsElement>(".transcript-notice")?.open).toBe(false);
    expect(trigger.querySelector(".conversation-heading")?.textContent).toBe("");
    const scroll = vi.fn();
    trigger.scrollIntoView = scroll;
    const tag = container.querySelector<HTMLButtonElement>(".followup-tag")!;
    expect(tag.textContent).toBe("后续回复 ↩ npm test");
    await click(tag);
    expect(scroll).toHaveBeenCalledWith({ block: "center" });
    expect(trigger.classList.contains("flash")).toBe(true);
    expect(errors.mock.calls.filter((args) => /same key|unique.*key/i.test(args.join(" ")))).toEqual([]);
  } finally {
    errors.mockRestore();
  }
});

it("后续流式过程独立展开和计时，完成后收起且主过程用时保持不变", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(134000);
  try {
    const messages = timeline(lateResultMessages());
    messages[7] = { ...messages[7], streaming: true, message: { ...messages[7].message, stopReason: undefined } };
    await render(<Transcript sessionId="late-live" messages={messages} tools={[]} busy />);
    const groups = container.querySelectorAll<HTMLDetailsElement>(".process-group");
    expect(groups[0].open).toBe(false);
    expect(groups[1].open).toBe(true);
    expect(container.querySelector(".conversation-followup .live-label")?.textContent).toBe("生成中");
    expect([...container.querySelectorAll(".process-summary-label")].map((node) => node.textContent)).toEqual(["运行了 4秒", "运行了 4秒"]);
    await act(() => vi.advanceTimersByTime(1000));
    await render(<Transcript sessionId="late-live" messages={timeline(lateResultMessages())} tools={[]} busy={false} />);
    expect(groups[1].open).toBe(false);
    expect([...container.querySelectorAll(".process-summary-label")].map((node) => node.textContent)).toEqual(["运行了 4秒", "运行了 5秒"]);
  } finally {
    vi.useRealTimers();
  }
});

it("回退内嵌过程保持后续段和工具内容，标签仍指向触发卡片", async () => {
  await render(<Transcript sessionId="late-inline" messages={timeline(lateResultMessages())} tools={[]} inlineProcess />);
  expect(container.querySelector(".process-group.followup")?.tagName).toBe("DIV");
  expect(container.querySelector(".process-group.followup .tool-row")?.getAttribute("data-tool-id")).toBe("followup");
  expect(container.querySelector(".conversation-followup")?.textContent).toContain("A2 后续结论");
  expect(container.querySelector(".conversation-late-trigger")?.textContent).toContain("npm test");
});

it("连续迟到段分别截止计时，不把下一次等待算入前一个后续过程", async () => {
  await conversation([
    ...lateResultMessages(),
    { role: "custom", customType: "irc:incoming", details: { from: "Reviewer" }, content: "复查完毕", timestamp: 200000 },
    { ...call("third", "read", { path: "review.txt" }), timestamp: 201000 },
    { role: "assistant", content: "A3", stopReason: "stop", timestamp: 203000 },
  ]);
  expect([...container.querySelectorAll(".process-summary-label")].map((node) => node.textContent)).toEqual(["运行了 4秒", "运行了 5秒", "运行了 3秒"]);
  expect([...container.querySelectorAll(".followup-tag")].map((node) => node.textContent)).toEqual(["后续回复 ↩ npm test", "后续回复 ↩ Reviewer"]);
});

/** 评论开头说明只在显示层隐藏，会话数据保持原样。 */
const fence = "`".repeat(3);
const commentMessage = `${COMMENT_PROMPT_PREAMBLE}\n\n帮我看下这处：\n\n<comment id="1">\n\n${fence}text\n{"type":"file","path":"a.ts"}\n\n代码行\n${fence}\n\n这里为什么改？\n</comment>`;

it("用户消息不显示评论开头说明，代码块和评论正文完整，原数据不变", async () => {
  const messages: AgentMessage[] = [
    { role: "user", content: commentMessage },
    { role: "user", content: [{ type: "text", text: commentMessage }] },
  ];
  await conversation(messages);
  expect(container.textContent).not.toContain("下面的");
  expect(container.textContent).not.toContain("元数据中的");
  expect(container.textContent).toContain("帮我看下这处：");
  expect(container.textContent).toContain("这里为什么改？");
  const blocks = [...container.querySelectorAll("pre code")];
  expect(blocks).toHaveLength(2);
  for (const block of blocks) expect(block.textContent).toContain('{"type":"file","path":"a.ts"}');
  expect(messages[0].content).toBe(commentMessage);
});

it("大纲标题不显示评论开头说明", () => {
  const entries = outlineEntries(transcriptUnits(timeline([{ role: "user", content: commentMessage }]), []));
  expect(entries).toHaveLength(1);
  expect(entries[0].title.startsWith("帮我看下这处：")).toBe(true);
  expect(entries[0].title).not.toContain("下面的");
});
