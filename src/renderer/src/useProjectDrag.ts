import { useEffect, useRef, useState, type PointerEvent } from "react";

type Drop = { cwd: string; position: "before" | "after" };

/** 管理目录指针排序、边缘自动滚动和滚轮滚动；卸载或取消时清理监听。 */
export function useProjectDrag(
  move: (source: string, target: string, position: Drop["position"]) => void,
  suppressClick: { current: boolean },
) {
  const list = useRef<HTMLElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const moveRef = useRef(move);
  moveRef.current = move;
  const [draggedProject, setDraggedProject] = useState<string | null>(null);
  const [projectDrop, setProjectDrop] = useState<Drop | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  /** 左键移动超过阈值后开始排序，轻点仍交由原来的折叠按钮处理。 */
  function start(event: PointerEvent<HTMLButtonElement>, cwd: string) {
    if (event.button !== 0 || event.isPrimary === false) return;
    cleanup.current?.();
    suppressClick.current = false;
    const element = list.current;
    if (!element) return;
    const pointerId = event.pointerId;
    const originX = event.clientX;
    const originY = event.clientY;
    let x = originX;
    let y = originY;
    let active = false;
    let drop: Drop | null = null;
    let frame = 0;
    let lastTime = 0;

    /** 用最新布局计算落点，滚动后无需再次移动鼠标即可更新。 */
    function locate() {
      const bounds = element!.getBoundingClientRect();
      let next: Drop | null = null;
      if (
        x >= bounds.left &&
        x <= bounds.right &&
        y >= bounds.top &&
        y <= bounds.bottom
      ) {
        const headings = [
          ...element!.querySelectorAll<HTMLButtonElement>(".project-toggle"),
        ];
        const target =
          headings.find((button) => {
            const rect = button.getBoundingClientRect();
            return y <= rect.bottom;
          }) ?? headings.at(-1);
        if (target) {
          const targetCwd = target
            .closest(".project-group")
            ?.getAttribute("aria-label");
          if (targetCwd && targetCwd !== cwd) {
            const rect = target.getBoundingClientRect();
            next = {
              cwd: targetCwd,
              position: y < rect.top + rect.height / 2 ? "before" : "after",
            };
          }
        }
      }
      if (next?.cwd !== drop?.cwd || next?.position !== drop?.position) {
        drop = next;
        setProjectDrop(next);
      }
    }

    /** 靠近或越过上下边缘时按距离连续滚动，横向离开目录栏则停止。 */
    function tick(time: number) {
      const bounds = element!.getBoundingClientRect();
      const edge = Math.min(48, bounds.height / 3);
      const elapsed = lastTime ? Math.min(time - lastTime, 40) : 16;
      lastTime = time;
      if (edge > 0 && x >= bounds.left && x <= bounds.right) {
        const speed =
          y < bounds.top + edge
            ? -Math.min(1, (bounds.top + edge - y) / edge)
            : y > bounds.bottom - edge
              ? Math.min(1, (y - bounds.bottom + edge) / edge)
              : 0;
        element!.scrollTop += speed * elapsed * 0.6;
      }
      locate();
      frame = requestAnimationFrame(tick);
    }

    /** 跟踪本次指针，防止拖动期间选中文字。 */
    function onMove(e: globalThis.PointerEvent) {
      if (e.pointerId !== pointerId) return;
      x = e.clientX;
      y = e.clientY;
      if (!active && Math.hypot(x - originX, y - originY) >= 5) {
        active = true;
        suppressClick.current = true;
        setDraggedProject(cwd);
        frame = requestAnimationFrame(tick);
      }
      if (active) {
        e.preventDefault();
        locate();
      }
    }

    /** 拖动期间将滚轮交给目录栏，兼容像素、行与页三种增量单位。 */
    function onWheel(e: WheelEvent) {
      if (!active) return;
      e.preventDefault();
      const unit =
        e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? element!.clientHeight : 1;
      element!.scrollTop += e.deltaY * unit;
      locate();
    }

    /** 结束本次交互并释放全部监听器及动画帧。 */
    function finish() {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", finish);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel, true);
      setDraggedProject(null);
      setProjectDrop(null);
      cleanup.current = null;
    }

    /** 只在目录栏内松开时提交排序，外部松开视为取消。 */
    function onUp(e: globalThis.PointerEvent) {
      if (e.pointerId !== pointerId) return;
      x = e.clientX;
      y = e.clientY;
      if (active) {
        locate();
        if (drop) moveRef.current(cwd, drop.cwd, drop.position);
      }
      finish();
    }
    /** 忽略其他指针的取消事件。 */
    function onCancel(e: globalThis.PointerEvent) {
      if (e.pointerId === pointerId) finish();
    }
    /** Escape 取消排序且不修改目录顺序。 */
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      }
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", finish);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, {
      passive: false,
      capture: true,
    });
    cleanup.current = finish;
  }
  return { list, start, draggedProject, projectDrop };
}
