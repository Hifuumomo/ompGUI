import { useRef, type KeyboardEvent } from "react";

export type ReviewTab = "files" | "changes";

interface Props {
  readonly tab: ReviewTab;
  readonly onChange: (tab: ReviewTab) => void;
  /** 变更文件数；读取中传 undefined，不显示徽标。 */
  readonly changeCount?: number;
  /** 非 Git 项目时「变更」置灰，并以 hint 说明原因。 */
  readonly changesDisabled?: boolean;
  readonly changesHint?: string;
  /** 用于关联标签与页面的 id 前缀。 */
  readonly idPrefix: string;
}

/** 徽标最多显示 99+，避免撑宽窄面板。 */
function badge(count: number) {
  return count > 99 ? "99+" : String(count);
}

/**
 * 固定在标题行的「文件 / 变更」分段控件，支持左右方向键与 roving tabindex。
 * @param props [in] 当前标签、切换回调、变更数及置灰状态。
 * @returns role="tablist" 的分段控件。
 */
export function ReviewTabs(props: Props) {
  const list = useRef<HTMLDivElement>(null);
  const tabs: readonly { id: ReviewTab; label: string; disabled: boolean }[] = [
    { id: "files", label: "文件", disabled: false },
    { id: "changes", label: "变更", disabled: !!props.changesDisabled },
  ];
  const enabled = tabs.filter((item) => !item.disabled);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const index = enabled.findIndex((item) => item.id === props.tab);
    const next =
      event.key === "Home"
        ? enabled[0]
        : event.key === "End"
          ? enabled[enabled.length - 1]
          : enabled[(Math.max(index, 0) + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
    if (!next) return;
    props.onChange(next.id);
    list.current
      ?.querySelector<HTMLElement>(`[data-review-tab="${next.id}"]`)
      ?.focus();
  }

  return (
    <div
      ref={list}
      className="review-tabs"
      role="tablist"
      aria-label="文件与变更视图"
      onKeyDown={onKeyDown}
    >
      {tabs.map((item) => {
        const selected = props.tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${props.idPrefix}-tab-${item.id}`}
            data-review-tab={item.id}
            aria-selected={selected}
            aria-controls={`${props.idPrefix}-panel-${item.id}`}
            aria-disabled={item.disabled || undefined}
            tabIndex={selected ? 0 : -1}
            title={item.disabled ? props.changesHint : undefined}
            onClick={() => {
              if (!item.disabled) props.onChange(item.id);
            }}
          >
            {item.label}
            {item.id === "changes" && props.changeCount !== undefined && !item.disabled && (
              <span className="review-tab-count" aria-label={`${props.changeCount} 个变更文件`}>
                {badge(props.changeCount)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
