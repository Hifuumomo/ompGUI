import { describe, expect, it } from "vitest";
import {
  applySubagentFrame,
  EMPTY_SUBAGENTS,
  mergeSubagent,
} from "./subagent-state";
import { runningAgent } from "./subagent-test-fixtures";
import { createDoubleArrow, DOUBLE_ARROW_WINDOW_MS } from "./subagent-shortcut";

describe("native subagent state", () => {
  it("retains terminal agents, usage and output, without showing a stale running tool", () => {
    const state = mergeSubagent(EMPTY_SUBAGENTS, runningAgent);
    const result = applySubagentFrame(state, {
      type: "subagent_lifecycle",
      payload: {
        id: runningAgent.id,
        index: 1,
        agent: "explore",
        agentSource: "bundled",
        status: "completed",
      },
    });
    expect(result.agents[0].status).toBe("completed");
    expect(result.agents[0].progress?.tokens).toBe(1200);
    expect(result.agents[0].sessionFile).toBe(runningAgent.sessionFile);
    expect(result.activity.some((row) => row.id.endsWith(":current"))).toBe(
      false,
    );
    expect(result.activity.some((row) => row.title === "已完成")).toBe(true);
    expect(state.agents[0].status).toBe("running");
  });
  it("deduplicates repeated progress and preserves tool errors", () => {
    const agent = {
      ...runningAgent,
      progress: {
        ...runningAgent.progress!,
        recentTools: [{ tool: "read", args: {}, endMs: 80, isError: true }],
      },
    };
    const state = mergeSubagent(EMPTY_SUBAGENTS, agent);
    const result = applySubagentFrame(state, {
      type: "subagent_progress",
      payload: agent,
    });
    expect(result.activity).toHaveLength(state.activity.length);
    expect(result.activity.find((row) => row.title === "read")?.error).toBe(
      true,
    );
    expect(applySubagentFrame(result, { type: "message_update" })).toBe(result);
  });
});

function arrow(
  key: string,
  timeStamp: number,
  options: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", { key, ...options });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
}
describe("double arrow shortcut", () => {
  it.each(["ArrowRight", "ArrowLeft"])("opens with two %s presses", (key) => {
    const detect = createDoubleArrow();
    expect(detect(arrow(key, 10))).toBe(false);
    expect(detect(arrow(key, 200))).toBe(true);
    expect(detect(arrow(key, 300))).toBe(false);
  });
  it("ignores held keys, composition, modifiers, other keys and expired pairs", () => {
    const detect = createDoubleArrow();
    expect(detect(arrow("ArrowRight", 0))).toBe(false);
    expect(detect(arrow("ArrowRight", 10, { repeat: true }))).toBe(false);
    expect(detect(arrow("ArrowRight", 20, { isComposing: true }))).toBe(false);
    expect(detect(arrow("ArrowRight", 30, { shiftKey: true }))).toBe(false);
    expect(detect(arrow("ArrowRight", 40))).toBe(false);
    expect(detect(arrow("ArrowRight", 41 + DOUBLE_ARROW_WINDOW_MS))).toBe(
      false,
    );
    expect(detect(arrow("ArrowLeft", 42 + DOUBLE_ARROW_WINDOW_MS))).toBe(false);
    expect(detect(arrow("x", 43 + DOUBLE_ARROW_WINDOW_MS))).toBe(false);
  });
});
