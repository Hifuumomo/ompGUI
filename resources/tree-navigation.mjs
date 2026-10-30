import { deleteTreeBranch } from "./tree-deletion.mjs";

const SUMMARY_CHOICES = [
  "No summary",
  "Summarize",
  "Summarize with custom prompt",
];

function validateRequest(request) {
  if (typeof request.requestId !== "string" || !request.requestId)
    throw new Error("缺少树导航请求标识");
  if (
    request.op !== "cancel" &&
    (typeof request.entryId !== "string" || !request.entryId)
  )
    throw new Error("缺少树导航目标节点");
  if (
    ![undefined, "navigate", "label", "cancel", "delete"].includes(request.op)
  )
    throw new Error("无效的会话树操作");
  for (const key of ["summarize", "askSummary"])
    if (request[key] !== undefined && typeof request[key] !== "boolean")
      throw new Error(`无效的会话树参数：${key}`);
}

/** 自定义输入取消时回到三选；取消三选才取消整次导航。 */
async function askSummary(ctx, signal) {
  while (!signal.aborted) {
    const selected = await ctx.ui.select("Summarize branch?", SUMMARY_CHOICES, {
      signal,
    });
    if (signal.aborted) return { cancelled: true };
    if (selected === undefined) return { cancelled: true };
    if (selected === SUMMARY_CHOICES[0]) return { summarize: false };
    if (selected === SUMMARY_CHOICES[1]) return { summarize: true };
    if (selected !== SUMMARY_CHOICES[2]) throw new Error("无效的分支摘要选项");
    const customInstructions = await ctx.ui.input(
      "Custom summarization instructions",
      undefined,
      { signal },
    );
    if (signal.aborted) return { cancelled: true };
    if (customInstructions !== undefined)
      return { summarize: true, customInstructions };
  }
  return { cancelled: true };
}

/** 回退默认不摘要；仅 /tree 明确请求时按原生配置显示摘要选择。 */
async function navigationOptions(host, request) {
  if (request.summarize !== undefined) return { summarize: request.summarize };
  if (!request.askSummary) return { summarize: false };
  const enabled = host.modules.contextSettings.cfgBranchSummaryEnabled.get(
    host.api.pi.settings,
  );
  return enabled
    ? askSummary(host.ctx, host.navigation.dialogs.signal)
    : { summarize: false };
}

/** SDK 注册表提供真实当前会话；会话文件 ID 用于防止中止其他会话。 */
function nativeSession(api, ctx) {
  if (typeof api.pi.AgentRegistry?.global !== "function")
    throw new Error("当前 omp 未提供原生会话注册表，无法中止分支摘要");
  const session = api.pi.AgentRegistry.global().get(ctx.agent.id)?.session;
  if (
    !session ||
    session.isDisposed ||
    session.sessionManager.getSessionId() !== ctx.sessionManager.getSessionId()
  )
    throw new Error("原生会话注册表与当前会话不匹配");
  if (typeof session.abortBranchSummary !== "function")
    throw new Error("当前 omp 未提供原生摘要中止方法");
  return session;
}

/** 只取消当前会话正在进行的 GUI 导航，由原导航请求报告最终取消结果。 */
function cancelNavigation(host, active) {
  const session = nativeSession(host.api, host.ctx);
  const navigation = active.get(host.ctx.sessionManager.getSessionId());
  if (!navigation) return { cancelRequested: false };
  if (navigation.session !== session)
    throw new Error("待取消的导航与当前原生会话不匹配");
  navigation.dialogs.abort();
  session.abortBranchSummary();
  return { cancelRequested: true };
}

function summaryInstructions(session, instructions) {
  const obfuscator = session.obfuscator;
  return instructions && obfuscator?.obfuscates()
    ? obfuscator.obfuscate(instructions)
    : instructions;
}

function summaryMessages(host, messages) {
  const converted = host.api.pi.convertToLlm(messages);
  const obfuscator = host.session.obfuscator;
  return obfuscator
    ? host.modules.secretTransforms.obfuscateMessages(obfuscator, converted)
    : converted;
}

