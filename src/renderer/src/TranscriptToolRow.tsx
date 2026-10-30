import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type MouseEventHandler,
} from "react";
import {
  describeToolCall,
  isSearchTool,
  type ToolDescription,
  type ToolTarget,
} from "../../shared/tool-presentation";
import type { ToolEvidence, ToolInspection } from "./transcript-types";
import { toolStatus, executableTool } from "./transcript-model";
import { countLines } from "./inline-detail-limits";
import { ToolOutput } from "./TranscriptContent";
import { InlineToolDetails } from "./InlineToolDetails";
import { InlineFileDetails } from "./InlineFileDetails";
import { ToolTargetButton, ToolTargets } from "./TranscriptToolTargets";
import { ToolIcon } from "./ToolIcon";

export interface ProcessContext {
  sessionId: string;
  expanded: Readonly<Record<string, number>>;
  toggle: (toolId: string, index: number) => void;
  panelId: (toolId: string) => string;
}

/** 每次从配对后的最新工具证据生成详情，避免保存点击时的输出快照。 */
function inspectEvidence(options: {
  tool: ToolEvidence;
  target: ToolTarget;
  sessionId: string;
}): ToolInspection {
  const { tool, target, sessionId } = options;
  return {
    sessionId,
    toolCallId: tool.id,
    toolName: tool.name,
    target,
    status: toolStatus(tool),
    args: tool.args,
    result: tool.resultMessage ?? tool.live?.result,
    call: tool.call,
    resultMessage: tool.resultMessage,
  };
}

/** 没有目标的工具仅显示实际输出，不展开内部调用封装。 */
function ToolEvidenceDetails({ tool }: { tool: ToolEvidence }) {
  const result = tool.resultMessage ?? tool.live?.result;
  return (
    <>
      {result === undefined ? (
        <p className="muted">未记录输出</p>
      ) : (
        <ToolOutput
          result={result}
          executable={executableTool(tool.name)}
          search={isSearchTool(tool.name)}
        />
      )}
    </>
  );
}

export function ToolRow({
  tool,
  context,
  hideVerb = false,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
  hideVerb?: boolean;
}) {
  const description = describeToolCall(tool.name, tool.args);
  const { targets } = description;
  const [listOpen, setListOpen] = useState(false);
  const index = context.expanded[tool.id];
  const target = targets[index ?? 0];
  const status = toolStatus(tool);
  const multiple = targets.length > 1;
  const open = multiple ? listOpen : index !== undefined;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const sticky = open && long;
  function toggle(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    if (multiple) setListOpen((current) => !current);
    else context.toggle(tool.id, index ?? 0);
  }
  /** 详情内容较长（已展开全部，或高度超过视口一半）时标题吸顶。 */
  function measure() {
    const panel = panelRef.current;
    if (!panel) return;
    setLong(
      !!panel.querySelector('[data-expanded="true"], [data-output-expanded="true"]') ||
        panel.offsetHeight > window.innerHeight / 2,
    );
  }
  useEffect(() => {
    if (open) measure();
    else setLong(false);
  }, [open]);
  /** 收起当前详情，并把工具行滚回最近的可见位置；focus 为真时焦点回到 summary。 */
  function collapse(focus: boolean) {
    const shown = context.expanded[tool.id];
    if (multiple && shown === undefined) setListOpen(false);
    else context.toggle(tool.id, shown ?? 0);
    const details = detailsRef.current;
    if (focus)
      details?.querySelector<HTMLElement>(":scope > summary")?.focus();
    requestAnimationFrame(() =>
      details?.scrollIntoView?.({ block: "nearest" }),
    );
  }
  /** Esc 收起焦点所在的已展开详情。 */
  function onPanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !open || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    collapse(true);
  }
  return (
    <details
      ref={detailsRef}
      className={`tool-row transcript-evidence ${multiple ? "tool-row-multiple" : ""} ${status === "错误" ? "process-error" : ""}`}
      data-tool-id={tool.id}
      data-sticky={sticky}
      open={open}
    >
      <ToolRowSummary
        tool={tool}
        description={description}
        context={context}
        open={open}
        onToggle={toggle}
        hideVerb={hideVerb}
        onCollapse={sticky ? () => collapse(false) : undefined}
      />
      <div
        id={context.panelId(tool.id)}
        ref={panelRef}
        onKeyDown={onPanelKeyDown}
        onClickCapture={() => setTimeout(measure, 0)}
      >
        {open &&
          (multiple ? (
            <ToolTargetList tool={tool} targets={targets} context={context} />
          ) : (
            <ToolRowBody tool={tool} target={target} context={context} />
          ))}
      </div>
    </details>
  );
}

