import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubagentTransport } from "../../shared/subagents";
import { SubagentTranscript } from "./SubagentTranscript";
import { container, render } from "./transcript-test-harness";
import { runningAgent } from "./subagent-test-fixtures";
import { useSubagentShortcut } from "./subagent-shortcut";

afterEach(() => vi.useRealTimers());
const message = (text: string) => ({
  role: "assistant",
  content: [{ type: "text", text }],
});
describe("subagent transcript", () => {
  it("uses byte cursors, replaces a truncated file and stops reading on unmount", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        nextByte: 100,
        reset: false,
        messages: [message("首条消息")],
      })
      .mockResolvedValueOnce({
        nextByte: 160,
        reset: false,
        messages: [message("增量消息")],
      })
      .mockResolvedValueOnce({
        nextByte: 40,
        reset: true,
        messages: [message("文件重置后的消息")],
      });
    const transport = { request } as unknown as SubagentTransport;
    await render(
      <SubagentTranscript agent={runningAgent} transport={transport} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(request).toHaveBeenLastCalledWith({
      type: "get_subagent_messages",
      subagentId: runningAgent.id,
      fromByte: 100,
    });
    expect(container.textContent).toContain("首条消息");
    expect(container.textContent).toContain("增量消息");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(container.textContent).not.toContain("首条消息");
    expect(container.textContent).toContain("文件重置后的消息");
    await render(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("does not poll a finished agent and surfaces read errors", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockRejectedValue(
        new Error("Unknown subagent or session file unavailable"),
      );
    const transport = { request } as unknown as SubagentTransport;
    await render(
      <SubagentTranscript
        agent={{ ...runningAgent, status: "completed" }}
        transport={transport}
      />,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Unknown subagent",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(request).toHaveBeenCalledOnce();
  });
});

function Shortcut({
  open,
  enabled = true,
}: {
  open: () => void;
  enabled?: boolean;
}) {
  useSubagentShortcut({ enabled, onOpen: open });
  return (
    <>
      <textarea aria-label="composer" />
      <input aria-label="search" />
    </>
  );
}
async function doubleKey(target: EventTarget, key = "ArrowRight") {
  await act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}
describe("subagent shortcut focus", () => {
  it("opens from an empty composer but leaves text editing and other inputs alone", async () => {
    const open = vi.fn();
    await render(<Shortcut open={open} />);
    await doubleKey(container.querySelector("input")!);
    const composer = container.querySelector("textarea")!;
    composer.value = "正在输入";
    await doubleKey(composer);
    expect(open).not.toHaveBeenCalled();
    composer.value = "";
    await doubleKey(composer);
    expect(open).toHaveBeenCalledOnce();
    await doubleKey(window, "ArrowLeft");
    expect(open).toHaveBeenCalledTimes(2);
  });
  it("does not open over another dialog", async () => {
    const open = vi.fn();
    await render(<Shortcut open={open} enabled={false} />);
    await doubleKey(window);
    expect(open).not.toHaveBeenCalled();
  });
});
