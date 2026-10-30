import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { formatDuration } from "./ProcessSummary";
import { Transcript } from "./Transcript";
import {
  setup,
  cleanup,
  render,
  container,
  timeline,
} from "./transcript-test-harness";

afterEach(() => vi.useRealTimers());

it.each([
  [0, "运行了 0秒"],
  [59000, "运行了 59秒"],
  [60000, "运行了 1分0秒"],
  [3600000, "运行了 1小时0分0秒"],
  [90061000, "运行了 1天1小时1分1秒"],
])("格式化 %i 毫秒", (duration, expected) => {
  expect(formatDuration(duration)).toBe(expected);
});

it("发送后立即计时，输出到达继续计时，结束及历史刷新后固定用时", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  setup();
  try {
    const runStart = { time: 100000, messageCount: 0 };
    await render(
      <Transcript
        messages={[]}
        tools={[]}
        sessionId="a"
        busy
        runStart={runStart}
      />,
    );
    expect(container.textContent).toContain("运行了 0秒");
    await act(() => vi.advanceTimersByTime(2000));
    expect(container.textContent).toContain("运行了 2秒");
    const messages = timeline([
      { role: "user", content: "执行", timestamp: 100100 },
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "处理中" }],
        timestamp: 101000,
      },
    ]);
    await render(
      <Transcript
        messages={messages}
        tools={[]}
        sessionId="a"
        busy
        runStart={runStart}
      />,
    );
    await act(() => vi.advanceTimersByTime(3000));
    expect(container.textContent).toContain("运行了 5秒");
    await render(
      <Transcript
        messages={messages}
        tools={[]}
        sessionId="a"
        busy={false}
        runStart={runStart}
      />,
    );
    await act(() => vi.advanceTimersByTime(10000));
    await render(
      <Transcript
        messages={messages.map((item) => ({
          ...item,
          key: `history:${item.key}`,
        }))}
        tools={[]}
        sessionId="a"
        busy={false}
        runStart={runStart}
      />,
    );
    expect(container.textContent).toContain("运行了 5秒");
    expect(
      container.querySelector<HTMLDetailsElement>(".process-group")?.open,
    ).toBe(false);
  } finally {
    await cleanup();
  }
});
