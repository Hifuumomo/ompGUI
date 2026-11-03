import type { AgentMessage } from "../../shared/protocol";
import { messageFileHref } from "../../shared/message-file-link";
import { FileReferenceLink } from "./FileReferenceLink";

/** 用户气泡下方的独立右对齐引用行保留原始路径、跳过原因和已记录的模型名称。 */
export function FileChips({
  mentions,
  modelMentions,
}: {
  mentions?: AgentMessage["files"];
  modelMentions?: AgentMessage[];
}) {
  if (!mentions?.length && !modelMentions?.length) return null;
  return (
    <div className="file-chips">
      {mentions?.map((file, index) =>
        file.skippedReason ? (
          <span
            key={`file:${index}`}
            className="file-chip-skipped"
            title={file.skippedReason}
          >
            @ {file.path}
          </span>
        ) : (
          <FileReferenceLink
            key={`file:${index}`}
            href={messageFileHref(file.path)}
          >
            @ {file.path}
          </FileReferenceLink>
        ),
      )}
      {modelMentions?.map((message, index) => {
        const details = message.details as
          { name?: unknown; selector?: unknown } | undefined;
        const name =
          typeof details?.name === "string"
            ? details.name
            : typeof details?.selector === "string"
              ? details.selector
              : undefined;
        return name ? <span key={`model:${index}`}>@ {name}</span> : null;
      })}
    </div>
  );
}
