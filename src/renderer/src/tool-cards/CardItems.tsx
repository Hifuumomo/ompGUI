import type { ProcessItem } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { groupCardItems } from "../tool-card-model";
import { ThinkingContent } from "../ThinkingContent";
import { MessageBody } from "../TranscriptContent";
import { FullMessage } from "./FullMessage";
import { ReadOnlyCard } from "./ReadOnlyCard";
import { ToolCard } from "./ToolCard";

/** 按原生顺序渲染每个工具、思考和消息；参数：[in] items 过程记录，[in] context 展开状态。返回值：完整过程内容。 */
export function CardItems({
  items,
  context,
}: {
  items: ProcessItem[];
  context: ProcessContext;
}) {
  return (
    <>
      {groupCardItems(items).map((item) => {
        if (item.kind === "errors")
          return (
            <details
              key={item.key}
              className="transcript-evidence process-error-group"
            >
              <summary>错误信息</summary>
              <div
                className="process-errors"
                role="region"
                aria-label="错误记录"
                tabIndex={0}
              >
                {item.items.map((entry) => (
                  <MessageBody key={entry.key} message={entry.message} />
                ))}
              </div>
            </details>
          );
        if (item.kind === "readonly")
          return (
            <ReadOnlyCard key={item.key} items={item.items} context={context} />
          );
        if (item.kind === "tool")
          return <ToolCard key={item.key} tool={item.tool} context={context} />;
        if (item.kind === "thinking")
          return (
            <ThinkingContent
              key={item.key}
              text={item.part.thinking ?? item.part.text ?? ""}
            />
          );
        return <FullMessage key={item.key} message={item.message} />;
      })}
    </>
  );
}
