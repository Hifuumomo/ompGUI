export const PERF_RENDERER_ARGUMENT = "--ompgui-perf";
export const PERF_RENDERER_CHANNEL = "desktop:performance-sample";
export const PERF_RENDERER_INTERVAL_MS = 2_000;
export const PERF_RENDERER_MAX_DURATION_MS = 3_600_000;
export const PERF_RENDERER_MAX_COUNT = 100_000;

export interface RendererPerformanceSample {
  durationMs: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longTaskMaxMs: number;
}

export interface RendererPerformanceBridge {
  report(sample: RendererPerformanceSample): void;
}

declare global {
  interface Window {
    desktopPerformance?: RendererPerformanceBridge;
  }
}

/** 仅接受固定的有界数值，拒绝扩展字段及互相矛盾的长任务统计。 */
export function isRendererPerformanceSample(value: unknown): value is RendererPerformanceSample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 4 || !keys.every((key) =>
    key === "durationMs" || key === "longTaskCount" || key === "longTaskTotalMs" || key === "longTaskMaxMs")) return false;
  const sample = value as RendererPerformanceSample;
  const { durationMs, longTaskCount, longTaskTotalMs, longTaskMaxMs } = sample;
  if (![durationMs, longTaskCount, longTaskTotalMs, longTaskMaxMs].every((item) => typeof item === "number" && Number.isFinite(item))) return false;
  if (durationMs <= 0 || durationMs > PERF_RENDERER_MAX_DURATION_MS ||
      !Number.isInteger(longTaskCount) || longTaskCount < 0 || longTaskCount > PERF_RENDERER_MAX_COUNT ||
      longTaskTotalMs < 0 || longTaskTotalMs > PERF_RENDERER_MAX_DURATION_MS ||
      longTaskMaxMs < 0 || longTaskMaxMs > longTaskTotalMs) return false;
  if (longTaskCount === 0) return longTaskTotalMs === 0 && longTaskMaxMs === 0;
  return longTaskMaxMs >= 50 && longTaskTotalMs >= longTaskMaxMs + (longTaskCount - 1) * 50 &&
    longTaskTotalMs <= longTaskCount * longTaskMaxMs;
}
