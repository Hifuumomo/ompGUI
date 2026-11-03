import type { ToolEvidence } from "../transcript-types";
import type { ProcessContext } from "../TranscriptToolRow";
import { cardKind } from "../tool-card-model";
import { CardResultContext } from "./CardFrame";
import { GenericCard } from "./GenericCard";
import { ReadOnlyCard } from "./ReadOnlyCard";
import { EditCard } from "./EditCard";
import { DeleteCard } from "./DeleteCard";
import { WriteCard } from "./WriteCard";
import { BashCard } from "./BashCard";
import { ProcessCard } from "./ProcessCard";
import { EvalCard } from "./EvalCard";
import { AskCard } from "./AskCard";
import { SearchCard } from "./SearchCard";
import { TaskCard } from "./TaskCard";
import { WaitCard } from "./WaitCard";
import { AgentMessageCard } from "./AgentMessageStrip";
import { AgentOutputCard } from "./AgentOutputCard";
import { McpCard } from "./McpCard";
import { YieldCard } from "./YieldCard";
import { InvalidCard } from "./InvalidCard";

/** 统一工具框分发入口，未知载荷使用通用详情。参数：[in] props 工具证据和上下文。返回值：工具框。 */
export function ToolCard(props: {
  tool: ToolEvidence;
  context: ProcessContext;
}) {
  const kind = cardKind(props.tool);
  if (kind === "readonly")
    return (
      <ReadOnlyCard
        items={[{ kind: "tool", key: props.tool.id, tool: props.tool }]}
        context={props.context}
      />
    );
  const Component = {
    edit: EditCard,
    delete: DeleteCard,
    write: WriteCard,
    bash: BashCard,
    process: ProcessCard,
    eval: EvalCard,
    ask: AskCard,
    search: SearchCard,
    task: TaskCard,
    wait: WaitCard,
    "message-out": AgentMessageCard,
    "message-in": AgentMessageCard,
    "agent-output": AgentOutputCard,
    mcp: McpCard,
    yield: YieldCard,
    invalid: InvalidCard,
    generic: GenericCard,
  }[kind];
  return (
    <CardResultContext.Provider
      value={props.tool.resultMessage ?? props.tool.live?.result}
    >
      <Component {...props} />
    </CardResultContext.Provider>
  );
}
