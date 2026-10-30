function selectedModel(host, selector) {
  const model = host.ctx.modelRegistry
    .getAvailable("all")
    .find((item) => `${item.provider}/${item.id}` === selector);
  if (!model) throw new Error(`模型不可用：${selector}`);
  return model;
}

function targetScope(host, scope) {
  const storage = host.modules.modelSettings.cfgModelRoleStorage.get(
    host.api.pi.settings,
  );
  if (!["global", "project"].includes(scope))
    throw new Error("无效模型配置作用域");
  return storage === "project" ? scope : "global";
}

function writeRole(host, action) {
  const settings = host.api.pi.settings;
  const scope = targetScope(host, action.scope);
  if (scope === "global") settings.setModelRole(action.role, action.value);
  else if (action.value === undefined)
    settings.clearProjectModelRole(action.role);
  else settings.setProjectModelRole(action.role, action.value);
}

/** Extension setModel is session-only unless its native options explicitly request persistence. */
async function switchModel(host, options) {
  const { api, ctx } = host;
  if (typeof ctx.sessionManager.appendModelChange !== "function")
    throw new Error("当前 omp 未公开原生模型角色记录方法");
  if (!(await api.setModel(options.model)))
    throw new Error(
      `模型凭据不可用：${options.model.provider}/${options.model.id}`,
    );
  if (options.role !== "default")
    ctx.sessionManager.appendModelChange(
      `${options.model.provider}/${options.model.id}`,
      options.role,
    );
  if (options.thinkingLevel && options.thinkingLevel !== "inherit")
    api.setThinkingLevel(options.thinkingLevel);
  return { switched: true };
}

function assignmentShadowed(host, scope) {
  const settings = host.api.pi.settings;
  const provenance = settings.getModelRoleProvenance("default");
  if (scope === "project") return provenance === "overlay";
  return (
    provenance === "project" ||
    provenance === "overlay" ||
    (provenance === "runtime" &&
      settings.isProjectModelRoleRuntimeOverrideActive("default"))
  );
}

async function assign(host, action) {
  if (!/^[a-zA-Z][\w-]*$/.test(action.role))
    throw new Error(
      "角色名称必须以字母开头，只能包含字母、数字、连字符或下划线",
    );
  const model = selectedModel(host, action.selector);
  const source = host.modules.source.createModelBrowserSource(
    host.api.pi.settings,
  );
  if (!source.getRoleInfo(action.role).accepts(model))
    throw new Error(`模型不支持 ${action.role} 角色`);
  const scope = targetScope(host, action.scope);
  const level = action.thinkingLevel;
  const valueLevel =
    action.role === "default" && level === "auto" ? undefined : level;
  const value =
    valueLevel && valueLevel !== "inherit"
      ? `${action.selector}:${valueLevel}`
      : action.selector;
  const shadowed = action.role === "default" && assignmentShadowed(host, scope);
  if (action.role === "default" && !shadowed)
    await switchModel(host, { model, role: action.role, thinkingLevel: level });
  writeRole(host, { role: action.role, scope, value });
  if (action.role === "default" && level === "auto")
    host.modules.sessionSettings.cfgDefaultThinkingLevel.set(
      host.api.pi.settings,
      "auto",
    );
  return shadowed
    ? "设置已保存；当前模型由优先级更高的项目或覆盖配置决定。"
    : undefined;
}

async function clear(host, action) {
  writeRole(host, { ...action, value: undefined });
  if (action.role !== "default") return;
  const settings = host.api.pi.settings;
  const value = settings.getModelRole("default");
  const provenance = settings.getModelRoleProvenance("default");
  if (!value || !["global", "project"].includes(provenance)) return;
  const source = host.modules.source.createModelBrowserSource(settings);
  const resolved = source.resolveRoleValue(
    value,
    host.ctx.modelRegistry.getAvailable(),
  );
  if (!resolved.model) throw new Error(`清除后生效的默认模型不可用：${value}`);
  await switchModel(host, {
    model: resolved.model,
    role: "default",
    thinkingLevel: resolved.thinkingLevel ?? source.defaultThinkingLevel,
  });
}

