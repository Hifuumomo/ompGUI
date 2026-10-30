import type { AgentMessage } from "../../shared/protocol";
import { RichContent } from "./RichContent";
import { NativeImage } from "./TranscriptNativeImage";

/** 读取执行角色状态。[in] message：原生执行消息。返回值：取消、错误或执行记录标签。 */
function executionStatus(message: AgentMessage): string {
  if (message.cancelled) return "已取消";
  if (message.exitCode !== undefined && message.exitCode !== 0)
    return "执行错误";
  return "执行记录";
}

/** 呈现执行角色的源代码、输出和图片。[in] message：原生执行消息。返回值：执行证据节点；缺少原生源代码或输出时为 undefined。 */
function ExecutionBody({ message }: { message: AgentMessage }) {
  const source =
    message.role === "bashExecution" ? message.command : message.code;
  if (typeof source !== "string" || typeof message.output !== "string")
    return undefined;
  return (
    <details className="transcript-evidence">
      <summary>
        {message.role === "bashExecution" ? "命令" : "Python 代码"} ·{" "}
        {executionStatus(message)} · 退出码 {message.exitCode ?? "未提供"}
        {message.truncated && " · 输出已截断"}
      </summary>
      <pre>{source}</pre>
      <h4>执行输出</h4>
      <pre>{message.output}</pre>
      {message.images?.map((image, index) => (
        <NativeImage key={index} image={image} label="执行图片" />
      ))}
    </details>
  );
}

/** 呈现文件引用角色保留的原生内容。[in] message：原生文件引用消息。返回值：文件内容节点；缺少原生文件数组时为 undefined。 */
function fileMentions(message: AgentMessage) {
  if (!Array.isArray(message.files)) return undefined;
  return message.files.map((file, index) => (
    <details className="transcript-evidence" key={index}>
      <summary>
        文件引用 · {file.path}
        {file.skippedReason && ` · 原生读取已跳过：${file.skippedReason}`}
      </summary>
      <pre>{file.content}</pre>
      {file.image && (
        <NativeImage image={file.image} label={`文件图片：${file.path}`} />
      )}
    </details>
  ));
}

/** 读取独立角色的真实正文。[in] message：原生消息。返回值：独立角色节点；缺少对应载荷或角色不适用时为 undefined。 */
export function specialRoleContent(message: AgentMessage) {
  if (message.role === "bashExecution" || message.role === "pythonExecution")
    return ExecutionBody({ message });
  if (message.role === "compactionSummary")
    return typeof message.summary === "string" ? (
      <details className="transcript-evidence compaction-notice">
        <summary>上下文压缩</summary>
        <RichContent text={message.summary} />
      </details>
    ) : undefined;
  if (message.role === "branchSummary")
    return typeof message.summary === "string" ? (
      <RichContent text={message.summary} />
    ) : undefined;
  if (message.role === "fileMention") return fileMentions(message);
  return undefined;
}

/** 判断是否具有独立角色正文契约。[in] role：原生角色。返回值：是否禁止使用通用 content 代替独立载荷。 */
export function hasSpecialRoleContent(role: string): boolean {
  return [
    "bashExecution",
    "pythonExecution",
    "branchSummary",
    "compactionSummary",
    "fileMention",
  ].includes(role);
}