function ToolRowSummary({
  tool,
  description,
  context,
  open,
  onToggle,
  hideVerb,
  onCollapse,
}: {
  tool: ToolEvidence;
  description: ToolDescription;
  context: ProcessContext;
  open: boolean;
  onToggle: MouseEventHandler<HTMLElement>;
  hideVerb: boolean;
  onCollapse?: () => void;
}) {
  const status = toolStatus(tool);
  return (
    <summary
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={context.panelId(tool.id)}
    >
      <ToolIcon verb={description.verb} />
      <ToolTargets
        tool={tool}
        description={description}
        context={context}
        open={open}
        hideVerb={hideVerb}
      />
      {status !== "已完成" && status !== "错误" && (
        <span className="muted">{status}</span>
      )}
      <ToolResultSummary tool={tool} />
      {onCollapse && (
        <button
          type="button"
          className="tool-row-collapse"
          aria-expanded={open}
          aria-controls={context.panelId(tool.id)}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCollapse();
          }}
        >
          收起 ⌃
        </button>
      )}
      <span className="tool-row-chevron" aria-hidden="true">
        {open ? "⌄" : "›"}
      </span>
    </summary>
  );
}

/** 统计结果正文的行数（content 文本块与 output 字段）；没有文本时为 0。 */
function resultLineCount(result: unknown): number {
  if (typeof result === "string") return countLines(result);
  if (result === null || typeof result !== "object") return 0;
  const payload = result as Record<string, unknown>;
  let lines = 0;
  if (typeof payload.content === "string") lines += countLines(payload.content);
  else if (Array.isArray(payload.content))
    for (const part of payload.content as { type?: unknown; text?: unknown }[])
      if (part?.type === "text" && typeof part.text === "string")
        lines += countLines(part.text);
  if (typeof payload.output === "string") lines += countLines(payload.output);
  return lines;
}

/** 工具行右侧的结果摘要：命令显示输出行数，搜索类显示结果处数。结果载荷中没有退出码字段，因此不显示退出码。 */
function ToolResultSummary({ tool }: { tool: ToolEvidence }) {
  const status = toolStatus(tool);
  if (status !== "已完成" && status !== "错误") return null;
  const search = isSearchTool(tool.name);
  if (!search && !executableTool(tool.name)) return null;
  const lines = resultLineCount(tool.resultMessage ?? tool.live?.result);
  if (!lines) return null;
  return (
    <span className="tool-row-result">
      {lines} {search ? "处" : "行"}
    </span>
  );
}

/** 对象列表逐行缩进；点击某个对象只展开该对象的详情。 */
function ToolTargetList({
  tool,
  targets,
  context,
}: {
  tool: ToolEvidence;
  targets: readonly ToolTarget[];
  context: ProcessContext;
}) {
  return (
    <ul className="tool-target-list">
      {targets.map((target, index) => {
        const panelId = `${context.panelId(tool.id)}-target-${index}`;
        return (
          <li key={targetKey(target)}>
            <ToolTargetButton
              target={target}
              tool={tool}
              index={index}
              context={context}
              panelId={panelId}
            />
            <div id={panelId}>
              {context.expanded[tool.id] === index && (
                <ToolRowBody tool={tool} target={target} context={context} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** 文件显示名可能相同，列表节点按真实目标区分。 */
function targetKey(target: ToolTarget): string {
  if (target.kind === "file") return `file:${target.path}`;
  if (target.kind === "command") return `command:${target.command}`;
  if (target.kind === "url") return `url:${target.url}`;
  return `query:${target.text}`;
}

function ToolRowBody({
  tool,
  target,
  context,
}: {
  tool: ToolEvidence;
  target?: ToolTarget;
  context: ProcessContext;
}) {
  if (!target) return <ToolEvidenceDetails tool={tool} />;
  const inspection = inspectEvidence({
    tool,
    target,
    sessionId: context.sessionId,
  });
  return target.kind === "file" ? (
    <InlineFileDetails key={target.path} inspection={inspection} />
  ) : (
    <InlineToolDetails
      key={`${target.kind}:${target.label}`}
      inspection={inspection}
    />
  );
}
