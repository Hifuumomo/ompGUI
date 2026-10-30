// @vitest-environment jsdom
import { expect, it } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import {
  commandCall,
  createTranscriptView,
  toolCall,
} from "./inline-transcript-test-helpers";
import { ProcessSummary, formatDuration } from "./ProcessSummary";
import { durationText } from "./duration-text";
import { container, render } from "./transcript-test-harness";
import type { ProcessItem } from "./transcript-types";

/** 读取过程摘要的可访问文字，排除纯装饰图标。[in] group：实际过程组。返回值：摘要可读文字。 */
function summaryText(group: HTMLDetailsElement): string {
  const summary = group
    .querySelector(":scope > summary")!
    .cloneNode(true) as HTMLElement;
  for (const decoration of summary.querySelectorAll('[aria-hidden="true"]'))
    decoration.remove();
  return summary.textContent!.trim();
}

/** 多条命令统一折叠为执行过程，展开后各行独立展示并保留自己的开合状态。参数：无。返回值：测试完成 Promise。 */
async function commandsStayCompact() {
  const view = createTranscriptView();
  await view.render({
    messages: [
      commandCall("one", "echo first-private-command"),
      commandCall("two", "echo second-private-command"),
      commandCall("three", "echo third-private-command"),
    ],
  });
  const group =
    view.container.querySelector<HTMLDetailsElement>(".process-group")!;
  const summary = group.querySelector<HTMLElement>(":scope > summary")!;
  expect(group.open).toBe(false);
  expect(summaryText(group)).toBe("执行过程");
  expect(
    summary.querySelector("button, .process-targets, .process-count"),
  ).toBeNull();
  for (const command of [
    "first-private-command",
    "second-private-command",
    "third-private-command",
  ])
    expect(summary.textContent).not.toContain(command);
  await view.click(summary);
  expect(group.open).toBe(true);
  expect(group.querySelectorAll(".tool-row")).toHaveLength(3);
  for (const [id, command] of [
    ["one", "first"],
    ["two", "second"],
    ["three", "third"],
  ])
    expect(view.row(id).querySelector("summary")?.textContent).toContain(
      `echo ${command}-private-command`,
    );
  await view.click(view.target("one"));
  await view.click(view.target("two"));
  expect(view.row("one").open).toBe(true);
  expect(view.row("two").open).toBe(true);
  expect(view.row("three").open).toBe(false);
  await view.click(summary);
  expect(group.open).toBe(false);
  await view.click(summary);
  expect(view.row("one").open).toBe(true);
  expect(view.row("two").open).toBe(true);
  await view.click(view.target("one"));
  expect(view.row("one").open).toBe(false);
  expect(view.row("two").open).toBe(true);
}
it(
  "三个命令折叠仅显示执行过程，展开逐行独立阅读并保留开合",
  commandsStayCompact,
);

/** 混合工具折叠为通用类别，文件名和命令只保留在展开后的行内。参数：无。返回值：测试完成 Promise。 */
async function mixedOperationsStayCompact() {
  const view = createTranscriptView();
  await view.render({
    messages: [
      toolCall("file", "read", { path: "confidential-config.toml" }),
      commandCall("command", "echo private-command"),
    ],
  });
  const group =
    view.container.querySelector<HTMLDetailsElement>(".process-group")!;
  const summary = group.querySelector<HTMLElement>(":scope > summary")!;
  expect(summaryText(group)).toBe("执行过程");
  expect(summary.textContent).not.toContain("confidential-config.toml");
  expect(summary.textContent).not.toContain("private-command");
  expect(summary.textContent).not.toContain("项");
  expect(summary.textContent).not.toContain("展开");
  await view.click(summary);
  expect(view.row("file").querySelector("summary")?.textContent).toContain(
    "confidential-config.toml",
  );
  expect(view.row("command").querySelector("summary")?.textContent).toContain(
    "echo private-command",
  );
}
it(
  "混合多项工具只显示执行过程，展开后才逐行显示目标",
  mixedOperationsStayCompact,
);

