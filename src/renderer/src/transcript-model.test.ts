// @vitest-environment node
import { expect, it } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import type { TimelineMessage } from "./session";
import { transcriptUnits } from "./transcript-model";

function render(message: AgentMessage) {
  return transcriptUnits([{ key: "message", message, streaming: false }], []);
}

it("隐藏助手单点正文且不修改原始消息", () => {
  for (const content of [".", " \n. ", [{ type: "text", text: "." }]]) {
    const message: AgentMessage = { role: "assistant", content };
    const before = structuredClone(message);
    expect(render(message)).toEqual([]);
    expect(message).toEqual(before);
  }
});

it("过滤单点后仍保留工具、思考和正常正文", () => {
  const message: AgentMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "检查文件" },
      { type: "text", text: "." },
      {
        type: "toolCall",
        id: "run",
        name: "bash",
        arguments: { command: "pwd" },
      },
      { type: "text", text: "完成。" },
    ],
  };
  const before = structuredClone(message);
  const units = render(message);
  expect(units[0]).toMatchObject({
    kind: "process",
    items: [{ kind: "thinking" }, { kind: "tool", tool: { id: "run" } }],
  });
  expect(units[1]).toMatchObject({
    kind: "message",
    message: { content: [{ type: "text", text: "完成。" }] },
  });
  expect(message).toEqual(before);
});

it("保留用户单点、正常标点文本及助手错误状态", () => {
  expect(render({ role: "user", content: "." })[0]).toMatchObject({
    kind: "message",
    message: { content: "." },
  });
  for (const text of ["...", "完成.", "。"])
    expect(render({ role: "assistant", content: text })[0]).toMatchObject({
      kind: "message",
      message: { content: text },
    });
  expect(
    JSON.stringify(
      render({
        role: "assistant",
        content: ".",
        stopReason: "error",
        errorMessage: "请求失败",
      }),
    ),
  ).toContain("请求失败");
});

/** 为多段时间线提供稳定 key，默认使用已落盘消息。 */
function entry(
  key: string,
  message: AgentMessage,
  streaming = false,
): TimelineMessage {
  return { key, message, streaming };
}

/** 显式保留原生 stop，不从测试消息的位置推断最终回复。 */
function answer(key: string, timestamp?: number): TimelineMessage {
  return entry(key, {
    role: "assistant",
    content: key,
    stopReason: "stop",
    timestamp,
  });
}

/** 后台标签和代理来源均来自原生 details。 */
function notice(
  key: string,
  customType = "async-result",
  timestamp?: number,
): TimelineMessage {
  return entry(key, {
    role: "custom",
    customType,
    content: `输出 ${key}`,
    timestamp,
    details: customType === "irc:incoming"
      ? { from: "审查代理" }
      : { jobs: [{ label: "后台检查" }] },
  });
}

/** 一次原生工具调用及其结果，用于验证过程边界和配对。 */
function toolRun(key: string): TimelineMessage[] {
  return [
    entry(`${key}:call`, {
      role: "assistant",
      stopReason: "toolUse",
      content: [{
        type: "toolCall",
        id: key,
        name: "bash",
        arguments: { command: "pwd" },
      }],
    }),
    entry(`${key}:result`, {
      role: "toolResult",
      toolCallId: key,
      toolName: "bash",
      content: "工作目录",
    }),
  ];
}

it("迟到结果将主回复、触发卡片和后续执行过程分开", () => {
  const messages = [
    entry("user", { role: "user", content: "检查项目" }),
    ...toolRun("main"),
    answer("A1", 1_000),
    notice("late", "async-result", 4_000),
    ...toolRun("followup"),
    answer("A2", 5_000),
  ];
  const before = structuredClone(messages);
  const units = transcriptUnits(messages, []);
  expect(units.map((unit) => unit.kind)).toEqual([
    "message", "process", "message", "lateDivider",
    "message", "process", "message",
  ]);
  expect(units[2]).toMatchObject({ key: "A1", message: { content: "A1" } });
  expect(units[3]).toEqual({
    kind: "lateDivider",
    key: "late:late",
    arrivedAt: 4_000,
    answeredAt: 1_000,
  });
  const followup = { key: "late", title: "后台检查" };
  expect(units[4]).toMatchObject({ key: "late", segment: "trigger", followup });
  expect(units[5]).toMatchObject({
    kind: "process",
    followup,
    items: [{ kind: "tool", tool: { id: "followup" } }],
  });
  expect(units[6]).toMatchObject({ key: "A2", segment: "followup", followup });
  expect(units.flatMap((unit) => unit.kind === "process" ? unit.items : [])
    .some((item) => item.key === "A1")).toBe(false);
  expect(messages).toEqual(before);
});

