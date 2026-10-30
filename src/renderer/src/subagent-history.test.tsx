import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  SubagentTransport,
  SubagentSnapshot,
} from "../../shared/subagents";
import type { RpcFrame } from "../../shared/protocol";
import { SubagentActivityHub } from "./SubagentActivityHub";
import { container, render } from "./transcript-test-harness";
import { runningAgent } from "./subagent-test-fixtures";
import { combineSubagentHistory } from "./use-subagent-history";
import { EMPTY_SUBAGENTS, mergeSubagent } from "./subagent-state";

const historical: SubagentSnapshot = {
  ...runningAgent,
  status: "parked",
  historical: true,
  parentId: "Main",
};
function backend() {
  const listeners = new Set<(frame: RpcFrame) => void>();
  const history = vi.fn(async (request) =>
    request.op === "list"
      ? { subagents: [historical] }
      : {
          nextByte: 50,
          reset: false,
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "历史子代理的真实对话内容" }],
            },
          ],
        },
  );
  const request = vi.fn().mockResolvedValue({ subagents: [runningAgent] });
  const transport: SubagentTransport = {
    request,
    subagentHistory: history as SubagentTransport["subagentHistory"],
    onFrame: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return { transport, history, request };
}

describe("persisted subagents in Agent Hub", () => {
  it("ignores an old history response after switching sessions", async () => {
    const native = backend();
    let finish!: (result: { subagents: SubagentSnapshot[] }) => void;
    native.history.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = (id: string) => (
      <SubagentActivityHub
        key={id}
        transport={native.transport}
        sessionId={id}
        connected={false}
        open
        onClose={() => {}}
      />
    );
    await render(view("old"));
    native.history.mockResolvedValue({ subagents: [] });
    await render(view("new"));
    await act(() => finish({ subagents: [historical] }));
    expect(container.querySelector('[role="option"]')).toBeNull();
  });
  /** 验证历史停驻状态灯及只读对话加载。参数：无。返回值：异步测试完成。 */
  it("loads agents and transcripts from a read-only session without connecting it", async () => {
    const native = backend();
    await render(
      <SubagentActivityHub
        transport={native.transport}
        sessionId="root-session"
        connected={false}
        open
        onClose={() => {}}
      />,
    );
    expect(native.history).toHaveBeenCalledWith({
      op: "list",
      sessionId: "root-session",
    });
    const light = container.querySelector('[role="option"] [role="img"]')!;
    expect(light.getAttribute("aria-label")).toBe("历史 · 已停驻");
    expect(light.textContent).toBe("");
    expect(container.textContent).toContain("Main");
    await act(() =>
      container
        .querySelector('[role="dialog"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
    );
    expect(native.history).toHaveBeenCalledWith({
      op: "messages",
      sessionId: "root-session",
      subagentId: "agent-1",
      fromByte: 0,
    });
    expect(container.textContent).toContain("历史子代理的真实对话内容");
    expect(native.request).not.toHaveBeenCalled();
  });
  /** 验证实时运行状态灯优先于磁盘停驻记录。参数：无。返回值：异步测试完成。 */
  it("does not replace a live agent with a parked history record", async () => {
    const native = backend();
    await render(
      <SubagentActivityHub
        transport={native.transport}
        sessionId="root-session"
        connected
        open
        onClose={() => {}}
      />,
    );
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(
      container.querySelector('[role="option"] [role="img"]')?.getAttribute("aria-label"),
    ).toBe("运行中");
    expect(container.querySelector('[role="option"] .parked')).toBeNull();
  });
  it("preserves observed completion when disk history is refreshed", () => {
    const history = mergeSubagent(EMPTY_SUBAGENTS, historical);
    const live = mergeSubagent(EMPTY_SUBAGENTS, {
      ...runningAgent,
      status: "completed",
    });
    const merged = combineSubagentHistory(history, live);
    expect(merged.agents[0].status).toBe("completed");
    expect(merged.agents[0].historical).toBeUndefined();
    expect(merged.activity.some((row) => row.title.includes("停驻"))).toBe(
      false,
    );
  });
  it("shows history loader errors instead of claiming there are no historical agents", async () => {
    const native = backend();
    native.history.mockRejectedValue(new Error("历史读取失败"));
    await render(
      <SubagentActivityHub
        transport={native.transport}
        sessionId="root-session"
        connected={false}
        open
        onClose={() => {}}
      />,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "历史读取失败",
    );
  });
});
