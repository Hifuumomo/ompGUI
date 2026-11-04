import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { durationText } from "./duration-text";
import { useNow } from "./use-now";
import { useStickyMeasure } from "./use-sticky-measure";
import "./tool-card.css";

/** 收起前记录的锚点。top 为被点击控件在视口中的纵坐标；footer 表示由底部收起条触发。 */
interface CollapseAnchor {
  readonly top: number;
  readonly footer: boolean;
}

/** 查找最近的纵向滚动祖先；参数：[in] node 起点元素。返回值：滚动容器，找不到时为 null。 */
export function scrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let current = node?.parentElement ?? null; current; current = current.parentElement) {
    const overflow = getComputedStyle(current).overflowY;
    if (overflow === "auto" || overflow === "scroll") return current;
  }
  return null;
}

/** 一轮过程的受控折叠容器；参数：[in] props 折叠状态、时间及正文。返回值：过程标题与可卸载正文。正文超过半屏时标题吸顶，正文末尾显示收起条。 */
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
  const section = useRef<HTMLElement>(null);
  const header = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLSpanElement>(null);
  const anchor = useRef<CollapseAnchor | null>(null);
  const previous = useRef(collapsed);
  const { sticky } = useStickyMeasure(body, !collapsed, null);
  const [stuck, setStuck] = useState(false);

  /** 记录被点击控件的位置后收起；参数：[in] source 被点击的控件，[in] footer 是否为底部收起条。返回值：无。 */
  function collapseFrom(source: HTMLElement, footer: boolean) {
    anchor.current = { top: source.getBoundingClientRect().top, footer };
    onToggle();
  }

  /** 标题点击：展开时按锚点收起，收起时直接展开；参数：[in] event 点击事件。返回值：无。 */
  function onHeaderClick(event: MouseEvent<HTMLButtonElement>) {
    if (collapsed) onToggle();
    else collapseFrom(event.currentTarget, false);
  }

  // 收起后让被点击的控件留在原来的屏幕位置；标题仍在滚动区上方时对齐到顶部。
  useLayoutEffect(() => {
    const opened = !previous.current;
    previous.current = collapsed;
    const saved = anchor.current;
    anchor.current = null;
    const head = header.current;
    if (!collapsed || !opened || !head) return;
    const scroller = scrollParent(section.current);
    if (scroller) {
      if (saved) scroller.scrollTop += head.getBoundingClientRect().top - saved.top;
      const limit = scroller.getBoundingClientRect().top;
      const top = head.getBoundingClientRect().top;
      if (top < limit) scroller.scrollTop -= limit - top;
    } else if (head.getBoundingClientRect().top < 0) {
      head.scrollIntoView?.({ block: "nearest" });
    }
    if (saved?.footer) head.focus({ preventScroll: true });
  }, [collapsed]);

  // 吸顶时把标题实际高度写给正文里的工具卡片，正文字号变化后跟着更新。
  useLayoutEffect(() => {
    const head = header.current;
    const root = section.current;
    if (!sticky || !head || !root) return;
    const write = () =>
      root.style.setProperty("--process-sticky-top", `${head.offsetHeight}px`);
    write();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(write);
    observer.observe(head);
    return () => observer.disconnect();
  }, [sticky]);

  // 哨兵越过滚动区顶部即表示标题已吸附，只用于显示分隔线。
  useEffect(() => {
    const node = sentinel.current;
    if (!sticky || !node || typeof IntersectionObserver === "undefined") {
      setStuck(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) =>
        setStuck(
          !entry.isIntersecting &&
            entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0),
        ),
      { root: scrollParent(section.current) },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [sticky]);

  return (
    <section
      ref={section}
      className="process-fold"
      data-collapsed={collapsed}
      data-sticky={sticky}
      data-stuck={sticky && stuck}
      aria-label="执行过程"
    >
      <span ref={sentinel} className="process-fold-sentinel" aria-hidden="true" />
      <button
        ref={header}
        type="button"
        className="process-fold-header"
        aria-expanded={!collapsed}
        aria-busy={!!active}
        onClick={onHeaderClick}
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
      {!collapsed && (
        <div ref={body} className="process-fold-body">
          {children}
          {sticky && (
            <button
              type="button"
              className="process-fold-footer"
              aria-label="收起执行过程"
              onClick={(event) => collapseFrom(event.currentTarget, true)}
            >
              <span className="process-fold-rule" aria-hidden="true" />
              <span className="process-fold-footer-label">
                <span aria-hidden="true">⌃</span> 收起执行过程
              </span>
              <span className="process-fold-rule" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
