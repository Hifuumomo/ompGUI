import { useEffect, useRef, useState, type PointerEvent } from "react";

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const STORAGE_KEY = "omp-desktop.sidebar-width";
const defaultWidth = () => (window.innerWidth <= 1200 ? 220 : 254);
const maximumWidth = () =>
  Math.max(
    MIN_WIDTH,
    Math.min(MAX_WIDTH, Math.floor(window.innerWidth * 0.45)),
  );
const bounded = (value: number) =>
  Math.max(MIN_WIDTH, Math.min(maximumWidth(), value));

/** 持久保存侧栏宽度；窗口变窄时给聊天区保留空间。 */
export function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      const parsed = value === null ? defaultWidth() : Number(value);
      return bounded(Number.isFinite(parsed) ? parsed : defaultWidth());
    } catch {
      return defaultWidth();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      /* 仍可调整当前窗口。 */
    }
  }, [width]);
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth > 800) setWidth((previous) => bounded(previous));
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return { width, setWidth };
}

/** 指针捕获保证拖出边界后继续调整，键盘方向键及双击也可操作。 */
export function SidebarResizeHandle({
  width,
  onWidth,
}: {
  width: number;
  onWidth: (value: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  function stop(event: PointerEvent<HTMLButtonElement>) {
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <button
      type="button"
      className="sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整会话侧栏宽度"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maximumWidth()}
      aria-valuenow={width}
      title="拖动调整侧栏宽度，双击恢复默认"
      data-dragging={dragging || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.clientX,
          width:
            event.currentTarget.parentElement!.getBoundingClientRect().width,
        };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          onWidth(bounded(drag.current.width + event.clientX - drag.current.x));
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onDoubleClick={() => onWidth(defaultWidth())}
      onKeyDown={(event) => {
        const value =
          event.key === "ArrowLeft"
            ? width - 10
            : event.key === "ArrowRight"
              ? width + 10
              : event.key === "Home"
                ? MIN_WIDTH
                : event.key === "End"
                  ? maximumWidth()
                  : undefined;
        if (value === undefined) return;
        event.preventDefault();
        onWidth(bounded(value));
      }}
    />
  );
}
