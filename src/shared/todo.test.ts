// @vitest-environment node
import { expect, it } from "vitest";
import { parseTodoPhases, todoResultPhases, type TodoPhase } from "./todo";
import {
  sessionHistoryTodos,
  type SessionHistorySnapshot,
} from "./session-history";

const phases: TodoPhase[] = [
  { name: "实现", tasks: [{ content: "显示计划", status: "in_progress" }] },
];

it("完整原生快照保留五种状态，空计划与畸形数据明确区分", () => {
  expect(parseTodoPhases(phases)).toEqual(phases);
  expect(parseTodoPhases([])).toEqual([]);
  for (const value of [
    undefined,
    {},
    [{ name: "阶段", tasks: [{}] }],
    [{ name: "阶段", tasks: [{ content: "任务", status: "unknown" }] }],
  ]) {
    expect(parseTodoPhases(value)).toBeUndefined();
  }
  expect(
    parseTodoPhases([
      {
        name: "阶段",
        tasks: [
          "pending",
          "in_progress",
          "completed",
          "blocked",
          "abandoned",
        ].map((status) => ({ content: status, status, blocker: "等待" })),
      },
    ])?.[0].tasks,
  ).toHaveLength(5);
});

it("失败、纯查看及其他工具不能改变计划，旧格式无 op 仍可恢复", () => {
  expect(todoResultPhases("todo", { details: { phases } })).toEqual(phases);
  expect(
    todoResultPhases("todo", { details: { phases }, isError: true }),
  ).toBeUndefined();
  expect(
    todoResultPhases("todo", { details: { phases, op: "view" } }),
  ).toBeUndefined();
  expect(todoResultPhases("task", { details: { phases } })).toBeUndefined();
});

it("仅恢复所选分支，跨压缩保留计划，手动清空不会被旧查询复活", () => {
  const snapshot: SessionHistorySnapshot = {
    leafId: "compact",
    entries: [
      {
        type: "message",
        id: "plan",
        parentId: null,
        timestamp: "",
        message: { role: "toolResult", toolName: "todo", details: { phases } },
      },
      {
        type: "custom",
        id: "clear",
        parentId: "plan",
        timestamp: "",
        customType: "user_todo_edit",
        data: { phases: [] },
      },
      {
        type: "message",
        id: "view",
        parentId: "clear",
        timestamp: "",
        message: {
          role: "toolResult",
          toolName: "todo",
          details: { op: "view", phases },
        },
      },
      {
        type: "compaction",
        id: "compact",
        parentId: "plan",
        timestamp: "",
        summary: "摘要",
      },
    ],
  };
  expect(sessionHistoryTodos(snapshot)).toEqual(phases);
  expect(sessionHistoryTodos({ ...snapshot, leafId: "view" })).toEqual([]);
  expect(sessionHistoryTodos({ ...snapshot, leafId: null })).toEqual([]);
});
