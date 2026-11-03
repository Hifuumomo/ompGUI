// @vitest-environment node
import { expect, it } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import { transcriptUnits } from "./transcript-model";

/** 从真实消息生成稳定键，便于验证原始位置。 */
function timeline(messages: AgentMessage[], mode: "full" | "compact" = "full") {
  return transcriptUnits(
    messages.map((message, index) => ({
      message,
      key: String(index),
      streaming: false,
    })),
    [],
    mode,
  );
}
/** 会话事件使用历史转换后的结构。 */
function event(event: string, fields: Record<string, unknown>): AgentMessage {
  return {
    role: "custom",
    customType: "ompgui-session-event",
    details: { event, ...fields },
  };
}
const user: AgentMessage = { role: "user", content: "开始" };
const answer: AgentMessage = {
  role: "assistant",
  content: "完成",
  stopReason: "stop",
};
const call: AgentMessage = {
  role: "assistant",
  content: [
    {
      type: "toolCall",
      id: "run",
      name: "bash",
      arguments: { command: "pwd" },
    },
  ],
};

it("丢弃初始化事件，相邻同类取最后值并规范化模型名称", () => {
  const units = timeline([
    event("model_change", { model: "p/init" }),
    user,
    answer,
    event("model_change", { model: "p/old" }),
    event("thinking_level_change", { thinkingLevel: "high" }),
    event("model_change", { model: { provider: "p", id: "p/latest" } }),
    event("mode_change", { mode: "plan" }),
    user,
  ]);
  expect(units.map((unit) => unit.kind)).toEqual([
    "message",
    "message",
    "message",
    "message",
  ]);
  expect(units[2]).toMatchObject({
    message: {
      customType: "ompgui-event-divider",
      content: "模型切换为 latest · 思考 high · 进入 plan 模式",
    },
  });
});

it("执行中事件留在折叠过程，最终回复之后的事件不倒移", () => {
  const units = timeline([
    user,
    call,
    event("mode_change", { mode: "plan" }),
    answer,
    event("mode_change", { mode: "code" }),
    user,
  ]);
  expect(units[1]).toMatchObject({
    kind: "process",
    items: [
      { kind: "tool" },
      { kind: "message", message: { content: "进入 plan 模式" } },
    ],
  });
  expect(units[2]).toMatchObject({ kind: "message", message: answer });
  expect(units[3]).toMatchObject({
    kind: "message",
    message: { content: "进入 code 模式" },
  });
});

it("分隔线不破坏最终回复后迟到结果及后续回复分段", () => {
  const units = timeline([
    user,
    answer,
    event("mode_change", { mode: "plan" }),
    { role: "custom", customType: "async-result", content: "输出" },
    answer,
  ]);
  expect(units[3]).toMatchObject({ kind: "lateDivider" });
  expect(units[4]).toMatchObject({ kind: "message", segment: "trigger" });
  expect(units[5]).toMatchObject({ kind: "message", segment: "followup" });
});

it("压缩只格式化真实 token 数，交接去除封装标签", () => {
  const units = timeline([
    user,
    answer,
    {
      role: "compactionSummary",
      summary: "摘要",
      tokensBefore: 232000,
      tokensAfter: 21000,
    },
    { role: "compactionSummary", summary: "缺少后值", tokensBefore: 232000 },
    { role: "compactionSummary", summary: "无数字" },
    { role: "branchSummary", summary: "分支内容" },
    {
      role: "custom",
      customType: "handoff",
      content: "<handoff-context>交接内容</handoff-context>",
    },
  ]);
  expect(units.slice(2)).toMatchObject([
    {
      message: {
        content: "上下文已压缩 232K → 21K",
        details: { detail: "摘要" },
      },
    },
    { message: { content: "上下文已压缩 232K" } },
    { message: { content: "上下文已压缩" } },
    { message: { content: "分支摘要", details: { detail: "分支内容" } } },
    { message: { details: { detail: "交接内容" } } },
  ]);
});

it("两种模式均把文件与隐藏模型提及关联最近用户，不猜测无前置用户的归属", () => {
  const file = {
    path: "src/a.ts",
    content: "",
    skippedReason: "binary" as const,
  };
  for (const mode of ["full", "compact"] as const) {
    const units = timeline(
      [
        { role: "fileMention", files: [file] },
        user,
        answer,
        { role: "fileMention", files: [file] },
        {
          role: "custom",
          customType: "model_mention",
          display: false,
          details: { name: "GPT-6-Luna" },
        },
        user,
      ],
      mode,
    );
    expect(units.filter((unit) => unit.kind === "message")).toHaveLength(3);
    expect(
      units.filter(
        (unit) => unit.kind === "message" && unit.message.role === "user",
      ),
    ).toMatchObject([
      {
        key: "1",
        mentions: [file],
        modelMentions: [{ details: { name: "GPT-6-Luna" } }],
      },
      { key: "5", mentions: [], modelMentions: [] },
    ]);
    expect(units[0]).toMatchObject({
      mentions: [file],
      modelMentions: [{ details: { name: "GPT-6-Luna" } }],
    });
    expect(units.at(-1)).toMatchObject({ mentions: [], modelMentions: [] });
  }
});

it("完整模式隐藏开发者元数据，紧凑模式保留原生消息和压缩表示", () => {
  const developer: AgentMessage = { role: "developer", content: "内部信息" };
  const compaction: AgentMessage = {
    role: "compactionSummary",
    summary: "摘要",
  };
  expect(JSON.stringify(timeline([user, developer, compaction]))).not.toContain(
    "内部信息",
  );
  const compact = JSON.stringify(
    timeline([user, developer, compaction], "compact"),
  );
  expect(compact).toContain("内部信息");
  expect(compact).toContain("compactionSummary");
  expect(compact).not.toContain("ompgui-event-divider");
});

it("守护进程完成通知也开启迟到后续段", () => {
  expect(
    timeline([
      user,
      answer,
      {
        role: "custom",
        customType: "launch-completion",
        details: { daemons: [] },
      },
      answer,
    ])[2],
  ).toMatchObject({ kind: "lateDivider" });
});

it("未完成参数预览不被旧实时参数覆盖，完整参数随后清除预览", () => {
  const live = [
    {
      id: "stream-preview",
      name: "bash",
      args: { command: "stale" },
      running: true,
    },
  ];
  const incomplete = {
    type: "toolCall",
    id: "stream-preview",
    name: "bash",
    partialArguments: '{"command":"current',
  };
  const units = transcriptUnits(
    [
      {
        key: "stream",
        streaming: true,
        message: { role: "assistant", content: [incomplete] },
      },
    ],
    live,
    "full",
  );
  expect(units[0]).toMatchObject({
    kind: "process",
    items: [
      { tool: { args: undefined, streamingArgs: { command: "current" } } },
    ],
  });
  const completed = transcriptUnits(
    [
      {
        key: "stream",
        streaming: false,
        message: {
          role: "assistant",
          content: [{ ...incomplete, arguments: { command: "complete" } }],
        },
      },
    ],
    live,
    "full",
  );
  expect(completed[0]).toMatchObject({
    kind: "process",
    items: [
      { tool: { args: { command: "complete" }, streamingArgs: undefined } },
    ],
  });
});
