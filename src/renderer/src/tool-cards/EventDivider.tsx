import { RichContent } from "../RichContent";

/** 会话分隔线在有原生摘要时允许展开，不补造摘要或 token 信息。 */
export function EventDivider({
  text,
  detail,
}: {
  text: string;
  detail?: string;
}) {
  return detail ? (
    <details className="event-divider">
      <summary>{text}</summary>
      <RichContent text={detail} />
    </details>
  ) : (
    <div className="event-divider" role="separator">
      <span>{text}</span>
    </div>
  );
}
