import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { SafeLink } from "../FileReferenceLink";
import { cardStatus, toolDetails, toolDurationMs } from "../tool-card-model";
import { useNow } from "../use-now";
import { CardFrame } from "./CardFrame";
import { GenericCard } from "./GenericCard";

type Source = { title: string; url: string; snippet?: string };

/** 校验原生网页来源，仅接受可读标题、网址和文字摘要。 */
function isSource(value: unknown): value is Source {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.title === "string" &&
    typeof source.url === "string" &&
    (source.snippet === undefined || typeof source.snippet === "string")
  );
}

/** 展示真实搜索来源，通过既有网页上下文安全打开 HTTP(S) 链接。 */
export function SearchCard({
  tool,
  context,
}: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const status = cardStatus(tool);
  const now = useNow(status === "running");
  const details = toolDetails(tool);
  const response =
    details.response &&
    typeof details.response === "object" &&
    !Array.isArray(details.response)
      ? (details.response as Record<string, unknown>)
      : undefined;
  const sources = response?.sources;
  const args =
    tool.args && typeof tool.args === "object" && !Array.isArray(tool.args)
      ? (tool.args as Record<string, unknown>)
      : {};
  if (
    !Array.isArray(sources) ||
    !sources.every(isSource) ||
    typeof args.query !== "string"
  ) {
    return <GenericCard tool={tool} context={context} />;
  }
  const expanded = context.expanded[tool.id] !== undefined;
  const visible = expanded ? sources : sources.slice(0, 3);
  return (
    <CardFrame
      toolId={tool.id}
      kind="search"
      status={status}
      title={
        <>
          <strong>搜索网页</strong> <code>{args.query}</code>
        </>
      }
      meta={`${sources.length} 个来源`}
      durationMs={toolDurationMs(tool, now)}
      expand={
        sources.length > 3
          ? { expanded, onToggle: () => context.toggle(tool.id, 0) }
          : undefined
      }
    >
      <div className="tool-card-list">
        {visible.map((source, index) => (
          <div className="tool-card-source" key={`${source.url}:${index}`}>
            <SafeLink
              href={/^https?:\/\//i.test(source.url) ? source.url : undefined}
            >
              {source.title}
            </SafeLink>
            {source.snippet !== undefined && (
              <div className="tool-card-source-snippet" title={source.snippet}>
                {source.snippet.replace(/\s+/g, " ").trim()}
              </div>
            )}
          </div>
        ))}
      </div>
      {sources.length > 3 && (
        <button
          type="button"
          className="tool-card-more"
          aria-expanded={expanded}
          onClick={() => context.toggle(tool.id, 0)}
        >
          {expanded ? "收起来源" : `显示全部 ${sources.length} 个来源`}
        </button>
      )}
    </CardFrame>
  );
}
