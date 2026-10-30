import type { RewindController } from "./useRewind";
import "./rewind.css";

type Props = { readonly rewind: RewindController };

/** 保留原生筛选输入与命中数量。 */
function RewindStatus({ rewind }: Props) {
  return (
    <>
      {rewind.filterMode ? (
        <label className="rewind-filter">
          <span>filter:</span>
          <input
            autoFocus
            aria-label="筛选回退消息"
            placeholder="words…"
            value={rewind.query}
            disabled={rewind.disabled}
            onChange={(event) => rewind.setQuery(event.target.value)}
          />
          <span role="status">{rewind.matchingTargets.length} matches</span>
        </label>
      ) : (
        <p className="rewind-caption" role="status">
          {rewind.selectedTarget
            ? "Continue from here"
            : "No messages to rewind"}
          {rewind.columns.length > 0 && (
            <span>
              {" "}
              · Branch {rewind.variantIndex + 1}/{rewind.columns.length}
            </span>
          )}
        </p>
      )}
    </>
  );
}

/** 原生回退的底部键盘提示与筛选输入，与正文中的虚线目标同步。 */
export function RewindToolbar({ rewind }: Props) {
  return (
    <div className="rewind-toolbar" role="region" aria-label="回退会话">
      <RewindStatus rewind={rewind} />
      <div className="rewind-controls">
        <span>
          <kbd>↑ ↓</kbd> messages
        </span>
        <span>
          <kbd>← →</kbd> branches / user turns
        </span>
        <button
          type="button"
          onClick={rewind.openFilter}
          disabled={rewind.disabled || rewind.filterMode}
        >
          <kbd>f</kbd> filter
        </button>
        <button
          type="button"
          onClick={rewind.confirm}
          disabled={rewind.disabled || !rewind.canConfirm}
        >
          <kbd>Enter</kbd> continue
        </button>
        <button
          type="button"
          onClick={rewind.filterMode ? rewind.closeFilter : rewind.cancel}
          disabled={rewind.disabled}
        >
          <kbd>Esc</kbd> {rewind.filterMode ? "clear filter" : "cancel"}
        </button>
      </div>
    </div>
  );
}
