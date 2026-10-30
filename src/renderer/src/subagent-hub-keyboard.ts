import type { KeyboardEvent } from "react";
import { hasShortcutModifier } from "./subagent-shortcut";

function isSelectionEnter(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Enter") return false;
  return (
    !(event.target instanceof HTMLButtonElement) ||
    event.target.getAttribute("role") === "option"
  );
}

export function trapSubagentFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Tab") return false;
  const nodes = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input,select,[tabindex="0"]',
    ),
  ];
  const index = nodes.indexOf(document.activeElement as HTMLElement);
  const next = event.shiftKey
    ? index <= 0
      ? nodes.length - 1
      : index - 1
    : (index + 1) % nodes.length;
  nodes[next]?.focus();
  event.preventDefault();
  return true;
}

export interface HubKeys {
  readonly back: () => void;
  readonly search: () => void;
  readonly tab: (tab: "agents" | "activity") => void;
  readonly move: (delta: number) => void;
  readonly enter: () => void;
  readonly group: () => void;
  readonly filter: () => void;
  readonly scope: () => void;
  readonly follow: () => void;
}
export function handleSubagentKey(
  event: KeyboardEvent<HTMLDivElement>,
  keys: HubKeys,
  doubleArrow: (event: globalThis.KeyboardEvent) => boolean,
) {
  event.stopPropagation();
  if (event.nativeEvent.isComposing || hasShortcutModifier(event.nativeEvent))
    return;
  if (trapSubagentFocus(event)) return;
  if (event.key === "Escape") {
    event.preventDefault();
    keys.back();
    return;
  }
  if ((event.target as HTMLElement).matches("input,select")) return;
  if (doubleArrow(event.nativeEvent) && event.key === "ArrowLeft") {
    event.preventDefault();
    keys.back();
    return;
  }
  const actions = navigationActions(keys);
  if (isSelectionEnter(event)) {
    event.preventDefault();
    keys.enter();
    return;
  }
  if (!actions[event.key]) return;
  event.preventDefault();
  actions[event.key]();
  if (["ArrowDown", "ArrowUp", "j", "k", "1", "2"].includes(event.key))
    event.currentTarget.focus();
}

function navigationActions(keys: HubKeys) {
  const actions: Record<string, () => void> = {
    "1": () => keys.tab("agents"),
    "2": () => keys.tab("activity"),
    ArrowLeft: () => keys.tab("agents"),
    "/": keys.search,
    ArrowDown: () => keys.move(1),
    j: () => keys.move(1),
    ArrowUp: () => keys.move(-1),
    k: () => keys.move(-1),
    t: keys.group,
    f: keys.filter,
    s: keys.scope,
    " ": keys.follow,
  };
  return actions;
}
