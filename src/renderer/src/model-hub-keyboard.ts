import type { KeyboardEvent } from "react";
import type { NativeCatalogModel } from "../../shared/native-model";
import {
  activateRole,
  pickHubModel,
  roleAction,
  switchHubPreset,
  type HubActionContext,
} from "./model-hub-actions";
import {
  hubScopes,
  MODEL_KIND_TABS,
  MODEL_PAGE_STEP,
  movedIndex,
  ROLE_TABS,
  type HubRoleRow,
} from "./model-hub-state";

interface HubMenu {
  readonly models: readonly NativeCatalogModel[];
  readonly rows: readonly HubRoleRow[];
  readonly rolesView: boolean;
}

export function cancelModelHub(ctx: HubActionContext) {
  if (ctx.state.strip) {
    const returns =
      ctx.state.strip.kind === "choices" && ctx.state.strip.returnToRoles;
    ctx.patch(
      returns
        ? { strip: undefined, assigning: undefined, scope: "roles", index: 0 }
        : { strip: undefined },
    );
    return;
  }
  if (ctx.state.assigning) {
    ctx.patch({ assigning: undefined, scope: "roles", index: 0 });
    return;
  }
  if (ctx.state.query) {
    ctx.patch({ query: "", index: 0 });
    return;
  }
  ctx.close();
}

function stripKey(event: KeyboardEvent, ctx: HubActionContext): boolean {
  const strip = ctx.state.strip;
  if (!strip) return false;
  if (event.key === "Escape") {
    event.preventDefault();
    cancelModelHub(ctx);
    return true;
  }
  if (strip.kind === "name") {
    if (event.key === "Enter") {
      event.preventDefault();
      strip.submit(strip.value);
    }
    return true;
  }
  const backward =
    ["ArrowLeft", "ArrowUp"].includes(event.key) ||
    (event.key === "Tab" && event.shiftKey);
  const forward = ["ArrowRight", "ArrowDown", "Tab"].includes(event.key);
  if (backward || forward) {
    event.preventDefault();
    ctx.patch({
      strip: {
        ...strip,
        index: movedIndex(strip.index, backward ? -1 : 1, strip.choices.length),
      },
    });
  } else if (event.key === "Enter") {
    event.preventDefault();
    strip.choices[strip.index]?.choose();
  }
  return true;
}

function paneKey(
  event: KeyboardEvent,
  ctx: HubActionContext,
  menu: HubMenu,
): boolean {
  if (ctx.temporary) return false;
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  if (
    event.ctrlKey &&
    ["ArrowLeft", "ArrowRight"].includes(event.key) &&
    menu.rolesView
  ) {
    switchHubPreset(ctx, direction);
    return true;
  }
  if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    const tabs: readonly string[] = menu.rolesView
      ? ROLE_TABS
      : MODEL_KIND_TABS;
    const selected = menu.rolesView ? ctx.state.roleTab : ctx.state.kind;
    const next =
      tabs[movedIndex(tabs.indexOf(selected), direction, tabs.length)];
    ctx.patch(
      menu.rolesView ? { roleTab: next, index: 0 } : { kind: next, index: 0 },
    );
    return true;
  }
  const panes: Record<string, "scope" | "list"> = {
    ArrowLeft: "scope",
    ArrowRight: "list",
  };
  if (!ctx.temporary && Object.hasOwn(panes, event.key)) {
    ctx.patch({ focus: panes[event.key] });
    return true;
  }
  if (!ctx.temporary && event.key === "Tab") {
    ctx.patch({ focus: ctx.state.focus === "scope" ? "list" : "scope" });
    return true;
  }
  return false;
}

function navigationKey(
  event: KeyboardEvent,
  ctx: HubActionContext,
  menu: HubMenu,
): boolean {
  const steps: Record<string, number> = {
    ArrowUp: -1,
    ArrowDown: 1,
    PageUp: ctx.temporary ? -8 : -MODEL_PAGE_STEP,
    PageDown: ctx.temporary ? 8 : MODEL_PAGE_STEP,
  };
  if (!Object.hasOwn(steps, event.key)) return false;
  if (event.shiftKey && menu.rolesView && ctx.state.focus === "list") {
    roleAction(
      ctx,
      menu.rows[ctx.state.index],
      steps[event.key] < 0 ? "[" : "]",
    );
    return true;
  }
  if (ctx.state.focus === "scope" && !ctx.temporary) {
    const scopes = hubScopes(ctx.data);
    const current = scopes.findIndex((scope) => scope.id === ctx.state.scope);
    const scope =
      scopes[movedIndex(current, steps[event.key], scopes.length)].id;
    ctx.patch({
      scope,
      index: 0,
      assigning: scope === "roles" ? undefined : ctx.state.assigning,
    });
  } else
    ctx.patch({
      index: movedIndex(
        ctx.state.index,
        steps[event.key],
        menu.rolesView ? menu.rows.length : menu.models.length,
      ),
    });
  return true;
}

function enterKey(ctx: HubActionContext, menu: HubMenu) {
  const provider = ctx.data.providers.find(
    (item) => `provider:${item.id}` === ctx.state.scope,
  );
  if (provider?.locked) {
    ctx.run({ op: "login", provider: provider.id });
    return;
  }
  if (ctx.state.focus === "scope") {
    ctx.patch({ focus: "list" });
    return;
  }
  if (menu.rolesView) {
    const row = menu.rows[ctx.state.index];
    if (row) activateRole(ctx, row);
    return;
  }
  const model = menu.models[ctx.state.index];
  if (model) pickHubModel(ctx, model);
}

function textKey(
  event: KeyboardEvent,
  ctx: HubActionContext,
  menu: HubMenu,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const roleKeys = [
    "x",
    "f",
    "c",
    "[",
    "]",
    "n",
    "t",
    "k",
    "s",
    "p",
    "P",
    "Delete",
    "Backspace",
  ];
  if (
    menu.rolesView &&
    ctx.state.focus === "list" &&
    roleKeys.includes(event.key)
  ) {
    roleAction(ctx, menu.rows[ctx.state.index], event.key);
    return true;
  }
  if (event.target instanceof HTMLInputElement) return false;
  if (event.key === "Backspace") {
    ctx.patch({ query: ctx.state.query.slice(0, -1), index: 0 });
    return true;
  }
  if (event.key.length !== 1) return false;
  ctx.patch({
    query: ctx.state.query + event.key,
    focus: "list",
    scope: menu.rolesView ? "all" : ctx.state.scope,
    index: 0,
  });
  return true;
}

export function modelHubKey(
  event: KeyboardEvent,
  ctx: HubActionContext,
  menu: HubMenu,
) {
  event.stopPropagation();
  if (stripKey(event, ctx)) return;
  if (event.key === "Escape") {
    event.preventDefault();
    cancelModelHub(ctx);
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
      event.key.toLowerCase() === "p" && ctx.temporary) {
    event.preventDefault();
    if (!event.repeat) ctx.patch({
      task: !ctx.state.task,
      query: ctx.state.query.startsWith("@") ? "" : ctx.state.query,
      index: 0,
    });
    return;
  }
  if (
    paneKey(event, ctx, menu) ||
    navigationKey(event, ctx, menu) ||
    textKey(event, ctx, menu)
  ) {
    event.preventDefault();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    enterKey(ctx, menu);
    return;
  }
  if (event.key === "F5") {
    event.preventDefault();
    ctx.run({
      op: "refresh",
      provider: ctx.state.scope.startsWith("provider:")
        ? ctx.state.scope.slice("provider:".length)
        : undefined,
    });
  }
}
