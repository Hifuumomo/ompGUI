export type ContextLevel = "normal" | "high" | "critical";

export const CONTEXT_HIGH_PERCENT = 75;
export const CONTEXT_CRITICAL_PERCENT = 90;
export const CONTEXT_MERGE_PERCENT = 85;

/** 阈值使用真实占用率，超出窗口时仍保持临界状态。 */
export function contextLevel(percent: number): ContextLevel {
  if (percent >= CONTEXT_CRITICAL_PERCENT) return "critical";
  return percent >= CONTEXT_HIGH_PERCENT ? "high" : "normal";
}

/** 只限制轨道宽度，不截断标签和辅助技术读取的真实数值。 */
export function meterWidth(percent: number): number {
  return Math.min(100, Math.max(0, percent));
}

/** 窗口容量最多保留一位小数；K 舍入进位后改用 M。 */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  const thousands = Math.round(n / 100) / 10;
  if (thousands < 1000) return `${thousands}K`;
  return `${Math.round(n / 100000) / 10}M`;
}

/** 缺失或无效的用量不绘制轨道，保留输入框原底边。 */
export function isUsableContextUsage(u: unknown): u is {
  tokens: number;
  contextWindow: number;
  percent: number;
} {
  if (typeof u !== "object" || u === null) return false;
  return "tokens" in u && typeof u.tokens === "number" && Number.isFinite(u.tokens)
    && "contextWindow" in u && typeof u.contextWindow === "number"
    && Number.isFinite(u.contextWindow) && u.contextWindow > 0
    && "percent" in u && typeof u.percent === "number" && Number.isFinite(u.percent);
}
