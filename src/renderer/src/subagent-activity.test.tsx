import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RpcCommand, RpcFrame } from "../../shared/protocol";
import type { SubagentTransport } from "../../shared/subagents";
import { SubagentActivityHub } from "./SubagentActivityHub";
import { container, render } from "./transcript-test-harness";
import { runningAgent } from "./subagent-test-fixtures";

function backend(reply?: (command: RpcCommand) => unknown) {
  const listeners = new Set<(frame: RpcFrame) => void>();
  const request = vi.fn(async (command: RpcCommand) => {
    if (reply) return reply(command);
    if (command.type === "get_subagents") return { subagents: [runningAgent] };
    if (command.type === "get_subagent_messages")
      return {
        nextByte: 100,
        reset: false,
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "已读取原生对话" }],
          },
        ],
      };
    return { level: "progress" };
  });
  const transport: SubagentTransport = {
    subagentHistory: vi.fn().mockResolvedValue({ subagents: [] }),
    request: request as SubagentTransport["request"],
    onFrame: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    request,
    transport,
    emit: (frame: RpcFrame) => listeners.forEach((listener) => listener(frame)),
  };
}
async function key(value: string) {
  const dialog = container.querySelector('[role="dialog"]')!;
  await act(() => {
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("subagent activity hub", () => {
  it("returns on native double-left and opens the selected list option with Enter", async () => {
    const native = backend();
    const close = vi.fn();
    await render(
      <SubagentActivityHub
        transport={native.transport}
        connected
        open
        onClose={close}
      />,
    );
    const option = container.querySelector<HTMLElement>('[role="option"]')!;
    await act(() => {
      option.focus();
      option.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(container.textContent).toContain("已读取原生对话");
    await key("ArrowLeft");
    await key("ArrowLeft");
    expect(container.querySelector('[aria-label="子代理列表"]')).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
    await key("ArrowLeft");
    await key("ArrowLeft");
    expect(close).toHaveBeenCalledOnce();
  });
  it("navigates agents, activity, transcript and returns without affecting the parent", async () => {
    const native = backend();
    const close = vi.fn();
    await render(
      <SubagentActivityHub
        transport={native.transport}
        connected
        open
        onClose={close}
      />,
    );
    expect(container.textContent).toContain("test-model");
    expect(container.textContent).toContain("1,200");
    await key("2");
    expect(container.querySelector('[aria-label="活动时间线"]')).not.toBeNull();
    await key("Enter");
    expect(container.textContent).toContain("已读取原生对话");
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
    await key("Escape");
    expect(close).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="活动时间线"]')).not.toBeNull();
    await key("Escape");
    expect(close).toHaveBeenCalledOnce();
  });
  /** 验证标题与页签同层且页签仍可切换。参数：无。返回值：异步测试完成。 */
  it("keeps the title and switchable tabs in the first of two navigation rows", async () => {
    const native = backend();
    await render(
      <SubagentActivityHub transport={native.transport} connected open onClose={vi.fn()} />,
    );
    const header = container.querySelector(".subagent-header")!;
    expect(header.querySelector("h1")?.textContent).toBe("Agent Hub");
    expect(header.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(header.nextElementSibling?.className).toBe("subagent-toolbar");
    expect(container.querySelectorAll(".subagent-toolbar")).toHaveLength(1);
    const tabs = header.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    await act(() => tabs[1].click());
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[aria-label="活动时间线"]')).not.toBeNull();
    await act(() => tabs[0].click());
    expect(container.querySelector('[aria-label="子代理列表"]')).not.toBeNull();
  });
  /** 验证状态灯及详情顺序，活动仅来自选中代理。参数：无。返回值：异步测试完成。 */
  it("shows an accessible status light and only the selected agent's recent activity", async () => {
    const other = {
      ...runningAgent,
      id: "agent-2",
      index: 2,
      progress: {
        ...runningAgent.progress!,
        id: "agent-2",
        recentOutput: ["其他代理的专属输出"],
      },
    };
    const native = backend((command) =>
      command.type === "get_subagents"
        ? { subagents: [runningAgent, other] }
        : { level: "progress" },
    );
    await render(
      <SubagentActivityHub transport={native.transport} connected open onClose={vi.fn()} />,
    );
    const light = container.querySelector('[role="option"] [role="img"]')!;
    expect(light.getAttribute("aria-label")).toBe("运行中");
    expect(light.getAttribute("title")).toBe("运行中");
    expect(light.textContent).toBe("");
    expect([...container.querySelectorAll(".subagent-inspector h3")].map((heading) => heading.textContent))
      .toEqual(["Task", "Current", "Output", "Usage", "Recent activity"]);
    const recent = container.querySelector('[aria-label="代理近期活动"]')!;
    expect(recent.textContent).toContain("已找到进度订阅接口");
    expect(recent.querySelector("time")).not.toBeNull();
    expect(recent.textContent).not.toContain("其他代理的专属输出");
    const options = container.querySelectorAll<HTMLButtonElement>('[role="option"]');
    await act(() => options[1].click());
    expect(container.querySelector('[aria-label="代理近期活动"]')?.textContent)
      .toContain("其他代理的专属输出");
    expect(container.querySelector('[aria-label="代理近期活动"]')?.textContent)
      .not.toContain("已找到进度订阅接口");
  });
  /** 验证快照到达前的完成事件通过状态灯保留。参数：无。返回值：异步测试完成。 */
  it("replays a completion arriving before the initial snapshot response", async () => {
    let resolve!: (value: unknown) => void;
    const native = backend((command) =>
      command.type === "get_subagents"
        ? new Promise((done) => {
            resolve = done;
          })
        : { level: "progress" },
    );
    await render(
      <SubagentActivityHub
        transport={native.transport}
        connected
        open
        onClose={() => {}}
      />,
    );
    await act(async () => {
      native.emit({
        type: "subagent_lifecycle",
        payload: { ...runningAgent, status: "completed" },
      });
      resolve({ subagents: [runningAgent] });
    });
    expect(
      container.querySelector('[role="option"] [role="img"]')?.getAttribute("aria-label"),
    ).toBe("已完成");
  });
  /** 验证关闭后仍保留失败状态，换连接时隔离记录。参数：无。返回值：异步测试完成。 */
  it("keeps observing while closed and resets records for a different connection", async () => {
    const native = backend();
    const view = (open: boolean, session: string) => (
      <SubagentActivityHub
        key={session}
        transport={native.transport}
        connected
        open={open}
        onClose={() => {}}
      />
    );
    await render(view(true, "first"));
    await render(view(false, "first"));
    await act(() => {
      native.emit({
        type: "subagent_lifecycle",
        payload: { ...runningAgent, status: "failed" },
      });
    });
    await render(view(true, "first"));
    expect(
      container.querySelector('[role="option"] [role="img"]')?.getAttribute("aria-label"),
    ).toBe("失败");
    native.request.mockResolvedValue({ subagents: [] });
    await render(view(true, "second"));
    expect(container.querySelector('[role="option"]')).toBeNull();
  });
  it("does not send requests for a disconnected or read-only session", async () => {
    const native = backend();
    await render(
      <SubagentActivityHub
        transport={native.transport}
        connected={false}
        open
        onClose={() => {}}
      />,
    );
    expect(native.request).not.toHaveBeenCalled();
    expect(container.textContent).toContain("请先选择已有会话");
  });
  it("shows native failures and retries explicitly", async () => {
    const native = backend(() => {
      throw new Error("Subagent event bus is unavailable");
    });
    await render(
      <SubagentActivityHub
        transport={native.transport}
        connected
        open
        onClose={() => {}}
      />,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Subagent event bus is unavailable",
    );
    native.request.mockResolvedValue({ subagents: [runningAgent] });
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "刷新",
    )!;
    await act(() => retry.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("explore");
  });
});
