import {
  isRendererPerformanceSample,
  PERF_RENDERER_INTERVAL_MS,
  PERF_RENDERER_MAX_COUNT,
  PERF_RENDERER_MAX_DURATION_MS,
  type RendererPerformanceBridge,
} from "../../shared/performance";

/** 仅在启用且 Chromium 支持 longtask 时启动；不支持时不发送伪零值。 */
export function startRendererPerformance(bridge: RendererPerformanceBridge): () => void {
  if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    return () => {};
  }
  let stopped = false;
  let startedAt = performance.now();
  let count = 0;
  let total = 0;
  let maximum = 0;
  let overflow = false;
  // 回调只读取耗时，绝不保留任务名称、来源、URL 或归因对象。
  const collect = (entries: readonly PerformanceEntry[]) => {
    for (const entry of entries) {
      const duration = entry.duration;
      if (entry.entryType !== "longtask" || !Number.isFinite(duration) || duration < 50) continue;
      if (count >= PERF_RENDERER_MAX_COUNT || duration > PERF_RENDERER_MAX_DURATION_MS - total) {
        overflow = true;
        continue;
      }
      count += 1;
      total += duration;
      maximum = Math.max(maximum, duration);
    }
  };
  const observer = new PerformanceObserver((list) => {
    if (!stopped) collect(list.getEntries());
  });
  try {
    observer.observe({ type: "longtask" });
  } catch {
    observer.disconnect();
    return () => {};
  }
  const timer = window.setInterval(() => {
    if (stopped) return;
    collect(observer.takeRecords());
    const now = performance.now();
    const sample = { durationMs: now - startedAt, longTaskCount: count, longTaskTotalMs: total, longTaskMaxMs: maximum };
    startedAt = now;
    count = total = maximum = 0;
    const dropped = overflow;
    overflow = false;
    // 挂起过久或溢出时丢弃整个区间，避免把截断值误记为真实统计。
    if (!dropped && isRendererPerformanceSample(sample)) {
      try { bridge.report(sample); } catch { /* 诊断桥失效不得影响界面。 */ }
    }
  }, PERF_RENDERER_INTERVAL_MS);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    window.clearInterval(timer);
    window.removeEventListener("pagehide", stop);
  };
  window.addEventListener("pagehide", stop, { once: true });
  return stop;
}
