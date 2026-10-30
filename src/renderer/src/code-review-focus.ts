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
  const targets = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
    ),
  ];
  const first = targets[0];
  const last = targets.at(-1);
  const outside = !targets.includes(document.activeElement as HTMLElement);
  if (outside || document.activeElement === (event.shiftKey ? first : last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}
