import { describeToolCall } from "../../shared/tool-presentation";
import type { ProcessItem } from "./transcript-types";
import { isErrorOnlyMessage, toolStatus } from "./transcript-model";
import { ToolRow, type ProcessContext } from "./TranscriptToolRow";
import { ToolIcon } from "./ToolIcon";

type ToolItem = Extract<ProcessItem, { kind: "tool" }>;
type ProcessEntry =
  | Exclude<ProcessItem, ToolItem>
  | {
      kind: "errors";
      key: string;
      items: Extract<ProcessItem, { kind: "message" }>[];
    }
  | {
      kind: "tools";
      key: string;
      items: ToolItem[];
    };

/** 连续工具合并为混合操作记录；文字和思考保留在原始位置。 */
export function groupToolItems(items: ProcessItem[]): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const item of items) {
    if (item.kind === "message" && isErrorOnlyMessage(item.message)) {
      const last = entries.at(-1);
      if (last?.kind === "errors") last.items.push(item);
      else entries.push({ kind: "errors", key: item.key, items: [item] });
      continue;
    }
    if (item.kind !== "tool") {
      entries.push(item);
      continue;
    }
    const last = entries.at(-1);
    if (last?.kind === "tools") {
      last.items.push(item);
    } else {
      entries.push({ kind: "tools", key: item.key, items: [item] });
    }
  }
  return entries;
}

/** 混合操作默认折叠，展开后在有界滚动区按顺序浏览并查看独立详情。 */
export function ToolGroup({
  items,
  context,
}: {
  items: ToolItem[];
  context: ProcessContext;
}) {
  if (items.length === 1)
    return <ToolRow tool={items[0].tool} context={context} />;
  const labels = [
    ...new Set(
      items.map(({ tool }) => {
        const description = describeToolCall(tool.name, tool.args);
        return description.verb === "调用工具"
          ? `${description.verb} ${tool.name}`
          : description.verb;
      }),
    ),
  ];
  const pluralLabels: Record<string, string> = {
    读取: "读取了多个对象",
    写入: "写入了多个对象",
    编辑: "编辑了多个对象",
    执行命令: "运行了多个命令",
    搜索: "搜索了多个对象",
    查找文件: "查找了多个文件",
    搜索网页: "搜索了多个网页",
  };
  const label =
    labels.length === 1
      ? (pluralLabels[labels[0]] ?? `多次${labels[0]}`)
      : labels.join(" · ");
  const statuses = items.map((item) => toolStatus(item.tool));
  const running = statuses.includes("执行中");
  return (
    <details className="tool-type-group">
      <summary aria-busy={running}>
        {labels.length === 1 && (
          <ToolIcon
            verb={describeToolCall(items[0].tool.name, items[0].tool.args).verb}
          />
        )}
        <span className="tool-group-label" title={label}>
          {label}
        </span>
        {running && <span className="muted">执行中</span>}
        <span className="tool-type-chevron" aria-hidden="true">
          ›
        </span>
      </summary>
      <div
        className="tool-type-items"
        role="region"
        aria-label="操作记录"
        tabIndex={0}
      >
        {items.map((item) => (
          <ToolRow key={item.tool.id} tool={item.tool} context={context} />
        ))}
      </div>
    </details>
  );
}
