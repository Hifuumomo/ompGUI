import { expect, it } from "vitest";
import type { AgentMessage, MessageContent, RpcFrame } from "./protocol";
import {
  streamedMessage,
  type StreamingMessageContent,
} from "./streamed-message";
import { describeToolCall } from "./tool-presentation";

/** 生成保存原生帧同形的事件，包含空 arguments 和双重权威快照。 */
function nativeFrame(
  type: string,
  delta = "",
  id = "native-write",
  index = 0,
  name = "write",
): RpcFrame {
  const tool: MessageContent = {
    type: "toolCall",
    id,
    name,
    arguments: {},
  };
  const content: MessageContent[] = Array.from({ length: index }, () => ({
    type: "text",
    text: "before",
  }));
  content.push(tool);
  const partial: AgentMessage = { role: "assistant", content };
  return {
    type: "message_update",
    message: partial,
    assistantMessageEvent: { type, contentIndex: index, delta, partial },
  };
}

/** 取出测试指定的工具块。 */
function part(message: AgentMessage, index = 0): StreamingMessageContent {
  return (message.content as StreamingMessageContent[])[index];
}

it("原生双快照中的空 arguments 不吞掉 raw delta，只有 end 授权文件", () => {
  let message = streamedMessage(undefined, nativeFrame("toolcall_start"));
  const raw = JSON.stringify({
    path: "parity-sample.txt",
    content: "alpha\nbeta\n",
  });
  for (const delta of raw) {
    message = streamedMessage(message, nativeFrame("toolcall_delta", delta));
    expect(part(message).arguments).toBeUndefined();
    expect(describeToolCall("write", part(message).arguments).targets).toEqual(
      [],
    );
  }
  expect(part(message).partialArguments).toBe(raw);
  const complete = {
    type: "toolCall",
    id: "native-write",
    name: "write",
    arguments: JSON.parse(raw),
  };
  message = streamedMessage(message, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [
        { ...complete, partialArguments: raw } as StreamingMessageContent,
      ],
    },
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: complete,
    },
  });
  expect(part(message)).not.toHaveProperty("partialArguments");
  expect(describeToolCall("write", part(message).arguments).targets).toEqual([
    { kind: "file", label: "parity-sample.txt", path: "parity-sample.txt" },
  ]);
});

it("原生 edit 的直接 freeform delta 保留原文且 end 前不产生输入参数或文件目标", () => {
  const frame = (type: string, delta = "") =>
    nativeFrame(type, delta, "native-edit", 0, "edit");
  let message = streamedMessage(undefined, frame("toolcall_start"));
  const deltas = [
    "*** Begin Patch\n",
    "[parity-sample.txt#0063]\n",
    "PUT 2.=2:\n",
    "+gamma",
  ];
  let raw = "";
  for (const delta of deltas) {
    raw += delta;
    message = streamedMessage(message, frame("toolcall_delta", delta));
    expect(part(message).partialArguments).toBe(raw);
    expect(part(message).arguments).toBeUndefined();
    expect(part(message)).not.toHaveProperty("input");
    expect(describeToolCall("edit", part(message).arguments).targets).toEqual([]);
  }
  const input = `${raw}\n*** End Patch\n`;
  message = streamedMessage(message, frame("toolcall_delta", "\n*** End Patch\n"));
  expect(part(message).partialArguments).toBe(input);
  expect(describeToolCall("edit", part(message).arguments).targets).toEqual([]);
  const complete = {
    type: "toolCall",
    id: "native-edit",
    name: "edit",
    arguments: { input },
  };
  message = streamedMessage(message, {
    type: "message_update",
    message: {
      role: "assistant",
      content: [
        { ...complete, partialArguments: input } as StreamingMessageContent,
      ],
    },
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: complete,
    },
  });
  expect(part(message)).toEqual(complete);
  expect(part(message)).not.toHaveProperty("partialArguments");
  expect(describeToolCall("edit", part(message).arguments).targets).toEqual([
    { kind: "file", label: "parity-sample.txt", path: "parity-sample.txt" },
  ]);
});

it("文本、思考和权威快照交错时保留流，不重复追加已有快照文本", () => {
  let message = streamedMessage(
    undefined,
    nativeFrame("toolcall_delta", '{"content":"a'),
  );
  const content = [part(message), { type: "thinking", thinking: "first" }];
  message = streamedMessage(message, {
    type: "message_update",
    message: { role: "assistant", model: "native", content },
    assistantMessageEvent: {
      type: "thinking_delta",
      contentIndex: 1,
      delta: "first",
    },
  });
  expect((message.content as MessageContent[])[1].thinking).toBe("first");
  message = streamedMessage(message, {
    type: "message_update",
    assistantMessageEvent: {
      type: "thinking_delta",
      contentIndex: 1,
      delta: " second",
    },
  });
  message = streamedMessage(message, {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 2,
      delta: "answer",
    },
  });
  expect(part(message).partialArguments).toBe('{"content":"a');
  expect((message.content as MessageContent[])[1].thinking).toBe(
    "first second",
  );
  expect((message.content as MessageContent[])[2].text).toBe("answer");
  expect(message.model).toBe("native");
});

it("并行调用按 id 和 index 隔离，位置复用不继承旧参数", () => {
  let message = streamedMessage(
    undefined,
    nativeFrame("toolcall_delta", '{"content":"old', "old"),
  );
  message = streamedMessage(message, nativeFrame("toolcall_start", "", "new"));
  expect(part(message).partialArguments).toBe("");
  message = streamedMessage(
    message,
    nativeFrame("toolcall_delta", '{"content":"second', "second", 1),
  );
  expect(part(message, 1).partialArguments).toBe('{"content":"second');
  expect(part(message, 1).id).toBe("second");
});

it("非工具快照包括省略 content 的快照仍保持权威", () => {
  const snapshot: AgentMessage = { role: "assistant", model: "new" };
  expect(
    streamedMessage(
      { role: "assistant", content: "old" },
      { type: "message_update", message: snapshot },
    ),
  ).toBe(snapshot);
  const partial: AgentMessage = { role: "assistant", content: "partial" };
  expect(
    streamedMessage(undefined, {
      type: "message_update",
      assistantMessageEvent: { partial },
    }),
  ).toBe(partial);
});

it("没有 message 时仍采用 partial，结束调用清除预览", () => {
  const first = nativeFrame("toolcall_delta", '{"command":"echo');
  delete first.message;
  let message = streamedMessage(undefined, first);
  expect(part(message).partialArguments).toBe('{"command":"echo');
  const complete = {
    type: "toolCall",
    id: "native-write",
    name: "bash",
    arguments: { command: "echo hello" },
  };
  message = streamedMessage(message, {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: complete,
    },
  });
  expect(part(message)).toEqual(complete);
});
