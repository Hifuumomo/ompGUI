// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { ProcessContext } from "../TranscriptToolRow";
import { container, click, render } from "../transcript-test-harness";
import { TranscriptActions } from "./actions";
import { taskProgress, waitJobs, tool } from "./fixtures";
import { TaskCard } from "./TaskCard";
import { WaitCard } from "./WaitCard";

const context: ProcessContext = {
  sessionId: "job-cards",
  expanded: {},
  toggle: vi.fn(),
  panelId: (id) => `panel-${id}`,
};

it("wait 真实样本完整展示每项 id、标签、状态与现有时长格式", async () => {
  await render(<WaitCard tool={waitJobs} context={context} />);
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-tool-id"),
  ).toBe(waitJobs.id);
  expect(container.textContent).toContain("等待后台任务");
  expect(container.textContent).toContain("2 个");
  expect(container.querySelectorAll(".tool-card-row")).toHaveLength(2);
  expect(container.textContent).toContain("bg_3");
  expect(container.textContent).toContain("python archive.py");
  expect(container.textContent).toContain("已完成 · 5分10秒");
  expect(container.textContent).toContain("npm run build");
  expect(container.textContent).toContain("已完成 · 1分2秒");
  expect(
    container.querySelectorAll('.tool-card-job-status[data-status="ok"]'),
  ).toHaveLength(2);
});

it("wait 显示中断底栏及所有任务状态，不以子任务决定工具状态", async () => {
  const evidence = tool(
    "wait",
    {},
    {
      details: {
        __interrupted: true,
        jobs: [
          { id: "bg_1", status: "running", durationMs: 0 },
          { id: "bg_2", status: "failed", durationMs: 12400 },
          { id: "bg_3", status: "cancelled" },
          { id: "bg_4", status: "pending" },
        ],
      },
    },
  );
  await render(<WaitCard tool={evidence} context={context} />);
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-status"),
  ).toBe("ok");
  expect(container.querySelectorAll(".tool-card-row")).toHaveLength(4);
  expect(container.textContent).toContain("运行中 · 0秒");
  expect(container.textContent).toContain("失败 · 12秒");
  expect(container.textContent).toContain("已取消");
  expect(container.textContent).toContain("等待中");
  expect(container.querySelector(".tool-card-footer")?.textContent).toBe(
    "等待被中断",
  );
  expect(
    container.querySelector('.tool-card-job-status[data-status="error"]'),
  ).not.toBeNull();
});

