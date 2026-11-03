// @vitest-environment jsdom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentMessage, MessageContent } from "../../shared/protocol";
import type { StreamingMessageContent } from "../../shared/streamed-message";
import { describeToolCall } from "../../shared/tool-presentation";
import {
  previewStreamingArgs,
  streamingToolPreview,
  subscribeStreamingPreviews,
  streamingPreviewRevision,
} from "./tool-stream-preview";
import { createAppFixture } from "./inline-app-test-fixture";

afterEach(() => {
  vi.useRealTimers();
});

it("顶层字符串和 edits.0 字符串解码，其他嵌套字段不混入", () => {
  const json = JSON.stringify({
    input: "*** Begin Patch\n[a.ts#ABCD]\nREM\n*** End Patch\n",
    content: 'line\n"quoted"\\tail\t中文😀',
    command: "echo hello",
    old_text: "old",
    new_text: "new",
    edits: [
      { oldText: "before", newText: "after", extra: { content: "hidden" } },
      { newText: "ignored" },
    ],
    nested: { content: "hidden" },
    count: 2,
    enabled: true,
    missing: null,
  });
  expect(previewStreamingArgs(json)).toEqual({
    input: "*** Begin Patch\n[a.ts#ABCD]\nREM\n*** End Patch\n",
    content: 'line\n"quoted"\\tail\t中文😀',
    command: "echo hello",
    old_text: "old",
    new_text: "new",
    "edits.0.oldText": "before",
    "edits.0.newText": "after",
  });
});

it("每个字符截断都不抛错且值为最终字符串前缀，包括转义和代理对", () => {
  const samples = [
    '{"content":"a\\n\\r\\t\\b\\f\\/\\\"\\\\\\u4e2d\\ud83d\\ude00tail","command":"echo \\\"ok\\\""}',
    JSON.stringify({
      input:
        "*** Begin Patch\n[a.ts#0063]\nPUT 1.=1:\n+你好😀\n*** End Patch\n",
      edits: [{ old_text: "old", new_text: "新😀" }],
    }),
  ];
  for (const sample of samples) {
    const final = previewStreamingArgs(sample);
    for (let length = 0; length <= sample.length; length += 1) {
      let preview: Readonly<Record<string, string>> = {};
      expect(() => {
        preview = previewStreamingArgs(sample.slice(0, length));
      }).not.toThrow();
      for (const [key, value] of Object.entries(preview)) {
        expect(final[key]?.startsWith(value)).toBe(true);
        expect(/[\ud800-\udbff]$/.test(value)).toBe(false);
      }
    }
  }
  expect(previewStreamingArgs('{"content":"a\\u12')).toEqual({ content: "a" });
  expect(previewStreamingArgs('{"content":"a\\ud83d\\ude')).toEqual({
    content: "a",
  });
  expect(previewStreamingArgs('{"content":"a\\')).toEqual({ content: "a" });
});

it("保留原型同名字段且不把值内引号识别成新字段", () => {
  const preview = previewStreamingArgs(
    '{"__proto__":"safe","content":"\\\"path\\\":\\\"secret"}',
  );
  expect(Object.getPrototypeOf(preview)).toBeNull();
  expect(Object.entries(preview)).toEqual([
    ["__proto__", "safe"],
    ["content", '"path":"secret'],
  ]);
  for (const sample of [
    "",
    "[",
    "null",
    "{x",
    '{"a":',
    '{"a":"\\q',
    '{"a":[[[',
  ]) {
    expect(() => previewStreamingArgs(sample)).not.toThrow();
  }
});

it("50ms 内复用预览，尾沿只解析最新参数并通知订阅者", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const part: StreamingMessageContent = {
    type: "toolCall",
    id: "throttle",
    partialArguments: '{"command":"a',
  };
  const listener = vi.fn();
  const unsubscribe = subscribeStreamingPreviews(listener);
  const revision = streamingPreviewRevision();
  const first = streamingToolPreview(part);
  part.partialArguments = '{"command":"ab';
  expect(streamingToolPreview(part)).toBe(first);
  vi.advanceTimersByTime(49);
  part.partialArguments = '{"command":"abc';
  expect(streamingToolPreview(part)).toBe(first);
  expect(listener).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(streamingToolPreview(part)).toEqual({ command: "abc" });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(streamingPreviewRevision()).toBe(revision + 1);
  unsubscribe();
  part.partialArguments = '{"command":"abcd';
  streamingToolPreview(part);
  part.arguments = { command: "complete" };
  expect(streamingToolPreview(part)).toBeUndefined();
  vi.advanceTimersByTime(50);
  expect(
    streamingToolPreview({
      type: "toolCall",
      id: part.id,
      partialArguments: '{"command":"new generation',
    } as StreamingMessageContent),
  ).toEqual({ command: "new generation" });
  streamingToolPreview(part);
  expect(listener).toHaveBeenCalledTimes(1);
});

