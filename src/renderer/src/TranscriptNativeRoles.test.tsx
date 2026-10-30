// @vitest-environment jsdom

import { expect, it, vi } from "vitest";
import type { PlanStatusRecord } from "../../shared/plan-status";
import { MessageBody } from "./TranscriptContent";
import type { AgentMessage } from "../../shared/protocol";
import { Transcript } from "./Transcript";
import { WebLinks } from "./WebLinks";

import {
  container,
  conversation,
  click,
  toolRow,
  call,
  image,
  render,
  timeline,
} from "./transcript-test-harness";
type MessageContentWithExtra = { type: string; text: string; extra: string };
const literal = "[source](https://evil.invalid) <script>bad()</script>";
const retainNativeRolesMessages: AgentMessage[] = [
  { role: "developer", content: "开发者约束" },
  {
    role: "bashExecution",
    command: literal,
    output: literal,
    cancelled: true,
    images: [image],
  },
  {
    role: "pythonExecution",
    code: literal,
    output: "python output",
    exitCode: 9,
  },
  { role: "branchSummary", summary: "保留分支" },
  { role: "compactionSummary", summary: "保留压缩" },
  {
    role: "fileMention",
    files: [
      { path: "reference.ts", content: literal },
      { path: "picture.png", content: "", image },
    ],
  },
  {
    role: "custom",
    content: "自定义正文",
    customType: "native-widget",
    details: { value: "自定义独立载荷" },
  },
  {
    role: "hookMessage",
    content: "",
    details: { value: "空正文钩子独立载荷" },
  },
  {
    role: "assistant",
    content: [
      image,
      { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz4=" },
      {
        type: "newNativeBlock",
        text: "新内容",
        extra: "完整块字段",
      } as MessageContentWithExtra,
    ],
  },
  {
    role: "futureRole",
    content: [
      {
        type: "toolCall",
        id: "future-call",
        name: "read",
        arguments: { path: "future.md" },
      },
    ],
    privateNativeField: { reason: "未知字段不得丢失" },
  },
  {
    role: "toolResult",
    toolCallId: "future-call",
    content: "未知角色的工具结果不能消失",
  },
  { role: "toolResult", toolCallId: "orphan", content: "无调用的原始结果" },
];

/** 保留独立角色、未知角色、未知块以及安全与不支持图片的实际载荷。参数：无。返回值：测试 Promise。 */
async function retainNativeRoles() {
  await conversation(retainNativeRolesMessages);
  await click(toolRow("future-call").querySelector("summary")!);
  await click(toolRow("orphan").querySelector("summary")!);
  expect(container.textContent).toContain("开发者约束");
  for (const text of [
    "保留分支",
    "保留压缩",
    "自定义正文",
    "空正文钩子独立载荷",
    "完整块字段",
    "未知字段不得丢失",
    "未知角色的工具结果不能消失",
    "无调用的原始结果",
  ])
    expect(container.textContent).toContain(text);
  expect(container.querySelectorAll("img")).toHaveLength(2);
  expect(container.querySelector('img[src*="svg"]')).toBeNull();
  expect(container.textContent).toContain("未加载不支持的图片格式或数据");
  expect(
    container.querySelector('[aria-label="Bash 执行"]')!.querySelector("a"),
  ).toBeNull();
  expect(
    container.querySelector('[aria-label="Python 执行"]')!.textContent,
  ).toContain("退出码 9");
  expect(
    container.querySelector('[aria-label="文件引用"]'),
  ).toBeNull();
  expect(toolRow("future-call").textContent).toContain(
    "未知角色的工具结果不能消失",
  );
  expect(
    container.querySelector('[aria-label="原生消息 futureRole"]')!.textContent,
  ).toContain("privateNativeField");
  expect(container.querySelector("script")).toBeNull();
  expect(container.textContent).not.toContain("原生消息数据");
}
it(
  "文件引用隐藏，其他原生角色、未知消息及图片保留且执行正文不解释链接",
  retainNativeRoles,
);

/** 文件引用仅在展示层过滤，不切断相邻操作或修改原始会话数据。 */
it("文件引用不产生空行或拆分执行过程，原生消息保持完整", async () => {
  const reference: AgentMessage = {
    role: "fileMention",
    files: [{ path: "hidden-reference.txt", content: "隐藏的引用内容" }],
  };
  const original = JSON.stringify(reference);
  await conversation([
    call("before-reference", "read", { path: "visible.txt" }),
    reference,
    call("after-reference", "bash", { command: "git status" }),
    { role: "assistant", content: "最终回答" },
  ]);
  expect(container.querySelectorAll(".process-group")).toHaveLength(1);
  expect(container.querySelectorAll(".tool-type-group")).toHaveLength(1);
  expect(container.textContent).not.toContain("hidden-reference.txt");
  expect(container.textContent).not.toContain("隐藏的引用内容");
  expect(container.textContent).toContain("visible.txt");
  expect(container.textContent).toContain("最终回答");
  expect(JSON.stringify(reference)).toBe(original);
});

const extensionPayloadsMessages: AgentMessage[] = [
  { role: "user", content: "普通提问" },
  { role: "assistant", content: "普通回答" },
  {
    role: "custom",
    content: "扩展正文",
    customType: "native-widget",
    details: { selected: "实际自定义选择" },
  },
  {
    role: "hookMessage",
    content: "",
    customType: "after-tool",
    details: { reason: "实际钩子拒绝原因" },
  },
];

/** 自定义消息仅显示正文，钩子消息保留专用证据折叠区。参数：无。返回值：测试 Promise。 */
async function extensionPayloads() {
  await conversation(extensionPayloadsMessages);
  expect(container.textContent).toContain("扩展正文");
  expect(container.textContent).not.toContain("自定义消息证据");
  expect(container.textContent).not.toContain("实际自定义选择");
  expect(container.textContent).not.toContain("native-widget");
  for (const role of ["用户消息", "助手消息", "自定义消息"])
    expect(
      container
        .querySelector(`[aria-label="${role}"]`)!
        .querySelector("details"),
    ).toBeNull();
  for (const [role, values] of [
    ["钩子消息", ["after-tool", "实际钩子拒绝原因"]],
  ] as const) {
    const evidence = container.querySelector<HTMLDetailsElement>(
      `[aria-label="${role}"] > .transcript-evidence`,
    )!;
    expect(evidence.open).toBe(false);
    await click(evidence.querySelector("summary")!);
    expect(evidence.open).toBe(true);
    for (const value of values)
      expect(evidence.querySelector("pre")!.textContent).toContain(value);
  }
}
it(
  "自定义消息保留正文且隐藏证据，空正文钩子仍可展开查看扩展载荷",
  extensionPayloads,
);

it("原生 seance XML 信封中的报告不会被 Markdown 当 HTML 丢弃", async () => {
  await conversation([{
    role: "custom", customType: "ompgui-seance", display: true,
    content: '<task-result id="history" agent="seance" status="completed">\\n<output>\\n## 历史决定\\n\\n**保留报告正文**\\n</output>\\n</task-result>'.replaceAll("\\n", "\n"),
  }]);
  const report = container.querySelector('[aria-label="历史会话咨询"]')!;
  expect(report.querySelector("strong")?.textContent).toBe("保留报告正文");
  expect(report.textContent).not.toContain("<task-result");
  expect(report.querySelector("task-result")).toBeNull();
});

const resultBeforeCallMessages: AgentMessage[] = [
  { role: "toolResult", toolCallId: "early", content: "早到结果" },
  { role: "assistant", content: "时间分隔正文" },
  call("early"),
];

/** 先收到孤立结果再收到同id调用时，结果原位置仍可查看。参数：无。返回值：测试 Promise。 */
async function resultBeforeCall() {
  await conversation(resultBeforeCallMessages);
  const units = [...container.querySelector(".conversation-review")!.children];
  await click(toolRow("early").querySelector("summary")!);
  expect(units[0].textContent).toContain("早到结果");
  expect(units[1].textContent).toContain("时间分隔正文");
  expect(container.querySelectorAll(".tool-row")).toHaveLength(1);
}
it("先到结果不移到未来调用位置也不重复创建结果行", resultBeforeCall);

// 固定原生批准记录的完整信封；不从生产解析器或提示模板生成，以捕获格式漂移。
const approvedPlanEnvelope = `Plan approved.
- History usable; the plan below authoritative if it conflicts with earlier exploration.

<instruction>
Full plan inlined below; durable copy at \`local://daily-focus-plan.md\` (identical content).
Execute plan step-by-step with full tool access; MUST verify each step before next.
NEVER re-read \`local://daily-focus-plan.md\` while the inline plan is intact; the path is for subagent handoff and recovery only.
Before execution: initialize todo tracking with \`todo\`.
After each completed step: immediately update \`todo\`.
If \`todo\` fails: fix payload; retry before continuing.
</instruction>

<plan path="local://daily-focus-plan.md">
## 计划
喝一杯水。

## 验收
喝完即可；不修改任何文件。
</plan>

<critical>
Inline plan compressed, expired, or unrecoverable: NEVER stop; read \`local://daily-focus-plan.md\`.
Read failure: report exact path and error; NEVER guess.
MUST continue until complete.
</critical>
`;
const approvedPlanMarkdown = "## 计划\n喝一杯水。\n\n## 验收\n喝完即可；不修改任何文件。";
const approvalHistoryLine =
  "- History usable; the plan below authoritative if it conflicts with earlier exploration.\n";
const approvalTodoLines =
  "Before execution: initialize todo tracking with `todo`.\n" +
  "After each completed step: immediately update `todo`.\n" +
  "If `todo` fails: fix payload; retry before continuing.\n";

/** 构造真实消费者输入，保留完整原生信封而不调用展示解析器。 */
function approvedMessage(content: AgentMessage["content"] = approvedPlanEnvelope): AgentMessage {
  return { role: "developer", synthetic: true, content };
}

/** 从真实可访问文章读取卡片，并检查完整计划及内部控制文本边界。 */
function approvedCard() {
  const cards = container.querySelectorAll('article[aria-label="计划已批准"]');
  expect(cards).toHaveLength(1);
  const card = cards[0];
  expect(card.classList.contains("plan-status-card")).toBe(true);
  expect(card.querySelector(".conversation-heading")?.textContent).toContain("计划已批准");
  expect([...card.querySelectorAll("h2")].map((heading) => heading.textContent))
    .toEqual(["计划", "验收"]);
  expect(card.textContent).toContain("喝一杯水。");
  expect(card.textContent).toContain("喝完即可；不修改任何文件。");
  expect(card.querySelector("code")?.textContent).toBe("local://daily-focus-plan.md");
  for (const control of [
    "Plan approved.", "History usable", "Full plan inlined", "MUST continue",
    "Execute plan step-by-step", "NEVER re-read", "initialize todo", "开发者消息",
  ]) expect(card.textContent).not.toContain(control);
  expect(card.querySelector("textarea, input, details")).toBeNull();
  return card;
}

it("原生批准快照显示完整只读计划卡片，后续助手回复保持在卡片之后", async () => {
  await conversation([
    approvedMessage(),
    { role: "assistant", content: "水已喝完，计划执行完成。" },
  ]);
  const card = approvedCard();
  expect(card.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  const answer = container.querySelector('article[aria-label="助手消息"]')!;
  expect(answer.textContent).toContain("水已喝完，计划执行完成。");
  expect(card.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(container.textContent).not.toContain("开发者消息");
});

it.each([
  { history: false, todo: false },
  { history: false, todo: true },
  { history: true, todo: false },
  { history: true, todo: true },
])("批准信封兼容原生 history=$history、todo=$todo 组合", async ({ history, todo }) => {
  let text = approvedPlanEnvelope;
  if (!history) text = text.replace(approvalHistoryLine, "");
  if (!todo) text = text.replace(approvalTodoLines, "");
  await conversation([approvedMessage(text)]);
  approvedCard();
});

it("CRLF 与跨控制行和计划正文边界的纯文本块仍组合成同一张卡片", async () => {
  const text = approvedPlanEnvelope.replaceAll("\n", "\r\n");
  const boundaries = [
    0,
    6,
    text.indexOf("<instruction>") + 5,
    text.indexOf('<plan path="') + 8,
    text.indexOf("喝一杯水。") + 2,
    text.indexOf("</plan>") + 3,
    text.length,
  ];
  const blocks = boundaries.slice(0, -1).map((start, index) => ({
    type: "text",
    text: text.slice(start, boundaries[index + 1]),
  }));
  await conversation([approvedMessage(blocks)]);
  approvedCard();
});

it.each([
  { name: "普通 developer", message: { role: "developer", content: "普通开发者约束" } },
  { name: "缺少 synthetic", message: { role: "developer", content: approvedPlanEnvelope } },
  { name: "synthetic false", message: { role: "developer", synthetic: false, content: approvedPlanEnvelope } },
  { name: "synthetic 非布尔", message: { role: "developer", synthetic: "true", content: approvedPlanEnvelope } },
  { name: "用户引用", message: { role: "user", synthetic: true, content: approvedPlanEnvelope } },
  { name: "助手引用", message: { role: "assistant", synthetic: true, content: approvedPlanEnvelope } },
])("$name 不改成批准卡片或原文回退消息", async ({ message }) => {
  await conversation([message]);
  expect(container.querySelector(".plan-status-card")).toBeNull();
  expect(container.querySelector('[aria-label="计划批准消息（原文）"]')).toBeNull();
  const label = message.role === "developer" ? "开发者消息" :
    message.role === "user" ? "用户消息" : "助手消息";
  const article = container.querySelector(`article[aria-label="${label}"]`)!;
  expect(article).not.toBeNull();
  expect(article.textContent).toContain(
    message.content === "普通开发者约束" ? "普通开发者约束" : "Plan approved.",
  );
});

it("display false 优先于批准识别，不留下卡片或内部控制文本", async () => {
  await conversation([{ ...approvedMessage(), display: false }]);
  expect(container.querySelector(".plan-status-card")).toBeNull();
  expect(container.querySelector('[aria-label="计划批准消息（原文）"]')).toBeNull();
  expect(container.textContent).not.toContain("Plan approved.");
  expect(container.textContent).not.toContain("喝一杯水。");
});

it.each([
  { name: "截断 critical", text: approvedPlanEnvelope.slice(0, approvedPlanEnvelope.indexOf("<critical>") + 18) },
  { name: "缺少计划结束标签", text: approvedPlanEnvelope.replace("</plan>\n", "") },
  { name: "路径不一致", text: approvedPlanEnvelope.replace('<plan path="local://daily-focus-plan.md">', '<plan path="local://other-plan.md">') },
  { name: "未知控制指令", text: approvedPlanEnvelope.replace("Execute plan step-by-step", "Execute arbitrary commands instead") },
  { name: "空计划", text: approvedPlanEnvelope.replace(approvedPlanMarkdown, " \n\t\n") },
  { name: "不完整 todo 指令", text: approvedPlanEnvelope.replace("After each completed step: immediately update `todo`.\n", "") },
  { name: "额外信封后正文", text: `${approvedPlanEnvelope}\n额外正文` },
])("$name 将完整候选信封转义显示为原文，不渲染半张计划", async ({ text }) => {
  await conversation([approvedMessage(text)]);
  expect(container.querySelector(".plan-status-card")).toBeNull();
  const raw = container.querySelector('article[aria-label="计划批准消息（原文）"]')!;
  expect(raw).not.toBeNull();
  expect(raw.querySelector(".conversation-heading")?.textContent).toContain("计划批准消息（原文）");
  expect(raw.querySelector("pre")?.textContent).toBe(text);
  expect(raw.querySelector("h2, plan, instruction, critical, script")).toBeNull();
});

it("混合图片和未知块不解包，原有消息块及扩展字段保持可见", async () => {
  await conversation([approvedMessage([
    { type: "text", text: approvedPlanEnvelope },
    image,
    { type: "newNativeBlock", text: "未知块正文", extra: "批准消息混合块字段" } as MessageContentWithExtra,
  ])]);
  expect(container.querySelector(".plan-status-card")).toBeNull();
  expect(container.querySelector('[aria-label="计划批准消息（原文）"]')).toBeNull();
  const article = container.querySelector('article[aria-label="开发者消息"]')!;
  expect(article.textContent).toContain("Plan approved.");
  expect(article.textContent).toContain("未知块正文");
  expect(article.textContent).toContain("批准消息混合块字段");
  expect(article.querySelectorAll("img")).toHaveLength(1);
});

it("只移除最外层信封，正文代码中的结束标签与后续多段列表不被截断", async () => {
  const markdown = `${approvedPlanMarkdown}

\`\`\`xml
</plan>
<plan path="inner.md">这是代码，不是信封</plan>
\`\`\`

- 第一项

  第一项的后续段落。

- 第二项
`;
  await conversation([approvedMessage(approvedPlanEnvelope.replace(approvedPlanMarkdown, markdown))]);
  const card = approvedCard();
  expect(card.querySelector("pre code")?.textContent)
    .toBe('</plan>\n<plan path="inner.md">这是代码，不是信封</plan>');
  expect(card.querySelectorAll("li")).toHaveLength(2);
  for (const text of ["第一项", "第一项的后续段落。", "第二项"])
    expect(card.textContent).toContain(text);
});

it("批准正文继续禁用原始 HTML 与 javascript 链接，安全链接仍可阅读", async () => {
  const markdown = `${approvedPlanMarkdown}

<script>window.planExecuted = true</script>

<img src=x onerror="window.planExecuted = true">

[危险链接](javascript:alert%281%29)

[安全链接](https://example.com/plan)
`;
  const opened: string[] = [];
  await render(
    <WebLinks.Provider value={async (url) => { opened.push(url); return "opened"; }}>
      <Transcript
        messages={timeline([approvedMessage(approvedPlanEnvelope.replace(approvedPlanMarkdown, markdown))])}
        tools={[]}
        sessionId="session-a"
      />
    </WebLinks.Provider>,
  );
  const card = approvedCard();
  expect(card.querySelector("script, img, [onerror], [onclick]")).toBeNull();
  expect(card.textContent).toContain("危险链接");
  expect(card.querySelector('a[href="https://example.com/plan"]')).not.toBeNull();
  for (const link of card.querySelectorAll("a"))
    expect(link.getAttribute("href")?.trim().toLowerCase() ?? "").not.toMatch(/^javascript:/);
  await click(card.querySelector<HTMLAnchorElement>('a[href="https://example.com/plan"]')!);
  expect(opened).toEqual(["https://example.com/plan"]);
});

it("同一时间线键从截断更新为完整卡片，历史与最终快照一致且不修改输入", async () => {
  const complete = approvedMessage([
    { type: "text", text: approvedPlanEnvelope.slice(0, 11) },
    { type: "text", text: approvedPlanEnvelope.slice(11) },
  ]);
  const snapshot = structuredClone(complete);
  const finalAnswer: AgentMessage = { role: "assistant", content: "完成后的助手回复" };
  await conversation([complete, finalAnswer]);
  approvedCard();
  const historicalMarkup = container.innerHTML;
  expect(complete).toEqual(snapshot);

  const partial = approvedMessage(approvedPlanEnvelope.slice(0, approvedPlanEnvelope.indexOf("</plan>")));
  const partialSnapshot = structuredClone(partial);
  await conversation([partial, finalAnswer]);
  expect(container.querySelectorAll('[aria-label="计划批准消息（原文）"]')).toHaveLength(1);
  expect(container.querySelector(".plan-status-card")).toBeNull();
  expect(partial).toEqual(partialSnapshot);

  await conversation([complete, finalAnswer]);
  approvedCard();
  expect(container.querySelector('[aria-label="计划批准消息（原文）"]')).toBeNull();
  expect(container.innerHTML).toBe(historicalMarkup);
  expect(complete).toEqual(snapshot);
  expect(partial).toEqual(partialSnapshot);
});

/** 状态元数据与正文分别持久化，测试保持与扩展写入格式一致。 */
function statusMessage(overrides: Partial<PlanStatusRecord> = {}): AgentMessage {
  return {
    role: "custom", customType: "ompgui-plan-status", display: true, timestamp: 1234,
    details: {
      version: 1, operationId: "operation-a", kind: "approved", choice: "keep",
      planPath: "local://daily-focus-plan.md", ...overrides,
    },
  };
}

it.each(["approved", "continued"] as const)("%s 元数据与紧邻批准正文合并，模型和版本保留且不出现自定义消息包装", async (kind) => {
  await conversation([
    call("preceding", "read"),
    statusMessage({ kind, choice: kind === "continued" ? "execute" : "keep", revision: 2, contextPercent: 62, model: { provider: "test", modelId: "model", name: "执行模型", thinkingLevel: "medium" } }),
    approvedMessage([{ type: "text", text: approvedPlanEnvelope }]),
    { role: "assistant", content: "后续回复" },
  ]);
  const cards = container.querySelectorAll(".plan-status-card");
  expect(cards).toHaveLength(1);
  expect(cards[0].textContent).toContain("执行模型");
  expect(cards[0].textContent).toContain("第 2 版");
  expect(cards[0].textContent).toContain("思考:medium");
  expect(cards[0].textContent).toContain("上下文 62%");
  expect(cards[0].textContent).toContain("喝一杯水。");
  expect(container.querySelector(".conversation-custom")).toBeNull();
  expect(container.textContent).not.toContain("自定义消息");
  expect(container.querySelectorAll(".process-group")).toHaveLength(1);
});

it("路径不匹配或原始消息不紧邻时不合并卡片", async () => {
  await conversation([
    statusMessage({ operationId: "mismatch", planPath: "local://other.md" }),
    approvedMessage(),
    statusMessage({ operationId: "interrupted" }),
    call("between", "read"),
    approvedMessage(),
  ]);
  const cards = container.querySelectorAll(".plan-status-card");
  expect(cards).toHaveLength(4);
  expect(cards[0].querySelector("[aria-expanded]")).toBeNull();
  expect(cards[2].querySelector("[aria-expanded]")).toBeNull();
});

it("只有最新批准默认展开，点击后刷新时间线键不重置稳定选择", async () => {
  const messages = [
    { ...approvedMessage(), timestamp: 10 },
    statusMessage({ operationId: "latest" }),
    approvedMessage(),
    statusMessage({ kind: "refined", choice: "refine", operationId: "refine", document: "## 退回时正文" }),
  ];
  const state = new Map<string, boolean>();
  const toggled = vi.fn();
  await render(<Transcript messages={timeline(messages)} tools={[]} sessionId="session-a" planCardState={state} onPlanCardToggle={toggled} />);
  const buttons = container.querySelectorAll<HTMLButtonElement>(".plan-status-toggle");
  expect([...buttons].map((button) => button.getAttribute("aria-expanded"))).toEqual(["false", "true", "false"]);
  await click(buttons[1]);
  expect(buttons[1].getAttribute("aria-expanded")).toBe("false");
  expect(toggled).toHaveBeenCalledWith("latest:approved", false);
  await click(buttons[0]);
  await render(<Transcript messages={timeline(messages).map((item) => ({ ...item, key: `reloaded:${item.key}` }))} tools={[]} sessionId="session-a" planCardState={state} />);
  expect([...container.querySelectorAll(".plan-status-toggle")].map((button) => button.getAttribute("aria-expanded"))).toEqual(["true", "false", "false"]);
});

it("无正文状态没有箭头和折叠按钮；无效元数据不留下任何包装", async () => {
  await conversation([
    statusMessage({ kind: "stopped" }),
    { ...statusMessage(), details: { version: 99, kind: "approved" } },
    { ...statusMessage(), details: null },
  ]);
  expect(container.querySelectorAll("article")).toHaveLength(1);
  expect(container.querySelector("[aria-expanded], .plan-status-chevron, button")).toBeNull();
  expect(container.textContent).toContain("已停止处置");
});

it("退回快照使用安全 Markdown，失败展开完整字面错误，嵌入 MessageBody 同样使用新卡片", async () => {
  const error = "连接中断\n完整错误 <script>执行()</script>\n尾部";
  await render(<>
    <MessageBody message={statusMessage({ kind: "refined", choice: "refine", document: "## 快照\n\n<script>执行()</script>\n\n[危险](javascript:alert%281%29)" })} />
    <MessageBody message={statusMessage({ kind: "failed", operationId: "failed", error })} />
    <MessageBody message={approvedMessage()} />
    <MessageBody message={{ ...statusMessage(), details: {} }} />
  </>);
  expect(container.querySelectorAll(".plan-status-card")).toHaveLength(3);
  const buttons = container.querySelectorAll<HTMLButtonElement>(".plan-status-toggle");
  await click(buttons[0]);
  await click(buttons[1]);
  expect(container.querySelector(".plan-status-info h2")?.textContent).toBe("快照");
  expect(container.querySelector("script, img, [onclick]")).toBeNull();
  expect(container.querySelector(".plan-status-error pre")?.textContent).toBe(error);
  for (const link of container.querySelectorAll("a")) expect(link.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
});

it("打开新会话和复制路径不嵌套按钮，也不切换折叠状态", async () => {
  const open = vi.fn(async () => {});
  await render(<Transcript messages={timeline([statusMessage({ kind: "refined", choice: "refine", document: "## 正文", targetSessionId: "target" })])} tools={[]} sessionId="session-a" onOpenPlanSession={open} />);
  const toggle = container.querySelector<HTMLButtonElement>(".plan-status-toggle")!;
  const action = container.querySelector<HTMLButtonElement>(".plan-status-actions button")!;
  expect(container.querySelector("button button")).toBeNull();
  await click(action);
  expect(open).toHaveBeenCalledWith("target");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

it("保存路径复制独立操作且错误可见，无正文卡片仍不折叠", async () => {
  const copyText = vi.fn(async (_path: string) => {});
  vi.stubGlobal("desktop", { copyText });
  try {
    await conversation([statusMessage({ kind: "saved", choice: "save", savedPath: "D:/plans/saved.md" })]);
    const copy = container.querySelector<HTMLButtonElement>(".plan-status-actions button")!;
    expect(copy.textContent).toBe("复制路径");
    expect(container.querySelector("button button, [aria-expanded]")).toBeNull();
    await click(copy);
    expect(copyText).toHaveBeenCalledWith("D:/plans/saved.md");
    copyText.mockRejectedValueOnce(new Error("无法复制路径"));
    await click(copy);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("无法复制路径");
  } finally { vi.unstubAllGlobals(); }
});

it("压缩取消快照默认收起，用户可展开全文；有后续批准前元数据不抢占最新展开", async () => {
  await conversation([
    approvedMessage(),
    statusMessage({ kind: "compactCancelled", choice: "compact", document: "## 压缩前的完整计划" }),
    statusMessage({ operationId: "waiting", kind: "continued", choice: "execute" }),
  ]);
  const cards = container.querySelectorAll(".plan-status-card");
  expect(cards[0].querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  const cancelled = cards[1].querySelector<HTMLButtonElement>(".plan-status-toggle")!;
  expect(cancelled.getAttribute("aria-expanded")).toBe("false");
  expect(cards[2].querySelector("[aria-expanded]")).toBeNull();
  await click(cancelled);
  expect(cards[1].querySelector("h2")?.textContent).toBe("压缩前的完整计划");
});
