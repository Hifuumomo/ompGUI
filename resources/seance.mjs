import { resolve } from "node:path";

const TASK = "Review this session's saved conversation and return a concise index of its main topics, decisions, and unresolved questions.";
const SOLUTION_SPACE = "Historical summary; the selected transcript provides the evidence.";

/** 注册只读历史咨询；原生 task 负责模型恢复、只读分叉及异步结果投递。 */
export function registerSeance(api, reply, loadModules) {
  const active = new Map();
  // 每个启动与尚未持久化的同步报告分别持有租约，兄弟任务不能提前解除保护。
  function retain(sessionId) {
    active.set(sessionId, (active.get(sessionId) ?? 0) + 1);
    return () => {
      const remaining = active.get(sessionId) - 1;
      if (remaining) active.set(sessionId, remaining);
      else active.delete(sessionId);
    };
  }
  for (const event of ["session_before_switch", "session_before_branch", "session_before_tree"]) {
    api.on(event, (_event, ctx) => {
      if (!active.has(ctx.sessionManager.getSessionId())) return;
      ctx.ui.notify("历史咨询仍在运行，请等待报告后切换会话或分支。", "warning");
      return { cancel: true };
    });
  }

  /** 每个来源独立执行同一原生 task 实例，复用其并发上限而不依赖 task.batch。 */
  async function launch(request, path, host) {
    const { ctx, session, sessionId, modules, tool } = host;
    const release = retain(sessionId);
    const taskIds = new Set();
    let jobId;
    let model;
    const collect = details => {
      if (!details) return;
      for (const item of [...(details.progress ?? []), ...(details.results ?? [])]) {
        taskIds.add(item.id);
        if (item.resolvedModel) model = item.resolvedModel;
      }
      jobId = details.async?.jobId ?? jobId;
    };
    const snapshot = state => ({ state, taskIds: [...taskIds], ...(jobId ? { jobId } : {}), ...(model ? { model } : {}) });
    async function persist(content, details) {
      // 忙碌时 sendCustomMessage 会变成 steer；等待空闲，绝不触发额外模型轮次。
      while (session.isStreaming || session.isCompacting) {
        if (session.isDisposed) throw new Error("历史咨询目标会话已关闭");
        await new Promise(done => setTimeout(done, 25));
      }
      if (session.isDisposed || session.sessionManager.getSessionId() !== sessionId)
        throw new Error("历史咨询目标会话已改变");
      await session.sendCustomMessage({ customType: "ompgui-seance", content, display: true, details: { sourceSession: path, ...details } }, { triggerTurn: false });
      await session.sessionManager.flush();
    }
    const execution = (async () => {
      try {
        const result = await tool.execute(`seance-${modules.Snowflake.next()}`, {
          agent: "seance", sourceSession: path, task: TASK, solutionSpace: SOLUTION_SPACE,
          ...(request.model !== undefined ? { model: request.model } : {}),
        }, undefined, update => collect(update.details));
        collect(result.details);
        const details = result.details;
        const content = result.content.filter(part => part.type === "text").map(part => part.text).join("\n").trim();
        const failed = details?.results?.find(item => item.error || item.aborted || item.exitCode !== 0);
        if (result.isError || details?.async?.state === "failed" || failed || (!details?.async && !(details?.results?.length)))
          throw new Error(failed?.aborted ? failed.abortReason || content || failed.error || "Seance preflight failed." : content || failed?.error || "Seance preflight failed.");
        const data = { ...snapshot(details?.async?.state === "running" ? "running" : "completed"), ...(content ? { content } : {}) };
        // 异步最终报告由原生 async-result 写入；同步正文必须显式写入当前会话。
        if (!details?.async || details.async.state === "completed")
          await persist(content || "Seance completed.", data);
        return { ok: true, data };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await persist(`Seance failed: ${message}`, { ...snapshot("completed"), error: message });
        } catch (persistenceError) {
          ctx.ui.notify(`历史咨询报告保存失败：${String(persistenceError)}；原始错误：${message}`, "error");
        }
        return { ok: false, error: message };
      } finally {
        release();
      }
    })();
    // 长同步任务不占用 RPC；租约仍由实际执行持有，直到报告完成 flush。
    let timer;
    const admission = await Promise.race([
      execution,
      new Promise(done => { timer = setTimeout(() => done({ ok: true, data: snapshot("running") }), 25); }),
    ]);
    clearTimeout(timer);
    return admission;
  }

  api.registerCommand("ompgui-seance", {
    description: "使用原生只读 seance 代理咨询已保存会话",
    async handler(args, ctx) {
      let request;
      let release;
      try {
        request = JSON.parse(args);
        if (!request || typeof request !== "object" || Array.isArray(request))
          throw new Error("无效的历史咨询请求");
        if (typeof request.requestId !== "string" || !request.requestId)
          throw new Error("缺少历史咨询请求标识");
        if (!["inspect", "run", "runBatch"].includes(request.op))
          throw new Error("无效的历史咨询操作");
        const batch = request.op === "runBatch";
        const requests = batch ? request.requests : [request];
        if (!Array.isArray(requests) || !requests.length)
          throw new Error("请选择历史咨询来源");
        for (const item of requests) {
          if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.sourceSession !== "string" || !item.sourceSession.trim())
            throw new Error("请选择已保存的来源会话");
          if (item.model !== undefined && (typeof item.model !== "string" || !item.model.trim()))
            throw new Error("无效的历史咨询模型");
        }
        const modules = await loadModules();
        const resolveSource = item => modules.resolveSeanceSource(item.sourceSession, {
          cwd: ctx.sessionManager.getCwd(),
          sessionDirHint: ctx.sessionManager.getSessionDir(),
          includeGlobal: true,
        });
        if (request.op === "inspect") {
          const source = await resolveSource(request);
          reply(ctx, request.requestId, { ok: true, data: { path: resolve(source.file), modelSelectors: source.modelSelectors } });
          return;
        }
        const session = api.pi.AgentRegistry?.global().get(ctx.agent.id)?.session;
        const sessionId = ctx.sessionManager.getSessionId();
        if (!session || session.isDisposed || session.sessionManager.getSessionId() !== sessionId)
          throw new Error("原生会话注册表与当前会话不匹配");
        if (!ctx.isIdle() || session.isStreaming || session.isCompacting || active.has(sessionId))
          throw new Error("请等待当前会话空闲后发起历史咨询");
        if (typeof session.sendCustomMessage !== "function")
          throw new Error("当前 omp 无法持久化历史咨询报告");
        release = retain(sessionId);
        const { agents } = await modules.discoverAgents(ctx.sessionManager.getCwd(), undefined, session.effectiveExtensionRoots);
        const agent = agents.find(item => item.name === "seance");
        if (!agent || !modules.isBundledSeance(agent))
          throw new Error("A custom `seance` agent overrides the bundled one; rename it to use /seance.");
        const tool = session.agent.state.tools.find(item => item.name === "task");
        if (!tool) throw new Error("The task tool is not available for /seance.");
        // 全部来源先解析，显式拒绝归一化后重复项，避免同一来源重复计费。
        const resolved = await Promise.all(requests.map(async item => {
          try { return { path: resolve((await resolveSource(item)).file) }; }
          catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
        }));
        const seen = new Set();
        for (const item of resolved) {
          if (!item.path) continue;
          const key = process.platform === "win32" ? item.path.toLowerCase() : item.path;
          if (seen.has(key)) {
            item.error = "重复的历史咨询来源";
            delete item.path;
          } else seen.add(key);
        }
        if (!ctx.isIdle() || session.isDisposed || session.isStreaming || session.isCompacting || session.sessionManager.getSessionId() !== sessionId)
          throw new Error("历史咨询准备期间当前会话已改变或不再空闲");
        const host = { ctx, session, sessionId, modules, tool };
        const results = await Promise.all(requests.map(async (item, index) => {
          const source = resolved[index];
          if (source.error) return { sourceSession: item.sourceSession, error: source.error };
          const outcome = await launch(item, source.path, host);
          return { sourceSession: item.sourceSession, ...(outcome.ok ? { launch: outcome.data } : { error: outcome.error }) };
        }));
        const first = results[0];
        reply(ctx, request.requestId, batch ? { ok: true, data: results } : first.error ? { ok: false, error: first.error } : { ok: true, data: first.launch });
      } catch (error) {
        reply(ctx, request?.requestId, { ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        release?.();
      }
    },
  });
}
