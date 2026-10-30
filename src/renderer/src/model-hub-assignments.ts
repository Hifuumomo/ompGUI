import type { ModelScope, NativeCatalogModel } from "../../shared/native-model";
import type { HubChoice } from "./model-hub-state";
import type { HubActionContext } from "./model-hub-context";

function choices(
  ctx: HubActionContext,
  title: string,
  items: readonly HubChoice[],
) {
  ctx.patch({
    strip: {
      kind: "choices",
      title,
      choices: items,
      index: 0,
      returnToRoles: !!ctx.state.assigning,
    },
  });
}

export function thinking(
  ctx: HubActionContext,
  options: { model: NativeCatalogModel; role: string; scope: ModelScope },
) {
  if (!options.model.thinkingLevels.length) {
    finishAssignment(ctx);
    return;
  }
  choices(
    ctx,
    `${options.role} · Thinking`,
    options.model.thinkingLevels.map((level) => ({
      label: level,
      active:
        ctx.data.roles.find((role) => role.role === options.role)
          ?.thinkingLevel === level,
      choose: () =>
        ctx.run(
          {
            op: "assign",
            role: options.role,
            selector: options.model.selector,
            thinkingLevel: level,
            scope: options.scope,
          },
          () => finishAssignment(ctx),
        ),
    })),
  );
}

function finishAssignment(ctx: HubActionContext) {
  ctx.patch({
    strip: undefined,
    assigning: undefined,
    scope: ctx.state.assigning ? "roles" : ctx.state.scope,
    index: 0,
  });
}

function assign(
  ctx: HubActionContext,
  options: { model: NativeCatalogModel; role: string; scope: ModelScope },
) {
  const previous = ctx.data.roles.find(
    (role) => role.role === options.role,
  )?.thinkingLevel;
  const thinkingLevel =
    previous && options.model.thinkingLevels.includes(previous)
      ? previous
      : "inherit";
  ctx.run(
    {
      op: "assign",
      role: options.role,
      selector: options.model.selector,
      scope: options.scope,
      thinkingLevel,
    },
    () => thinking(ctx, options),
  );
}

function assignRole(
  ctx: HubActionContext,
  options: { model: NativeCatalogModel; role: string },
) {
  if (ctx.data.storage === "global") {
    assign(ctx, { ...options, scope: "global" });
    return;
  }
  choices(
    ctx,
    `${options.role} · Save to`,
    (["project", "global"] as const).map((scope) => ({
      label: scope,
      choose: () => assign(ctx, { ...options, scope }),
    })),
  );
}

function addToChain(ctx: HubActionContext, model: NativeCatalogModel) {
  const target = ctx.state.assigning!;
  const chain = ctx.data.fallbackChains[target.role] ?? [];
  const values =
    target.chainIndex === null
      ? [...chain, model.selector]
      : chain.map((value, index) =>
          index === target.chainIndex ? model.selector : value,
        );
  ctx.run(
    { op: "fallback", role: target.role, chain: [...new Set(values)] },
    () => finishAssignment(ctx),
  );
}

export function pickHubModel(ctx: HubActionContext, model: NativeCatalogModel) {
  if (ctx.temporary) {
    ctx.run(
      {
        op: "temporary",
        selector: model.selector,
        target: ctx.state.task ? "task" : "session",
      },
      ctx.close,
    );
    return;
  }
  if (ctx.state.assigning?.chainIndex !== undefined) {
    addToChain(ctx, model);
    return;
  }
  if (ctx.state.assigning) {
    assignRole(ctx, { model, role: ctx.state.assigning.role });
    return;
  }
  const scopes: readonly ModelScope[] =
    ctx.data.storage === "project" ? ["project", "global"] : ["global"];
  const items = model.allowedRoles.flatMap((role) =>
    scopes.map((scope) => ({
      label: ctx.data.storage === "project" ? `${scope} ${role}` : role,
      active:
        ctx.data.roles.find((item) => item.role === role)?.resolvedSelector ===
        model.selector,
      choose: () => assign(ctx, { model, role, scope }),
    })),
  );
  choices(ctx, `Assign ${model.id}`, [
    ...items,
    {
      label: `fallbacks:${model.id}`,
      choose: () =>
        startAssignment(ctx, { role: model.selector, chainIndex: null }),
    },
    {
      label: `fallbacks:${model.provider}/*`,
      choose: () =>
        startAssignment(ctx, { role: `${model.provider}/*`, chainIndex: null }),
    },
  ]);
}

export function startAssignment(
  ctx: HubActionContext,
  target: { role: string; chainIndex?: number | null },
) {
  ctx.patch({
    assigning: target,
    strip: undefined,
    scope: "all",
    focus: "list",
    index: 0,
    query: "",
    kind: "all",
  });
}
