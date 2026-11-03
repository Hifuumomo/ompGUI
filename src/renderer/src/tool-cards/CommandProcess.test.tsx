// @vitest-environment jsdom
import { act, useState } from "react";
import { expect, it, vi } from "vitest";
import { container, click, render } from "../transcript-test-harness";
import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { outputTail } from "../tool-card-model";
import { BashCard, CommandOutput } from "./BashCard";
import { ProcessCard } from "./ProcessCard";
import {
  tool,
  bashOk,
  bashFailed,
  bashBackground,
  bashServiceTimeout,
  hubStart,
  hubStop,
  procKill,
  hubCancel,
  hubLogs,
  hubList,
  hubWait,
} from "./fixtures";

const context: ProcessContext = {
  sessionId: "commands",
  expanded: {},
  toggle: vi.fn(),
  panelId: (id) => id,
};

/** 输出边界排除末尾换行，同时保留真正的空白行。 */
it("handles output tail bounds without inventing empty lines", () => {
  expect(outputTail("", 5)).toEqual({ lines: [], total: 0 });
  expect(outputTail("one\n", 5)).toEqual({ lines: ["one"], total: 1 });
  expect(outputTail("one\ntwo", 2)).toEqual({
    lines: ["one", "two"],
    total: 2,
  });
  expect(outputTail("one\n\ntwo\n", 2)).toEqual({
    lines: ["", "two"],
    total: 3,
  });
  expect(outputTail("one\ntwo", 0)).toEqual({ lines: [], total: 2 });
});

/** 完成及错误命令保留真实退出码，后台回执展示真实任务标识和超时。 */
it("renders completed failed and background commands", async () => {
  await render(<BashCard tool={bashOk} context={context} />);
  expect(container.textContent).toContain("✓ exit 0");
  await render(<BashCard tool={bashFailed} context={context} />);
  expect(container.textContent).toContain("✗ exit 2");
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-status"),
  ).toBe("error");
  await render(<BashCard tool={bashBackground} context={context} />);
  expect(container.textContent).toContain("⇢ 后台 bg_1");
  expect(container.textContent).toContain("已转入后台运行。");
  expect(container.textContent).toContain("超过 300 秒将被终止");
  await render(
    <BashCard
      tool={tool("bash", { command: "work" }, { details: { async: true } })}
      context={context}
    />,
  );
  expect(container.textContent).toContain("⇢ 后台");
  expect(container.textContent).not.toContain("exit 0");
});

/** 取消是终态，不能被退出码或遗留后台回执标为成功。 */
it.each([0, 130])(
  "keeps cancellation ahead of exit %s and background receipts",
  async (exitCode) => {
    const evidence = tool(
      "bash",
      { command: "work" },
      {
        text: "Command cancelled",
        details: {
          exitCode,
          async: { state: "running", jobId: "bg_cancelled" },
        },
      },
    );
    evidence.resultMessage!.stopReason = "aborted";
    await render(<BashCard tool={evidence} context={context} />);
    expect(
      container.querySelector(".tool-card")?.getAttribute("data-status"),
    ).toBe("cancelled");
    expect(container.querySelector(".tool-card-status")?.textContent).toBe(
      "已取消",
    );
    expect(container.textContent).toContain("Command cancelled");
    expect(container.textContent).not.toContain("✓ exit");
  },
);

/** 多行命令只显示首行，展开后使用同一份去色输出。 */
it("bounds successful output and expands all with full command title", async () => {
  const evidence = tool(
    "bash",
    { command: "first\nsecond\nthird" },
    {
      text: "\u001b[31m0\n1\n2\n3\n4\n5\n6\u001b[0m\n",
      details: { truncated: true, prunedAt: 10 },
    },
  );
  /** 提供真实受控展开，避免测试伪造卡片内部状态。返回值：命令框。 */
  function Example() {
    const [expanded, setExpanded] = useState(false);
    return (
      <BashCard
        tool={evidence}
        context={{
          ...context,
          expanded: expanded ? { [evidence.id]: 0 } : {},
          toggle: () => setExpanded(!expanded),
        }}
      />
    );
  }
  await render(<Example />);
  expect(
    container.querySelector(".tool-card-command-title")?.getAttribute("title"),
  ).toBe("first\nsecond\nthird");
  expect(container.textContent).toContain("+2 行");
  expect(container.textContent).not.toContain("exit 0");
  expect(container.querySelector(".tool-card-output")?.textContent).toBe(
    "2\n3\n4\n5\n6",
  );
  expect(container.textContent).toContain("共 7 行");
  expect(container.textContent).toContain("输出已截断");
  expect(container.textContent).toContain("输出已裁剪");
  await click(
    container.querySelector<HTMLButtonElement>(".tool-card-footer button")!,
  );
  expect(container.querySelector(".tool-card-output")?.textContent).toBe(
    "0\n1\n2\n3\n4\n5\n6\n",
  );
});

