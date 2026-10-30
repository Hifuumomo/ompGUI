import { useLayoutEffect, useRef, useState } from "react";
import "./pane-resize.css";

/** 为所属面板设置可持久保存的宽度，使用父容器限制宽度并给相邻内容保留空间。 */
export function PaneResizeHandle({
  storageKey,
  label,
  edge = "left",
  initialWidth,
  minWidth = 180,
  reserve = 260,
}: {
  readonly storageKey: string;
  readonly label: string;
  readonly edge?: "left" | "right";
  readonly initialWidth: number;
  readonly minWidth?: number;
  readonly reserve?: number;
}) {
  const handle = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [width, setWidth] = useState(initialWidth);
  const limits = useRef({ min: minWidth, max: initialWidth });
  const apply = useRef<(value: number, persist?: boolean) => void>(() => {});

  useLayoutEffect(() => {
    const pane = handle.current?.parentElement;
    const container = pane?.parentElement;
    if (!pane || !container) return;
    let preferred = initialWidth;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null && Number.isFinite(Number(saved))) preferred = Number(saved);
    } catch { /* 禁用存储时仍可拖动。 */ }
    const update = (value: number, persist = false) => {
      const max = Math.max(80, container.clientWidth - reserve);
      const min = Math.min(minWidth, max);
      limits.current = { min, max };
      const next = Math.max(min, Math.min(max, value));
      pane.style.width = `${next}px`;
      setWidth(next);
      if (persist) {
        preferred = next;
        try { localStorage.setItem(storageKey, String(next)); } catch { /* 当前窗口继续使用。 */ }
      }
    };
    apply.current = update;
    update(preferred);
    const resize = () => update(preferred);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    observer?.observe(container);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      pane.style.removeProperty("width");
    };
  }, [storageKey, initialWidth, minWidth, reserve]);

  return (
    <button
      ref={handle}
      type="button"
      className={`pane-resize-handle pane-resize-${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={limits.current.min}
      aria-valuemax={limits.current.max}
      aria-valuenow={Math.round(width)}
      title={`${label}；双击恢复默认`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start) apply.current(start.width + (event.clientX - start.x) * (edge === "left" ? -1 : 1), true);
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => apply.current(initialWidth, true)}
      onKeyDown={(event) => {
        const direction = edge === "left" ? -1 : 1;
        const next = event.key === "ArrowLeft" ? width - 10 * direction
          : event.key === "ArrowRight" ? width + 10 * direction
          : event.key === "Home" ? limits.current.min
          : event.key === "End" ? limits.current.max : undefined;
        if (next === undefined) return;
        event.preventDefault();
        apply.current(next, true);
      }}
    />
  );
}
