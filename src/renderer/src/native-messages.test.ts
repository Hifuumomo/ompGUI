// @vitest-environment node
// 原生角色契约：https://github.com/can1357/oh-my-pi/blob/v18.8.9/packages/tui/src/chat/messages.ts
import { describe, expect, it } from "vitest";
import type { AgentMessage, SessionState } from "../../shared/protocol";
import { initialSession, messageText, sessionReducer } from "./session";

const image = { type: "image", mimeType: "image/png", data: "aW1hZ2U=" };
const nativeMessages: AgentMessage[] = [
  {
    role: "bashExecution",
    command: "printf 'bash-result'",
    output: "bash-result",
    exitCode: 0,
    cancelled: false,
    truncated: false,
    images: [image],
    timestamp: 1,
  },
  {
    role: "pythonExecution",
    code: "print(6 * 7)",
    output: "42",
    exitCode: 1,
    cancelled: true,
    truncated: false,
    timestamp: 2,
  },
  {
    role: "branchSummary",
    summary: "分支保留的上下文",
    fromId: "branch-source",
    timestamp: 3,
  },
  {
    role: "compactionSummary",
    summary: "压缩后保留的约束",
    tokensBefore: 8000,
    timestamp: 4,
  },
  {
    role: "fileMention",
    files: [
      {
        path: "src/answer.ts",
        content: "export const answer = 42;",
        lineCount: 1,
      },
      { path: "assets/chart.png", content: "", image },
      {
        path: "archive.bin",
        content: "",
        skippedReason: "binary",
        byteSize: 8,
      },
    ],
    timestamp: 5,
  },
];
const state: SessionState = {
  sessionId: "native-session",
  isStreaming: false,
  isCompacting: false,
  messageCount: nativeMessages.length,
  queuedMessageCount: 0,
};

