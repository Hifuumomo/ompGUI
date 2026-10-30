// @vitest-environment node
import { expect, it } from "vitest";
import { initialSession, sessionReducer, type SessionView } from "./session";
import type { RpcFrame, SessionState } from "../../shared/protocol";
import type { TodoPhase } from "../../shared/todo";

const phases: TodoPhase[] = [
  { name: "开发", tasks: [{ content: "功能", status: "in_progress" }] },
];
const state: SessionState = {
  sessionId: "one",
  isStreaming: false,
  isCompacting: false,
  messageCount: 0,
  queuedMessageCount: 0,
};
function frame(view: SessionView, event: RpcFrame) {
  return sessionReducer(view, { type: "frame", frame: event });
}

it("工具返回立即更新进度，不等待 agent_end；失败、增量及查看不覆盖", () => {
  let view = frame(initialSession, { type: "agent_start" });
  view = frame(view, {
    type: "tool_execution_start",
    toolName: "todo",
    toolCallId: "t1",
  });
  view = frame(view, {
    type: "tool_execution_end",
    toolCallId: "t1",
    result: { details: { phases } },
  });
  expect(view.todoPhases).toEqual(phases);
  expect(view.busy).toBe(true);
  for (const event of [
    {
      type: "tool_execution_update",
      partialResult: { details: { phases: [] } },
    },
    {
      type: "tool_execution_end",
      isError: true,
      result: { details: { phases: [] } },
    },
    {
      type: "tool_execution_end",
      result: { isError: true, details: { phases: [] } },
    },
    {
      type: "tool_execution_end",
      result: { details: { op: "view", phases: [] } },
    },
    { type: "tool_execution_end", result: { details: { phases: [{}] } } },
  ]) {
    view = frame(view, { ...event, toolName: "todo", toolCallId: "t2" });
    expect(view.todoPhases).toEqual(phases);
  }
  view = frame(view, {
    type: "message_end",
    message: {
      role: "toolResult",
      toolName: "todo",
      details: {
        phases: [
          { name: "开发", tasks: [{ content: "功能", status: "completed" }] },
        ],
      },
    },
  });
  expect(view.todoPhases[0].tasks[0].status).toBe("completed");
});

it("提醒保留完整计划，自动清空立即生效，重置及会话切换隔离状态", () => {
  const view = { ...initialSession, state, todoPhases: phases };
  expect(frame(view, { type: "todo_reminder", todos: [] }).todoPhases).toEqual(
    phases,
  );
  expect(frame(view, { type: "todo_auto_clear" }).todoPhases).toEqual([]);
  expect(sessionReducer(view, { type: "reset" }).todoPhases).toEqual([]);
  expect(
    sessionReducer(view, {
      type: "state",
      state: { ...state, sessionId: "two" },
    }).todoPhases,
  ).toEqual([]);
  expect(sessionReducer(view, { type: "state", state }).todoPhases).toEqual(
    phases,
  );
});

it("原生状态快照优先于历史；显式空快照不能回退到旧工具结果", () => {
  const messages = [
    { role: "toolResult", toolName: "todo", details: { phases } },
  ];
  const view = sessionReducer(initialSession, {
    type: "history",
    state,
    messages,
  });
  expect(view.todoPhases).toEqual(phases);
  expect(
    sessionReducer(view, {
      type: "history",
      state: { ...state, todoPhases: [] },
      messages,
      todoPhases: phases,
    }).todoPhases,
  ).toEqual([]);
  expect(
    sessionReducer(view, {
      type: "readonly",
      snapshot: {
        summary: {
          id: "two",
          path: "two.jsonl",
          cwd: "D:/",
          title: "",
          timestamp: "",
          modified: 0,
        },
        messages,
        todoPhases: [],
      },
    }).todoPhases,
  ).toEqual([]);
});
