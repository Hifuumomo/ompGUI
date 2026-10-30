import { useEffect, useRef } from "react";

export const DOUBLE_ARROW_WINDOW_MS = 500;
export function hasShortcutModifier(event: KeyboardEvent) {
  return event.ctrlKey || event.altKey || event.metaKey;
}
export function createDoubleArrow() {
  let previous: { key: string; time: number } | undefined;
  return (event: KeyboardEvent) => {
    const arrow = event.key === "ArrowRight" || event.key === "ArrowLeft";
    if (
      !arrow ||
      event.repeat ||
      event.isComposing ||
      hasShortcutModifier(event) ||
      event.shiftKey
    ) {
      previous = undefined;
      return false;
    }
    const match =
      previous?.key === event.key &&
      event.timeStamp - previous.time <= DOUBLE_ARROW_WINDOW_MS;
    previous = match ? undefined : { key: event.key, time: event.timeStamp };
    return match;
  };
}

interface ShortcutOptions {
  readonly enabled: boolean;
  readonly onOpen: () => void;
}
export function useSubagentShortcut(options: ShortcutOptions) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const doubleArrow = createDoubleArrow();
    function onKey(event: KeyboardEvent) {
      if (!latest.current.enabled || event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input,select,button,[contenteditable=""],[contenteditable="true"]',
        )
      )
        return;
      if (target instanceof HTMLTextAreaElement && target.value.length) return;
      if (!doubleArrow(event)) return;
      event.preventDefault();
      latest.current.onOpen();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options.enabled]);
}
