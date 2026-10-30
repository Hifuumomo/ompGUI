import { expect, it, vi } from "vitest";
import type { SessionState } from "../../shared/protocol";
import { createAppFixture } from "./inline-app-test-fixture";

it("真实 App 随会话用量显示与移除底边轨道，caption 只保留快捷键提示", async () => {
  const app = await createAppFixture([]);
  expect(app.container.querySelector('[role="meter"]')).toBeNull();
  const original = window.desktop.request;
  const state = await original<SessionState>({ type: "get_state" });
  let usage: SessionState["contextUsage"] = { tokens: 144213, contextWindow: 200000, percent: 72 };
  const request = vi.spyOn(window.desktop, "request");
  request.mockImplementation((command) => command.type === "get_state"
    ? Promise.resolve({ ...state, contextUsage: usage })
    : original(command));
  try {
    await app.emit({ type: "session_info_update" });
    expect(app.container.querySelector('.composer-box [role="meter"]')?.getAttribute("aria-valuenow")).toBe("72");
    const caption = app.container.querySelector(".composer-caption")!;
    expect(caption.textContent).not.toContain("上下文");
    expect(caption.textContent).toContain("Enter 发送");
    usage = undefined;
    await app.emit({ type: "session_info_update" });
    expect(app.container.querySelector('[role="meter"]')).toBeNull();
  } finally {
    request.mockRestore();
  }
});
