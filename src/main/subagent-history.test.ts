// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readSubagentHistory } from "./subagent-history";

function host() {
  return {
    current: vi
      .fn()
      .mockResolvedValue({ id: "session-a", path: "C:/sessions/a.jsonl" }),
    prepare: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue({ subagents: [] }),
  };
}
describe("historical subagent IPC", () => {
  it("binds requests to the selected root and discards renderer-supplied paths", async () => {
    const services = host();
    await readSubagentHistory(
      { op: "list", sessionId: "session-a", rootSessionFile: "C:/other.jsonl" },
      services,
    );
    expect(services.read).toHaveBeenCalledWith({
      op: "list",
      sessionId: "session-a",
      rootSessionFile: "C:/sessions/a.jsonl",
    });
    expect(services.prepare).toHaveBeenCalledOnce();
  });
  it("rejects a stale session before starting an engine", async () => {
    const services = host();
    await expect(
      readSubagentHistory({ op: "list", sessionId: "old" }, services),
    ).rejects.toThrow("会话已切换");
    expect(services.prepare).not.toHaveBeenCalled();
    expect(services.read).not.toHaveBeenCalled();
  });
  it.each([-1, 1.5, "100", Infinity])(
    "rejects invalid transcript cursor %s",
    async (fromByte) => {
      await expect(
        readSubagentHistory(
          {
            op: "messages",
            sessionId: "session-a",
            subagentId: "child",
            fromByte,
          },
          host(),
        ),
      ).rejects.toThrow("读取位置");
    },
  );
  it("surfaces native loader failures", async () => {
    const services = host();
    services.read.mockRejectedValue(new Error("EACCES transcript"));
    await expect(
      readSubagentHistory({ op: "list", sessionId: "session-a" }, services),
    ).rejects.toThrow("EACCES");
  });
});