/** 注册原生角色的真实预览与 reducer 消费者回归。参数：无。返回值：无。 */
function nativeMessageConsumers() {
  /** 验证没有 content 的执行、摘要与文件消息仍有有意义的预览。参数：无。返回值：无。 */
  function rolePreviews() {
    const previews = nativeMessages.map(messageText);
    expect(previews).toEqual([
      "printf 'bash-result'\nbash-result",
      "print(6 * 7)\n42",
      "分支保留的上下文",
      "压缩后保留的约束",
      "src/answer.ts\nexport const answer = 42;\nassets/chart.png\narchive.bin\nbinary",
    ]);
    for (const message of nativeMessages)
      expect(message.content).toBeUndefined();
  }
  it(
    "原生执行、摘要和文件角色从各自载荷提取预览，不要求 content",
    rolePreviews,
  );

  /** 验证导入历史保留完整图片、退出状态和角色扩展数据。参数：无。返回值：无。 */
  function importedHistory() {
    const view = sessionReducer(initialSession, {
      type: "history",
      state,
      messages: nativeMessages,
    });
    expect(view.messages.map((item) => item.message)).toEqual(nativeMessages);
    expect(view.messages.map((item) => messageText(item.message))).toEqual(
      nativeMessages.map(messageText),
    );
    expect(view.messages[0].message.images).toEqual([image]);
    expect(view.messages[1].message).toMatchObject({
      code: "print(6 * 7)",
      output: "42",
      exitCode: 1,
      cancelled: true,
    });
    expect(view.messages[4].message.files?.[1].image).toEqual(image);
    expect(view.messages.every((item) => !item.streaming)).toBe(true);
  }
  it("历史导入完整保存无 content 的所有原生角色与图片", importedHistory);

  /** 验证完整原生快照优先于增量，更新同一消息而不伪造空 content。参数：无。返回值：无。 */
  function streamedSnapshots() {
    let view = initialSession;
    for (const [index, message] of nativeMessages.entries()) {
      const messageId = `native-${index}`;
      view = sessionReducer(view, {
        type: "frame",
        frame: { type: "message_start", messageId, message },
      });
      // 原生 full snapshot 是权威值，不能因无 content 而错误应用附带增量。
      view = sessionReducer(view, {
        type: "frame",
        frame: {
          type: "message_update",
          messageId,
          message,
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: "不应覆盖原生载荷",
          },
        },
      });
      view = sessionReducer(view, {
        type: "frame",
        frame: { type: "message_end", messageId, message },
      });
    }
    expect(view.messages.map((item) => item.message)).toEqual(nativeMessages);
    expect(view.messages.map((item) => messageText(item.message))).toEqual(
      nativeMessages.map(messageText),
    );
    expect(view.messages).toHaveLength(nativeMessages.length);
    for (const item of view.messages) {
      expect(item.message).not.toHaveProperty("content");
      expect(item.streaming).toBe(false);
    }
    const updated: AgentMessage = {
      ...nativeMessages[0],
      output: "new output",
      exitCode: 2,
    };
    view = sessionReducer(view, {
      type: "frame",
      frame: {
        type: "message_update",
        messageId: "native-0",
        message: updated,
      },
    });
    expect(view.messages[0].message).toEqual(updated);
    expect(messageText(view.messages[0].message)).toBe(
      "printf 'bash-result'\nnew output",
    );
    expect(view.messages).toHaveLength(nativeMessages.length);
  }
  it(
    "start/update/end 的原生完整快照不丢失载荷或制造空数组",
    streamedSnapshots,
  );

  /** 验证未知原生角色在历史、完整帧与 partial 中完整保留并提供可读原始数据。参数：无。返回值：无。 */
  function unknownNativePayload() {
    const message: AgentMessage = {
      role: "extensionNotice",
      timestamp: 6,
      payload: {
        title: "运行记录",
        paths: ["src/answer.ts"],
        status: { finished: true },
      },
    };
    let view = sessionReducer(initialSession, {
      type: "history",
      state,
      messages: [message],
    });
    expect(JSON.parse(messageText(view.messages[0].message))).toEqual(message);
    view = sessionReducer(view, { type: "reset" });
    view = sessionReducer(view, {
      type: "frame",
      frame: { type: "message_start", messageId: "unknown", message },
    });
    const partial: AgentMessage = {
      ...message,
      payload: { title: "更新后的记录", result: [42] },
    };
    view = sessionReducer(view, {
      type: "frame",
      frame: {
        type: "message_update",
        messageId: "unknown",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "不应伪造正文",
          partial,
        },
      },
    });
    expect(view.messages[0].message).toEqual(partial);
    expect(JSON.parse(messageText(view.messages[0].message))).toEqual(partial);
    view = sessionReducer(view, {
      type: "frame",
      frame: { type: "message_end", messageId: "unknown", message: partial },
    });
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0].message).not.toHaveProperty("content");
    expect(JSON.parse(messageText(view.messages[0].message))).toEqual(partial);
  }
  it("未知角色和无 content 的 partial 保留可读原始载荷", unknownNativePayload);

  /** 验证真正无快照的助手增量仍然累加正文而不丢失之前内容。参数：无。返回值：无。 */
  function assistantDeltaWithoutSnapshot() {
    let view = sessionReducer(initialSession, {
      type: "frame",
      frame: {
        type: "message_start",
        messageId: "assistant",
        message: { role: "assistant", timestamp: 7 },
      },
    });
    for (const delta of ["第一段", "第二段"]) {
      view = sessionReducer(view, {
        type: "frame",
        frame: {
          type: "message_update",
          messageId: "assistant",
          assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
        },
      });
    }
    expect(messageText(view.messages[0].message)).toBe("第一段第二段");
    expect(view.messages[0].message).toEqual({
      role: "assistant",
      timestamp: 7,
      content: [{ type: "text", text: "第一段第二段" }],
    });
  }
  it("仅助手真实增量使用正文累加器", assistantDeltaWithoutSnapshot);
}

describe("原生消息消费者兼容", nativeMessageConsumers);
