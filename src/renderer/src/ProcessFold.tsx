import { useLayoutEffect, useRef, type ReactNode } from "react";
import { durationText } from "./duration-text";
import { useNow } from "./use-now";
import "./tool-card.css";

/** 一轮过程的受控折叠容器；参数：[in] props 折叠状态、时间及正文。返回值：过程标题与可卸载正文。 */
export function ProcessFold({
  collapsed,
  onToggle,
  active,
  startedAt,
  endedAt,
  failures,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  active?: boolean;
  startedAt?: number;
  endedAt?: number;
  failures: number;
  children: ReactNode;
}) {
  const now = useNow(!!active);
  const header = useRef<HTMLButtonElement>(null);
  const previous = useRef(collapsed);
  useLayoutEffect(() => {
    if (
      collapsed &&
      !previous.current &&
      (header.current?.getBoundingClientRect().top ?? 0) < 0
    )
      header.current?.scrollIntoView?.({ block: "nearest" });
    previous.current = collapsed;
  }, [collapsed]);
  return (
    <section
      className="process-fold"
      data-collapsed={collapsed}
      aria-label="执行过程"
    >
      <button
        ref={header}
        type="button"
        className="process-fold-header"
        aria-expanded={!collapsed}
        aria-busy={!!active}
        onClick={onToggle}
      >
        <span className="process-fold-title">执行过程</span>
        {startedAt !== undefined && (
          <span className="process-fold-time">
            {active ? "· 运行中 " : ""}
            {durationText((active ? now : (endedAt ?? startedAt)) - startedAt)}
          </span>
        )}
        {failures > 0 && (
          <span className="process-fold-failures">· {failures} 个失败</span>
        )}
        <span className="process-fold-chevron" aria-hidden="true">
          {collapsed ? "›" : "⌄"}
        </span>
        <span className="process-fold-rule" aria-hidden="true" />
      </button>
      {!collapsed && <div className="process-fold-body">{children}</div>}
    </section>
  );
}
