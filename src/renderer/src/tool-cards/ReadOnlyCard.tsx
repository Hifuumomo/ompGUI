import { useRef, useState, type KeyboardEvent } from "react";
import {
  describeToolCall,
  toolOperation,
} from "../../../shared/tool-presentation";
import type { ProcessItem, ToolEvidence } from "../transcript-types";
import { ToolTargetButton } from "../TranscriptToolTargets";
import { ToolRowBody, type ProcessContext } from "../TranscriptToolRow";
import { RichContent } from "../RichContent";
import {
  cardStatus,
  toolDetails,
  toolResultText,
  virtualScheme,
  type VirtualScheme,
} from "../tool-card-model";
import { CardFrame, ToolResultImages, withoutResultImages } from "./CardFrame";
import { GenericCard } from "./GenericCard";

const resourceLabels: Partial<Record<VirtualScheme, string>> = {
  local: "会话笔记",
  artifact: "已保存输出",
  history: "会话记录",
  http: "网页",
  https: "网页",
  omp: "omp 文档",
  cfg: "配置",
  ssh: "SSH",
  xd: "工具说明",
  attachment: "附件",
};

/** 仅解析完整原生参数，不把流式字符串补齐为文件目标。 */
function argumentsObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 只接受原生非负有限数量，缺失时不伪造零值。 */
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** 从路径选择器或显式范围参数生成行范围标签。 */
function readRange(
  args: Record<string, unknown>,
  path: string,
  total: unknown,
): string {
  const selector = /:(\d+)(?:-(\d*)|\+(\d+))?(?=:|$)/.exec(path);
  const start =
    args.startLine ??
    args.start_line ??
    args.offset ??
    (selector ? Number(selector[1]) : undefined);
  const end =
    args.endLine ??
    args.end_line ??
    (selector?.[2]
      ? Number(selector[2])
      : selector?.[3] && count(start)
        ? start + Number(selector[3]) - 1
        : undefined);
  const range = count(start)
    ? `${start}–${count(end) ? end : count(total) ? total : "…"} 行`
    : "";
  return [range, count(total) ? `共 ${total} 行` : ""]
    .filter(Boolean)
    .join(" / ");
}

