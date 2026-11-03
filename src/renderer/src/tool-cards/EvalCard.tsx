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
      meta={`${cells.length} 个 cell`}
      durationMs={toolDurationMs(tool, now)}
      expand={{ expanded, onToggle: () => context.toggle(tool.id, 0) }}
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
          const open = opened[index] ?? (expanded || failed);
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
              {open && (
                <div className="tool-card-cell-detail">
                  {cell.code !== undefined && (
                    <pre className="tool-card-output">
                      <code>{cell.code}</code>
                    </pre>
                  )}
                  {cell.output !== undefined && (
                    <div className="tool-card-output">
                      <ToolOutput result={cell.output} executable />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </CardFrame>
  );
}
