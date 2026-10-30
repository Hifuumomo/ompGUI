import { act } from "react";
import { expect, it, vi } from "vitest";
import type { TodoPhase } from "../../shared/todo";
import type { SessionState } from "../../shared/protocol";
import { createAppFixture } from "./inline-app-test-fixture";

const phases: TodoPhase[] = [
  {
    name: "实现",
    tasks: [
      { content: "接入实时 TODO", status: "in_progress" },
      { content: "验证", status: "pending" },
    ],
  },
];

it("真实 App 在输入框上方实时显示计划，折叠仍更新进度，清空后隐藏", async () => {
  const app = await createAppFixture([]);
  const panel = () =>
    app.container.querySelector<HTMLElement>(".todo-panel");
  expect(panel()).toBeNull();
  await app.emit({ type: "agent_start" });
  await app.emit({
    type: "tool_execution_end",
    toolName: "todo",
    toolCallId: "init",
    result: { details: { phases } },
  });
  expect(
    panel()?.compareDocumentPosition(
      app.container.querySelector(".composer-box")!,
    )! & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(panel()?.textContent).toContain("0/2 已完成");
  await app.click(panel()!.querySelector("button")!);
  expect(panel()?.querySelector<HTMLElement>(".todo-list")?.hidden).toBe(true);
  const done = [
    {
      ...phases[0],
      tasks: phases[0].tasks.map((task) => ({ ...task, status: "completed" })),
    },
  ];
  await app.emit({
    type: "tool_execution_end",
    toolName: "todo",
    toolCallId: "done",
    result: { details: { phases: done } },
  });
  expect(panel()?.textContent).toContain("2/2 已完成");
  expect(panel()?.querySelector("progress")?.value).toBe(2);
  await app.emit({ type: "todo_auto_clear" });
  expect(panel()).toBeNull();
});

it("读取历史中手动编辑的计划并显示受阻原因和放弃状态", async () => {
  const app = await createAppFixture([], {
    leafId: "edit",
    entries: [
      {
        type: "custom",
        id: "edit",
        parentId: null,
        timestamp: "",
        customType: "user_todo_edit",
        data: {
          phases: [
            {
              name: "交付",
              tasks: [
                { content: "发布", status: "blocked", blocker: "等待审核" },
                { content: "旧方案", status: "abandoned" },
              ],
            },
          ],
        },
      },
    ],
  });
  const panel = app.container.querySelector(".todo-panel")!;
  expect(panel.textContent).toContain("受阻原因：等待审核");
  expect(panel.textContent).toContain("1/2 已结束 · 1 项已放弃");
  expect(panel.querySelector(".todo-list")?.getAttribute("tabindex")).toBe("0");
});

it("刷新中的旧 get_state 响应不能覆盖刚收到的实时 TODO", async () => {
  const app = await createAppFixture([]);
  const original = window.desktop.request;
  let resolveState!: (state: SessionState) => void;
  const request = vi.spyOn(window.desktop, "request");
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveState = resolve as typeof resolveState;
      }),
  );
  await app.emit({ type: "session_info_update" });
  await app.emit({
    type: "tool_execution_start",
    toolName: "todo",
    toolCallId: "todo",
  });
  await app.emit({
    type: "tool_execution_end",
    toolCallId: "todo",
    result: { details: { phases } },
  });
  const liveState = {
    sessionId: "inline-app",
    isStreaming: true,
    isCompacting: false,
    isSettled: false,
    messageCount: 0,
    queuedMessageCount: 0,
    todoPhases: phases,
  };
  request.mockImplementation((command) =>
    command.type === "get_state"
      ? (Promise.resolve(liveState) as ReturnType<typeof original>)
      : original(command),
  );
  await act(async () => resolveState({ ...liveState, todoPhases: [] }));
  expect(
    app.container.querySelector(".todo-panel")?.textContent,
  ).toContain("接入实时 TODO");
  request.mockRestore();
});
