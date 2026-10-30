// @vitest-environment node
// 原生帧契约：https://github.com/can1357/oh-my-pi/blob/v18.8.9/docs/rpc.md（Events / Side questions / Transport）。
import { describe, expect, it } from "vitest";
import type {
  AgentMessage,
  BtwRecord,
  RpcFrame,
  SessionState,
} from "../../shared/protocol";
import {
  initialSession,
  messageText,
  sessionReducer,
  type SessionView,
} from "./session";

/** 应用有序原生事件。参数：[in] view 初始视图；[in] frames 原生 RPC 帧。返回值：最后一帧后的视图。 */
function applyFrames(view: SessionView, ...frames: RpcFrame[]): SessionView {
  let next = view;
  for (const frame of frames)
    next = sessionReducer(next, { type: "frame", frame });
  return next;
}

/** 读取用户可见消息文本。参数：[in] view 当前会话视图。返回值：按显示顺序排列的消息文本。 */
function transcript(view: SessionView): string[] {
  const texts: string[] = [];
  for (const item of view.messages) texts.push(messageText(item.message));
  return texts;
}

/** 注册会话消费者可见的状态迁移回归。参数：无。返回值：无。 */
function sessionTransitions() {
  /** 验证完整快照替换流式回复且终帧不重复提交。参数：无。返回值：无。 */
  function assistantSnapshots() {
    const partial: AgentMessage = {
      role: "assistant",
      content: [{ type: "text", text: "答案" }],
      timestamp: 10,
    };
    const expanded: AgentMessage = {
      ...partial,
      content: [
        { type: "thinking", thinking: "先检查条件" },
        { type: "text", text: "答案是 42" },
      ],
    };
    const final: AgentMessage = {
      ...expanded,
      content: [
        { type: "thinking", thinking: "先检查条件" },
        { type: "text", text: "答案是 42。" },
      ],
      stopReason: "stop",
    };
    let view = applyFrames(
      initialSession,
      {
        type: "message_start",
        messageId: "user-1",
        message: { role: "user", content: "计算结果？" },
      },
      {
        type: "message_end",
        messageId: "user-1",
        message: { role: "user", content: "计算结果？" },
      },
      { type: "message_start", messageId: "reply-1", message: partial },
      {
        type: "message_update",
        messageId: "reply-1",
        message: expanded,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 1,
          delta: "是 42",
          partial: expanded,
        },
      },
    );
    expect(transcript(view)).toEqual(["计算结果？", "先检查条件\n答案是 42"]);
    expect(view.messages[1].streaming).toBe(true);
    expect(view.messages[1].message.content).toEqual(expanded.content);

    // 原生 RPC 为插入消息分配独立 ID，不能让它抢走正在流式输出的回复。
    view = applyFrames(
      view,
      {
        type: "message_end",
        messageId: "notice-1",
        message: { role: "custom", content: "旁路通知" },
      },
      {
        type: "message_update",
        messageId: "reply-1",
        message: final,
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 1,
          delta: ".",
          partial: final,
        },
      },
    );
    expect(transcript(view)).toEqual([
      "计算结果？",
      "先检查条件\n答案是 42。",
      "旁路通知",
    ]);
    expect(view.messages[1].streaming).toBe(true);
    view = applyFrames(view, {
      type: "message_end",
      messageId: "reply-1",
      message: final,
    });
    expect(transcript(view)).toEqual([
      "计算结果？",
      "先检查条件\n答案是 42。",
      "旁路通知",
    ]);
    expect(view.messages).toHaveLength(3);
    expect(view.messages[1].streaming).toBe(false);
    expect(view.activeMessage).toBeUndefined();
    view = applyFrames(view, {
      type: "agent_end",
      messages: [final],
      isTerminal: true,
    });
    expect(view.messages).toHaveLength(3);
    expect(view.messages[1].streaming).toBe(false);
    expect(view.activeMessage).toBeUndefined();
  }
  it(
    "完整助手快照替换同一流式消息，message_end 只保留一个最终回复",
    assistantSnapshots,
  );

  /** 验证压缩终帧保留此前已交付的整个 transcript。参数：[in] retainSuffix 是否在终帧保留最后一条消息。返回值：无。 */
  function compactedAgentEnd(retainSuffix: boolean) {
    const user: AgentMessage = { role: "user", content: "读取文件" };
    const call: AgentMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "read-1",
          name: "read",
          arguments: { path: "notes.txt" },
        },
      ],
    };
    const result: AgentMessage = {
      role: "toolResult",
      toolCallId: "read-1",
      toolName: "read",
      content: "文件正文",
    };
    const answer: AgentMessage = {
      role: "assistant",
      content: "已经读取文件正文。",
    };
    const delivered = applyFrames(
      initialSession,
      { type: "message_end", messageId: "user-1", message: user },
      { type: "message_end", messageId: "call-1", message: call },
      { type: "message_end", messageId: "result-1", message: result },
      { type: "message_end", messageId: "answer-1", message: answer },
    );
    // v18.8.9 docs/rpc.md：超限 agent_end 移除已交付的前缀，或降为带 messageCount 的空数组。
    const ended = applyFrames(delivered, {
      type: "agent_end",
      messages: retainSuffix ? [answer] : [],
      messageCount: 4,
      isTerminal: true,
    });
    expect(transcript(ended)).toEqual([
      "读取文件",
      "",
      "文件正文",
      "已经读取文件正文。",
    ]);
    expect(ended.messages).toEqual(delivered.messages);
    expect(ended.messages).toHaveLength(4);
  }
  it.each([true, false])(
    "压缩 agent_end 不丢失已交付的用户、工具和助手消息（保留末条：%s）",
    compactedAgentEnd,
  );

  /** 验证 BTW 增量进入最新追问，终态完整记录替换而非重复追加。参数：无。返回值：无。 */
  function btwFollowUp() {
    const record: BtwRecord = {
      id: "topic-1",
      leafId: "branch-1",
      question: "为什么？",
      answer: "根问题答案",
      status: "complete",
      createdAt: 1,
      updatedAt: 2,
      followUps: [
        {
          question: "举个例子",
          answer: "先前追问答案",
          status: "complete",
          createdAt: 3,
          updatedAt: 4,
        },
        {
          question: "还有呢？",
          answer: "",
          status: "running",
          createdAt: 5,
          updatedAt: 5,
        },
      ],
    };
    const other: BtwRecord = {
      id: "topic-2",
      leafId: "branch-1",
      question: "另一主题",
      answer: "不变",
      status: "complete",
      createdAt: 6,
      updatedAt: 6,
    };
    let view = applyFrames(
      initialSession,
      { type: "btw_record", record: other },
      { type: "btw_record", record },
      { type: "btw_delta", recordId: record.id, delta: "最新" },
      { type: "btw_delta", recordId: record.id, delta: "追问答案" },
    );
    expect(view.records[0].answer).toBe("根问题答案");
    expect(view.records[0].followUps).toEqual([
      record.followUps![0],
      { ...record.followUps![1], answer: "最新追问答案" },
    ]);
    expect(view.records[1]).toEqual(other);
    expect(record.followUps![1].answer).toBe("");

    // BTW 生命周期帧带完整 record；它的最后一轮是末个 followUps，而不是根问题。
    const terminal: BtwRecord = {
      ...record,
      updatedAt: 7,
      followUps: [
        record.followUps![0],
        {
          ...record.followUps![1],
          answer: "最新追问答案。",
          status: "complete",
          updatedAt: 7,
        },
      ],
    };
    view = applyFrames(view, { type: "btw_record", record: terminal });
    expect(view.records).toEqual([terminal, other]);
    expect(view.records[0].followUps).toHaveLength(2);
    expect(view.records[0].followUps![1].answer).toBe("最新追问答案。");
    expect(view.messages).toEqual([]);
  }
  it(
    "BTW delta 追加到最后一个追问，终态快照不重复主题、轮次或文本",
    btwFollowUp,
  );

  /** 验证切换会话时旧分支的聊天、BTW 和工具全部清除。参数：无。返回值：无。 */
  function resetSession() {
    const oldState: SessionState = {
      sessionId: "old-branch",
      isStreaming: true,
      isCompacting: false,
      messageCount: 1,
      queuedMessageCount: 0,
    };
    const oldRecord: BtwRecord = {
      id: "old-topic",
      leafId: "old-branch",
      question: "旧问题",
      answer: "旧答案",
      status: "complete",
      createdAt: 1,
      updatedAt: 2,
    };
    let view = sessionReducer(initialSession, {
      type: "history",
      state: oldState,
      messages: [{ role: "user", content: "旧分支问题" }],
      records: [oldRecord],
    });
    view = applyFrames(
      view,
      {
        type: "message_start",
        messageId: "old-reply",
        message: { role: "assistant", content: "旧分支尚未完成的回复" },
      },
      {
        type: "tool_execution_start",
        toolCallId: "old-tool",
        toolName: "read",
        args: { path: "old.txt" },
      },
      {
        type: "tool_execution_update",
        toolCallId: "old-tool",
        partialResult: { content: [{ type: "text", text: "旧工具输出" }] },
      },
    );
    expect(view.messages).toHaveLength(2);
    expect(view.records).toHaveLength(1);
    expect(view.tools[0].running).toBe(true);
    expect(view.tools[0].result).toEqual({
      content: [{ type: "text", text: "旧工具输出" }],
    });
    expect(view.activeMessage).toBeDefined();

    view = sessionReducer(view, { type: "reset" });
    expect(transcript(view)).toEqual([]);
    expect(view.records).toEqual([]);
    expect(view.tools).toEqual([]);
    expect(view.activeMessage).toBeUndefined();
    expect(view.state).toBeUndefined();
    expect(view.busy).toBe(false);

    // 新历史不附带 BTW 时也不得继承旧主题；新消息不能复用旧流式回复的位置。
    const newState: SessionState = {
      ...oldState,
      sessionId: "new-branch",
      isStreaming: false,
    };
    view = sessionReducer(view, {
      type: "history",
      state: newState,
      messages: [{ role: "user", content: "新分支问题" }],
    });
    view = applyFrames(view, {
      type: "message_end",
      messageId: "new-reply",
      message: { role: "assistant", content: "新分支答案" },
    });
    expect(transcript(view)).toEqual(["新分支问题", "新分支答案"]);
    expect(view.state?.sessionId).toBe("new-branch");
    expect(view.records).toEqual([]);
    expect(view.tools).toEqual([]);
  }
  it(
    "reset 丢弃旧会话 transcript、BTW、工具和活跃回复，新分支不继承旧内容",
    resetSession,
  );

  /** 验证日志错误不改变连接或聊天，普通通知不覆盖错误，既有状态更新可清除错误。参数：无。返回值：无。 */
  function logErrorTransitions() {
    const connected = applyFrames(
      initialSession,
      { type: "desktop_status", status: "connected" },
      {
        type: "message_end",
        messageId: "existing-message",
        message: { role: "user", content: "保留当前会话" },
      },
    );
    const notified = applyFrames(connected, {
      type: "notice",
      message: "普通通知",
    });
    expect(notified.error).toBeUndefined();
    const rejected = applyFrames(notified, {
      type: "response",
      command: "tree",
      success: false,
      error: "原生命令拒绝",
    });
    expect(rejected.error).toBeDefined();
    expect(rejected.connection).toBe("connected");
    expect(rejected.messages).toBe(connected.messages);
    expect(rejected.busy).toBe(connected.busy);
    const continued = applyFrames(
      rejected,
      { type: "notice", message: "后续普通通知" },
      { type: "command_output", command: "help", text: "正常命令结果" },
    );
    expect(continued.error).toBe(rejected.error);
    expect(continued.connection).toBe("connected");
    const nativeError = applyFrames(continued, {
      type: "rpc_frame_error",
      message: "原生事件失败",
    });
    expect(nativeError.error).not.toBe(rejected.error);
    expect(nativeError.connection).toBe("connected");
    const reported = sessionReducer(nativeError, {
      type: "log",
      text: "调用失败",
      error: true,
    });
    const recovered = applyFrames(reported, {
      type: "desktop_status",
      status: "connected",
    });
    expect(recovered.error).toBeUndefined();
    expect(sessionReducer(reported, { type: "reset" }).error).toBeUndefined();
  }
  it(
    "真实错误进入现有错误状态但不伪造断连，普通通知保留错误，状态恢复及重置清除错误",
    logErrorTransitions,
  );
}

describe("原生会话状态迁移", sessionTransitions);
