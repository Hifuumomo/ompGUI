import type { KeyboardEvent } from "react";
import { AGENT_SCOPES } from "./agents-hub-state";
import type { AgentsContext } from "./use-agents-hub";

function back(context: AgentsContext) {
  const { state, patch, close } = context;
  if (["pattern", "models"].includes(state.stage)) patch({ stage: "property" });
  else if (state.stage === "property") patch({ stage: "agent" });
  else if (state.stage === "create")
    patch({
      stage: "list",
      scope: state.scope === "new" ? "all" : state.scope,
    });
  else if (state.stage !== "list") patch({ stage: "list" });
  else if (state.query) patch({ query: "", index: 0 });
  else close();
}

function moveList(context: AgentsContext, direction: number) {
  const { state, patch, rows } = context;
  if (state.focus === "scope") {
    const index = Math.max(
      0,
      Math.min(
        AGENT_SCOPES.length - 1,
        AGENT_SCOPES.indexOf(state.scope) + direction,
      ),
    );
    patch({ scope: AGENT_SCOPES[index], index: 0 });
  } else
    patch({
      index: Math.max(0, Math.min(rows.length, state.index + direction)),
    });
}

function listKey(event: KeyboardEvent, context: AgentsContext): boolean {
  const { state, patch, selected } = context;
  if (["ArrowUp", "ArrowDown"].includes(event.key)) {
    moveList(context, event.key === "ArrowUp" ? -1 : 1);
  } else if (event.key === "Enter") {
    if (state.scope === "new" || !selected) context.beginCreate();
    else if (state.focus === "scope") patch({ focus: "list" });
    else patch({ stage: "agent" });
  } else if (event.key === " " && !state.query && selected) {
    context.run({
      op: "toggle",
      name: selected.name,
      disabled: !selected.disabled,
    });
  } else return false;
  return true;
}

function createKey(event: KeyboardEvent, context: AgentsContext) {
  if (event.key === "Tab")
    context.patch({
      createScope: context.state.createScope === "project" ? "user" : "project",
    });
  else if (context.spec) return previewKey(event, context);
  else if (
    event.key === "Enter" &&
    (event.ctrlKey || event.altKey || event.metaKey)
  )
    context.generate();
  else return false;
  return true;
}

function previewKey(event: KeyboardEvent, context: AgentsContext) {
  if (event.key === "Enter") context.save();
  else if (event.key.toLowerCase() === "r") context.generate();
  else return false;
  return true;
}

function focusChips(event: KeyboardEvent): boolean {
  if (!["ArrowLeft", "ArrowRight", "Tab"].includes(event.key)) return false;
  if ((event.target as HTMLElement).matches("input, textarea")) return false;
  const strip = (event.target as HTMLElement).closest(".agents-strip");
  if (!strip) return false;
  const buttons = [
    ...strip.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  ];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const delta = event.key === "ArrowLeft" || event.shiftKey ? -1 : 1;
  buttons[(current + delta + buttons.length) % buttons.length]?.focus();
  return true;
}

function trapTab(event: KeyboardEvent) {
  const dialog = event.currentTarget as HTMLElement;
  const controls = [
    ...dialog.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary",
    ),
  ];
  const index = controls.indexOf(document.activeElement as HTMLElement);
  const direction = event.shiftKey ? -1 : 1;
  controls[(index + direction + controls.length) % controls.length]?.focus();
  event.preventDefault();
}

function paneKey(event: KeyboardEvent, context: AgentsContext) {
  const { state, patch } = context;
  const input = (event.target as HTMLElement).matches("input, textarea");
  if (
    event.key === "Tab" ||
    (!input && ["ArrowLeft", "ArrowRight"].includes(event.key))
  ) {
    patch({
      focus:
        event.key === "ArrowLeft"
          ? "scope"
          : event.key === "ArrowRight"
            ? "list"
            : state.focus === "scope"
              ? "list"
              : "scope",
    });
    return true;
  }
  return false;
}

function searchKey(event: KeyboardEvent, context: AgentsContext) {
  const { state, patch } = context;
  if ((event.target as HTMLElement).matches("input, textarea")) return false;
  if (
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key.length === 1
  ) {
    patch({ query: state.query + event.key, index: 0, focus: "list" });
    return true;
  }
  if (event.key === "Backspace") {
    patch({ query: state.query.slice(0, -1), index: 0 });
    return true;
  }
  return false;
}

function browseKey(event: KeyboardEvent, context: AgentsContext) {
  if (context.state.stage !== "list") return focusChips(event);
  return (
    paneKey(event, context) ||
    listKey(event, context) ||
    searchKey(event, context)
  );
}

export function agentsHubKey(event: KeyboardEvent, context: AgentsContext) {
  event.stopPropagation();
  if (event.nativeEvent.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    if (!context.busy) back(context);
    return;
  }
  if (context.busy) {
    if (event.key === "Tab") trapTab(event);
    return;
  }
  if (event.ctrlKey && event.key.toLowerCase() === "r") {
    event.preventDefault();
    context.run({ op: "list" });
    return;
  }
  const handled =
    context.state.stage === "create"
      ? createKey(event, context)
      : browseKey(event, context);
  if (handled) event.preventDefault();
  else if (event.key === "Tab") trapTab(event);
}
