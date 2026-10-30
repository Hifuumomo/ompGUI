import { useContext, useId, useMemo, useState, type ReactNode } from "react";
import type { AgentMessage, MessageContent } from "../../shared/protocol";
import { messageFileHref } from "../../shared/message-file-link";
import { splitHeadTail } from "./inline-detail-limits";
import { FileReferenceLink, SafeLink } from "./FileReferenceLink";
import { MessageFileLinks } from "./MessageFileLinks";
import { WebLinks } from "./WebLinks";
import {
  outputPaths,
  parseOutput,
  useExistingFiles,
  type OutputMode,
} from "./output-file-links";
import { RichContent } from "./RichContent";
import type { PlanApprovalPresentation } from "./plan-approval";
import { planApprovalPresentation } from "./plan-approval";
import { parsePlanStatus } from "./plan-status";
import { PlanStatusCard } from "./PlanStatusCard";
import { ThinkingContent } from "./ThinkingContent";
import {
  isAgentMessage,
  isBackgroundOutput,
  TranscriptNotice,
} from "./TranscriptNotice";
import { readable } from "./session";
import { NativeImage } from "./TranscriptNativeImage";
import { FileReviewSource } from "./FileReviewContent";
import { NativeReadContent, readDisplayContent } from "./NativeReadContent";
import {
  hasSpecialRoleContent,
  specialRoleContent,
} from "./TranscriptRoleContent";

export { NativeImage } from "./TranscriptNativeImage";

export const roleLabels: Record<string, string> = {
  user: "用户消息",
  developer: "开发者消息",
  assistant: "助手消息",
  toolResult: "工具结果",
  bashExecution: "Bash 执行",
  pythonExecution: "Python 执行",
  branchSummary: "分支摘要",
  compactionSummary: "上下文压缩摘要",
  fileMention: "文件引用",
  custom: "自定义消息",
  hookMessage: "钩子消息",
};

/** 解析输出并渲染链接：路径只有确认存在且有打开入口时才成为链接，确认前和失败时保持纯文本；网址交给 WebLinks。[in] texts：当前可见的输出段，合并为一次存在性确认；[in] mode：输出类型。返回值：与 texts 一一对应的节点。 */
function useOutputLinks(texts: readonly string[], mode: OutputMode): ReactNode[] {
  const openFile = useContext(MessageFileLinks);
  const openWeb = useContext(WebLinks);
  const key = texts.join("\u0000");
  const parsed = useMemo(
    () => texts.map((text) => parseOutput(text, mode)),
    [key, mode],
  );
  const candidates = useMemo(
    () => (openFile ? outputPaths(parsed.flat()) : []),
    [parsed, openFile],
  );
  const found = useExistingFiles(candidates);
  return parsed.map((pieces) =>
    pieces.map((piece, index) => {
      if (piece.path !== undefined && openFile && found.has(piece.path))
        return (
          <FileReferenceLink key={index} href={messageFileHref(piece.path)}>
            {piece.text}
          </FileReferenceLink>
        );
      if (piece.url !== undefined && openWeb)
        return (
          <SafeLink key={index} href={piece.url}>
            {piece.text}
          </SafeLink>
        );
      if (piece.location)
        return (
          <span key={index} className="inline-output-location">
            {piece.text}
          </span>
        );
      return piece.text;
    }),
  );
}

/** grep/glob 结果：按行识别 路径[:行[:列]]，路径部分为文件链接，行列号用次要色。[in] text：完整结果。返回值：结果节点。 */
function SearchOutput({ text }: { text: string }) {
  const [nodes] = useOutputLinks([text], "search");
  return <pre className="inline-search-output">{nodes}</pre>;
}

