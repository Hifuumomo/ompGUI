import { fastPhase, fastTitle } from "./fast-mode";
import "./fast-toggle.css";

interface FastToggleProps {
  state?: {
    fastModeEnabled?: boolean;
    fastModeActive?: boolean;
    tokensPerSecond?: number | null;
  };
  disabled: boolean;
  pending: boolean;
  onToggle: () => void;
}

/** 只用闪电颜色表达状态；等待回显期间保留原阶段，不做乐观切换。 */
export function FastToggle({ state, disabled, pending, onToggle }: FastToggleProps) {
  const phase = fastPhase(state);
  return (
    <button
      type="button"
      className="fast-toggle"
      data-phase={phase}
      aria-label="Fast 模式"
      aria-pressed={phase !== "off"}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      title={fastTitle(phase, state?.tokensPerSecond)}
      onClick={onToggle}
    >
      <svg viewBox="0 0 10 10" aria-hidden="true">
        <path d="M6.2 0 L1 5.8 H4.4 L3.6 10 L9 3.9 H5.6 Z" />
      </svg>
    </button>
  );
}