/** 自定义摘要保留真实秘密映射与元数据；私有 side-stream hooks 和遥测不在公开扩展契约中。 */
async function customSummary(host, event, instructions) {
  const session = nativeSession(host.api, host.ctx);
  const model = session.model;
  if (!model) throw new Error("当前会话尚未选择摘要模型");
  const sessionId = session.sessionId;
  if (!(await host.ctx.modelRegistry.getApiKey(model, sessionId)))
    throw new Error(`No API key for ${model.provider}`);
  const result = await host.modules.compaction.generateBranchSummary(
    event.preparation.entriesToSummarize,
    {
      model,
      apiKey: host.ctx.modelRegistry.resolver(model, sessionId),
      signal: event.signal,
      customInstructions: summaryInstructions(session, instructions),
      reserveTokens:
        host.modules.contextSettings.cfgBranchSummaryReserveTokens.get(
          session.settings,
        ),
      metadata: session.agent.metadataForProvider(model.provider),
      convertToLlm: (messages) =>
        summaryMessages({ ...host, session }, messages),
    },
  );
  if (result.aborted) return { cancel: true };
  if (result.error) throw new Error(result.error);
  if (typeof result.summary !== "string" || !result.summary)
    throw new Error("原生分支摘要生成器未返回摘要");
  return {
    summary: {
      summary: result.summary,
      details: {
        readFiles: result.readFiles ?? [],
        modifiedFiles: result.modifiedFiles ?? [],
      },
    },
  };
}

/** 原生会吞掉扩展 hook 的异常；返回 cancel 并在命令层重抛，避免退回默认摘要。 */
function registerSummaryHook(api, getModules) {
  api.on("session_before_tree", async (event, ctx) => {
    const modules = await getModules();
    const job = modules.scope.getStore();
    if (!job || job.entryId !== event.preparation.targetId) return;
    if (
      !event.preparation.userWantsSummary ||
      !event.preparation.entriesToSummarize.length
    )
      return;
    try {
      return await customSummary(
        { api, ctx, modules },
        event,
        job.instructions,
      );
    } catch (error) {
      job.fail(error);
      return { cancel: true };
    }
  });
}

async function navigate(host, request) {
  const options = await navigationOptions(host, request);
  if (options.cancelled || host.navigation.dialogs.signal.aborted)
    return { cancelled: true };
  if (options.customInstructions === undefined)
    return host.ctx.navigateTree(request.entryId, {
      summarize: options.summarize,
    });
  let failure;
  const job = {
    entryId: request.entryId,
    instructions: options.customInstructions,
    fail: (error) => {
      failure = error;
    },
  };
  const result = await host.modules.scope.run(job, () =>
    host.ctx.navigateTree(request.entryId, { summarize: true }),
  );
  if (failure) throw failure;
  return result;
}

async function execute(host, request, active) {
  if (request.op === "cancel") return cancelNavigation(host, active);
  if (request.op === "label") return setLabel(host.ctx, request);
  const sessionId = host.ctx.sessionManager.getSessionId();
  if (active.has(sessionId)) throw new Error("当前会话已有树导航正在进行");
  const navigation = {
    entryId: request.entryId,
    session: nativeSession(host.api, host.ctx),
    dialogs: new AbortController(),
  };
  active.set(sessionId, navigation);
  try {
    if (request.op === "delete")
      return await deleteTreeBranch(
        host.api,
        host.ctx,
        navigation.session,
        request,
      );
    const modules = await host.getModules();
    if (navigation.dialogs.signal.aborted) return { cancelled: true };
    return await navigate({ ...host, navigation, modules }, request);
  } finally {
    if (active.get(sessionId) === navigation) active.delete(sessionId);
  }
}

/** v18.8.6 的 api.setLabel 实际改扩展名称；使用原生树 UI 的 appendLabelChange。 */
async function setLabel(ctx, request) {
  if (typeof request.label !== "string")
    throw new Error("会话节点标签必须是文字");
  ctx.sessionManager.appendLabelChange(
    request.entryId,
    request.label || undefined,
  );
  await ctx.sessionManager.flush();
  return { cancelled: false };
}

/** loadModules 注入 contextSettings、compaction 和 AsyncLocalStorage 构造器。 */
export function registerTreeNavigation(api, reply, loadModules) {
  let loading;
  const active = new Map();
  function getModules() {
    loading ??= loadModules().then((modules) => ({
      ...modules,
      scope: new modules.AsyncLocalStorage(),
    }));
    return loading;
  }
  registerSummaryHook(api, getModules);
  api.registerCommand("ompgui-tree", {
    description: "桌面端原生会话树导航与标签",
    async handler(args, ctx) {
      let request;
      try {
        request = JSON.parse(args);
        validateRequest(request);
        if (ctx.agent.kind !== "main") throw new Error("GUI 桥接仅支持主会话");
        const data = await execute({ api, ctx, getModules }, request, active);
        reply(ctx, request.requestId, { ok: true, data });
      } catch (error) {
        reply(ctx, request?.requestId, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}