it("轮次中途的后台结果仍保留在主过程内", () => {
  const units = transcriptUnits([
    ...toolRun("main"), notice("early"), answer("A1"),
  ], []);
  expect(units.map((unit) => unit.kind)).toEqual(["process", "message"]);
  expect(units[0]).toMatchObject({
    items: [
      { kind: "tool", tool: { id: "main" } },
      { kind: "message", key: "early" },
    ],
  });
  expect(units[1]).toMatchObject({ key: "A1" });
  expect(units[1]).not.toHaveProperty("segment");
});

it("连续迟到结果共用首条来源和一条分隔线", () => {
  const units = transcriptUnits([
    answer("A1"), notice("late1"), notice("late2"), answer("A2"),
  ], []);
  expect(units.map((unit) => unit.kind)).toEqual([
    "message", "lateDivider", "message", "message", "message",
  ]);
  for (const index of [2, 3])
    expect(units[index]).toMatchObject({
      segment: "trigger",
      followup: { key: "late1", title: "后台检查" },
    });
  expect(units[4]).toMatchObject({
    key: "A2", segment: "followup", followup: { key: "late1" },
  });
});

it("迟到结果后没有回复时仅保留分隔线和触发卡片", () => {
  const units = transcriptUnits([
    answer("A1"),
    notice("late"),
    entry("next", { role: "user", content: "继续" }),
  ], []);
  expect(units.map((unit) => unit.kind)).toEqual([
    "message", "lateDivider", "message", "message",
  ]);
  expect(units[2]).toMatchObject({ key: "late", segment: "trigger" });
  expect(units[3]).toMatchObject({ key: "next" });
  expect(units[3]).not.toHaveProperty("followup");
  expect(transcriptUnits([answer("A1"), notice("late")], []))
    .toEqual(units.slice(0, 3));
});

it("流式后续正文无需 stopReason 也关联触发来源", () => {
  const units = transcriptUnits([
    answer("A1"),
    notice("late"),
    entry("A2", { role: "assistant", content: "继续生成" }, true),
  ], []);
  expect(units.at(-1)).toMatchObject({
    key: "A2",
    streaming: true,
    segment: "followup",
    followup: { key: "late" },
  });
});

it("代理来信与后台结果同样开启后续段并使用原生来源标题", () => {
  const units = transcriptUnits([
    answer("A1"), notice("mail", "irc:incoming"), answer("A2"),
  ], []);
  expect(units[1]).toMatchObject({ kind: "lateDivider", key: "late:mail" });
  expect(units[2]).toMatchObject({
    key: "mail",
    segment: "trigger",
    followup: { key: "mail", title: "审查代理" },
  });
  expect(units[3]).toMatchObject({
    key: "A2", segment: "followup", followup: { key: "mail" },
  });
});

it("缺少 stopReason 的旧回复保持原有合并行为", () => {
  const units = transcriptUnits([
    entry("A1", { role: "assistant", content: "旧回复" }),
    notice("late"),
    answer("A2"),
  ], []);
  expect(units.map((unit) => unit.kind)).toEqual(["process", "message"]);
  expect(units[0]).toMatchObject({
    items: [{ key: "A1" }, { key: "late" }],
  });
  expect(units[1]).toMatchObject({ key: "A2" });
  expect(units[1]).not.toHaveProperty("followup");
});

