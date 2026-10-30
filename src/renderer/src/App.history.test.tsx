// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createAppFixture } from "./inline-app-test-fixture";

/** 即便模型上下文以摘要开头，真实 App 仍展示完整父链历史，摘要可就地展开。 */
it("会话以原始用户提示开头，压缩摘要不再替代早期聊天", async () => {
  const app = await createAppFixture(
    [
      { role: "compactionSummary", summary: "压缩摘要" },
      { role: "assistant", content: "回答2" },
    ],
    {
      entries: [
        {
          type: "message",
          id: "u1",
          parentId: null,
          timestamp: "2026-10-13T00:00:00Z",
          message: { role: "user", content: "最初提示" },
        },
        {
          type: "message",
          id: "a1",
          parentId: "u1",
          timestamp: "2026-10-13T00:00:01Z",
          message: { role: "assistant", content: "回答1" },
        },
        {
          type: "message",
          id: "u2",
          parentId: "a1",
          timestamp: "2026-10-13T00:00:02Z",
          message: { role: "user", content: "后续提示" },
        },
        {
          type: "compaction",
          id: "compact",
          parentId: "u2",
          timestamp: "2026-10-13T00:00:03Z",
          summary: "压缩摘要",
          firstKeptEntryId: "u2",
        },
        {
          type: "message",
          id: "a2",
          parentId: "compact",
          timestamp: "2026-10-13T00:00:04Z",
          message: { role: "assistant", content: "回答2" },
        },
        {
          type: "message",
          id: "other",
          parentId: "a1",
          timestamp: "2026-10-13T00:00:05Z",
          message: { role: "user", content: "旁支提示" },
        },
      ],
      leafId: "a2",
    },
  );
  const conversation = app.container.querySelector(".conversation-review")!;
  expect(
    [...conversation.children]
      .filter((node) => !node.classList.contains("process-group"))
      .map((node) => node.textContent),
  ).toEqual(["最初提示", "回答1", "后续提示", "回答2"]);
  expect(app.commands).toContain("get_entries");
  expect(app.commands).not.toContain("get_messages_page");
  const compact =
    conversation.querySelector<HTMLDetailsElement>(".compaction-notice")!;
  const process = compact.closest<HTMLDetailsElement>(".process-group")!;
  expect(process).not.toBeNull();
  await app.click(process.querySelector("summary")!);
  expect(compact.open).toBe(false);
  await app.click(compact.querySelector("summary")!);
  expect(compact.open).toBe(true);
});
