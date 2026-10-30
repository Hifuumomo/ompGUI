import type { CSSProperties } from "react";
import {
  CONTEXT_MERGE_PERCENT,
  contextLevel,
  formatTokenCount,
  isUsableContextUsage,
  meterWidth,
} from "./context-meter";
import "./context-meter.css";

/** 输入框底边的上下文轨道；交互层独立于圆角裁切层。 */
export function ContextMeter({ usage }: {
  usage?: { tokens: number; contextWindow: number; percent: number };
}) {
  if (!isUsableContextUsage(usage)) return null;
  const { tokens, contextWindow, percent } = usage;
  const merged = percent >= CONTEXT_MERGE_PERCENT;
  const pct = `${Math.round(percent)}%`;
  const win = formatTokenCount(contextWindow);

  return (
    <div
      className="context-meter"
      data-level={contextLevel(percent)}
      data-merged={merged || undefined}
      style={{ "--context-percent": meterWidth(percent) } as CSSProperties}
    >
      <div className="context-meter-rail" aria-hidden="true">
        <div className="context-meter-fill" />
      </div>
      <div
        className="context-meter-hit"
        role="meter"
        tabIndex={0}
        aria-label="上下文占用"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent * 10) / 10}
        aria-valuetext={`上下文 ${percent.toFixed(1)}%，${tokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`}
      >
        {merged ? (
          <span className="context-meter-label context-meter-end">
            {pct}<span className="context-meter-end-window"> / {win}</span>
          </span>
        ) : (
          <>
            <span className="context-meter-label context-meter-percent">{pct}</span>
            <span className="context-meter-label context-meter-window">{win}</span>
          </>
        )}
        <div className="context-meter-tooltip" aria-hidden="true">
          <strong>上下文 {percent.toFixed(1)}%</strong>
          <span>{tokens.toLocaleString()} / {contextWindow.toLocaleString()} tokens</span>
          <span>剩余 {Math.max(0, contextWindow - tokens).toLocaleString()} tokens</span>
        </div>
      </div>
    </div>
  );
}