function presetSession(host) {
  return {
    scopedModels: [],
    modelRegistry: host.ctx.modelRegistry,
    getAvailableModels: () => host.ctx.modelRegistry.getAvailable(),
    setThinkingLevel: (level, persist) =>
      host.api.setThinkingLevel(level, persist),
    setModel: (model, role, options) =>
      switchModel(host, { model, role, thinkingLevel: options?.thinkingLevel }),
  };
}

async function switchPreset(host, action) {
  const result = await host.modules.presets.applyModelPreset(
    host.api.pi.settings,
    presetSession(host),
    action.name,
  );
  const message = host.modules.presets.formatModelPresetSwitch(
    action.name,
    result,
  );
  if (result.kind !== "switched") throw new Error(message);
  return message;
}

function setTaskModel(host, selector) {
  const { cfgTaskAgentModelOverrides } = host.modules.taskSettings;
  const settings = host.api.pi.settings;
  cfgTaskAgentModelOverrides.override(settings, {
    ...cfgTaskAgentModelOverrides.get(settings),
    task: selector,
  });
}

async function temporary(host, action) {
  const model = selectedModel(host, action.selector);
  if (action.target === "task") {
    setTaskModel(host, action.selector);
    return;
  }
  const tokens = host.ctx.getContextUsage()?.tokens ?? 0;
  if (model.contextWindow > 0 && tokens > model.contextWindow)
    await host.ctx.compact();
  await switchModel(host, { model, role: "temporary" });
}

async function applyRole(host, action) {
  const source = host.modules.source.createModelBrowserSource(
    host.api.pi.settings,
  );
  const value =
    source.getModelRole(action.role) ??
    (action.role === "default" && host.ctx.model
      ? `${host.ctx.model.provider}/${host.ctx.model.id}`
      : undefined);
  const resolved = source.resolveRoleValue(
    value,
    host.ctx.modelRegistry.getAvailable(),
  );
  if (!resolved.model) throw new Error(`角色 ${action.role} 没有可用的模型`);
  if (action.target === "task") {
    const selector = `${resolved.model.provider}/${resolved.model.id}`;
    const level =
      resolved.explicitThinkingLevel && resolved.thinkingLevel !== "inherit"
        ? resolved.thinkingLevel
        : undefined;
    setTaskModel(host, level ? `${selector}:${level}` : selector);
    return;
  }
  await switchModel(host, {
    model: resolved.model,
    role: action.role,
    thinkingLevel: resolved.thinkingLevel,
  });
}

function editConfiguration(host, action) {
  const { modules, api } = host;
  const settings = api.pi.settings;
  if (action.op === "cycle")
    modules.modelSettings.cfgCycleOrder.set(settings, [...action.order]);
  if (action.op === "fallback")
    modules.sessionSettings.cfgRetryFallbackChains.setEntry(
      settings,
      action.role,
      action.chain.length ? [...action.chain] : undefined,
    );
  if (action.op === "compaction")
    modules.compaction.setModelCompactionPoint(
      settings,
      selectedModel(host, action.selector),
      action.value,
    );
  if (action.op === "savePreset") {
    modules.presets.saveModelPreset(settings, action.name);
    return modules.presets.modelPresetSavedMessage(settings, action.name);
  }
}

export async function applyModelHubAction(host, action) {
  const handlers = {
    assign,
    clear,
    switchPreset,
    temporary,
    applyRole,
    cycle: editConfiguration,
    fallback: editConfiguration,
    compaction: editConfiguration,
    savePreset: editConfiguration,
    refresh: async (current, request) => {
      if (request.provider)
        await current.ctx.modelRegistry.refreshProvider(
          request.provider,
          "online",
          { refreshCommandCredentials: true },
        );
      else await current.ctx.modelRegistry.refresh("online");
    },
  };
  if (!Object.hasOwn(handlers, action.op))
    throw new Error(`不支持的模型操作：${action.op}`);
  const notice = await handlers[action.op](host, action);
  await host.api.pi.settings.flush();
  return notice;
}