const categoryCases = [
  { name: "read", args: { path: "private.txt" } },
  {
    name: "write",
    args: { path: "private.txt", content: "value" },
  },
  { name: "edit", args: { path: "private.txt" } },
  {
    name: "grep",
    args: { path: "private.txt", pattern: "secret" },
  },
  { name: "glob", args: { pattern: "*.txt" } },
  { name: "web_search", args: { query: "secret query" } },
  {
    name: "functions.eval",
    args: { code: "privateCode()" },
  },
  {
    name: "unknown_tool",
    args: { payload: "secret" },
  },
];

/** 各类工具统一显示执行过程，无错误时不标红。[in] scenario：工具名与调用参数。返回值：测试完成 Promise。 */
async function categorizedTool(scenario: (typeof categoryCases)[number]) {
  const view = createTranscriptView();
  await view.render({
    messages: [toolCall("category", scenario.name, scenario.args)],
  });
  const group =
    view.container.querySelector<HTMLDetailsElement>(".process-group")!;
  expect(summaryText(group)).toBe("执行过程");
  expect(group.classList.contains("process-error")).toBe(false);
  expect(group.querySelector(":scope > summary button")).toBeNull();
}
it.each(categoryCases)("$name 的收起过程摘要统一为执行过程", categorizedTool);

/** 仅思考内容同样使用执行过程，不附加工具计数或目标列表。参数：无。返回值：测试完成 Promise。 */
async function thinkingSummary() {
  const view = createTranscriptView();
  await view.render({
    messages: [
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "private reasoning" }],
      },
    ],
  });
  const group =
    view.container.querySelector<HTMLDetailsElement>(".process-group")!;
  expect(summaryText(group)).toBe("执行过程");
  expect(group.querySelector(":scope > summary")?.textContent).not.toContain(
    "private reasoning",
  );
}
it("仅思考过程同样显示执行过程", thinkingSummary);

/** 运行、错误、取消都仅显示执行过程，错误通过颜色标记。参数：无。返回值：测试完成 Promise。 */
async function runningAndTerminalStatuses() {
  const view = createTranscriptView();
  await view.render({
    messages: [
      commandCall("running", "echo currently-running"),
      commandCall("failed", "echo failed-command"),
      {
        role: "toolResult",
        toolCallId: "failed",
        isError: true,
        content: "failure",
      },
      commandCall("cancelled", "echo cancelled-command"),
      {
        role: "toolResult",
        toolCallId: "cancelled",
        cancelled: true,
        content: "cancelled",
      },
    ],
    tools: [{ id: "running", name: "bash", args: {}, running: true }],
  });
  const group =
    view.container.querySelector<HTMLDetailsElement>(".process-group")!;
  expect(summaryText(group)).toBe("执行过程");
  expect(group.classList.contains("process-error")).toBe(false);
  expect(group.querySelector("summary")?.getAttribute("aria-busy")).toBe(
    "true",
  );
  expect(summaryText(group)).not.toContain("echo");
  expect(summaryText(group)).not.toContain("项");
}
it(
  "运行中摘要只显示执行过程，有错误时仍保持普通样式",
  runningAndTerminalStatuses,
);

/** 持续思考和思考结束时文案保持执行过程，通过可访问属性保留运行状态。参数：无。返回值：测试完成 Promise。 */
async function thinkingAfterCompletedTool() {
  const view = createTranscriptView();
  const messages: AgentMessage[] = [
    commandCall("completed", "echo completed"),
    { role: "toolResult", toolCallId: "completed", content: "finished output" },
    {
      role: "assistant",
      content: [{ type: "thinking", thinking: "still reasoning" }],
    },
  ];
  await view.render({ messages, streaming: true });
  const group =
    view.container.querySelector<HTMLDetailsElement>(".process-group")!;
  expect(summaryText(group)).toBe("执行过程");
  expect(group.querySelector("summary")?.getAttribute("aria-busy")).toBe(
    "true",
  );
  expect(
    view.row("completed").querySelector("summary")?.textContent,
  ).not.toContain("已完成");
  expect(
    view.row("completed").querySelector("summary")?.textContent,
  ).not.toContain("执行中");
  await view.render({ messages, streaming: false });
  expect(summaryText(group)).toBe("执行过程");
  expect(group.querySelector("summary")?.getAttribute("aria-busy")).toBe(
    "false",
  );
  expect(
    view.row("completed").querySelector("summary")?.textContent,
  ).not.toContain("已完成");
}
it(
  "思考进行中和结束后均显示执行过程，可访问运行状态跟随更新",
  thinkingAfterCompletedTool,
);

