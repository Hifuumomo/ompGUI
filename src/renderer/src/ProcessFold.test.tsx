// @vitest-environment jsdom
import { act, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  container,
  click,
  render,
  timeline,
  call,
} from "./transcript-test-harness";
import { Transcript } from "./Transcript";
import { ProcessFold } from "./ProcessFold";

afterEach(() => vi.useRealTimers());

/** 真实主会话折叠保留外部回复和各工具的展开状态。 */
it("full 过程默认展开，折叠卸载正文并保留工具展开状态", async () => {
  await render(
    <Transcript
      mode="full"
      sessionId="full"
      tools={[]}
      messages={timeline([
        { role: "user", content: "开始" },
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "完整思考" }],
        },
        call("one", "unknown"),
        call("two", "unknown"),
        call("todo", "todo"),
        { role: "assistant", content: "最终回复" },
      ])}
    />,
  );
  expect(container.querySelector(".process-group")).toBeNull();
  expect(container.querySelectorAll(".tool-card")).toHaveLength(2);
  const card = container.querySelector<HTMLElement>(".tool-card-header")!;
  await click(card);
  expect(card.getAttribute("aria-expanded")).toBe("true");
  await click(container.querySelector<HTMLElement>(".process-fold-header")!);
  expect(container.querySelector(".tool-card")).toBeNull();
  expect(container.querySelector(".thinking-block")).toBeNull();
  expect(container.textContent).toContain("最终回复");
  expect(container.querySelector(".process-fold-chevron")?.textContent).toBe(
    "›",
  );
  await click(container.querySelector<HTMLElement>(".process-fold-header")!);
  expect(
    container.querySelector(".tool-card-header")?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(container.querySelector(".process-fold-chevron")?.textContent).toBe(
    "⌄",
  );
});

/** 原生命令失败计入折叠标题，取消终态不误报失败。 */
it("full 失败徽标与命令卡片一致，折叠后仍显示", async () => {
  await render(
    <Transcript
      mode="full"
      sessionId="native-errors"
      tools={[]}
      messages={timeline([
        { role: "user", content: "运行命令" },
        {
          role: "bashExecution",
          command: "fail",
          output: "failed",
          exitCode: 2,
        },
        {
          role: "bashExecution",
          command: "cancel",
          output: "cancelled",
          exitCode: 130,
          cancelled: true,
        },
        { role: "assistant", content: "已处理" },
      ])}
    />,
  );
  expect(
    container.querySelector(".process-fold-failures")?.textContent,
  ).toContain("1 个失败");
  await click(container.querySelector<HTMLElement>(".process-fold-header")!);
  expect(container.querySelector(".tool-card")).toBeNull();
  expect(
    container.querySelector(".process-fold-failures")?.textContent,
  ).toContain("1 个失败");
});

/** 折叠不停止运行标题的计时，结束后释放计时器。 */
it("运行中可折叠并继续计时，结束时停止，显示失败计数", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  /** 为测试提供受控折叠状态。参数：[in] active 是否运行。返回值：折叠容器。 */
  function Example({ active }: { active: boolean }) {
    const [collapsed, setCollapsed] = useState(false);
    return (
      <ProcessFold
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        active={active}
        startedAt={1_000}
        endedAt={12_000}
        failures={2}
      >
        <p>正文</p>
      </ProcessFold>
    );
  }
  await render(<Example active />);
  await click(container.querySelector<HTMLElement>(".process-fold-header")!);
  const before = container.querySelector(".process-fold-time")!.textContent;
  await act(() => {
    vi.advanceTimersByTime(2_000);
  });
  expect(container.querySelector(".process-fold-time")!.textContent).not.toBe(
    before,
  );
  expect(container.textContent).toContain("2 个失败");
  expect(container.textContent).not.toContain("正文");
  await render(<Example active={false} />);
  const ended = container.textContent;
  await act(() => {
    vi.advanceTimersByTime(5_000);
  });
  expect(container.textContent).toBe(ended);
  expect(vi.getTimerCount()).toBe(0);
});