it("原生 freeform 补丁在首帧、尾沿和匿名预览保持 input 显示投影", () => {
  vi.useFakeTimers();
  const raw = "*** Begin Patch\n[parity-sample.txt#0063]\nPUT 2.=2:\n+gamma";
  expect(previewStreamingArgs(raw)).toEqual({});
  expect(
    streamingToolPreview({ type: "toolCall", partialArguments: raw }),
  ).toEqual({ input: raw });
  expect(
    streamingToolPreview({
      type: "toolCall",
      partialArguments: "--- parity-sample.txt\n+++ parity-sample.txt",
    }),
  ).toEqual({});
  const part: StreamingMessageContent = {
    type: "toolCall",
    id: "raw-freeform-throttle",
    partialArguments: "*** Begin Patch",
  };
  const first = streamingToolPreview(part);
  expect(first).toEqual({ input: "*** Begin Patch" });
  part.partialArguments = raw;
  expect(streamingToolPreview(part)).toBe(first);
  vi.advanceTimersByTime(50);
  expect(streamingToolPreview(part)).toEqual({ input: raw });
  vi.advanceTimersByTime(50);
  part.partialArguments += "\n*** End Patch\n";
  expect(streamingToolPreview(part)).toEqual({ input: part.partialArguments });
  part.arguments = { input: part.partialArguments };
  expect(streamingToolPreview(part)).toBeUndefined();
});

it("缓存有界，淘汰调用会取消尾沿，匿名调用不串流", () => {
  vi.useFakeTimers();
  const first: StreamingMessageContent = {
    type: "toolCall",
    id: "evicted",
    partialArguments: '{"content":"old',
  };
  streamingToolPreview(first);
  first.partialArguments += "new";
  streamingToolPreview(first);
  const listener = vi.fn();
  const unsubscribe = subscribeStreamingPreviews(listener);
  for (let index = 0; index < 128; index += 1) {
    streamingToolPreview({
      type: "toolCall",
      id: `bounded-${index}`,
      partialArguments: '{"content":"x',
    } as StreamingMessageContent);
  }
  vi.advanceTimersByTime(50);
  expect(listener).not.toHaveBeenCalled();
  expect(
    streamingToolPreview({
      type: "toolCall",
      partialArguments: '{"content":"one',
    } as StreamingMessageContent),
  ).toEqual({ content: "one" });
  expect(
    streamingToolPreview({
      type: "toolCall",
      partialArguments: '{"content":"two',
    } as StreamingMessageContent),
  ).toEqual({ content: "two" });
  unsubscribe();
});

