import type { HubRoleRow } from "./model-hub-state";
import { movedOrder } from "./model-hub-state";
import type { HubActionContext } from "./model-hub-context";
import { thinking, startAssignment } from "./model-hub-assignments";
import type { NativeCatalogModel } from "../../shared/native-model";
export { pickHubModel } from "./model-hub-assignments";
export type { HubActionContext } from "./model-hub-context";

function nameInput(ctx: HubActionContext, purpose: "role" | "preset") {
  ctx.patch({
    strip: {
      kind: "name",
      title: purpose === "role" ? "New role" : "Save preset",
      value: "",
      submit: (value) => {
        const name = value.trim();
        if (purpose === "preset")
          ctx.run({ op: "savePreset", name }, () =>
            ctx.patch({ strip: undefined }),
          );
        else startAssignment(ctx, { role: name });
      },
    },
  });
}

export function activateRole(ctx: HubActionContext, row: HubRoleRow) {
  if (row.kind === "newRole") {
    nameInput(ctx, "role");
    return;
  }
  if (row.kind === "newFallback") {
    ctx.patch({
      strip: {
        kind: "name",
        title: "Fallback role / provider/model / provider/*",
        value: "",
        submit: (role) =>
          startAssignment(ctx, { role: role.trim(), chainIndex: null }),
      },
    });
    return;
  }
  startAssignment(ctx, {
    role: row.role!,
    chainIndex: row.kind === "role" ? undefined : (row.chainIndex ?? null),
  });
}

function clearRow(ctx: HubActionContext, row: HubRoleRow) {
  if (!row.role) return;
  if (row.kind === "role") {
    const role = ctx.data.roles.find((item) => item.role === row.role)!;
    ctx.run({
      op: "clear",
      role: row.role,
      scope: role.source === "default" ? ctx.data.storage : role.source,
    });
  } else
    ctx.run({
      op: "fallback",
      role: row.role,
      chain:
        row.kind === "chain"
          ? []
          : (ctx.data.fallbackChains[row.role] ?? []).filter(
              (_, index) => index !== row.chainIndex,
            ),
    });
}

function reorderRow(ctx: HubActionContext, row: HubRoleRow, delta: number) {
  if (!row.role) return;
  if (row.kind === "role") {
    ctx.run({
      op: "cycle",
      order: movedOrder(ctx.data.cycleOrder, row.role, delta),
    });
    return;
  }
  if (row.kind !== "fallback") return;
  const chain = ctx.data.fallbackChains[row.role];
  ctx.run({
    op: "fallback",
    role: row.role,
    chain: movedOrder(chain, row.selector!, delta),
  });
}

function editChainThinking(
  ctx: HubActionContext,
  row: HubRoleRow,
  model: NativeCatalogModel,
) {
  if (!model.thinkingLevels.length) return;
  ctx.patch({
    strip: {
      kind: "choices",
      title: "Fallback · Thinking",
      index: 0,
      choices: model.thinkingLevels.map((level) => ({
        label: level,
        choose: () => {
          const selector =
            level === "inherit" ? model.selector : `${model.selector}:${level}`;
          const chain = ctx.data.fallbackChains[row.role!].map(
            (value, index) => (index === row.chainIndex ? selector : value),
          );
          ctx.run({ op: "fallback", role: row.role!, chain }, () =>
            ctx.patch({ strip: undefined }),
          );
        },
      })),
    },
  });
}

function editRoleModel(ctx: HubActionContext, row: HubRoleRow, action: string) {
  const role = ctx.data.roles.find((item) => item.role === row.role);
  const selector = row.selector ?? role?.resolvedSelector;
  const model =
    ctx.data.models.find((item) => item.selector === selector) ??
    ctx.data.models.find((item) =>
      item.thinkingLevels.some(
        (level) => selector === `${item.selector}:${level}`,
      ),
    );
  if (!model || !row.role) return;
  if (action === "k") {
    ctx.patch({
      strip: {
        kind: "name",
        title: "Compaction point · 90000 / 90k / 1m / 80% / empty resets",
        value: model.compaction?.draft ?? "",
        submit: (value) =>
          ctx.run({ op: "compaction", selector: model.selector, value }, () =>
            ctx.patch({ strip: undefined }),
          ),
      },
    });
  } else if (row.kind === "fallback") editChainThinking(ctx, row, model);
  else
    thinking(ctx, {
      model,
      role: row.role,
      scope: role?.source === "project" ? "project" : "global",
    });
}

export function switchHubPreset(ctx: HubActionContext, delta: number) {
  const { names, active } = ctx.data.presets;
  if (!names.length) return;
  const index =
    active === undefined ? (delta > 0 ? -1 : 0) : names.indexOf(active);
  ctx.run({
    op: "switchPreset",
    name: names[(index + delta + names.length) % names.length],
  });
}

export function roleAction(
  ctx: HubActionContext,
  row: HubRoleRow | undefined,
  action: string,
) {
  if (action === "n") {
    nameInput(ctx, "role");
    return;
  }
  if (action === "s") {
    nameInput(ctx, "preset");
    return;
  }
  if (action === "p" || action === "P") {
    switchHubPreset(ctx, action === "p" ? 1 : -1);
    return;
  }
  if (!row) return;
  const handlers: Record<string, () => void> = {
    Enter: () => activateRole(ctx, row),
    x: () => clearRow(ctx, row),
    Delete: () => clearRow(ctx, row),
    Backspace: () => clearRow(ctx, row),
    f: () =>
      row.role
        ? startAssignment(ctx, { role: row.role, chainIndex: null })
        : activateRole(ctx, row),
    c: () =>
      row.kind === "role" &&
      ctx.run({
        op: "cycle",
        order: ctx.data.cycleOrder.includes(row.role!)
          ? ctx.data.cycleOrder.filter((role) => role !== row.role)
          : [...ctx.data.cycleOrder, row.role!],
      }),
    "[": () => reorderRow(ctx, row, -1),
    "]": () => reorderRow(ctx, row, 1),
    t: () => editRoleModel(ctx, row, "t"),
    k: () => editRoleModel(ctx, row, "k"),
  };
  handlers[action]?.();
}
