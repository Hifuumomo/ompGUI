const PROPERTIES = ["model", "prewalk", "advisor"];
const SOURCE_ORDER = { project: 0, user: 1, bundled: 2 };

async function snapshot(host, query = "") {
  const agents = (await host.deps.loadAgents())
    .map((agent) => {
      const patterns = host.deps.effectiveModelPatterns(agent);
      return {
        ...agent,
        effectiveModel: patterns.join(", "),
        resolvedModel: host.deps.resolvePatterns(patterns),
        effectivePrewalk: host.deps.effectivePrewalkPattern(agent),
        effectiveAdvisor: host.deps.effectiveAdvisorPattern(agent),
      };
    })
    .sort(
      (a, b) =>
        SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
        a.name.localeCompare(b.name),
    );
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => new host.modules.FuzzyQuery(token));
  const matches = agents
    .filter((agent) =>
      tokens.every(
        (token) =>
          token.match(
            `${agent.name} ${agent.description} ${agent.source} ${agent.overrideModel ?? ""}`,
          ).matches,
      ),
    )
    .map((agent) => agent.name);
  const models = host.deps.getAvailableModels().map((model) => ({
    selector: `${model.provider}/${model.id}`,
    name: model.name,
    provider: model.provider,
  }));
  return { agents, models, matches, query };
}

async function applyAction(host, action) {
  if (action.op === "list" || action.op === "search") return {};
  if (action.op === "generate") return generateAgent(host, action.description);
  if (action.op === "save") return saveAgent(host, action);
  return updateAgent(host, action);
}

async function generateAgent(host, description) {
  if (typeof description !== "string" || !description.trim())
    throw new Error("请填写代理的用途描述。");
  const raw = await host.deps.generateAgent(description.trim(), host.onText);
  return { spec: host.modules.parseGeneratedAgentSpec(raw) };
}

async function saveAgent(host, action) {
  if (!["project", "user"].includes(action.scope))
    throw new Error("无效的代理保存范围");
  const spec = host.modules.parseGeneratedAgentSpec(
    JSON.stringify(action.spec),
  );
  const path = await host.deps.saveAgent(action.scope, spec);
  return { notice: `已创建 ${spec.identifier}：${path}` };
}

async function updateAgent(host, action) {
  const agent = (await host.deps.loadAgents()).find(
    (entry) => entry.name === action.name,
  );
  if (!agent) throw new Error(`代理不存在：${action.name}`);
  if (action.op === "toggle") {
    if (typeof action.disabled !== "boolean")
      throw new Error("无效的代理启用状态");
    host.deps.setAgentDisabled(agent.name, { disabled: action.disabled });
  } else if (action.op === "override") {
    if (!PROPERTIES.includes(action.property))
      throw new Error("无效的代理属性");
    if (action.value !== undefined && typeof action.value !== "string")
      throw new Error("无效的属性值");
    host.deps.setAgentOverride(
      action.property,
      agent.name,
      action.value?.trim() || undefined,
    );
  } else throw new Error(`不支持的代理操作：${action.op}`);
  await host.settings.flush();
  return { notice: `已更新 ${agent.name}` };
}

/** Discovery, resolution, generation and persistence are owned by the native /agents implementation. */
export function registerAgentsHub(api, reply, loadModules) {
  api.registerCommand("ompgui-agents", {
    description: "桌面端原生代理管理",
    async handler(args, ctx) {
      let request;
      try {
        request = JSON.parse(args);
        if (typeof request.requestId !== "string")
          throw new Error("缺少代理请求标识");
        const modules = await loadModules();
        const settings = api.pi.settings;
        const activeModel =
          ctx.model && `${ctx.model.provider}/${ctx.model.id}`;
        // GUI launches no explicit plugin roots; native discovery resolves configured project/user roots.
        const deps = modules.createAgentsHubDeps(
          ctx.cwd,
          settings,
          ctx.modelRegistry,
          () => undefined,
          activeModel,
        );
        const onText = (text) =>
          ctx.ui.notify(
            JSON.stringify({ namespace: "ompgui-agents-progress", text }),
            "info",
          );
        const host = { deps, settings, modules, onText };
        const result = await applyAction(host, request);
        const data = await snapshot(host, request.query ?? "");
        reply(ctx, request.requestId, {
          ok: true,
          data: { ...data, ...result },
        });
      } catch (error) {
        reply(ctx, request?.requestId, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}