/** 执行输出按行数折叠中间部分：总行数超过预览行数时只渲染首尾，截断仅在渲染层，text 保持完整。[in] text：完整输出。返回值：输出节点。 */
export function ExecutableOutput({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const { head, tail, omitted } = splitHeadTail(text);
  const visible = omitted === 0 || expanded ? [text] : [head, tail];
  const [first, second] = useOutputLinks(visible, "shell");
  if (omitted === 0 || expanded)
    return (
      <pre id={id} data-output-expanded={omitted > 0 ? "true" : undefined}>
        {first}
      </pre>
    );
  return (
    <div id={id}>
      <pre>{first}</pre>
      <button
        type="button"
        className="inline-output-omitted"
        aria-controls={id}
        aria-expanded={false}
        onClick={() => setExpanded(true)}
      >
        ··· 省略中间 {omitted} 行 · 展开 ···
      </button>
      <pre>{second}</pre>
    </div>
  );
}

/** 显示真实内容块，输出模式不解释文本为 Markdown。[in] part：内容；[in] plain：是否为执行输出。返回值：内容节点。 */
export function ContentPart({
  part,
  plain = false,
}: {
  part: MessageContent;
  plain?: boolean;
}) {
  if (part.type === "image")
    return <NativeImage image={part} label="原生会话图片" />;
  if (part.type === "text")
    return plain ? (
      <ExecutableOutput text={part.text ?? ""} />
    ) : (
      <RichContent text={part.text ?? ""} />
    );
  if (part.type === "thinking") {
    if (!(part.thinking ?? part.text ?? "").trim()) return null;
    return (
      <ThinkingContent text={part.thinking ?? part.text ?? ""} />
    );
  }
  return (
    <details className="transcript-evidence" open>
      <summary>未识别内容块 · {part.type}</summary>
      <pre>{readable(part)}</pre>
    </details>
  );
}

interface OutputOptions {
  /** grep/glob 类搜索结果：按行识别文件位置。 */
  search?: boolean;
  executable: boolean;
  path?: string;
  wrap?: boolean;
  fileRead?: boolean;
  /** 文件正文只渲染前若干行，原始结果不变。 */
  maxLines?: number;
}

const UNNUMBERED_READ_LINES: ReadonlyArray<number | null> = Object.freeze([]);

/** 文件与执行输出保留字面内容，普通工具正文支持 Markdown。 */
function OutputText({
  text,
  options,
}: {
  text: string;
  options: OutputOptions;
}) {
  if (text === "")
    return (
      <p className="muted">{options.path ? "文件内容为空" : "输出为空"}</p>
    );
  if (options.path !== undefined)
    return (
      <FileReviewSource
        content={text}
        path={options.path}
        wrap={options.wrap}
        maxLines={options.maxLines}
        // 缺少独立展示正文时保留原生文本中的编号，不再叠加推测行号。
        lineNumbers={options.fileRead ? UNNUMBERED_READ_LINES : undefined}
      />
    );
  return options.executable ? (
    <ExecutableOutput text={text} />
  ) : (
    options.search ? (
      <SearchOutput text={text} />
    ) : (
      <RichContent text={text} />
    )
  );
}

function OutputPart({
  part,
  options,
}: {
  part: MessageContent;
  options: OutputOptions;
}) {
  if (part.type === "text")
    return <OutputText text={part.text ?? ""} options={options} />;
  return <ContentPart part={part} plain={options.executable} />;
}

/** 原生读取以独立展示正文取代面向模型的带编号文本。 */
function OutputBody({
  payload,
  options,
}: {
  payload: Record<string, unknown>;
  options: OutputOptions;
}) {
  const content = payload.content;
  const display = options.fileRead ? readDisplayContent(payload) : undefined;
  return (
    <>
      {display && options.path !== undefined && (
        <NativeReadContent
          display={display}
          path={options.path}
          wrap={options.wrap}
          maxLines={options.maxLines}
          original={content}
        />
      )}
      {!display && typeof content === "string" && (
        <OutputText text={content} options={options} />
      )}
      {!display &&
        Array.isArray(content) &&
        content.length === 0 &&
        payload.structuredContent === undefined && (
          <OutputText text="" options={options} />
        )}
      {Array.isArray(content) &&
        content.map((part: MessageContent, index: number) =>
          display && part.type === "text" ? null : (
            <OutputPart key={index} part={part} options={options} />
          ),
        )}
    </>
  );
}

/** 呈现工具正文、原生图片、错误及结构化数据。 */
function ToolOutputContent({
  payload,
  options,
}: {
  payload: Record<string, unknown>;
  options: OutputOptions;
}) {
  return (
    <>
      <OutputBody payload={payload} options={options} />
      {typeof payload.output === "string" && (
        <OutputText text={payload.output} options={options} />
      )}
      {Array.isArray(payload.images) &&
        payload.images.map((image: MessageContent, index: number) => (
          <NativeImage key={index} image={image} label="工具输出图片" />
        ))}
      {typeof payload.errorMessage === "string" && (
        <p className="inline-error" role="alert">
          {payload.errorMessage}
        </p>
      )}
      {payload.structuredContent !== undefined && (
        <pre>{readable(payload.structuredContent)}</pre>
      )}
    </>
  );
}

/** 仅呈现真实工具正文；协议字段和完整调用封装不进入会话阅读区。 */
export function ToolOutput({
  result,
  executable,
  path,
  wrap,
  fileRead,
  maxLines,
  search,
}: { result: unknown } & OutputOptions) {
  const options = { executable, path, wrap, fileRead, maxLines, search };
  if (typeof result === "string")
    return <OutputText text={result} options={options} />;
  if (result === null || typeof result !== "object")
    return <pre>{readable(result)}</pre>;
  const payload = result as Record<string, unknown>;
  const hasBody =
    typeof payload.content === "string" ||
    Array.isArray(payload.content) ||
    typeof payload.output === "string" ||
    (Array.isArray(payload.images) && payload.images.length > 0) ||
    typeof payload.errorMessage === "string";
  if (hasBody) return <ToolOutputContent payload={payload} options={options} />;
  if (payload.structuredContent !== undefined)
    return <pre>{readable(payload.structuredContent)}</pre>;
  if (payload.role === "toolResult" || typeof payload.toolCallId === "string")
    return <p className="muted">未记录输出</p>;
  return <pre>{readable(result)}</pre>;
}

/** 读取原生角色正文。[in] message：原生消息。返回值：独立角色载荷或通用 content；缺少正文时为 undefined。 */
function messageContent(message: AgentMessage) {
  if (hasSpecialRoleContent(message.role)) return specialRoleContent(message);
  if (message.role === "custom" && message.customType === "ompgui-seance" && typeof message.content === "string") {
    // 原生 task 用 XML 信封传输报告；只解包明确的外层，不启用任意 HTML 渲染。
    const report = /^<task-result\b[^>]*>[\s\S]*?<output>\s*\n?([\s\S]*)\s*<\/output>\s*<\/task-result>\s*$/.exec(message.content);
    const details = message.details;
    const source = details && typeof details === "object" && "sourceSession" in details && typeof details.sourceSession === "string"
      ? details.sourceSession : undefined;
    const model = details && typeof details === "object" && "model" in details && typeof details.model === "string"
      ? details.model : undefined;
    return <section aria-label="历史会话咨询">
      <h3>历史会话咨询 · /seance</h3>
      {source && <p className="muted" style={{ overflowWrap: "anywhere" }}>{source}{model ? ` · ${model}` : ""}</p>}
      {report ? <RichContent text={report[1].trim()} /> : <pre>{message.content}</pre>}
    </section>;
  }
  if (typeof message.content === "string")
    return <RichContent text={message.content} />;
  if (Array.isArray(message.content))
    return message.content.map((part, index) => (
      <ContentPart key={index} part={part} />
    ));
  return undefined;
}

/** 保留钩子消息的独立扩展证据。[in] message：原生消息；[in] hasBody：是否已有可读正文。返回值：角色证据节点或 undefined。 */
function extensionEvidence(message: AgentMessage, hasBody: boolean) {
  if (!hasBody || message.role !== "hookMessage") return undefined;
  return (
    <details className="transcript-evidence">
      <summary>钩子消息证据</summary>
      <pre>{readable(message)}</pre>
    </details>
  );
}

/** 显示原生各角色载荷，不附加普遍原始消息按钮。[in] message：原生消息。返回值：完整可读载荷。 */
export function MessageBody({
  message,
  planApproval,
}: {
  message: AgentMessage;
  planApproval?: PlanApprovalPresentation | null;
}) {
  if (message.display === false) return null;
  if (message.role === "custom" && message.customType === "ompgui-plan-status") {
    const record = parsePlanStatus(message);
    return record ? <PlanStatusCard record={record} timestamp={message.timestamp} /> : null;
  }
  if (isBackgroundOutput(message)) {
    return (
      <TranscriptNotice message={message}>
        {typeof message.content === "string" ? (
          <ExecutableOutput text={message.content} />
        ) : (
          message.content?.map((part, index) => (
            <ContentPart key={index} part={part} plain />
          ))
        )}
      </TranscriptNotice>
    );
  }
  if (isAgentMessage(message)) {
    return (
      <TranscriptNotice message={message}>
        {messageContent(message)}
      </TranscriptNotice>
    );
  }
  const approval = planApproval === undefined
    ? planApprovalPresentation(message)
    : planApproval;
  if (approval?.kind === "approved")
    return <PlanStatusCard path={approval.path} markdown={approval.markdown} timestamp={message.timestamp} defaultExpanded />;
  const body = approval?.kind === "raw" ? (
    <pre>{approval.text}</pre>
  ) : messageContent(message);
  return (
    <>
      {body}
      {extensionEvidence(message, body !== undefined)}
      {((body === undefined &&
        !message.errorMessage &&
        message.stopReason !== "error") ||
        !Object.hasOwn(roleLabels, message.role)) && (
        <details className="transcript-evidence" open>
          <summary>未识别原生消息 · {message.role}</summary>
          <pre>{readable(message)}</pre>
        </details>
      )}
      {message.errorMessage && (
        <p className="inline-error" role="alert">
          {message.errorMessage}
        </p>
      )}
      {message.stopReason === "aborted" && <p className="muted">已取消生成</p>}
      {message.stopReason === "error" && !message.errorMessage && (
        <p className="inline-error">生成错误</p>
      )}
    </>
  );
}
