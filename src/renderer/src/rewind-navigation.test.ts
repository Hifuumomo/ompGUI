import { expect, it } from "vitest";
import type { AgentMessage, SessionEntry } from "../../shared/protocol";
import {
  createRewindState,
  filterRewind,
  moveRewind,
  openRewindFilter,
  rewindView,
} from "./rewind-navigation";
import { matchesRewindFilter, rewindTargets } from "./rewind-targets";

function entry(
  id: string,
  parentId: string | null,
  message: AgentMessage,
): SessionEntry {
  return {
    id,
    parentId,
    type: "message",
    timestamp: "2026-10-15T00:00:00Z",
    message,
  };
}

const entries = [
  entry("u1", null, { role: "user", content: "第一轮" }),
  entry("a1", "u1", { role: "assistant", content: "第一轮回复" }),
  entry("u2", "a1", { role: "user", content: "ls 第二轮" }),
  entry("a2", "u2", { role: "assistant", content: "tools 回复" }),
  entry("b1", "a1", { role: "user", content: "另一分支" }),
  entry("b2", "b1", { role: "assistant", content: "分支回复" }),
  entry("c1", "a1", { role: "user", content: "第三分支" }),
  entry("c2", "c1", { role: "assistant", content: "第三分支回复" }),
  entry("c-old", "c2", { role: "assistant", content: "较早延伸" }),
  entry("c-new", "c2", { role: "assistant", content: "最新延伸" }),
];

it("初始框选最后消息，上下逐项且到首尾不循环", () => {
  const initial = createRewindState(entries, "a2");
  expect(rewindView(initial).selectedTarget?.turnId).toBe("a2");
  expect(moveRewind(initial, "ArrowDown")).toBe(initial);
  const previous = moveRewind(initial, "ArrowUp");
  expect(rewindView(previous).selectedTarget?.turnId).toBe("u2");
  const first = moveRewind(moveRewind(previous, "ArrowUp"), "ArrowUp");
  expect(rewindView(first).selectedTarget?.turnId).toBe("u1");
  expect(moveRewind(first, "ArrowUp")).toBe(first);
});

it("左右在直接分岔处切换列，其余位置跳用户轮", () => {
  const atFork = moveRewind(createRewindState(entries, "a2"), "ArrowLeft");
  expect(rewindView(atFork).columns.map((col) => col.rootId)).toEqual([
    "u2",
    "b1",
    "c1",
  ]);
  const sibling = moveRewind(atFork, "ArrowRight");
  expect(rewindView(sibling).selectedTarget?.turnId).toBe("b1");
  expect(rewindView(sibling).entries.map((item) => item.id)).toEqual([
    "u1",
    "a1",
    "b1",
    "b2",
  ]);
  const third = moveRewind(moveRewind(sibling, "ArrowDown"), "ArrowRight");
  expect(rewindView(third).selectedTarget?.turnId).toBe("c1");
  expect(rewindView(third).columns[2].entries.map((item) => item.id)).toEqual([
    "c1",
    "c2",
    "c-new",
  ]);
  const back = moveRewind(moveRewind(third, "ArrowLeft"), "ArrowLeft");
  expect(rewindView(back).selectedTarget?.turnId).toBe("u2");
});

it("兄弟列首项再向上返回主路径分岔前一个可见项", () => {
  const fork = moveRewind(createRewindState(entries, "a2"), "ArrowUp");
  const sibling = moveRewind(fork, "ArrowRight");
  const previous = moveRewind(sibling, "ArrowUp");
  expect(previous.variantIndex).toBe(0);
  expect(rewindView(previous).selectedTarget?.turnId).toBe("a1");
});

it("筛选只匹配主路径，取上方最后命中且零匹配禁止确认", () => {
  const fork = moveRewind(createRewindState(entries, "a2"), "ArrowUp");
  const filtered = openRewindFilter(moveRewind(fork, "ArrowRight"));
  expect(filtered.variantIndex).toBe(0);
  const match = filterRewind(filtered, "第一轮");
  expect(rewindView(match).selectedTarget?.turnId).toBe("a1");
  expect(
    rewindView(match).matchingTargets.map((target) => target.turnId),
  ).toEqual(["u1", "a1"]);
  expect(
    rewindView(moveRewind(match, "ArrowLeft")).selectedTarget?.turnId,
  ).toBe("u1");
  expect(rewindView(filterRewind(match, "不存在")).canConfirm).toBe(false);
});

it("筛选英文使用词边界、中文使用子串、多词必须全部匹配", () => {
  const targets = rewindTargets(entries.slice(0, 4));
  expect(matchesRewindFilter(targets[2], "ls 第二")).toBe(true);
  expect(matchesRewindFilter(targets[3], "ls")).toBe(false);
  expect(matchesRewindFilter(targets[2], "ls 回复")).toBe(false);
});

it("隐藏项不可框选，工具结果归并到调用并提交最后结果节点", () => {
  const path = [
    entry("u", null, { role: "user", content: "读取文件" }),
    entry("a", "u", {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call",
          name: "read",
          arguments: { path: "file.txt" },
        },
      ],
    }),
    entry("r", "a", {
      role: "toolResult",
      toolCallId: "call",
      toolName: "read",
      content: "文件正文",
    }),
    entry("hidden", "r", {
      role: "custom",
      display: false,
      content: "内部消息",
    }),
    entry("empty", "hidden", { role: "assistant", content: " " }),
    entry("file", "empty", {
      role: "fileMention",
      files: [
        { path: "hidden.txt", content: "不可见", lineCount: 1, byteSize: 1 },
      ],
    }),
  ];
  const targets = rewindTargets(path);
  expect(targets.map((target) => target.turnId)).toEqual(["u", "a"]);
  expect(targets[1].entryId).toBe("r");
  expect(targets[1].entryIds).toEqual(["a", "r"]);
  expect(targets[1].text).toContain("文件正文");
});

it("只把有文字的用户消息与用户发起的原生自定义消息作为用户轮", () => {
  const path = [
    entry("image", null, {
      role: "user",
      content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
    }),
    entry("exec", "image", {
      role: "bashExecution",
      command: "pwd",
      output: "/work",
    }),
    entry("skill", "exec", {
      role: "custom",
      customType: "skill-prompt",
      attribution: "user",
      content: "技能任务",
    }),
    entry("collab", "skill", {
      role: "custom",
      customType: "collab-prompt",
      attribution: "user",
      content: "协作任务",
    }),
  ];
  expect(rewindTargets(path).map((target) => target.userTurn)).toEqual([
    false,
    false,
    true,
    true,
  ]);
});
