/** Use the same persisted roster loader as the native Agent Hub, in an isolated registry. */
export function registerSubagentHistory(api, reply, loadModules) {
  api.registerCommand("ompgui-subagents", {
    description: "桌面端只读历史子代理",
    async handler(args, ctx) {
      let request;
      try {
        request = JSON.parse(args);
        const modules = await loadModules();
        const data = await readHistory({ request, modules });
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

async function readHistory({ request, modules }) {
  const { rootSessionFile } = request;
  if (
    typeof rootSessionFile !== "string" ||
    !rootSessionFile.endsWith(".jsonl")
  )
    throw new Error("缺少原生根会话文件");
  if (!["list", "messages"].includes(request.op))
    throw new Error("不支持的历史子代理操作");
  const registry = modules.createRegistry();
  await modules.registerPersistedSubagents(registry, rootSessionFile, {
    hydrateHistory: request.op === "list",
  });
  const refs = registry.list();
  if (request.op === "list") return { subagents: refs.map(toSnapshot) };
  const ref = refs.find((item) => item.id === request.subagentId);
  if (!ref?.sessionFile) throw new Error("子代理不属于当前历史会话");
  return modules.readTranscript(ref.sessionFile, request.fromByte ?? 0);
}

function toSnapshot(ref, index) {
  const history = ref.history;
  const metrics = history?.metrics;
  const status = ref.status === "aborted" ? "aborted" : "parked";
  return {
    id: ref.id,
    index,
    agent: history?.agent ?? ref.displayName,
    agentSource: "history",
    status,
    historical: true,
    parentId: ref.parentId,
    task: ref.activity,
    sessionFile: ref.sessionFile,
    lastUpdate: ref.lastActivity,
    progress: metrics
      ? {
          id: ref.id,
          status,
          task: ref.activity ?? "",
          tokens: metrics.tokens,
          requests: metrics.requests,
          toolCount: metrics.tools,
          cost: metrics.cost,
          durationMs: metrics.durationMs,
          durationKind: metrics.durationKind,
          contextTokens: metrics.contextTokens,
          contextWindow: metrics.contextWindow,
          resolvedModel: history.resolvedModel,
          modelRole: history.modelRole,
          recentTools: [],
          recentOutput: [],
        }
      : undefined,
  };
}
