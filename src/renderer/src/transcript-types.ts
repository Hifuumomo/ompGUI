import type { AgentMessage, MessageContent } from "../../shared/protocol";
import type { ToolTarget } from "../../shared/tool-presentation";
import type { TimelineMessage, ToolActivity } from "./session";

export interface ToolInspection {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  status: string;
  target: ToolTarget;
  args: unknown;
  result?: unknown;
  call?: MessageContent;
  resultMessage?: AgentMessage;
}

export interface TranscriptProps {
  messages: TimelineMessage[];
  tools: ToolActivity[];
  sessionId: string;
  busy?: boolean;
  inlineProcess?: boolean;
  /** 主会话显示左侧提示词目录；回退预览等嵌入场景关闭。 */
  outline?: boolean;
  onOpenFile?: (href: string) => Promise<void>;
  /** 按会话与稳定卡片标识保存用户的折叠选择。 */
  planCardState?: Map<string, boolean>;
  onPlanCardToggle?: (id: string, expanded: boolean) => void;
  onOpenPlanSession?: (sessionId: string) => Promise<void>;
  runStart?: { time: number; messageCount: number };
}

export interface ToolEvidence {
  id: string;
  name: string;
  args: unknown;
  call?: MessageContent;
  resultMessage?: AgentMessage;
  live?: ToolActivity;
}

export type ProcessItem =
  | { kind: "message"; key: string; message: AgentMessage; streaming: boolean }
  | { kind: "tool"; key: string; tool: ToolEvidence }
  | { kind: "thinking"; key: string; part: MessageContent; streaming: boolean };

/** 后续段的触发来源，标题取自原生 details，可缺省。 */
export interface FollowupTrigger {
  key: string;
  title?: string;
}

export type TranscriptUnit =
  | {
      kind: "process";
      key: string;
      items: ProcessItem[];
      /** 属于迟到结果后续段的处理过程。 */
      followup?: FollowupTrigger;
    }
  | {
      kind: "message";
      key: string;
      message: AgentMessage;
      streaming: boolean;
      /** trigger：迟到的后台结果/代理来信；followup：模型对其的回复。 */
      segment?: "trigger" | "followup";
      followup?: FollowupTrigger;
    }
  | {
      kind: "lateDivider";
      key: string;
      /** 首条迟到消息的原生时间戳。 */
      arrivedAt?: number;
      /** 上一条已结束回复的原生时间戳。 */
      answeredAt?: number;
    };
