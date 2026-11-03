import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { cardStatus, toolDetails, toolDurationMs } from "../tool-card-model";
import { useNow } from "../use-now";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";

type Option = { label: string; value: string };

/** 只读取选项的文字标签与标识，不把任意对象转为展示文本。 */
function optionLabel(value: unknown): Option | undefined {
  if (typeof value === "string") return { label: value, value };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const option = value as Record<string, unknown>;
  if (typeof option.label !== "string") return undefined;
  if (option.value !== undefined && typeof option.value !== "string")
    return undefined;
  if (option.id !== undefined && typeof option.id !== "string")
    return undefined;
  return {
    label: option.label,
    value: (option.value ?? option.id ?? option.label) as string,
  };
}

/** 以只读选项呈现已经回答的提问，不创建新的提交入口。 */
export function AskCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const details = toolDetails(tool);
  const options = Array.isArray(details.options)
    ? details.options.map(optionLabel)
    : undefined;
  const selected = Array.isArray(details.selectedOptions)
    ? details.selectedOptions.map(optionLabel)
    : undefined;
  if (
    typeof details.question !== "string" ||
    !options ||
    options.some((option) => !option) ||
    !selected ||
    selected.some((option) => !option) ||
    (details.multi !== undefined && typeof details.multi !== "boolean") ||
    (details.customInput !== undefined &&
      typeof details.customInput !== "string")
  ) {
    return <GenericCard tool={tool} context={context} />;
  }
  const selections = new Set(
    selected.flatMap((option) => (option ? [option.label, option.value] : [])),
  );
  return (
    <CardFrame
      toolId={tool.id}
      kind="ask"
      status={status}
      title={<strong>提问</strong>}
      meta={details.multi ? "多选" : "单选"}
      durationMs={toolDurationMs(tool, now)}
    >
      <p className="tool-card-question">{details.question}</p>
      <div className="tool-card-list" aria-label="回答选项">
        {options.map((option, index) => {
          if (!option) return null;
          const chosen =
            selections.has(option.value) || selections.has(option.label);
          return (
            <div
              className="tool-card-row tool-card-option"
              key={index}
              data-selected={chosen}
            >
              <span
                className="tool-card-option-mark"
                aria-label={chosen ? "已选择" : "未选择"}
              >
                {chosen ? "✓" : "○"}
              </span>
              <span>{option.label}</span>
            </div>
          );
        })}
        {details.customInput && (
          <div className="tool-card-row tool-card-option" data-selected="true">
            <span className="tool-card-option-mark" aria-label="用户输入">
              ✓
            </span>
            <span>{details.customInput}</span>
          </div>
        )}
      </div>
    </CardFrame>
  );
}
