import {
  describeToolCall,
  patchMoves,
} from "../../../shared/tool-presentation";
import { messageFileHref } from "../../../shared/message-file-link";
import { FileReferenceLink } from "../FileReferenceLink";
import { ToolOutput } from "../TranscriptContent";
import { ToolRowBody, type ProcessContext } from "../TranscriptToolRow";
import type { ToolEvidence } from "../transcript-types";
import {
  cardStatus,
  diffStats,
  parseNativeDiff,
  toolDetails,
  toolDurationMs,
  toolResultText,
  type NativeDiffLine,
} from "../tool-card-model";
import { useNow } from "../use-now";
import { CardFrame, withoutResultImages } from "./CardFrame";
import { GenericCard } from "./GenericCard";

/** 读取完整参数，绝不将流式残片传入目标或文件证据解析。 */
function completeArgs(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { input: value };
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 从预览补丁提取纯文本标题，不将其用于文件证据或链接授权。 */
function pendingPath(
  args: Readonly<Record<string, string>>,
): string | undefined {
  const patch = args.input ?? args.patch ?? "";
  return (
    args.path ??
    /^\[([^\r\n]+)#[0-9a-fA-F]{4}\]\r?$/m.exec(patch)?.[1] ??
    /^\*\*\* Update File: ([^\r\n]+)/m.exec(patch)?.[1]
  );
}

/** 只展示已收到的增删源码，不展示补丁指令或推测被删除的正文。 */
function pendingLines(
  args: Readonly<Record<string, string>>,
): NativeDiffLine[] {
  const before =
    args.oldText ??
    args.old_text ??
    args.old_string ??
    args["edits.0.oldText"] ??
    args["edits.0.old_text"] ??
    args["edits.0.old_string"];
  const after =
    args.newText ??
    args.new_text ??
    args.new_string ??
    args["edits.0.newText"] ??
    args["edits.0.new_text"] ??
    args["edits.0.new_string"];
  if (before !== undefined || after !== undefined) {
    return [
      ...(before === undefined
        ? []
        : before
            .split("\n")
            .map((text): NativeDiffLine => ({ kind: "del", text }))),
      ...(after === undefined
        ? []
        : after
            .split("\n")
            .map((text): NativeDiffLine => ({ kind: "add", text }))),
    ];
  }
  return (args.input ?? args.patch ?? "")
    .split("\n")
    .flatMap((text): NativeDiffLine[] =>
      /^[+-]/.test(text)
        ? [
            {
              kind: text.startsWith("+") ? "add" : "del",
              text: text.slice(1),
            },
          ]
        : [],
    );
}

/** 显示真实增删计数。 */
function Stats({ lines }: { lines: readonly NativeDiffLine[] }) {
  const stats = diffStats(lines);
  return (
    <>
      <span className="tool-card-stat-add">+{stats.added}</span>{" "}
      <span className="tool-card-stat-del">−{stats.removed}</span>
    </>
  );
}

/** 原生差异行保留全宽背景；未完成参数不显示伪造行号。 */
function DiffRows({
  lines,
  pending = false,
}: {
  lines: readonly NativeDiffLine[];
  pending?: boolean;
}) {
  return (
    <div className="tool-card-diff">
      {pending && lines.length === 0 && (
        <span className="tool-card-cursor">▍</span>
      )}
      {lines.map((line, index) => (
        <div className="tool-card-diff-line" data-kind={line.kind} key={index}>
          {!pending && (
            <span className="tool-card-line-number">
              {line.kind === "gap" ? "" : line.line}
            </span>
          )}
          <span className="tool-card-line-text">
            {line.kind === "gap" ? (
              line.hidden === undefined ? (
                "…"
              ) : (
                `… ${line.hidden} 行未修改`
              )
            ) : (
              <>
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
                {line.text}
              </>
            )}
            {pending && index === lines.length - 1 && (
              <span className="tool-card-cursor">▍</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 取失败编辑的旧文本参数，依次尝试 old_string、old_text、edits[0].old_text 和补丁中的首段 - 行。参数：[in] args 完整参数。返回值：实际参数名与旧文本，取不到时为 undefined。 */
function failedOldText(
  args: Record<string, unknown>,
): { name: string; text: string } | undefined {
  for (const name of ["old_string", "old_text"]) {
    const value = args[name];
    if (typeof value === "string" && value) return { name, text: value };
  }
  const first = Array.isArray(args.edits) ? args.edits[0] : undefined;
  const nested =
    first && typeof first === "object"
      ? (first as Record<string, unknown>).old_text
      : undefined;
  if (typeof nested === "string" && nested)
    return { name: "old_text", text: nested };
  const patch = typeof args.input === "string" ? args.input : "";
  const removed: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    if (/^-(?!--)/.test(line)) removed.push(line.slice(1));
    else if (removed.length) break;
  }
  return removed.length ? { name: "patch", text: removed.join("\n") } : undefined;
}

/** 流式参数已接收字符数的显示文字。参数：[in] args 流式参数。返回值：如 1.2K，拿不到时为 undefined。 */
function receivedChars(
  args: Readonly<Record<string, string>>,
): string | undefined {
  const count = Object.values(args).reduce(
    (sum, value) => sum + (typeof value === "string" ? value.length : 0),
    0,
  );
  if (!count) return undefined;
  return count >= 1000 ? `${(count / 1000).toFixed(1)}K` : String(count);
}

/** 编辑卡将生成中正文切换为原生结果差异，保留外部控制的展开状态。 */
export function EditCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const details = toolDetails(tool);
  const expanded = context.expanded[tool.id] !== undefined;
  const pending = status === "running" && tool.streamingArgs !== undefined;
  const args = completeArgs(tool.args);
  const description = describeToolCall(tool.name, tool.args);
  const target = description.targets.find((item) => item.kind === "file");
  const path =
    typeof details.path === "string"
      ? details.path
      : (target?.path ??
        (typeof args.path === "string" && args.path.startsWith("local://")
          ? args.path
          : undefined));
  const patch =
    typeof args.input === "string"
      ? args.input
      : typeof args.patch === "string"
        ? args.patch
        : "";
  const moves = patchMoves(patch);
  const failure = status === "error" || details.errorKind !== undefined;
  const multi = details.perFileResults;
  if (
    !pending &&
    !failure &&
    multi !== undefined &&
    (!Array.isArray(multi) ||
      multi.some(
        (item) =>
          !item ||
          typeof item !== "object" ||
          typeof item.path !== "string" ||
          typeof item.diff !== "string",
      ))
  )
    return <GenericCard tool={tool} context={context} />;
  if (
    !pending &&
    !failure &&
    details.diff !== undefined &&
    typeof details.diff !== "string"
  )
    return <GenericCard tool={tool} context={context} />;
  const sections: { path?: string; lines: NativeDiffLine[] }[] = pending
    ? [{ lines: pendingLines(tool.streamingArgs!) }]
    : Array.isArray(multi) && multi.length
      ? multi.map((item: { path: string; diff: string }) => ({
          path: item.path,
          lines: parseNativeDiff(item.diff),
        }))
      : typeof details.diff === "string" && details.diff.length
        ? [{ path, lines: parseNativeDiff(details.diff) }]
        : [];
  const perFile = !pending && Array.isArray(multi) && multi.length > 0;
  const limit = perFile ? 15 : 30;
  const total = sections.reduce(
    (sum, section) => sum + section.lines.length,
    0,
  );
  const truncated = sections.some((section) => section.lines.length > limit);
  const oldText = failure ? failedOldText(args) : undefined;
  const received = pending ? receivedChars(tool.streamingArgs!) : undefined;
  return (
    <CardFrame
      toolId={tool.id}
      kind="edit"
      status={failure ? "error" : status}
      title={
        <>
          <strong>{moves.length ? "移动" : "编辑"}</strong>{" "}
          {pending ? (
            <code>{pendingPath(tool.streamingArgs!) ?? tool.name}</code>
          ) : moves.length ? (
            moves.map((move, index) => (
              <span key={index}>
                <FileReferenceLink href={messageFileHref(move.from)}>
                  {move.from}
                </FileReferenceLink>
                {" → "}
                <FileReferenceLink href={messageFileHref(move.to)}>
                  {move.to}
                </FileReferenceLink>
                {index < moves.length - 1 ? " · " : ""}
              </span>
            ))
          ) : path?.startsWith("local://") ? (
            <code>{path}</code>
          ) : path ? (
            <FileReferenceLink href={messageFileHref(path)}>
              {path}
            </FileReferenceLink>
          ) : (
            <code>
              {pending ? (tool.streamingArgs?.path ?? tool.name) : tool.name}
            </code>
          )}
          {path?.startsWith("local://") && (
            <span className="tool-card-chip">会话笔记</span>
          )}
        </>
      }
      meta={
        !pending && !failure && sections.length ? (
          <Stats lines={sections.flatMap((section) => section.lines)} />
        ) : undefined
      }
      statusText={
        pending ? "生成中" : status === "running" ? "应用中" : undefined
      }
      durationMs={toolDurationMs(tool, now)}
      expand={{ expanded, onToggle: () => context.toggle(tool.id, 0) }}
      footer={
        failure ? undefined : pending ? (
          `无行号${received ? ` · 已接收 ${received} 字符` : ""}`
        ) : truncated ? (
          <>
            共 {total} 行 ·{" "}
            <button type="button" onClick={() => context.toggle(tool.id, 0)}>
              {expanded ? "收起" : "展开全部"}
            </button>
          </>
        ) : undefined
      }
      output={
        failure ? (
          <>
            <ToolOutput
              result={{
                content: [{ type: "text", text: toolResultText(tool) }],
              }}
              executable={false}
            />
            {details.errorKind !== undefined && (
              <p className="tool-card-muted">
                errorKind:{" "}
                {typeof details.errorKind === "string"
                  ? details.errorKind
                  : JSON.stringify(details.errorKind)}
              </p>
            )}
            <p className="tool-card-muted">文件未改动</p>
          </>
        ) : undefined
      }
    >
      {failure ? (
        oldText ? (
          <>
            <div className="tool-card-muted tool-card-code-label">
              {oldText.name}
            </div>
            <pre className="tool-card-old-text">
              {oldText.text.split("\n").slice(0, 3).join("\n")}
            </pre>
          </>
        ) : undefined
      ) : sections.length ? (
        sections.map((section, index) => (
          <div key={index}>
            {perFile && (
              <div className="tool-card-row">
                <FileReferenceLink href={messageFileHref(section.path!)}>
                  {section.path}
                </FileReferenceLink>
                <Stats lines={section.lines} />
              </div>
            )}
            <DiffRows
              lines={expanded ? section.lines : section.lines.slice(0, limit)}
              pending={pending}
            />
          </div>
        ))
      ) : (
        <ToolRowBody
          tool={{
            ...tool,
            resultMessage: withoutResultImages(tool.resultMessage),
            live: tool.live
              ? { ...tool.live, result: withoutResultImages(tool.live.result) }
              : undefined,
          }}
          target={target}
          context={context}
        />
      )}
    </CardFrame>
  );
}
