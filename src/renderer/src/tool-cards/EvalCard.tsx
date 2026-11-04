import { useState } from "react";
import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { ToolOutput } from "../TranscriptContent";
import { cardStatus, toolDetails, toolDurationMs } from "../tool-card-model";
import { durationText } from "../duration-text";
import { useNow } from "../use-now";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";

type Cell = {
  index?: number;
  title: string;
  code?: string;
  output?: string;
  language?: string;
  status?: string;
  isError?: boolean;
  exitCode?: number;
  durationMs?: number;
  wallTimeMs?: number;
};

/** 只接受可读的原生 cell 字段，避免把未知结构当成执行结果。 */
function isCell(value: unknown): value is Cell {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cell = value as Record<string, unknown>;
  return (
    typeof cell.title === "string" &&
    ["code", "output", "language", "status"].every(
      (key) => cell[key] === undefined || typeof cell[key] === "string",
    ) &&
    ["index", "exitCode", "durationMs", "wallTimeMs"].every(
      (key) =>
        cell[key] === undefined ||
        (typeof cell[key] === "number" && Number.isFinite(cell[key])),
    ) &&
    (cell.isError === undefined || typeof cell.isError === "boolean")
  );
}

/** 统一显示原生 JavaScript/Python 语言名，未知语言不伪造执行类型。 */
function languageLabel(language: unknown): string | undefined {
  if (language === "js" || language === "javascript") return "JS";
  if (language === "py" || language === "python") return "Python";
  return undefined;
}

/** 按原生错误标志、状态和退出码判定 cell 失败。 */
function cellFailed(cell: Cell): boolean {
  return (
    cell.isError === true ||
    cell.status === "error" ||
    (cell.exitCode !== undefined && cell.exitCode !== 0)
  );
}

type StatusEvent = { op: string; detail?: string; error?: string };

/** 判断是否为 statusEvents 事件；参数：[in] value 原生值。返回值：结构合法时为 true。 */
function isStatusEvent(value: unknown): value is StatusEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.op === "string" &&
    (event.detail === undefined || typeof event.detail === "string") &&
    (event.error === undefined || typeof event.error === "string") &&
    (event.detail !== undefined || event.error !== undefined)
  );
}

/** Status 树，最多 8 行，超出时最后一行为「… 另有 N 条」；参数：[in] events 事件。返回值：等宽灰色树。 */
function StatusTree({ events }: { events: readonly StatusEvent[] }) {
  const overflow = events.length > 8;
  const shown = overflow ? events.slice(0, 7) : events;
  const rows = [
    ...shown.map((event) => ({
      text: event.detail ?? event.error ?? "",
      error: event.detail === undefined,
    })),
    ...(overflow
      ? [{ text: `… 另有 ${events.length - 7} 条`, error: false }]
      : []),
  ];
  return (
    <div className="tool-card-status-tree">
      <div className="tool-card-muted">Status</div>
      {rows.map((row, index) => (
        <div
          key={index}
          className={row.error ? "tool-card-danger-text" : "tool-card-muted"}
        >
          {index === rows.length - 1 ? "└─" : "├─"} {row.text}
        </div>
      ))}
    </div>
  );
}

/** 展示执行 cell；失败项默认展开，逐项操作只改变阅读状态。 */
export function EvalCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const [opened, setOpened] = useState<Record<number, boolean>>({});
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const details = toolDetails(tool);
  const cells = details.cells;
  const args =
    tool.args && typeof tool.args === "object"
      ? (tool.args as Record<string, unknown>)
      : {};
  const language = languageLabel(details.language ?? args.language);
  if (
    !Array.isArray(cells) ||
    cells.length === 0 ||
    !cells.every(isCell) ||
    !language
  ) {
    return <GenericCard tool={tool} context={context} />;
  }
  const expanded = context.expanded[tool.id] !== undefined;
  const isOpen = (index: number) =>
    opened[index] ?? (expanded || cellFailed(cells[index]));
  const outputs = cells.flatMap((cell, index) =>
    isOpen(index) && cell.output !== undefined ? [{ cell, index }] : [],
  );
  const events = Array.isArray(details.statusEvents)
    ? details.statusEvents.filter(isStatusEvent)
    : [];
  const single = outputs.length === 1;
  return (
    <CardFrame
      toolId={tool.id}
      kind="eval"
      status={status}
      title={
        <>
          <strong>运行 {language}</strong> <span>{cells[0].title}</span>
        </>
      }
      durationMs={toolDurationMs(tool, now)}
      expand={{ expanded, onToggle: () => context.toggle(tool.id, 0) }}
      footer={`${cells.length} 个 cell`}
      outputLabel={
        single ? `Output · cell ${(outputs[0].cell.index ?? outputs[0].index) + 1}` : undefined
      }
      output={
        outputs.length || events.length ? (
          <>
            {outputs.map(({ cell, index }) => (
              <div
                key={index}
                className={cellFailed(cell) ? "tool-card-danger-text" : undefined}
                data-cell-output={(cell.index ?? index) + 1}
              >
                {!single && (
                  <div className="tool-card-muted tool-card-code-label">
                    cell {(cell.index ?? index) + 1}
                  </div>
                )}
                <div className="tool-card-output">
                  <ToolOutput result={cell.output!} executable />
                </div>
              </div>
            ))}
            {events.length > 0 && <StatusTree events={events} />}
          </>
        ) : undefined
      }
    >
      <div className="tool-card-list">
        {cells.map((cell, index) => {
          const failed = cellFailed(cell);
          const cellStatus = failed
            ? "error"
            : cell.status === "running"
              ? "running"
              : status === "running" && cell.output === undefined
                ? "running"
                : "ok";
          const open = isOpen(index);
          const duration = cell.wallTimeMs ?? cell.durationMs;
          return (
            <div
              key={index}
              className="tool-card-cell"
              data-status={cellStatus}
            >
              <button
                type="button"
                className="tool-card-row tool-card-cell-toggle"
                aria-expanded={open}
                onClick={() =>
                  setOpened((previous) => ({ ...previous, [index]: !open }))
                }
              >
                <span className="tool-card-cell-index">
                  {(cell.index ?? index) + 1}
                </span>
                <span className="tool-card-cell-title">{cell.title}</span>
                {cell.language && (
                  <span className="tool-card-muted">
                    {languageLabel(cell.language) ?? cell.language}
                  </span>
                )}
                {duration !== undefined && (
                  <span className="tool-card-muted">
                    {durationText(duration)}
                  </span>
                )}
                <span
                  aria-label={
                    failed
                      ? "失败"
                      : cellStatus === "running"
                        ? "运行中"
                        : "完成"
                  }
                >
                  {failed ? "✗" : cellStatus === "running" ? "◐" : "✓"}
                </span>
              </button>
              {open && cell.code !== undefined && (
                <div className="tool-card-cell-detail">
                  <pre className="tool-card-output">
                    <code>{cell.code}</code>
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </CardFrame>
  );
}
