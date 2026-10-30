/** Native v18.8.6 model-hub data; never send credentials or request headers to the renderer. */
function resolveAssignments(source, all, available) {
  return Object.fromEntries(
    source.knownRoleIds.flatMap((role) => {
      const value = source.getModelRole(role);
      const accepts = source.getRoleInfo(role).accepts;
      const pool = (value ? all : available).filter(accepts);
      const resolved = source.resolveRoleValue(value || `pi/${role}`, pool);
      if (!resolved.model) return [];
      const thinkingLevel = resolved.explicitThinkingLevel
        ? resolved.thinkingLevel
        : role === "default"
          ? source.defaultThinkingLevel
          : "inherit";
      return [
        [role, { model: resolved.model, thinkingLevel, autoSelected: !value }],
      ];
    }),
  );
}

function searchAffinity(source, assignments) {
  const configured = Object.values(assignments).filter(
    (value) => !value.autoSelected,
  );
  const models = [
    ...new Set(
      [
        ...configured.map(
          (value) => `${value.model.provider}/${value.model.id}`,
        ),
        ...source.mruOrder,
      ].map((value) => value.toLowerCase()),
    ),
  ];
  const counts = new Map();
  for (const value of configured)
    counts.set(
      value.model.provider,
      (counts.get(value.model.provider) ?? 0) + 1,
    );
  const roleProviders = [...counts]
    .sort((left, right) => right[1] - left[1])
    .map(([provider]) => provider);
  const providers = [
    ...new Set(
      [
        ...source.modelProviderOrder,
        ...roleProviders,
        ...source.mruOrder.map((value) => value.split("/")[0]),
      ].map((value) => value.toLowerCase()),
    ),
  ];
  return {
    models: new Map(models.map((key, index) => [key, index])),
    providers: new Map(providers.map((key, index) => [key, index])),
  };
}

function modelRow(model, data) {
  const { source, modules, roleIds } = data;
  const selector = `${model.provider}/${model.id}`;
  const perf = source.modelPerf.get(selector);
  return {
    selector,
    id: model.id,
    provider: model.provider,
    name: model.name,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    kind: modules.catalog.modelKind(model),
    description: model.description,
    maxTokens: model.maxTokens,
    input: model.input,
    cost: model.cost,
    intelligence: Number.isFinite(model.int) ? Math.round(model.int) : undefined,
    tps: perf?.tps,
    thinking: model.thinking,
    thinkingLevels: model.reasoning
      ? [
          "inherit",
          "off",
          "auto",
          ...modules.thinking.getSupportedEfforts(model),
        ]
      : [],
    allowedRoles: roleIds.filter((role) =>
      source.getRoleInfo(role).accepts(model),
    ),
    compaction: source.compactionPointFor(model),
  };
}

function roleRow(role, data) {
  const { source, assignments } = data;
  const info = source.getRoleInfo(role);
  const assigned = assignments[role];
  return {
    role,
    name: info.name,
    tag: info.tag,
    color: info.color,
    section: info.section,
    value: source.getModelRole(role),
    global: source.getGlobalModelRole(role),
    project: source.getProjectModelRole(role),
    source: source.getModelRoleSource(role),
    resolvedSelector: assigned
      ? `${assigned.model.provider}/${assigned.model.id}`
      : undefined,
    thinkingLevel: assigned?.thinkingLevel,
    autoSelected: assigned?.autoSelected ?? true,
  };
}

function providerRows(registry, data) {
  const { source, modules, all, available } = data;
  const counts = new Map();
  for (const model of available)
    counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
  const oauth = new Set(
    modules.oauth.getOAuthProviders().map((provider) => provider.id),
  );
  const catalog = new Set(all.map((model) => model.provider));
  const providers = new Set([
    ...catalog,
    ...registry.getDiscoverableProviders(),
  ]);
  return [...providers]
    .filter((id) => !source.disabledProviders.includes(id))
    .flatMap((id) => {
      const discovery = registry.getProviderDiscoveryState(id);
      const authenticated = registry.authStorage.keys.source(id) !== undefined;
      if (
        !counts.has(id) &&
        !authenticated &&
        discovery?.optional &&
        ["idle", "unavailable"].includes(discovery.status)
      )
        return [];
      return [
        {
          id,
          locked: !counts.has(id) && !authenticated && catalog.has(id),
          oauth: oauth.has(id),
          count: counts.get(id) ?? 0,
          status: discovery?.status,
          error: discovery?.error,
        },
      ];
    })
    .sort(
      (left, right) =>
        Number(left.locked) - Number(right.locked) ||
        left.id.localeCompare(right.id),
    );
}

/** Build the same role resolution, order and fuzzy ranks as omp's ModelBrowser. */
export function modelHubSnapshot(host, options = {}) {
  const { api, ctx, modules } = host;
  const source = modules.source.createModelBrowserSource(api.pi.settings);
  const all = ctx.modelRegistry.getAll("all");
  const available = ctx.modelRegistry.getAvailable("all");
  const error = ctx.modelRegistry.getError();
  if (error) throw new Error(String(error));
  const assignments = resolveAssignments(source, all, available);
  const roleIds = source.knownRoleIds.filter(
    (role) => !source.getRoleInfo(role).hidden,
  );
  const items = modules.browser.buildBrowserItems(available);
  modules.browser.sortModelItems(items, {
    roles: assignments,
    mruOrder: source.mruOrder,
  });
  const query = options.query ?? "";
  const affinity = searchAffinity(source, assignments);
  const matches = modules.browser.rankModelItems(query, items, {
    roles: assignments,
    mruOrder: source.mruOrder,
    affinity,
  });
  const data = { source, modules, assignments, all, available, roleIds };
  return {
    models: items.map((item) => modelRow(item.model, data)),
    roles: roleIds.map((role) => roleRow(role, data)),
    providers: providerRows(ctx.modelRegistry, data),
    recent: [...source.mruOrder],
    cycleOrder: [...source.cycleOrder],
    fallbackChains: source.fallbackChains,
    presets: source.getModelPresets(),
    storage: source.modelRoleStorage,
    currentSelector: ctx.model
      ? `${ctx.model.provider}/${ctx.model.id}`
      : undefined,
    currentThinking: api.getThinkingLevel(),
    currentContextTokens: ctx.getContextUsage()?.tokens,
    query,
    matches: matches.map((item) => item.selector),
    notice: options.notice,
  };
}
