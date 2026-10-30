import { useEffect, useState } from "react";
import type { ToolInspection } from "./transcript-types";
import { isSearchTool } from "../../shared/tool-presentation";
import { executableTool } from "./transcript-model";
import { ToolOutput } from "./TranscriptContent";

/** 命令展示副本按语法格式化，资源与查询保留原文，并显示最新输出。 */
export function InlineToolDetails({
  inspection,
}: {
  inspection: ToolInspection;
}) {
  const { target } = inspection;
  const literal =
    target.kind === "command"
      ? target.command
      : target.kind === "url"
        ? target.url
        : target.kind === "query"
          ? target.text
          : target.path;
  const command = target.kind === "command";
  const [formatted, setFormatted] = useState<{
    source: string;
    toolName: string;
    value: string;
  }>();
  useEffect(() => {
    if (!command || !window.desktop?.formatCommand) return;
    let active = true;
    void window.desktop
      .formatCommand(inspection.toolName, literal)
      .then((value) => {
        if (active)
          setFormatted({
            source: literal,
            toolName: inspection.toolName,
            value: value || literal,
          });
      })
      .catch(() => {
        /* 失败时继续展示原文。 */
      });
    return () => {
      active = false;
    };
  }, [command, literal, inspection.toolName]);
  const displayed =
    command &&
    formatted?.source === literal &&
    formatted.toolName === inspection.toolName
      ? formatted.value
      : literal;
  return (
    <div
      className="inline-tool-details"
      data-kind={command ? "command" : "target"}
      aria-label={command ? "命令详情" : "操作详情"}
    >
      <div className="inline-tool-content">
        {/* 目标已在工具行显示；只有命令在此保留完整原文。 */}
        {command && (
          <pre className="inline-tool-source">
            <span aria-hidden="true">$ </span>
            {displayed}
          </pre>
        )}
        {inspection.result === undefined ? (
          <p className="muted" role="status">
            {inspection.status === "执行中" ? "等待输出…" : "未记录输出"}
          </p>
        ) : (
          <div className="inline-tool-output" aria-label="工具输出">
            <ToolOutput
              result={inspection.result}
              executable={command || executableTool(inspection.toolName)}
              search={isSearchTool(inspection.toolName)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