/** 累计快照替换输出，运行、成功和失败各使用约定末尾行数。 */
it("updates cumulative output with running ten success five error fifteen", async () => {
  const text = Array.from({ length: 20 }, (_, index) => `line-${index}`).join(
    "\n",
  );
  const completed = tool("bash", { command: "watch" }, { text });
  const live: ToolEvidence = {
    id: completed.id,
    name: "bash",
    args: { command: "watch" },
    live: {
      id: completed.id,
      name: "bash",
      args: {},
      running: true,
      result: text,
    },
  };
  await render(<BashCard tool={live} context={context} />);
  expect(
    container.querySelector(".tool-card-output")?.textContent?.split("\n"),
  ).toHaveLength(10);
  expect(container.querySelector(".tool-card-output")?.textContent).toBe(
    Array.from({ length: 10 }, (_, index) => `line-${index + 10}`).join("\n"),
  );
  expect(container.textContent).toContain("末尾 10 行 · 共 20 行");
  for (const next of ["0\n", "0\n1\n", "0\n1\n2\n"]) {
    await render(
      <BashCard
        tool={{ ...live, live: { ...live.live!, result: next } }}
        context={context}
      />,
    );
    expect(container.querySelector(".tool-card-output")?.textContent).toBe(
      next.trimEnd(),
    );
    expect(container.textContent).toContain(
      `末尾 ${next.trimEnd().split("\n").length} 行 · 共 ${next.trimEnd().split("\n").length} 行`,
    );
  }
  await render(<BashCard tool={completed} context={context} />);
  expect(
    container.querySelector(".tool-card-output")?.textContent?.split("\n"),
  ).toHaveLength(5);
  expect(container.querySelector(".tool-card-output")?.textContent).toBe(
    "line-15\nline-16\nline-17\nline-18\nline-19",
  );
  expect(container.textContent).toContain("末尾 5 行 · 共 20 行");
  const failedLines = Array.from(
    { length: 24 },
    (_, index) => `failed-line-${index}`,
  );
  const failed: ToolEvidence = {
    ...completed,
    resultMessage: {
      ...completed.resultMessage!,
      isError: true,
      content: [
        {
          type: "text",
          text: `\u001b[31m${failedLines.join("\n")}\u001b[0m\n`,
        },
      ],
    },
  };
  await render(<BashCard tool={failed} context={context} />);
  expect(
    container.querySelector(".tool-card-output")?.textContent?.split("\n"),
  ).toHaveLength(15);
  expect(container.querySelector(".tool-card-output")?.textContent).toBe(
    failedLines.slice(-15).join("\n"),
  );
  expect(container.textContent).toContain("failed-line-14");
  expect(container.textContent).toContain("末尾 15 行 · 共 24 行");
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-status"),
  ).toBe("error");
  expect(container.querySelector(".inline-output-omitted")).toBeNull();
  expect(container.textContent).not.toContain("\u001b");
  await render(
    <BashCard
      tool={failed}
      context={{ ...context, expanded: { [failed.id]: 0 } }}
    />,
  );
  expect(container.querySelector(".tool-card-output")?.textContent).toBe(
    `${failedLines.join("\n")}\n`,
  );
  expect(container.querySelector(".inline-output-omitted")).toBeNull();
});

/** 未完成参数只能用于命令文字，不伪造退出状态。 */
it("shows streaming command previews", async () => {
  await render(
    <BashCard
      tool={{
        id: "stream",
        name: "bash",
        args: undefined,
        streamingArgs: { command: "npm run" },
      }}
      context={context}
    />,
  );
  expect(container.textContent).toContain("$ npm run");
  expect(container.textContent).toContain("生成中");
  expect(container.textContent).not.toContain("exit");
});

/** 用户向上滚动停止跟随，回到底部后重新跟随输出。 */
it("respects scrollback and resumes following at bottom", async () => {
  await render(<CommandOutput text="one" running />);
  const output = container.querySelector<HTMLDivElement>(".tool-card-output")!;
  Object.defineProperties(output, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 100 },
  });
  output.scrollTop = 100;
  await act(() => output.dispatchEvent(new Event("scroll", { bubbles: true })));
  await render(<CommandOutput text="two" running />);
  expect(output.scrollTop).toBe(100);
  output.scrollTop = 900;
  await act(() => output.dispatchEvent(new Event("scroll", { bubbles: true })));
  await render(<CommandOutput text="three" running />);
  expect(output.scrollTop).toBe(1000);
});