/** Markdown 仅随详情挂载，预览与全文切换不改变原生行的展开状态。 */
function ReadOnlyMarkdown({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const lines = text.split("\n");
  return (
    <>
      <RichContent text={full ? text : lines.slice(0, 12).join("\n")} />
      <div className="tool-card-muted">
        Markdown 渲染{!full && lines.length > 12 ? " · 前 12 行" : ""}
        {lines.length > 12 && (
          <button
            type="button"
            aria-expanded={full}
            onClick={() => setFull(!full)}
          >
            {full ? "收起全文" : `展开全部（共 ${lines.length} 行）`}
          </button>
        )}
      </div>
    </>
  );
}

/** 单个原生只读目标：保持原来的文件详情、点击证据与最新结果。 */
function ReadOnlyItem({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const row = useRef<HTMLDivElement>(null);
  const args = argumentsObject(tool.args);
  const details = toolDetails(tool);
  const description = describeToolCall(tool.name, tool.args);
  const operation = toolOperation(tool.name);
  const path = args.path ?? args.file_path ?? args.filePath ?? args.url;
  const scheme = typeof path === "string" ? virtualScheme(path) : undefined;
  const originalTarget = description.targets[0];
  // 虚拟资源永远作为查询展示，绝不通过文件预览入口获得磁盘权限。
  const target =
    scheme && originalTarget?.kind === "file"
      ? {
          kind: "query" as const,
          label: originalTarget.label,
          text: String(path),
        }
      : originalTarget;
  const status = cardStatus(tool);
  const expanded = context.expanded[tool.id] !== undefined;
  const panelId = context.panelId(tool.id);
  let stats: string;
  if (operation === "grep") {
    if (!count(details.matchCount) || !count(details.fileCount))
      return <GenericCard tool={tool} context={context} />;
    stats = `${details.matchCount} 处 · ${details.fileCount} 个文件`;
  } else if (operation === "glob") {
    const total = details.fileCount ?? details.totalFiles ?? details.count;
    if (
      !count(total) ||
      (details.missingPaths !== undefined &&
        !Array.isArray(details.missingPaths))
    )
      return <GenericCard tool={tool} context={context} />;
    stats = `${total} 个文件${Array.isArray(details.missingPaths) && details.missingPaths.length ? " · 部分路径不存在" : ""}`;
  } else {
    if (details.totalLines !== undefined && !count(details.totalLines))
      return <GenericCard tool={tool} context={context} />;
    if (
      details.isDirectory !== undefined &&
      typeof details.isDirectory !== "boolean"
    )
      return <GenericCard tool={tool} context={context} />;
    stats = details.isDirectory
      ? "目录"
      : readRange(
          args,
          typeof path === "string" ? path : "",
          details.totalLines,
        );
    const truncation = details.truncation;
    if (
      truncation &&
      (typeof truncation !== "object" ||
        !("truncated" in truncation) ||
        truncation.truncated !== false)
    )
      stats += `${stats ? " · " : ""}已截断`;
  }
  if (!target) return <GenericCard tool={tool} context={context} />;
  const display = details.displayContent;
  const displayText =
    display &&
    typeof display === "object" &&
    "text" in display &&
    typeof display.text === "string"
      ? display.text
      : undefined;
  const markdown =
    status !== "error" &&
    (scheme === "http" ||
      scheme === "https" ||
      (scheme === "local" &&
        (details.contentType === "markdown" ||
          (typeof path === "string" && /\.md(?::|$)/i.test(path)))))
      ? (displayText ??
        (scheme === "http" || scheme === "https"
          ? toolResultText(tool)
          : undefined))
      : undefined;
  const safeTool = {
    ...tool,
    resultMessage: withoutResultImages(tool.resultMessage),
    live: tool.live
      ? { ...tool.live, result: withoutResultImages(tool.live.result) }
      : undefined,
  };
  /** 行本身支持键盘，内部原生目标按钮保留自己的点击处理。 */
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.target === event.currentTarget &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      context.toggle(tool.id, 0);
    }
  }
  /** Esc 只收起焦点所在的原生行，不影响同组其他已展开目标。 */
  function onItemKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || event.defaultPrevented || !expanded) return;
    event.preventDefault();
    event.stopPropagation();
    context.toggle(tool.id, 0);
    row.current?.focus();
    requestAnimationFrame(() =>
      row.current?.scrollIntoView?.({ block: "nearest" }),
    );
  }
  return (
    <div
      className="tool-card-readonly-item"
      data-tool-id={tool.id}
      data-status={status}
      onKeyDown={onItemKey}
    >
      <div
        ref={row}
        className="tool-card-readonly-row"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={panelId}
        onKeyDown={onKey}
        onClick={(event) => {
          if (!(event.target as Element).closest("button,a"))
            context.toggle(tool.id, 0);
        }}
      >
        <span className="tool-card-readonly-target">
          {scheme && resourceLabels[scheme] && (
            <span className="tool-card-chip">{resourceLabels[scheme]}</span>
          )}
          {operation === "grep" || operation === "glob" ? (
            <span>
              {operation === "grep" ? "搜索" : "查找"} "
              {String(args.pattern ?? target.label)}"
            </span>
          ) : (
            <ToolTargetButton
              target={target}
              tool={tool}
              index={0}
              context={context}
              panelId={panelId}
            />
          )}
        </span>
        <span className="tool-card-readonly-stats">{stats}</span>
      </div>
      {expanded && (
        <div id={panelId} className="tool-card-readonly-details">
          {markdown !== undefined ? (
            <ReadOnlyMarkdown text={markdown} />
          ) : (
            <ToolRowBody tool={safeTool} target={target} context={context} />
          )}
        </div>
      )}
      <ToolResultImages result={tool.resultMessage ?? tool.live?.result} />
    </div>
  );
}

/** 相邻只读操作共用白底框，状态先展示执行中，再展示错误。 */
export function ReadOnlyCard({
  items,
  context,
}: {
  items: Extract<ProcessItem, { kind: "tool" }>[];
  context: ProcessContext;
}) {
  const statuses = items.map(({ tool }) => cardStatus(tool));
  const status = statuses.includes("running")
    ? "running"
    : statuses.includes("error")
      ? "error"
      : statuses.includes("cancelled")
        ? "cancelled"
        : statuses.includes("unknown")
          ? "unknown"
          : "ok";
  return (
    <CardFrame
      toolId={`readonly:${items[0]?.tool.id ?? "empty"}`}
      kind="readonly"
      status={status}
      stickyExpanded={items.some(
        ({ tool }) => context.expanded[tool.id] !== undefined,
      )}
      title={
        <>
          <strong>读取 / 搜索</strong>{" "}
          <span className="tool-card-muted">· {items.length} 项</span>
        </>
      }
    >
      {items.map(({ tool, key }) => (
        <ReadOnlyItem key={key} tool={tool} context={context} />
      ))}
    </CardFrame>
  );
}