it("真实 App 消费原生双快照帧，未结束参数没有授权目标也不请求文件预览", async () => {
  const app = await createAppFixture([]);
  vi.useFakeTimers();
  const raw = JSON.stringify({
    path: "parity-sample.txt",
    content: "alpha\nbeta\n",
  });
  const tool: MessageContent = {
    type: "toolCall",
    id: "stream-authority",
    name: "write",
    arguments: {},
  };
  const message: AgentMessage = { role: "assistant", content: [tool] };
  await app.emit({ type: "message_start", message });
  for (const [type, delta] of [
    ["toolcall_start", ""],
    ["toolcall_delta", raw],
  ] as const) {
    await app.emit({
      type: "message_update",
      message,
      assistantMessageEvent: { type, contentIndex: 0, delta, partial: message },
    });
  }
  const preview: StreamingMessageContent = {
    ...tool,
    arguments: undefined,
    partialArguments: raw,
  };
  const observed: Array<Readonly<Record<string, string>> | undefined> = [];
  const unsubscribe = subscribeStreamingPreviews(() => {
    observed.push(streamingToolPreview(preview));
  });
  try {
    // 原生 start 已缓存空参数；同一调用的 delta 必须等尾沿通知，而非绕过节流。
    expect(streamingToolPreview(preview)).toEqual({});
    expect(describeToolCall("write", preview.arguments).targets).toEqual([]);
    expect(app.previewToolFile).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(49);
    });
    expect(observed).toEqual([]);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(observed).toEqual([
      { path: "parity-sample.txt", content: "alpha\nbeta\n" },
    ]);
    expect(
      app.container.querySelector(".tool-card-output")?.textContent,
    ).toContain("alpha\nbeta\n");
    expect(app.container.querySelector(".tool-card-cursor")).not.toBeNull();
    expect(
      app.container.querySelector(
        '[data-tool-id="stream-authority"] .rich-file-link',
      ),
    ).toBeNull();
  } finally {
    unsubscribe();
  }
  expect(describeToolCall("write", preview.arguments).targets).toEqual([]);
  expect(app.previewToolFile).not.toHaveBeenCalled();
  // 在下一次尾沿之前结束调用，完成帧必须取消尚未交付的预览刷新。
  await app.emit({
    type: "message_update",
    message,
    assistantMessageEvent: {
      type: "toolcall_delta",
      contentIndex: 0,
      delta: " ",
      partial: message,
    },
  });
  const afterCompletion = vi.fn();
  const unsubscribeCompletion = subscribeStreamingPreviews(afterCompletion);
  const complete = { ...tool, arguments: JSON.parse(raw) };
  await app.emit({
    type: "message_update",
    message: { ...message, content: [complete] },
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: complete,
    },
  });
  try {
    expect(app.container.querySelector(".tool-card-cursor")).toBeNull();
    expect(
      streamingToolPreview({
        ...preview,
        partialArguments: '{"content":"fresh',
      }),
    ).toEqual({ content: "fresh" });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(afterCompletion).not.toHaveBeenCalled();
  } finally {
    unsubscribeCompletion();
    streamingToolPreview(complete);
  }
  expect(describeToolCall("write", complete.arguments).targets).toHaveLength(1);
  expect(app.previewToolFile).not.toHaveBeenCalled();
});

it("捕获形状的原生 edit raw delta 经过转录只显示补丁，end 才恢复文件目标", async () => {
  const app = await createAppFixture([]);
  vi.useFakeTimers();
  const raw = "*** Begin Patch\n[parity-sample.txt#0063]\nPUT 2.=2:\n+gamma";
  const tool: MessageContent = {
    type: "toolCall",
    id: "native-raw-edit",
    name: "edit",
    arguments: {},
  };
  const message: AgentMessage = { role: "assistant", content: [tool] };
  await app.emit({ type: "message_start", message });
  for (const [type, delta] of [
    ["toolcall_start", ""],
    ["toolcall_delta", "*** Begin Patch\n"],
    ["toolcall_delta", "[parity-sample.txt#0063]\nPUT 2.=2:\n"],
    ["toolcall_delta", "+gamma"],
  ] as const) {
    await app.emit({
      type: "message_update",
      message,
      assistantMessageEvent: { type, contentIndex: 0, delta, partial: message },
    });
    expect(app.previewToolFile).not.toHaveBeenCalled();
  }
  const preview: StreamingMessageContent = {
    ...tool,
    arguments: undefined,
    partialArguments: raw,
  };
  await act(async () => {
    vi.advanceTimersByTime(50);
  });
  expect(streamingToolPreview(preview)).toEqual({ input: raw });
  expect(preview.arguments).toBeUndefined();
  expect(describeToolCall("edit", preview.arguments).targets).toEqual([]);
  expect(app.container.querySelector(".tool-card-diff")?.textContent).toContain(
    "gamma",
  );
  expect(app.container.querySelector(".tool-card-cursor")).not.toBeNull();
  expect(
    app.container.querySelector(
      '[data-tool-id="native-raw-edit"] .rich-file-link',
    ),
  ).toBeNull();
  expect(app.previewToolFile).not.toHaveBeenCalled();
  const complete = {
    ...tool,
    arguments: { input: `${raw}\n*** End Patch\n` },
  };
  await app.emit({
    type: "message_update",
    message: { ...message, content: [complete] },
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: complete,
    },
  });
  expect(streamingToolPreview(complete)).toBeUndefined();
  expect(app.container.querySelector(".tool-card-cursor")).toBeNull();
  expect(describeToolCall("edit", complete.arguments).targets).toEqual([
    { kind: "file", label: "parity-sample.txt", path: "parity-sample.txt" },
  ]);
  expect(app.previewToolFile).not.toHaveBeenCalled();
});
