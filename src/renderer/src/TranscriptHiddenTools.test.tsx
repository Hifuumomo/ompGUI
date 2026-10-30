// @vitest-environment jsdom
import { expect, it } from "vitest";
import type { AgentMessage } from "../../shared/protocol";
import { container, conversation } from "./transcript-test-harness";

/** 同时覆盖配对历史、孤立结果和实时调用，避免隐藏名称后仍残留结果或空分组。 */
it.each(["todo", "eval", "wait"])(
  "隐藏 %s 的历史及实时工具展示",
  async (name) => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "history",
            name,
            arguments: { text: "隐藏参数" },
          },
        ],
      },
      { role: "toolResult", toolCallId: "history", content: "隐藏结果" },
      {
        role: "toolResult",
        toolCallId: "orphan",
        toolName: name,
        content: "隐藏孤立结果",
      },
    ];
    await conversation(messages, [
      { id: "live", name, running: true, args: { text: "隐藏实时参数" } },
    ]);
    expect(
      container.querySelector(".conversation-review")!.children,
    ).toHaveLength(0);

    await conversation(
      [
        { role: "user", content: "用户提示" },
        ...messages,
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "visible",
              name: "read",
              arguments: { path: "visible.txt" },
            },
          ],
        },
        { role: "toolResult", toolCallId: "visible", content: "可见结果" },
        { role: "assistant", content: "最终回复" },
      ],
      [{ id: "live", name, args: {}, running: false, result: "隐藏实时结果" }],
    );
    expect(container.textContent).not.toContain("隐藏");
    expect(container.textContent).toContain("用户提示");
    expect(container.textContent).toContain("最终回复");
    expect(container.querySelectorAll(".tool-row")).toHaveLength(1);
    expect(
      container.querySelector('.tool-row[data-tool-id="visible"]'),
    ).not.toBeNull();
    expect(container.querySelectorAll(".process-group")).toHaveLength(1);
    expect(
      container.querySelector(".process-group")!.textContent,
    ).not.toContain("最终回复");
  },
);