it("wait 缺失或错误结构回退通用展开，不静默丢掉坏行", async () => {
  for (const details of [
    {},
    { jobs: "wrong" },
    { jobs: [{ id: "bg_1", status: "completed", durationMs: "1" }] },
    { jobs: [null] },
  ]) {
    await render(
      <WaitCard
        tool={tool("wait", {}, { details, text: "原始等待结果" })}
        context={context}
      />,
    );
    expect(
      container.querySelector(
        '.tool-card-header[role="button"][aria-expanded="false"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector(".tool-card-list")).toBeNull();
  }
});

it("task 真实样本展示代理与三种状态，汇总总耗时", async () => {
  await render(<TaskCard tool={taskProgress} context={context} />);
  expect(container.textContent).toContain("子代理");
  expect(container.textContent).toContain("3 个");
  expect(container.querySelector(".tool-card-duration")?.textContent).toBe(
    "(4分12秒)",
  );
  expect(container.querySelectorAll(".tool-card-row")).toHaveLength(3);
  expect(container.textContent).toContain("PerfCore");
  expect(container.textContent).toContain("task · 已完成");
  expect(container.textContent).toContain("LiveData");
  expect(container.textContent).toContain("task · 运行中");
  expect(container.textContent).toContain("ReleaseDocs");
  expect(container.textContent).toContain("task · 等待中");
  expect(
    [...container.querySelectorAll(".tool-card-job-dot")].map((dot) =>
      dot.getAttribute("data-status"),
    ),
  ).toEqual(["ok", "running", "pending"]);
});

it("task 只有既有操作存在时每行可点击并显示打开提示", async () => {
  const onOpenSubagent = vi.fn();
  await render(
    <TranscriptActions.Provider value={{ onOpenSubagent }}>
      <TaskCard tool={taskProgress} context={context} />
    </TranscriptActions.Provider>,
  );
  const buttons = container.querySelectorAll<HTMLButtonElement>(
    "button.tool-card-row",
  );
  expect(buttons).toHaveLength(3);
  for (const button of buttons) await click(button);
  expect(onOpenSubagent).toHaveBeenCalledTimes(3);
  expect(container.textContent).toContain("点击打开子代理面板");
  await render(<TaskCard tool={taskProgress} context={context} />);
  expect(container.querySelector("button.tool-card-row")).toBeNull();
  expect(container.querySelectorAll("div.tool-card-row")).toHaveLength(3);
  expect(container.textContent).not.toContain("点击打开子代理面板");
});

it("task 历史结果优先于过时的实时 running 与详情", async () => {
  const evidence = {
    ...taskProgress,
    live: {
      id: taskProgress.id,
      name: "task",
      args: {},
      running: true,
      startedAt: 1,
      result: {
        details: {
          progress: [{ id: "Stale", agent: "task", status: "running" }],
        },
      },
    },
  };
  await render(<TaskCard tool={evidence} context={context} />);
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-status"),
  ).toBe("ok");
  expect(container.textContent).toContain("PerfCore");
  expect(container.textContent).not.toContain("Stale");
});

it("task 无 progress 时仅接受带身份代理状态的 results，未知状态原样保留", async () => {
  const evidence = tool(
    "task",
    {},
    {
      details: {
        results: [
          {
            id: "Review",
            agent: "reviewer",
            status: "failed",
            task: "Review changes",
          },
          { id: "Cancelled", agent: "task", status: "cancelled" },
          { id: "Native", agent: "task", status: "native-state" },
        ],
        totalDurationMs: 0,
      },
    },
  );
  await render(<TaskCard tool={evidence} context={context} />);
  expect(container.querySelector(".tool-card-duration")?.textContent).toBe(
    "(0秒)",
  );
  expect(container.textContent).toContain("reviewer · 失败");
  expect(container.textContent).toContain("已取消");
  expect(container.textContent).toContain("native-state");
  expect(
    container.querySelector('.tool-card-job-dot[data-status="error"]'),
  ).not.toBeNull();
});

it("task 缺失、空白、坏进度或不明终态结果回退可展开原始结果", async () => {
  for (const details of [
    {},
    { progress: [] },
    { progress: [{ id: "Bad", status: "running" }] },
    { results: [{ output: "raw result" }] },
    { progress: "wrong" },
    { progress: [null] },
    {
      progress: [{ id: "Bad", agent: "task", status: "running" }],
      totalDurationMs: -1,
    },
  ]) {
    await render(
      <TaskCard
        tool={tool("task", {}, { details, text: "原始子任务结果" })}
        context={context}
      />,
    );
    expect(
      container.querySelector(
        '.tool-card-header[role="button"][aria-expanded="false"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector(".tool-card-list")).toBeNull();
  }
});

it("任务框在原生进行中与失败结果之间更新工具状态", async () => {
  const details = {
    progress: [
      { id: "Worker", agent: "task", status: "running", task: "Live work" },
    ],
  };
  const running = {
    id: "live-task",
    name: "task",
    args: {},
    live: {
      id: "live-task",
      name: "task",
      args: {},
      running: true,
      result: { details },
    },
  };
  await render(<TaskCard tool={running} context={context} />);
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-status"),
  ).toBe("running");
  expect(
    container.querySelector('.tool-card-job-dot[data-status="running"]'),
  ).not.toBeNull();
  await render(
    <TaskCard
      tool={tool(
        "task",
        {},
        {
          details: {
            progress: [{ id: "Worker", agent: "task", status: "error" }],
          },
          isError: true,
        },
      )}
      context={context}
    />,
  );
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-status"),
  ).toBe("error");
  expect(
    container.querySelector('.tool-card-job-dot[data-status="error"]'),
  ).not.toBeNull();
});

it("等待框采用实时结构化任务，但历史失败结果覆盖过时 running", async () => {
  const live = {
    id: "wait-live",
    name: "wait",
    args: {},
    running: true,
    result: {
      details: {
        jobs: [{ id: "bg_live", status: "running", durationMs: 300 }],
      },
    },
  };
  await render(
    <WaitCard
      tool={{ id: live.id, name: live.name, args: {}, live }}
      context={context}
    />,
  );
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-status"),
  ).toBe("running");
  expect(container.textContent).toContain("bg_live");
  const historical = tool(
    "wait",
    {},
    {
      details: {
        jobs: [{ id: "bg_done", status: "failed", durationMs: 92000 }],
      },
      isError: true,
    },
  );
  await render(<WaitCard tool={{ ...historical, live }} context={context} />);
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-status"),
  ).toBe("error");
  expect(container.textContent).toContain("bg_done");
  expect(container.textContent).toContain("失败 · 1分32秒");
  expect(container.textContent).not.toContain("bg_live");
});
