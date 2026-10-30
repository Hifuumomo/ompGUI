import type { PlanChoice, PlanPhase } from "./native-plan";

/** 原生会话元数据；计划快照只用于展示，不加入模型上下文。 */
export interface PlanStatusRecord {
  version: 1;
  operationId: string;
  kind: "approved" | "executedElsewhere" | "continued" | "refined" | "saved" | "stopped" | "compactCancelled" | "failed";
  choice: PlanChoice;
  planPath: string;
  revision?: number;
  model?: { provider: string; modelId: string; name?: string; thinkingLevel?: string };
  contextPercent?: number;
  savedPath?: string;
  sourceSessionFile?: string;
  targetSessionId?: string;
  document?: string;
  error?: string;
}

export interface PlanStatusText {
  title: string;
  detail?: string;
  level: "success" | "info" | "warning" | "error";
}

/** 通知条与持久化卡片共用处置结果文案。 */
export function planStatusText(record: Pick<PlanStatusRecord, "kind" | "choice" | "savedPath" | "error">, modelLabel = "当前模型", phase?: PlanPhase): PlanStatusText {
  if (record.kind === "failed") {
    const title = record.choice === "refine" ? "完善计划失败" : record.choice === "save" ? "保存计划失败" : "执行计划失败";
    return { level: "error", title, detail: record.error || "未知原因" };
  }
  switch (record.kind) {
    case "refined": return { level: "info", title: "计划已退回完善", detail: "已退回规划，计划模式继续" };
    case "stopped": return { level: "warning", title: "已停止处置", detail: phase === undefined || phase === "review" ? "计划仍可审阅" : phase === "planning" ? "计划模式继续" : "计划模式已退出" };
    case "compactCancelled": return { level: "warning", title: "计划已批准，但压缩被取消，尚未开始执行", detail: "发送一条消息以继续" };
    case "saved": return { level: "success", title: record.savedPath ? `计划已保存到 ${record.savedPath}` : "计划已保存", detail: "已新建会话" };
    case "executedElsewhere": return { level: "success", title: "计划已批准 · 已在新会话执行", detail: `使用 ${modelLabel} 执行` };
    case "continued": return { level: "success", title: "计划已批准 · 已开始新会话", detail: `计划与本地依赖已复制，使用 ${modelLabel} 执行` };
    case "approved": return { level: "success", title: record.choice === "compact" ? "计划已批准 · 已压缩上下文" : record.choice === "keep" ? "计划已批准 · 保留上下文" : "计划已批准", detail: `使用 ${modelLabel} 执行` };
  }
}
