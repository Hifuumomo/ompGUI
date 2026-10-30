import { useEffect, useLayoutEffect, useRef } from "react";
import type { KeyboardEventHandler, RefObject } from "react";

/** 为已挂载的浮层统一处理初始焦点、外部点击及键盘导航。 */
export function usePopover(onClose: () => void, trigger: RefObject<HTMLButtonElement | null>): {
  ref: RefObject<HTMLDivElement | null>;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
} {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && !trigger.current?.contains(event.target)) close.current();
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [trigger]);

  const onKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close.current();
      trigger.current?.focus({ preventScroll: true });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    // 搜索输入保留光标编辑快捷键，仅向下键进入候选列表。
    const editing = event.target instanceof HTMLElement && (event.target.matches("input, textarea") || event.target.isContentEditable);
    if (editing && event.key !== "ArrowDown") return;
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const index = items.findIndex((item) => item === document.activeElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : index < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1)
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return { ref, onKeyDown };
}
