// @vitest-environment jsdom
import { expect, it } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import { Transcript } from "./Transcript";
import {
  call,
  click,
  container,
  conversation,
  render,
  timeline,
} from "./transcript-test-harness";

it("错误滚动区默认折叠，追加错误保留展开选择且可再次收起", async () => {
  const first = { role: "assistant", errorMessage: "连接断开" };
  await conversation([first]);
  const group = container.querySelector<HTMLDetailsElement>(
    ".process-error-group",
  )!;
  expect(group.open).toBe(false);
  await click(group.querySelector("summary")!);
  expect(group.open).toBe(true);
  await conversation([first, { role: "assistant", errorMessage: "重试失败" }]);
  expect(container.querySelector(".process-error-group")).toBe(group);
  expect(group.open).toBe(true);
  expect(group.querySelectorAll(".inline-error")).toHaveLength(2);
  await click(group.querySelector("summary")!);
  expect(group.open).toBe(false);
});

it("连续错误按原序汇总，重试操作分隔批次且最终回复留在外部", async () => {
  await conversation([
    { role: "user", content: "开始" },
    { role: "assistant", content: "正在处理" },
    { role: "assistant", content: "", errorMessage: "SSE stalled" },
    {
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "ECONNRESET\n原始详情",
    },
    call("retry", "bash", { command: "retry" }),
    { role: "assistant", stopReason: "error" },
    { role: "assistant", content: "恢复完成" },
  ]);
  const groups = container.querySelectorAll(".process-errors");
  expect(groups).toHaveLength(2);
  expect(
    [...groups[0].querySelectorAll(".inline-error")].map((n) => n.textContent),
  ).toEqual(["SSE stalled", "ECONNRESET\n原始详情"]);
  expect(groups[1].textContent).toBe("生成错误");
  expect(container.querySelector(".process-group")!.textContent).not.toContain(
    "恢复完成",
  );
  expect(container.textContent).toContain("恢复完成");
});

it("末尾错误不散落到过程外，带正文的失败回复保留正文", async () => {
  await conversation([
    { role: "assistant", errorMessage: "错误一" },
    { role: "assistant", errorMessage: "错误二" },
  ]);
  expect(container.querySelectorAll(".process-errors")).toHaveLength(1);
  expect(
    container.querySelectorAll(".process-errors .inline-error"),
  ).toHaveLength(2);
  await conversation([
    { role: "assistant", content: "已完成一部分", errorMessage: "网络中断" },
  ]);
  expect(container.querySelector(".process-errors")).toBeNull();
  expect(container.textContent).toContain("已完成一部分");
  expect(container.textContent).toContain("网络中断");
});

it.each([false, true])("静默停止不产生错误组或空消息，实时状态为 %s", async (streaming) => {
  for (const content of [undefined, "", [], [{ type: "text", text: "  " }]]) {
    const message: AgentMessage = {
      role: "assistant", content, stopReason: "aborted", errorMessage: "__omp.silent_abort__",
    };
    await render(<Transcript messages={[{ key: "silent", message, streaming }]} tools={[]} sessionId="session-a" />);
    expect(container.querySelector(".process-error-group")).toBeNull();
    expect(container.querySelector(".conversation-message")).toBeNull();
    expect(container.textContent).not.toContain("已取消生成");
    expect(container.textContent).not.toContain("__omp.silent_abort__");
    expect(message.errorMessage).toBe("__omp.silent_abort__");
    expect(message.stopReason).toBe("aborted");
  }
});

it("静默停止保留有效正文和工具调用，不泄漏内部终止提示", async () => {
  const message: AgentMessage = {
    role: "assistant", stopReason: "aborted", errorMessage: "__omp.silent_abort__",
    content: [
      { type: "text", text: "计划已提交，等待审阅。" },
      { type: "toolCall", id: "proposal", name: "write", arguments: { path: "xd://propose", content: "inventory" } },
    ],
  };
  await render(<Transcript messages={timeline([message])} tools={[]} sessionId="session-a" />);
  expect(container.textContent).toContain("计划已提交，等待审阅。");
  expect(container.querySelector('[data-tool-id="proposal"]')).not.toBeNull();
  expect(container.querySelector(".process-error-group")).toBeNull();
  expect(container.textContent).not.toContain("已取消生成");
  expect(container.textContent).not.toContain("__omp.silent_abort__");
});

it("用户取消及相似但非静默标记的真实错误继续显示", async () => {
  await conversation([
    { role: "assistant", content: [], stopReason: "aborted" },
    { role: "assistant", content: [], stopReason: "error", errorMessage: "鉴权失败" },
    { role: "assistant", content: [], stopReason: "aborted", errorMessage: "__omp.silent_abort__: 网络中断" },
  ]);
  expect(container.textContent).toContain("已取消生成");
  expect(container.textContent).toContain("鉴权失败");
  expect(container.textContent).toContain("__omp.silent_abort__: 网络中断");
});
