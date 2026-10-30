import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { PaneResizeHandle } from "./PaneResizeHandle";
import { usePopover } from "./usePopover";

export interface PlanHeading {
  text: string;
  element: HTMLElement;
  depth: number;
}

/** 从编辑器实际 DOM 获取标题，以正文滚动容器为坐标原点追踪当前章节。 */
export function usePlanToc(body: RefObject<HTMLDivElement | null>, documentKey: string): {
  headings: PlanHeading[];
  active: HTMLElement | null;
} {
  const [headings, setHeadings] = useState<PlanHeading[]>([]);
  const [active, setActive] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    let current: PlanHeading[] = [];
    let frame: number | undefined;
    const updateActive = () => {
      frame = undefined;
      const rootTop = root.getBoundingClientRect().top + root.clientTop;
      let next = current[0]?.element ?? null;
      for (const heading of current) {
        // 编辑器内部可能有多层定位容器，不能直接把标题 offsetTop 当作正文坐标。
        const top = heading.element.getBoundingClientRect().top - rootTop + root.scrollTop;
        if (top <= root.scrollTop + 16) next = heading.element;
      }
      setActive(next);
    };
    const schedule = () => {
      if (frame === undefined) frame = requestAnimationFrame(updateActive);
    };
    const scan = () => {
      current = [...root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")].map((element) => ({ element, text: element.textContent ?? "", depth: Number(element.tagName.slice(1)) }));
      setHeadings(current);
      schedule();
    };
    const observer = new MutationObserver(scan);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    root.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // 图片、编辑器和侧栏宽度变化也可能改变标题位置。
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    resize?.observe(root);
    root.addEventListener("load", schedule, true);
    scan();
    return () => {
      observer.disconnect();
      resize?.disconnect();
      root.removeEventListener("scroll", schedule);
      root.removeEventListener("load", schedule, true);
      window.removeEventListener("resize", schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [body, documentKey]);
  return { headings, active };
}

/** 两种目录外观共用同一份标题数据，显示方式由父面板容器查询决定。 */
export function PlanToc({ headings, active, variant }: {
  headings: PlanHeading[];
  active: HTMLElement | null;
  variant: "rail" | "dropdown";
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("omp-desktop.plan-toc-collapsed") === "true"; }
    catch { return false; }
  });
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const current = headings.find((heading) => heading.element === active)?.text || "目录";
  const items = (onSelect?: () => void) => <div className="plan-toc-list">
    {headings.map((heading, index) => <button type="button" key={index} role={variant === "dropdown" ? "menuitem" : undefined} aria-current={heading.element === active ? "location" : undefined} style={{ paddingLeft: `${12 + (heading.depth - 1) * 10}px` }} onClick={() => { heading.element.scrollIntoView({ block: "start" }); onSelect?.(); }}>
      {heading.text || "未命名标题"}
    </button>)}
    {!headings.length && <p className="plan-toc-empty">暂无标题</p>}
  </div>;

  if (variant === "dropdown") return <div className="plan-toc-dropdown">
    <button type="button" ref={trigger} className="plan-toc-trigger" aria-label={`目录：${current}`} aria-expanded={open} aria-haspopup="menu" aria-controls={open ? menuId : undefined} onClick={() => setOpen((value) => !value)}>☰ {current} ▾</button>
    {open && <TocMenu id={menuId} trigger={trigger} onClose={() => setOpen(false)}>{items(() => {
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    })}</TocMenu>}
  </div>;

  return <nav className={`plan-toc-rail${collapsed ? " is-collapsed" : ""}`} aria-label="计划目录">
    <button type="button" className="plan-toc-toggle" aria-label={collapsed ? "展开目录" : "折叠目录"} aria-expanded={!collapsed} title={collapsed ? "展开目录" : "折叠目录"} onClick={() => {
      const next = !collapsed;
      setCollapsed(next);
      try { localStorage.setItem("omp-desktop.plan-toc-collapsed", String(next)); }
      catch { /* 禁用存储时仍可在当前窗口折叠。 */ }
    }}>{collapsed ? "»" : "«"}{!collapsed && <span>目录</span>}</button>
    {!collapsed && <>
      {items()}
      <PaneResizeHandle storageKey="omp-desktop.plan-toc-width" label="调整计划目录宽度" edge="right" initialWidth={168} minWidth={120} reserve={260} />
    </>}
  </nav>;
}

/** 仅在下拉菜单挂载时启动浮层事件和焦点管理。 */
function TocMenu({ id, trigger, onClose, children }: {
  id: string;
  trigger: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const popover = usePopover(onClose, trigger);
  return <div {...popover} id={id} className="plan-toc-menu" role="menu" aria-label="计划章节">{children}</div>;
}