/** 所有真实进程样本映射到对应标题和证据行。 */
it("renders process variants including nonzero stop and readiness timeout", async () => {
  const cases: [ToolEvidence, string, string][] = [
    [hubStart, "启动服务", "就绪匹配：preparing"],
    [bashServiceTimeout, "启动服务", "15 秒内未匹配就绪日志"],
    [hubStop, "终止", "exit 1"],
    [procKill, "终止", "proc://parity-ui-data/kill"],
    [hubCancel, "取消后台任务", "已取消"],
    [hubLogs, "进程日志", "preparing"],
    [hubList, "进程列表", "timer"],
    [hubWait, "等待", "✓ 已匹配"],
  ];
  for (const [evidence, title, content] of cases) {
    await render(<ProcessCard tool={evidence} context={context} />);
    expect(container.textContent).toContain(title);
    expect(container.textContent).toContain(content);
    expect(container.textContent).not.toContain("\u001b");
    if (evidence === hubStop || evidence === procKill)
      expect(
        container.querySelector(".tool-card")?.getAttribute("data-status"),
      ).toBe("error");
  }
});

/** 不同版本的 daemon 容器及空字段不应抛错或伪造状态。 */
it("handles service nested daemon list jobs logs timeout send and missing fields", async () => {
  const cases: [ToolEvidence, string][] = [
    [
      tool(
        "hub",
        { op: "start" },
        {
          details: {
            daemons: [{ name: "nested", state: "starting", pid: 12 }],
          },
        },
      ),
      "nested",
    ],
    [
      tool(
        "read",
        { path: "proc://nested" },
        { details: { proc: { daemon: { name: "nested" } } }, text: "tail" },
      ),
      "进程日志",
    ],
    [
      tool(
        "hub",
        { op: "jobs" },
        {
          details: {
            jobs: [
              {
                id: "bg_2",
                status: "completed",
                durationMs: 1000,
                label: "build",
              },
            ],
          },
        },
      ),
      "后台任务 · 1 个",
    ],
    [
      tool(
        "hub",
        { op: "wait", name: "slow", pattern: "ready" },
        { details: { timedOut: true } },
      ),
      "超时",
    ],
    [
      tool(
        "hub",
        { op: "send", name: "input", text: "hello\n" },
        { details: { daemon: { name: "input" } } },
      ),
      "hello",
    ],
  ];
  for (const [evidence, expected] of cases) {
    await render(<ProcessCard tool={evidence} context={context} />);
    expect(container.textContent).toContain(expected);
  }
  await render(
    <ProcessCard
      tool={tool(
        "hub",
        { op: "start" },
        { details: { daemon: "bad", proc: [], service: false } },
      )}
      context={context}
    />,
  );
  expect(container.textContent).not.toContain("启动服务");
  expect(container.textContent).not.toContain("pid undefined");
});

/** 原生 bashExecution 和实时终态都保留输出，终态计时不继续推进。 */
it("uses bashExecution output and stops the completed live timer", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(10_000);
    const evidence: ToolEvidence = {
      id: "timer",
      name: "bash",
      args: { command: "work" },
      live: {
        id: "timer",
        name: "bash",
        args: {},
        running: true,
        startedAt: 9000,
        result: "working",
      },
    };
    await render(<BashCard tool={evidence} context={context} />);
    expect(container.querySelector(".tool-card-duration")?.textContent).toBe(
      "1秒",
    );
    await act(() => vi.advanceTimersByTime(2000));
    expect(container.querySelector(".tool-card-duration")?.textContent).toBe(
      "3秒",
    );
    const finished = {
      ...evidence,
      live: { ...evidence.live!, running: false, endedAt: 12000 },
    };
    await render(<BashCard tool={finished} context={context} />);
    await act(() => vi.advanceTimersByTime(4000));
    expect(container.querySelector(".tool-card-duration")?.textContent).toBe(
      "3秒",
    );
    await render(
      <BashCard
        tool={{
          id: "execution",
          name: "bash",
          args: { command: "native" },
          resultMessage: {
            role: "bashExecution",
            command: "native",
            output: "native output",
            exitCode: 7,
          },
        }}
        context={context}
      />,
    );
    expect(container.textContent).toContain("native output");
    expect(container.textContent).toContain("✗ exit 7");
  } finally {
    vi.useRealTimers();
  }
});
