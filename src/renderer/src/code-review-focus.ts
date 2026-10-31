import { useEffect, useRef, type KeyboardEvent } from "react";

export function useReviewFocus() {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return root;
}

export function reviewKeys(
  event: KeyboardEvent<HTMLElement>,
  options: {
    readonly fullscreen: boolean;
    readonly onClose: () => void;
  },
) {
  // 浏览器内的按键不能触发会话的停止、回退或模型切换。
  event.stopPropagation();
  if (event.nativeEvent.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    options.onClose();
    return;
  }
  if (event.key !== "Tab" || !options.fullscreen) return;
  // 标签页的 roving tabindex 会让未选中标签为 -1，隐藏的页面与目录栏也不能获得焦点，
  // 它们都不能作为循环的首尾目标。
  const targets = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
    ),
  ].filter((element) => !element.closest("[hidden]"));
  const first = targets[0];
  const last = targets.at(-1);
  const outside = !targets.includes(document.activeElement as HTMLElement);
  if (outside || document.activeElement === (event.shiftKey ? first : last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}