it("后续回复结束后再次迟到的结果开启独立后续段", () => {
  const units = transcriptUnits([
    answer("A1", 1_000),
    notice("late1", "async-result", 2_000),
    answer("A2", 3_000),
    notice("late2", "async-result", 4_000),
    ...toolRun("second"),
    answer("A3", 5_000),
  ], []);
  expect(units.filter((unit) => unit.kind === "lateDivider")).toEqual([
    { kind: "lateDivider", key: "late:late1", arrivedAt: 2_000, answeredAt: 1_000 },
    { kind: "lateDivider", key: "late:late2", arrivedAt: 4_000, answeredAt: 3_000 },
  ]);
  expect(units.find((unit) => unit.key === "A2")).toMatchObject({
    segment: "followup", followup: { key: "late1" },
  });
  expect(units.at(-2)).toMatchObject({
    kind: "process", followup: { key: "late2" },
  });
  expect(units.at(-1)).toMatchObject({
    key: "A3", segment: "followup", followup: { key: "late2" },
  });
});

it.each(["toolUse", "aborted", "error", "length", undefined])(
  "原生终止原因 %s 不作为已完成回复边界",
  (stopReason) => {
    const units = transcriptUnits([
      entry("A1", { role: "assistant", content: "阶段正文", stopReason }),
      notice("notice"),
      answer("A2"),
    ], []);
    expect(units.map((unit) => unit.kind)).toEqual(["process", "message"]);
    expect(units[0]).toMatchObject({
      items: [{ key: "A1" }, { key: "notice" }],
    });
  },
);

it("仍在 streaming 的 stop 正文不作为边界", () => {
  const units = transcriptUnits([
    { ...answer("A1"), streaming: true }, notice("notice"), answer("A2"),
  ], []);
  expect(units.map((unit) => unit.kind)).toEqual(["process", "message"]);
});

it("只从过程开头剥离连续通知，思考后的通知仍属于过程", () => {
  const units = transcriptUnits([
    answer("A1"),
    notice("trigger"),
    entry("thinking", {
      role: "assistant",
      content: [{ type: "thinking", thinking: "处理结果" }],
    }),
    notice("inside"),
    answer("A2"),
  ], []);
  expect(units.map((unit) => unit.kind)).toEqual([
    "message", "lateDivider", "message", "process", "message",
  ]);
  expect(units[3]).toMatchObject({
    followup: { key: "trigger" },
    items: [{ kind: "thinking" }, { kind: "message", key: "inside" }],
  });
});

it("已结束回复后先出现非通知过程时不再识别迟到边界", () => {
  const units = transcriptUnits([
    answer("A1"), ...toolRun("next"), notice("inside"), answer("A2"),
  ], []);
  expect(units.map((unit) => unit.kind)).toEqual(["message", "process", "message"]);
  expect(units[1]).toMatchObject({
    items: [{ kind: "tool" }, { kind: "message", key: "inside" }],
  });
  expect(units[2]).not.toHaveProperty("segment");
});

it.each(["user", "developer", "custom"])(
  "其他角色 %s 会清除结束边界及后续来源",
  (role) => {
    const units = transcriptUnits([
      answer("A1"),
      notice("trigger"),
      answer("A2"),
      entry("other", { role, content: "新消息" }),
      notice("inside"),
      answer("A3"),
    ], []);
    expect(units.filter((unit) => unit.kind === "lateDivider")).toHaveLength(1);
    expect(units.at(-1)).toMatchObject({ key: "A3" });
    expect(units.at(-1)).not.toHaveProperty("followup");
    expect(units.at(-2)).toMatchObject({
      kind: "process", items: [{ key: "inside" }],
    });
  },
);

it("数组正文仅最后一个正文块的 stop 产生迟到边界", () => {
  const units = transcriptUnits([
    entry("A1", {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "阶段说明" },
        { type: "thinking", thinking: "继续分析" },
        { type: "text", text: "最终正文" },
      ],
    }),
    notice("late"),
    answer("A2"),
  ], []);
  expect(units.map((unit) => unit.kind)).toEqual([
    "process", "message", "lateDivider", "message", "message",
  ]);
  expect(units[0]).toMatchObject({
    items: [
      { kind: "message", message: { stopReason: undefined } },
      { kind: "thinking" },
    ],
  });
  expect(units[1]).toMatchObject({
    key: "A1:text:1",
    message: { content: [{ type: "text", text: "最终正文" }], stopReason: "stop" },
  });
});
