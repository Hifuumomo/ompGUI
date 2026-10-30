/** 原生计划身份由当前扩展绑定生成，epoch 不接受客户端自造。 */
export interface PlanIdentity { sessionId: string; sessionFile: string; epoch: string }
export type PlanChoice = "execute" | "compact" | "keep" | "refine" | "save";
export type PlanPhase = "off" | "planning" | "review" | "applying" | "paused";
/** 完善意见随同原生处置提交的图片，与普通提示词图片格式一致。 */
export interface PlanFeedbackImage { type: "image"; data: string; mimeType: string }
export interface PlanDocument {
  path: string; title: string; content: string; saveFileName: string; revision: string;
}
export interface PlanSnapshot {
  identity: PlanIdentity; phase: PlanPhase;
  document?: PlanDocument; reviewId?: string;
  busy: boolean; error?: string;
  context?: { tokens: number; contextWindow: number; percent: number };
  executionModel?: { provider: string; modelId: string; thinkingLevel?: string };
  operation?: {
    id: string; choice: PlanChoice; status: "running" | "completed" | "failed" | "cancelled";
    error?: string; savedPath?: string; origin: PlanIdentity;
  };
}
export type PlanAction =
  | { op: "status" }
  | { op: "enter"; identity: PlanIdentity }
  | { op: "pause" | "leave"; identity: PlanIdentity }
  | { op: "saveDocument"; identity: PlanIdentity; path: string; revision: string; content: string }
  | { op: "cancel"; identity: PlanIdentity; operationId: string }
  | { op: "decide"; identity: PlanIdentity; reviewId: string; revision: string; choice: PlanChoice;
      executionModel?: { provider: string; modelId: string; thinkingLevel?: string }; feedback?: string; feedbackImages?: PlanFeedbackImage[] };
