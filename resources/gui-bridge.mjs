import { resolve } from "node:path";
import { registerModelHub } from "./model-hub.mjs";
import { registerTreeNavigation } from "./tree-navigation.mjs";
import { registerAgentsHub } from "./agents-hub.mjs";
import { registerSubagentHistory } from "./subagent-history.mjs";
import { readSessionHeaderId, registerSessionOps } from "./session-ops.mjs";
import { registerSeance } from "./seance.mjs";
import { registerPlanMode } from "./plan-mode.mjs";

const builtinRoles = [
  "default",
  "smol",
  "slow",
  "vision",
  "plan",
  "commit",
  "tiny",
  "memory",
  "task",
  "advisor",
  "image",
  "web",
  "speech",
  "dictation",
  "judge",
];

/**
 * 向原生 CLI 注册 GUI 的配置与树导航命令，不写入会话消息。
 * 参数：[in] api CLI 注入的真实 ExtensionAPI。
 * 返回值：无。
 */
export default function guiBridge(api) {
  const settings = api.pi.settings;
  let heldSession;
  let lastRole;
  registerSubagentHistory(api, reply, async () => {
    const { AgentRegistry } = await import("@oh-my-pi/pi-coding-agent/registry/agent-registry");
    const { registerPersistedSubagents } = await import("@oh-my-pi/pi-coding-agent/registry/persisted-agents");
    const { readRpcSubagentTranscript } = await import("@oh-my-pi/pi-coding-agent/modes/rpc/rpc-subagents");
    return { createRegistry: () => new AgentRegistry(), registerPersistedSubagents, readTranscript: readRpcSubagentTranscript };
  });
  registerSeance(api, reply, async () => {
    const [seance, discovery, utils] = await Promise.all([
      import("@oh-my-pi/pi-coding-agent/task/seance"),
      import("@oh-my-pi/pi-coding-agent/task/discovery"),
      import("@oh-my-pi/pi-utils"),
    ]);
    return { ...seance, discoverAgents: discovery.discoverAgents, Snowflake: utils.Snowflake };
  });
  registerPlanMode(api, reply, async () => {
    const [settings, transition, files, approved, autosave, urls, resolution, names, compaction, utils, thinking, catalog, devices] = await Promise.all([
      import("@oh-my-pi/pi-coding-agent/plan-mode/settings"),
      import("@oh-my-pi/pi-coding-agent/plan-mode/model-transition"),
      import("@oh-my-pi/pi-coding-agent/plan-mode/plan-files"),
      import("@oh-my-pi/pi-coding-agent/plan-mode/approved-plan"),
      import("@oh-my-pi/pi-coding-agent/plan-mode/plan-autosave"),
      import("@oh-my-pi/pi-coding-agent/internal-urls"),
      import("@oh-my-pi/pi-coding-agent/tools/resolve"),
      import("@oh-my-pi/pi-coding-agent/tools/builtin-names"),
      import("@oh-my-pi/pi-agent-core/compaction"),
      import("@oh-my-pi/pi-utils"),
      import("@oh-my-pi/pi-catalog/model-thinking"),
      import("@oh-my-pi/pi-catalog/types"),
      import("@oh-my-pi/pi-tui/tools/resolve"),
    ]);
    return { ...settings, ...transition, ...files, ...approved, ...autosave, ...urls, ...resolution, ...names, ...compaction, ...devices, prompt: utils.prompt, ...thinking, modelKind: catalog.modelKind };
  });

  /** 按原生 Ctrl+P 的 cycleOrder 解析角色；沿用原生别名、路由和思考等级解析。 */
  async function cycleRole(ctx, direction) {
    if (!ctx.isIdle()) throw new Error("请等待会话空闲后切换模型。");
    const { cfgCycleOrder } =
      await import("@oh-my-pi/pi-coding-agent/config/model-settings");
    const { resolveModelRoleValue, getModelMatchPreferences } =
      await import("@oh-my-pi/pi-coding-agent/config/model-resolver");
    const order = cfgCycleOrder.get(settings);
    const available = ctx.modelRegistry.getAvailable();
    const current = ctx.model;
    const sameModel = (model) =>
      model?.provider === current?.provider && model?.id === current?.id;
    const entries = order.flatMap((role) => {
      const value =
        settings.getModelRole(role) ??
        (role === "default" && current
          ? `${current.provider}/${current.id}`
          : undefined);
      const resolved = resolveModelRoleValue(value, available, {
        settings,
        matchPreferences: getModelMatchPreferences(settings),
      });
      return resolved.model ? [{ role, ...resolved }] : [];
    });
    if (entries.length <= 1) return null;
    const sessionId = ctx.sessionManager.getSessionId();
    const previousRole =
      lastRole?.sessionId === sessionId
        ? lastRole.role
        : ctx.sessionManager.getLastModelChangeRole();
    let index = entries.findIndex(
      (entry) => entry.role === previousRole && sameModel(entry.model),
    );
    if (index < 0) index = entries.findIndex((entry) => sameModel(entry.model));
    if (index < 0) index = 0;
    const next =
      entries[
        (index + (direction === "backward" ? -1 : 1) + entries.length) %
          entries.length
      ];
    if (!(await api.setModel(next.model)))
      throw new Error(`模型不可用：${next.model.provider}/${next.model.id}`);
    if (next.explicitThinkingLevel && next.thinkingLevel !== undefined)
      api.setThinkingLevel(next.thinkingLevel);
    lastRole = { sessionId, role: next.role };
    return {
      order,
      role: next.role,
      model: next.model,
      thinkingLevel: api.getThinkingLevel(),
    };
  }

  // 保持原生 claim 的引用直到切换到其他会话；进程退出时 OS 自动释放租约。
  api.on("session_switch", (_event, ctx) => {
    if (heldSession && ctx.sessionManager.getSessionId() !== heldSession.id) {
      heldSession.release();
      heldSession = undefined;
    }
  });

  /**
   * 读取 Settings 的有效、全局与项目模型角色。
   * 参数：无。
   * 返回值：内置和自定义模型角色的当前配置列表。
   */
  function snapshot() {
    return [
      ...new Set([...builtinRoles, ...Object.keys(settings.getModelRoles())]),
    ].map((role) => ({
      role,
      value: settings.getModelRole(role),
      global: settings.getGlobalModelRole(role),
      project: settings.getProjectModelRole(role),
    }));
  }

  /**
   * 通过原生 notify 回传一次相关请求结果，避免 stdout 与 journal 污染。
   * 参数：[in] ctx 原生命令上下文；[in] requestId 主进程请求标识；[in] result 成功数据或失败说明。
   * 返回值：无。
   */
  function reply(ctx, requestId, result) {
    ctx.ui.notify(
      JSON.stringify({ namespace: "ompgui", requestId, ...result }),
      "info",
    );
  }

  // omp 的扩展加载器只对入口中的字面模块路径提供内部模块映射。
  async function loadModelHubModules() {
    const [
      source,
      catalog,
      thinking,
      oauth,
      presets,
      modelSettings,
      sessionSettings,
      compaction,
      taskSettings,
    ] = await Promise.all([
      import("@oh-my-pi/pi-coding-agent/modes/model-browser-source"),
      import("@oh-my-pi/pi-catalog/types"),
      import("@oh-my-pi/pi-catalog/model-thinking"),
      import("@oh-my-pi/pi-ai/oauth"),
      import("@oh-my-pi/pi-coding-agent/config/model-presets"),
      import("@oh-my-pi/pi-coding-agent/config/model-settings"),
      import("@oh-my-pi/pi-coding-agent/session/settings"),
      import("@oh-my-pi/pi-coding-agent/session/model-compaction-threshold"),
      import("@oh-my-pi/pi-coding-agent/task/settings"),
    ]);
    return {
      source,
      catalog,
      thinking,
      oauth,
      presets,
      modelSettings,
      sessionSettings,
      compaction,
      taskSettings,
      browser: api.pi,
    };
  }
  registerModelHub(api, reply, loadModelHubModules);
  registerAgentsHub(api, reply, async () => {
    const [deps, hub, tui] = await Promise.all([
      import("@oh-my-pi/pi-coding-agent/modes/agents-hub-deps"),
      import("@oh-my-pi/pi-tui/overlays/agents-hub"),
      import("@oh-my-pi/pi-tui"),
    ]);
    return { ...deps, parseGeneratedAgentSpec: hub.parseGeneratedAgentSpec, FuzzyQuery: tui.FuzzyQuery };
  });

  api.registerCommand("ompgui-resume", {
    description: "取得原生独占租约后恢复桌面只读会话",
    async handler(args, ctx) {
      let request;
      let release;
      try {
        request = JSON.parse(args);
        if (
          typeof request.requestId !== "string" ||
          typeof request.path !== "string" ||
          typeof request.sessionId !== "string"
        )
          throw new Error("缺少会话恢复参数");
        if (ctx.agent.kind !== "main") throw new Error("GUI 桥接仅支持主会话");
        const { FileSessionStorage, tryAcquireSessionLease } = api.pi;
        if (!FileSessionStorage || !tryAcquireSessionLease)
          throw new Error("当前 omp 不支持安全会话占用检测，请更新引擎后重试");
        // 显式探测使原生 claimSession 的异常降级不能掩盖不支持的锁机制。
        const probe = tryAcquireSessionLease(request.sessionId);
        if (!probe)
          throw new Error(
            "SESSION_OCCUPIED：该会话正在被其他 omp 实例使用，无法启动；请结束占用后重试。",
          );
        probe.release();
        // 原子 claim 保留在同一个即将恢复会话的 omp 进程内，绝不在进程间交接锁。
        release = new FileSessionStorage().claimSession(
          request.sessionId,
          request.path,
        );
        if (!release)
          throw new Error(
            "SESSION_OCCUPIED：会话已被占用或文件身份已改变，无法启动。",
          );
        if ((await readSessionHeaderId(request.path)) !== request.sessionId)
          throw new Error("会话文件已改变，请重新选择会话");
        const result = await ctx.switchSession(request.path);
        if (result?.cancelled) throw new Error("原生扩展取消了会话恢复");
        if (
          ctx.sessionManager.getSessionId() !== request.sessionId ||
          resolve(ctx.sessionManager.getSessionFile()) !== resolve(request.path)
        )
          throw new Error("恢复后的会话身份不一致，已拒绝发送");
        heldSession?.release();
        heldSession = { id: request.sessionId, release };
        release = undefined;
        reply(ctx, request.requestId, { ok: true });
      } catch (error) {
        reply(ctx, request?.requestId, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        release?.();
      }
    },
  });

  api.registerCommand("ompgui-roles", {
    description: "桌面端模型角色设置桥接",
    /**
     * 执行角色 list/set/clear 并等待原生配置持久化。
     * 参数：[in] args JSON 请求参数；[in] ctx 原生命令上下文。
     * 返回值：无；结果通过相关 notify 返回主进程。
     */
    async handler(args, ctx) {
      let request;
      try {
        request = JSON.parse(args);
        if (typeof request.requestId !== "string")
          throw new Error("缺少 requestId");
        if (ctx.agent.kind !== "main") throw new Error("GUI 桥接仅支持主会话");
        if (request.op === "cycle") {
          if (!["forward", "backward"].includes(request.direction))
            throw new Error("无效的角色切换方向");
          reply(ctx, request.requestId, {
            ok: true,
            data: await cycleRole(ctx, request.direction),
          });
          return;
        }
        if (request.op !== "list") {
          if (
            !["set", "clear"].includes(request.op) ||
            typeof request.role !== "string" ||
            !request.role.trim()
          ) {
            throw new Error("无效的角色操作");
          }
          if (!["global", "project"].includes(request.scope))
            throw new Error("无效配置作用域");
          if (
            request.op === "set" &&
            (typeof request.value !== "string" || !request.value.trim())
          ) {
            throw new Error("模型角色值不能为空");
          }
          // 使用 CLI 已初始化的 Settings singleton；项目清除恢复全局，不伪造配置文件。
          if (request.scope === "global")
            settings.setModelRole(
              request.role,
              request.op === "clear" ? undefined : request.value,
            );
          else if (request.op === "clear")
            settings.clearProjectModelRole(request.role);
          else settings.setProjectModelRole(request.role, request.value);
          await settings.flush();
        }
        reply(ctx, request.requestId, { ok: true, data: snapshot() });
      } catch (error) {
        reply(ctx, request?.requestId, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // 复刻 omp 原生 composer-prediction-controller：同一提示词、哨兵、清洗规则与用量记录。
  const PREDICTION_SKIP = "NO_PREDICTION";
  const PREDICTION_PROMPT = `<composer-prediction>
Predict the user's next message in this conversation. Reply with that message only, exactly as the user would type it.
- Write as the user: their voice, language, tone, and typical length. Mirror how they phrase requests.
- Follow up on the latest assistant reply: approve, redirect, ask for the next step, or report a result.
- One line. No quotes, preamble, or markdown.
- Keep it short; usually under 20 words.
- No confident guess: reply exactly ${PREDICTION_SKIP}
</composer-prediction>`;
  const PREDICTION_QUOTED =
    /^(?:"([^"]*)"|\u201C([^\u201C\u201D]*)\u201D|`([^`]*)`)$/;
  let prediction;
  function cancelPrediction() {
    prediction?.abort();
    prediction = undefined;
  }
  // 与原生一致在新回合开始时取消；不能监听 message_start，预测自身的 ephemeral 提示也会触发它。
  api.on("agent_start", cancelPrediction);
  for (const event of ["session_switch", "session_branch", "session_tree"])
    api.on(event, cancelPrediction);

  /**
   * 按原生规则清洗模型回复：折叠空白、去掉整句引号；空、哨兵或超过 500 字符视为无预测。
   * 参数：[in] text 模型原始回复。
   * 返回值：可放入输入框的单行文本，或 null。
   */
  function sanitizePrediction(text) {
    let value = String(text ?? "")
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const quoted = PREDICTION_QUOTED.exec(value);
    if (quoted) value = (quoted[1] ?? quoted[2] ?? quoted[3] ?? "").trim();
    return !value || value.includes(PREDICTION_SKIP) || value.length > 500
      ? null
      : value;
  }

  api.registerCommand("ompgui-predict", {
    description: "桌面端下一条提示词预测",
    /**
     * 在后台运行一次不写入历史的 ephemeral 回合，结果通过相关 notify 返回。
     * 参数：[in] args JSON 请求参数；[in] ctx 原生命令上下文。
     * 返回值：无；不等待模型回复，避免原生串行命令队列阻塞用户的下一条提示词。
     */
    async handler(args, ctx) {
      let request;
      try {
        request = JSON.parse(args);
        if (typeof request.requestId !== "string")
          throw new Error("缺少 requestId");
        if (ctx.agent.kind !== "main") throw new Error("GUI 桥接仅支持主会话");
        if (typeof ctx.runEphemeralTurn !== "function")
          throw new Error("当前 omp 不支持提示词预测，请更新引擎后重试");
      } catch (error) {
        reply(ctx, request?.requestId, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      cancelPrediction();
      const controller = new AbortController();
      prediction = controller;
      const sessionId = ctx.sessionManager.getSessionId();
      const leafId = ctx.sessionManager.getLeafId();
      void (async () => {
        try {
          const { replyText, assistantMessage } = await ctx.runEphemeralTurn({
            promptText: PREDICTION_PROMPT,
            minimizeEffort: true,
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15_000),
            ]),
          });
          // 先核对会话位置：记录用量本身会追加条目并移动 leaf。
          const current =
            prediction === controller &&
            !controller.signal.aborted &&
            ctx.sessionManager.getSessionId() === sessionId &&
            ctx.sessionManager.getLeafId() === leafId;
          try {
            if (assistantMessage)
              ctx.sessionManager.appendModelUsage?.(
                {
                  purpose: "composer-prediction",
                  api: assistantMessage.api,
                  provider: assistantMessage.provider,
                  model: assistantMessage.model,
                  usage: assistantMessage.usage,
                  stopReason: assistantMessage.stopReason,
                },
                { sessionId, parentId: leafId },
              );
          } catch {
            /* 用量记录失败不影响预测本身。 */
          }
          reply(ctx, request.requestId, {
            ok: true,
            data: { text: current ? sanitizePrediction(replyText) : null },
          });
        } catch (error) {
          reply(
            ctx,
            request.requestId,
            controller.signal.aborted
              ? { ok: true, data: { text: null } }
              : {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                },
          );
        } finally {
          if (prediction === controller) prediction = undefined;
        }
      })();
    },
  });

  registerTreeNavigation(api, reply, async () => {
    const [contextSettings, compaction, asyncHooks, secretTransforms] =
      await Promise.all([
        import("@oh-my-pi/pi-coding-agent/session/context-settings"),
        import("@oh-my-pi/pi-agent-core/compaction"),
        import("node:async_hooks"),
        import("@oh-my-pi/pi-coding-agent/secrets/message-transform"),
      ]);
    return {
      contextSettings,
      compaction,
      AsyncLocalStorage: asyncHooks.AsyncLocalStorage,
      secretTransforms,
    };
  });
  // 字面模块路径才能被扩展加载器映射到引擎内置模块。
  registerSessionOps(api, reply, () =>
    import("@oh-my-pi/pi-coding-agent/session/session-manager"),
  );
}
