import type { AgentMessage } from "../../../shared/protocol";
import { MessageBody } from "../TranscriptContent";
import { isAgentMessage, isBackgroundOutput } from "../TranscriptNotice";
import { IncomingAgentMessage } from "./AgentMessageStrip";
import { EventDivider } from "./EventDivider";
import { isLaunchCompletion, NoticeStrip } from "./NoticeStrip";

/** 完整模式专用消息分发，顶层迟到触发消息与过程内消息共享同一展示。 */
export function FullMessage({ message }: { message: AgentMessage }) {
  if (message.customType === "ompgui-event-divider") {
    const details = message.details as { detail?: unknown } | undefined;
    return (
      <EventDivider
        text={typeof message.content === "string" ? message.content : ""}
        detail={
          typeof details?.detail === "string" ? details.detail : undefined
        }
      />
    );
  }
  if (isBackgroundOutput(message) || isLaunchCompletion(message))
    return <NoticeStrip message={message} />;
  if (isAgentMessage(message))
    return <IncomingAgentMessage message={message} />;
  return <MessageBody message={message} />;
}