/** 结果刷新时错误标红同步更新，正常完成和取消都不标红。参数：无。返回值：测试完成 Promise。 */
async function errorHighlightUpdates() {
  const view = createTranscriptView();
  const results = [
    { isError: true, cancelled: false },
    { isError: false, cancelled: false },
    { isError: false, cancelled: true },
  ];
  for (const result of results) {
    await view.render({
      messages: [
        commandCall("operation", "echo operation"),
        {
          role: "toolResult",
          toolCallId: "operation",
          content: "actual output",
          ...result,
        },
      ],
    });
    const group =
      view.container.querySelector<HTMLDetailsElement>(".process-group")!;
    expect(summaryText(group)).toBe("执行过程");
    expect(group.classList.contains("process-error")).toBe(false);
    expect(view.row("operation").classList.contains("process-error")).toBe(result.isError);
  }
}
it("仅出错条目标红，执行过程及正常和取消条目不标红", errorHighlightUpdates);

/** 只按原生类型统计过程通知，正文和普通自定义消息不会参与计数。 */
it.each([
  { background: 0, agent: 0, expected: undefined },
  { background: 2, agent: 0, expected: " · 2 条后台结果" },
  { background: 0, agent: 1, expected: " · 1 条代理消息" },
  { background: 2, agent: 1, expected: " · 2 条后台结果 · 1 条代理消息" },
])("过程摘要仅显示非零通知计数：$background/$agent", async (scenario) => {
  const notices: AgentMessage[] = [
    ...Array.from({ length: scenario.background }, (): AgentMessage => ({
      role: "custom",
      customType: "async-result",
      content: "后台结果正文",
    })),
    ...Array.from({ length: scenario.agent }, (): AgentMessage => ({
      role: "custom",
      customType: "irc:incoming",
      content: "代理消息正文",
    })),
    { role: "custom", customType: "future-notice", content: "async-result" },
    { role: "assistant", customType: "async-result", content: "代理消息" },
  ];
  const items: ProcessItem[] = notices.map((message, index) => ({
    kind: "message",
    key: `notice:${index}`,
    message,
    streaming: false,
  }));
  await render(
    <details>
      <ProcessSummary
        items={items}
        active={false}
        startedAt={0}
        endedAt={125000}
      />
    </details>,
  );
  expect(container.querySelector(".process-summary-label")!.textContent).toBe(
    "运行了 2分5秒",
  );
  const counts = container.querySelector(".process-summary-notices");
  if (scenario.expected === undefined) expect(counts).toBeNull();
  else expect(counts!.textContent).toBe(scenario.expected);
  expect(container.textContent).not.toContain("正文");
});

/** 同一条纯用时转换同时支持执行过程和迟到分隔线，不重复添加场景前缀。 */
it.each([
  [-1000, "0秒"],
  [0, "0秒"],
  [999, "0秒"],
  [1000, "1秒"],
  [60000, "1分0秒"],
  [125999, "2分5秒"],
  [3600000, "1小时0分0秒"],
  [90061000, "1天1小时1分1秒"],
] as const)("纯用时与执行用时共用 %i 毫秒格式", (milliseconds, expected) => {
  expect(durationText(milliseconds)).toBe(expected);
  expect(formatDuration(milliseconds)).toBe(`运行了 ${expected}`);
});
