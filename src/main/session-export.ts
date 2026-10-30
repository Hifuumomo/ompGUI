import type { AgentMessage } from "../shared/protocol";

/**
 * 导出当前分支的用户提示词与每轮最终回答，不复制内部执行过程。
 * 调用方必须先用独立 SessionReader 还原活动父链；本函数不读写会话或剪贴板。
 * 原生 stop 才是明确最终边界；缺少 stopReason 的旧记录仅保留该轮最后的纯文本回答。
 */
export function sessionMainContent(messages: readonly AgentMessage[]): string {
  const parts: string[] = [];
  let finalText: string | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      if (finalText !== undefined) parts.push(`## Assistant\n\n${finalText}`);
      finalText = undefined;
      const content = message.content;
      const prompt = typeof content === "string"
        ? content
        : content?.filter((block) => block.type === "text")
          .map((block) => block.text ?? "").join("\n") ?? "";
      if (prompt.trim()) parts.push(`## User\n\n${prompt}`);
      continue;
    }
    if (message.role === "toolResult") {
      finalText = undefined;
      continue;
    }
    if (message.role !== "assistant") continue;
    // 新的 assistant 记录替代同轮候选；失败或工具调用绝不遗留旧 commentary。
    finalText = undefined;
    const content = message.content;
    if (
      (message.stopReason !== undefined && message.stopReason !== "stop") ||
      (Array.isArray(content) && content.some((block) => block.type === "toolCall"))
    ) continue;
    const answer = typeof content === "string"
      ? content
      : content?.filter((block) => block.type === "text")
        .map((block) => block.text ?? "").join("\n") ?? "";
    if (answer.trim()) finalText = answer;
  }
  if (finalText !== undefined) parts.push(`## Assistant\n\n${finalText}`);
  return parts.join("\n\n");
}
