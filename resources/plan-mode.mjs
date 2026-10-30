import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { planModeApprovedPrompt, planModeCompactInstructionsPrompt } from "./plan-mode-prompts.mjs";

const LIMIT = 1024 * 1024;
const CONFLICT = "计划已在磁盘修改，请先处理冲突";
const unsupported = "当前 omp 不支持桌面计划模式，请升级到兼容版本";
const message = error => error instanceof Error ? error.message : String(error);
const same = (a, b) => a?.sessionId === b?.sessionId && a?.sessionFile === b?.sessionFile && a?.epoch === b?.epoch;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const modelRef = (model, thinkingLevel) => model ? { provider: model.provider, modelId: model.id, ...(thinkingLevel !== undefined ? { thinkingLevel } : {}) } : undefined;

/** 原生控制器只有一个绑定和一个转换事务；取消不进入串行队列。 */
export function registerPlanMode(api, reply, loadModules) {
  let host;
  let queue = Promise.resolve();
  let internalSwitch = false;
  let modulesPromise;
  let controlPromise;
  let shutdown = false;
  const controlSockets = new Set();
  /** 私有取消通道不经过原生 prompt admission，也不绑定或重建会话。 */
  async function startControl() {
    const token = randomBytes(32).toString("hex");
    const directory = process.platform === "win32" ? undefined : await fs.mkdtemp(path.join(tmpdir(), "ompgui-plan-"));
    const endpoint = directory ? path.join(directory, "control.sock") : `\\\\.\\pipe\\ompgui-plan-${randomUUID()}`;
    const server = createServer(socket => {
      if (shutdown) { socket.destroy(); return; }
      controlSockets.add(socket);
      socket.on("close", () => controlSockets.delete(socket));
      socket.on("error", () => {});
      socket.setTimeout(5000, () => socket.destroy());
      let input = Buffer.alloc(0);
      let finished = false;
      const respond = response => {
        if (finished) return;
        finished = true;
        socket.end(`${JSON.stringify(response)}\n`);
      };
      socket.on("data", chunk => {
        if (finished) return;
        if (input.length + chunk.length > 8192) { respond({ ok: false, error: "取消请求过长" }); return; }
        input = Buffer.concat([input, chunk]);
        const end = input.indexOf(10);
        if (end < 0) return;
        try {
          if (end !== input.length - 1) throw new Error("无效的取消请求");
          const request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.subarray(0, end)));
          if (!request || Object.keys(request).sort().join(",") !== "action,token" ||
            typeof request.token !== "string" || !/^[a-f0-9]{64}$/.test(request.token) ||
            !timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(request.token, "hex"))) throw new Error("取消认证失败");
          if (shutdown) throw new Error("计划控制通道已关闭");
          respond({ ok: true, data: cancelAction(request.action) });
        } catch (error) { respond({ ok: false, error: message(error) }); }
      });
    });
    try {
      if (directory) await fs.chmod(directory, 0o700);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(endpoint, () => { server.removeListener("error", reject); resolve(); });
      });
      server.on("error", () => {});
      server.unref();
      if (shutdown) throw new Error("计划控制通道已关闭");
      return { endpoint, token, server, directory };
    } catch (error) {
      if (server.listening) await new Promise(resolve => server.close(resolve));
      if (directory) await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  async function closeControl() {
    shutdown = true;
    for (const socket of controlSockets) socket.destroy();
    const active = await controlPromise?.catch(() => undefined);
    if (active) {
      await new Promise(resolve => active.server.close(resolve));
      if (active.directory) await fs.rm(active.directory, { recursive: true, force: true });
    }
  }
  const modules = () => modulesPromise ??= loadModules();
  const nativeSession = ctx => api.pi.AgentRegistry?.global().get(ctx.agent.id)?.session;
  const localOptions = h => ({ getArtifactsDir: () => h.session.sessionManager.getArtifactsDir(), getSessionId: () => h.session.sessionManager.getSessionId() });
  const options = h => ({ localProtocolOptions: localOptions(h), cwd: h.session.sessionManager.getCwd() });
  const root = h => path.resolve(h.modules.resolveLocalRoot(localOptions(h)));
  const identity = h => ({ sessionId: h.session.sessionManager.getSessionId(), sessionFile: h.session.sessionManager.getSessionFile() ?? "", epoch: h.epoch });
  const current = h => host === h && !h.session.isDisposed && same(identity(h), h.identity);
  const snapshot = h => ({ identity: h.identity, phase: h.phase, ...(h.document ? { document: h.document } : {}), ...(h.reviewId ? { reviewId: h.reviewId } : {}), busy: !!h.operation && h.operation.status === "running", ...(h.error ? { error: h.error } : {}), ...(h.executionModel ? { executionModel: h.executionModel } : {}), ...(h.operation ? { operation: h.operation } : {}), ...(h.session.getContextUsage?.() ? { context: h.session.getContextUsage() } : {}) });
  function publish(h) { if (current(h)) h.ctx.ui.notify(JSON.stringify({ namespace: "ompgui-plan-state", snapshot: snapshot(h) }), "info"); }
  function capable(h) {
    for (const name of ["getPlanModeState", "setPlanModeState", "setPlanProposalHandler", "preparePlanForReview", "setActiveToolsByName", "hasBuiltInTool", "restoreNonMCPToolPresentation", "configuredThinkingLevel", "getEnabledToolNames", "getMountedXdevToolNames", "resolveRoleModelWithThinking", "markPlanInternalAbortPending", "clearPlanInternalAbortPending", "setPlanReferencePath", "markPlanReferenceSent", "setModelTemporary", "setThinkingLevel", "newSession", "compact", "prompt", "subscribe", "abort"])
      if (typeof h.session[name] !== "function") throw new Error(unsupported);
  }
  function baseline(h) {
    const nonMCP = name => !h.modules.isMCPToolName(name);
    return { previousModel: modelRef(h.session.model, h.session.configuredThinkingLevel()), previousEnabled: h.session.getEnabledToolNames().filter(nonMCP), previousMounted: h.session.getMountedXdevToolNames().filter(nonMCP) };
  }
  async function persist(h, mode, phase) {
    h.session.sessionManager.appendModeChange(mode, mode === "none" ? undefined : { planFilePath: h.planPath, ompguiPlan: { version: 1, phase, ...h.previous } });
    await h.session.sessionManager.flush();
  }
  /** 状态仅写入会话元数据，不进入模型上下文；落盘失败不能阻断处置。 */
  async function record(h, data) {
    if (!current(h)) return;
    try {
      const manager = h.session.sessionManager;
      const duplicate = manager.getEntries().some(entry => entry.type === "custom" && entry.customType === "ompgui-plan-status" &&
        entry.data?.operationId === data.operationId && entry.data?.kind === data.kind);
      if (!duplicate) manager.appendCustomEntry("ompgui-plan-status", data);
      // 原生空会话会延迟建档；仅 flush 不保证元数据已落盘。
      await manager.ensureOnDisk();
      await manager.flush();
    } catch (error) { h.ctx.ui.notify(`计划状态保存失败：${message(error)}`, "warning"); }
  }
  /** 从持久化记录累计完善次数，重新绑定或重启后仍保留版本序号。 */
  function revision(h) {
    try {
      return new Set(h.session.sessionManager.getEntries()
        .filter(entry => entry.type === "custom" && entry.customType === "ompgui-plan-status" && entry.data?.version === 1 && entry.data.kind === "refined")
        .map(entry => entry.data.operationId)).size + 1;
    } catch (error) { h.ctx.ui.notify(`计划版本读取失败：${message(error)}`, "warning"); return 1; }
  }
  async function applyModel(h, ref) {
    if (!ref) return;
    const model = h.ctx.modelRegistry.getAvailable("all").find(item => item.provider === ref.provider && item.id === ref.modelId);
    if (!model) throw new Error(`执行模型不可用：${ref.provider}/${ref.modelId}`);
    if (model.provider === h.session.model?.provider && model.id === h.session.model?.id) h.session.setThinkingLevel(ref.thinkingLevel);
    else await h.session.setModelTemporary(model, ref.thinkingLevel);
  }
  function validateModel(h, ref) {
    if (!ref || typeof ref.provider !== "string" || typeof ref.modelId !== "string") throw new Error("请选择可用执行模型");
    const model = h.ctx.modelRegistry.getAvailable("all").find(item => item.provider === ref.provider && item.id === ref.modelId);
    if (!model || h.modules.modelKind(model) !== "chat") throw new Error(`执行模型不可用：${ref.provider}/${ref.modelId}`);
    if (ref.thinkingLevel !== undefined && (!model.reasoning || !["off", "auto", ...h.modules.getSupportedEfforts(model)].includes(ref.thinkingLevel))) throw new Error("执行模型不支持所选思考强度");
    return model;
  }
  async function install(h) {
    if (!h.session.hasBuiltInTool("write")) throw new Error("扩展覆盖了内置 write，无法安全进入计划模式");
    h.session.setPlanModeState({ enabled: true, planFilePath: h.planPath, workflow: "parallel", reentry: h.reentry });
    await h.session.setActiveToolsByName([...new Set([...h.session.getEnabledToolNames().filter(name => name !== "write"), "write"])]);
    h.session.setPlanProposalHandler(title => h.session.preparePlanForReview(title));
  }
  async function exit(h, paused = false, deferModel = false) {
    const oldState = h.session.getPlanModeState();
    const oldTools = h.session.getEnabledToolNames();
    const oldMounted = h.session.getMountedXdevToolNames();
    const oldModel = modelRef(h.session.model, h.session.configuredThinkingLevel());
    const oldContext = h.session.sessionManager.buildSessionContext();
    h.session.setPlanModeState(undefined);
    h.session.setPlanProposalHandler(null);
    try {
      await h.session.restoreNonMCPToolPresentation(h.previous.previousEnabled, h.previous.previousMounted);
      if (!deferModel) await applyModel(h, h.previous.previousModel);
      await persist(h, paused ? "plan_paused" : "none", paused ? "paused" : "off");
    } catch (error) {
      h.session.setPlanModeState(oldState);
      await h.session.restoreNonMCPToolPresentation(oldTools, oldMounted);
      await applyModel(h, oldModel);
      h.session.setPlanProposalHandler(title => h.session.preparePlanForReview(title));
      h.session.sessionManager.appendModeChange(oldContext.mode ?? "none", oldContext.modeData);
      await h.session.sessionManager.flush();
      throw error;
    }
  }
  // 校验真实路径而非 renderer 提供的路径；禁止符号链接或重解析点逃逸。
  async function file(h) {
    if (!h.planPath?.startsWith("local://")) throw new Error("计划必须位于当前会话 local 目录");
    const resolved = path.resolve(h.modules.resolvePlanFilePath(h.planPath, options(h)));
    const realRoot = await fs.realpath(root(h));
    const realFile = await fs.realpath(resolved).catch(error => { if (error.code === "ENOENT") throw new Error("计划文件已不存在，请返回规划重新提交"); throw error; });
    const relative = path.relative(realRoot, realFile);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("计划路径越出当前会话 local 目录");
    const stat = await fs.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("计划路径不是普通文件");
    if (stat.size > LIMIT) throw new Error("计划正文超过 1MiB 上限");
    return resolved;
  }
  async function readDocument(h, title = h.document?.title ?? "计划") {
    const bytes = await fs.readFile(await file(h));
    if (bytes.length > LIMIT) throw new Error("计划正文超过 1MiB 上限");
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return { path: h.planPath, title, content, saveFileName: h.modules.planSaveFileName(title), revision: hash(bytes) };
  }
  async function review(h, title) {
    const document = await readDocument(h, title);
    await persist(h, "plan", "review");
    h.document = document;
    h.phase = "review";
    h.reviewId = randomUUID();
    h.error = undefined;
    if (!h.executionModel) {
      const resolved = h.session.resolveRoleModelWithThinking("default");
      const candidates = [modelRef(resolved?.model, resolved?.explicitThinkingLevel ? resolved.thinkingLevel : undefined), h.previous.previousModel, modelRef(h.session.model, h.session.configuredThinkingLevel())];
      h.executionModel = candidates.find(ref => { try { validateModel(h, ref); return true; } catch { return false; } });
    }
  }
  function listen(h) {
    h.unsubscribe = h.session.subscribe(event => {
      if (!current(h) || h.phase !== "planning" || event.type !== "tool_execution_end" || event.isError || h.proposing) return;
      const dispatch = h.modules.writeDeviceDispatch(event.toolName, event.result);
      const inner = dispatch?.inner;
      if (dispatch?.tool !== h.modules.PROPOSE_DEVICE_NAME || dispatch.mode !== "execute" || inner?.planExists !== true || typeof inner.planFilePath !== "string" || typeof inner.title !== "string" || h.seen.has(event.toolCallId) || !h.session.getPlanModeState()?.enabled) return;
      h.seen.add(event.toolCallId);
      h.proposing = true;
      // 不能在工具事件栈中等待 abort；proposal handler 已经返回真正解析结果。
      setTimeout(() => void (async () => {
        try {
          h.session.markPlanInternalAbortPending();
          try { await h.session.abort(); } finally { h.session.clearPlanInternalAbortPending(); }
          if (!current(h) || h.phase !== "planning" || !h.session.getPlanModeState()?.enabled) return;
          h.planPath = inner.planFilePath;
          h.session.setPlanModeState({ ...h.session.getPlanModeState(), planFilePath: h.planPath });
          await review(h, inner.title);
        } catch (error) { h.error = message(error); }
        finally { h.proposing = false; publish(h); }
      })(), 0);
    });
  }
  async function bind(ctx) {
    if (ctx.agent.kind !== "main") throw new Error("计划模式仅支持主会话");
    const session = nativeSession(ctx);
    if (!session || session.isDisposed || session.sessionManager.getSessionId() !== ctx.sessionManager.getSessionId()) throw new Error("原生会话注册表与当前会话不匹配");
    // 内部 newSession 的 await 窗口内 identity 尚未迁移，读取/取消仍属于原事务。
    if (host?.session === session && host.operation?.status === "running") { host.ctx = ctx; return host; }
    if (host && host.session === session && host.identity.sessionId === session.sessionManager.getSessionId() && host.identity.sessionFile === (session.sessionManager.getSessionFile() ?? "")) { host.ctx = ctx; return host; }
    if (host) { cancel(host); host.unsubscribe?.(); }
    const h = { ctx, session, epoch: randomUUID(), phase: "off", seen: new Set() };
    host = h;
    h.identity = identity(h);
    const context = session.sessionManager.buildSessionContext();
    try {
    if (["plan", "plan_paused"].includes(context.mode)) {
      try { h.modules = await modules(); } catch (error) { host = undefined; throw new Error(`${unsupported}：${message(error)}`); }
      capable(h);
      const data = context.modeData ?? {};
      h.previous = data.ompguiPlan?.version === 1 ? data.ompguiPlan : baseline(h);
      h.planPath = data.planFilePath ?? "local://PLAN.md";
      h.reentry = true;
      if (context.mode === "plan") {
        await install(h);
        h.phase = "planning";
        if (data.ompguiPlan?.phase === "review") await review(h);
      } else h.phase = "paused";
    } else if (session.getPlanModeState?.()?.enabled) { session.setPlanModeState(undefined); session.setPlanProposalHandler(null); }
    if (typeof session.subscribe === "function") listen(h);
    } catch (error) {
      h.unsubscribe?.();
      if (host === h) host = undefined;
      throw error;
    }
    return h;
  }
  function cancel(h) {
    if (h?.operation?.status !== "running") return;
    h.controller.abort();
    h.session.abortCompaction?.("用户停止计划处置");
    void h.session.abort().catch(() => {});
  }
  /** 仅凭当前事务的原始身份取消，内部切会话期间仍保留同一授权。 */
  function cancelAction(request) {
    const h = host;
    if (!request || Object.keys(request).sort().join(",") !== "identity,op,operationId" || request.op !== "cancel" ||
      !request.identity || Object.keys(request.identity).sort().join(",") !== "epoch,sessionFile,sessionId" ||
      !["sessionId", "sessionFile", "epoch"].every(key => typeof request.identity[key] === "string") ||
      !h || h.session.isDisposed || h.operation?.status !== "running" ||
      request.operationId !== h.operation.id || !same(request.identity, h.operation.origin)) throw new Error("计划操作已失效");
    cancel(h);
    return snapshot(h);
  }
  function check(h) {
    if (!current(h)) throw new Error("计划目标会话已改变");
    if (h.controller.signal.aborted) throw new Error("计划处置已取消");
  }
  async function newSession(h, document, copy) {
    const oldRoot = root(h);
    internalSwitch = true;
    let changed;
    try { changed = await h.session.newSession(); } finally {
      internalSwitch = false;
      // 原生已切换但初始化失败时，失败记录也只能属于实际所在的新会话。
      const actual = identity(h);
      if (actual.sessionId !== h.identity.sessionId || actual.sessionFile !== h.identity.sessionFile) {
        h.epoch = randomUUID();
        h.identity = identity(h);
      }
    }
    if (!changed) throw new Error("新建会话已取消");
    // 会话已创建，即使收到取消也必须完成计划副本，不能留下断裂引用。
    if (copy) {
      await h.modules.copyLocalArtifacts(oldRoot, root(h));
      const target = h.modules.resolvePlanFilePath(document.path, options(h));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, document.content, "utf8");
      h.session.setPlanReferencePath(document.path);
    }
  }
  async function dispatch(h, text, planning = false, images) {
    check(h);
    // prompt 等待整个模型回合；转换只等待 agent_start，后续归常规流处理。
    await new Promise((resolve, reject) => {
      let admitted = false;
      const unsubscribe = h.session.subscribe(event => {
        if (event.type !== "agent_start" || !current(h)) return;
        admitted = true;
        unsubscribe();
        h.phase = planning ? "planning" : "off";
        resolve();
      });
      const aborted = () => { if (!admitted) { unsubscribe(); reject(new Error("计划处置已取消")); } };
      h.controller.signal.addEventListener("abort", aborted, { once: true });
      Promise.resolve().then(() => { check(h); return h.session.prompt(text, planning ? (images?.length ? { images } : undefined) : { synthetic: true }); }).then(() => {
        if (!admitted) { unsubscribe(); reject(new Error("原生会话未启动执行回合")); }
      }, error => { if (!admitted) { unsubscribe(); reject(error); } }).finally(() => h.controller.signal.removeEventListener("abort", aborted));
    });
  }
  async function perform(h, request, document) {
    const choice = request.choice;
    let exited = false;
    const sourceIdentity = h.identity;
    const planningModel = modelRef(h.session.model, h.session.configuredThinkingLevel());
    const data = { version: 1, operationId: h.operation.id, choice, planPath: document.path, revision: revision(h) };
    try {
      // 切换前固定源计划与模型信息；新会话沿用快照，不回写源会话。
      if (["execute", "compact", "keep"].includes(choice)) {
        const model = validateModel(h, request.executionModel);
        data.model = { ...modelRef(model, request.executionModel.thinkingLevel), ...(model.name ? { name: model.name } : {}) };
        if (choice === "keep") data.contextPercent = h.session.getContextUsage({ contextWindow: model.contextWindow })?.percent;
      }
      check(h);
      if (choice === "refine") {
        await persist(h, "plan", "planning");
        await record(h, { ...data, kind: "refined", document: document.content });
        h.phase = "planning"; h.reviewId = undefined; h.document = undefined;
        check(h);
        if (request.feedback?.trim() || request.feedbackImages?.length) await dispatch(h, request.feedback ?? "", true, request.feedbackImages);
        h.operation.status = "completed";
        return;
      }
      if (choice === "save") {
        if (typeof request.savePath !== "string" || !path.isAbsolute(request.savePath)) throw new Error("缺少主进程确认的保存路径");
        await fs.writeFile(request.savePath, document.content, "utf8");
        h.operation.savedPath = request.savePath;
        check(h);
        await record(h, { ...data, kind: "saved", savedPath: request.savePath });
        await exit(h); exited = true;
        check(h);
        await newSession(h, document, false);
        await record(h, { ...data, kind: "saved", savedPath: request.savePath, sourceSessionFile: sourceIdentity.sessionFile });
        h.phase = "off"; h.document = undefined; h.reviewId = undefined;
        check(h);
        h.operation.status = "completed";
        return;
      }
      await exit(h, false, choice === "compact"); exited = true;
      check(h);
      if (choice === "execute") {
        await record(h, { ...data, kind: "executedElsewhere" });
        check(h);
        await newSession(h, document, true);
      }
      check(h);
      const enabled = [...new Set([...h.previous.previousEnabled, "read"])];
      await h.session.restoreNonMCPToolPresentation(enabled, h.previous.previousMounted);
      h.session.setPlanReferencePath(document.path);
      if (choice === "compact") {
        h.session.markPlanInternalAbortPending();
        try {
          await h.session.compact(undefined, { internalGuidance: h.modules.prompt.render(planModeCompactInstructionsPrompt, { planFilePath: document.path }), suppressContinuation: true });
        } catch (error) {
          if (error instanceof h.modules.CompactionCancelledError || error.name === "CompactionCancelledError" || h.controller.signal.aborted) {
            await applyModel(h, request.executionModel);
            h.phase = "off";
            throw error;
          }
          if (error.name !== "ManualCompactionNoOpError") throw error;
        } finally { h.session.clearPlanInternalAbortPending(); }
      }
      check(h);
      await applyModel(h, request.executionModel);
      check(h);
      try { await h.modules.autosaveApprovedPlan({ settings: h.session.settings, cwd: h.session.sessionManager.getCwd(), title: document.title, planContent: document.content }); }
      catch (error) { h.ctx.ui.notify(`计划自动保存失败：${message(error)}`, "warning"); }
      check(h);
      if (!h.session.sessionManager.getSessionName()) await h.session.sessionManager.setSessionName(document.title.replace(/[_-]+/g, " "), "auto");
      check(h);
      h.session.markPlanReferenceSent();
      const text = h.modules.prompt.render(planModeApprovedPrompt, { planFilePath: document.path, planContent: document.content, contextPreserved: choice !== "execute" });
      await record(h, { ...data, kind: choice === "execute" ? "continued" : "approved",
        ...(choice === "execute" ? { sourceSessionFile: sourceIdentity.sessionFile } : {}) });
      await dispatch(h, text);
      h.document = undefined; h.reviewId = undefined;
      h.operation.status = "completed";
    } catch (error) {
      const cancelled = h.controller.signal.aborted || error.name === "CompactionCancelledError";
      h.operation.error = message(error);
      h.error = message(error);
      if (cancelled && exited && choice === "compact" && current(h)) {
        try { await applyModel(h, request.executionModel); }
        catch (modelError) { h.operation.error += `；执行模型切换失败：${message(modelError)}`; }
      }
      if (current(h) && same(sourceIdentity, h.identity) && (!cancelled || !exited) && choice !== "refine") {
        try { await applyModel(h, planningModel); await install(h); await review(h, document.title); }
        catch (restoreError) { h.phase = "off"; h.document = undefined; h.reviewId = undefined; h.error += `；恢复计划模式失败：${message(restoreError)}`; }
      } else if (exited) { h.phase = "off"; h.document = undefined; h.reviewId = undefined; }
      // 恢复 guard、模型和审阅均已完成，才对外暴露处置终态。
      if (current(h)) await record(h, {
        ...data, kind: cancelled ? (choice === "compact" ? "compactCancelled" : "stopped") : "failed",
        ...(!same(sourceIdentity, h.identity) ? { sourceSessionFile: sourceIdentity.sessionFile } : {}),
        ...(cancelled && choice === "compact" ? { document: document.content } : {}),
        ...(!cancelled ? { error: h.operation.error } : {}),
      });
      h.operation.status = cancelled ? "cancelled" : "failed";
    } finally { publish(h); }
  }
  async function action(request, ctx) {
    const h = await bind(ctx);
    if (request.op === "status") return snapshot(h);
    if (!h.modules) {
      try { h.modules = await modules(); } catch (error) { throw new Error(`${unsupported}：${message(error)}`); }
    }
    capable(h);
    if (request.op === "cancel") return cancelAction({ op: request.op, identity: request.identity, operationId: request.operationId });
    if (!same(request.identity, h.identity)) throw new Error("计划身份已过期，请重新加载");
    if (h.operation?.status === "running" || h.proposing || h.session.isCompacting || h.session.isStreaming || !ctx.isIdle()) throw new Error("请等待当前会话空闲后操作计划");
    h.error = undefined;
    if (request.op === "enter") {
      if (!["off", "paused"].includes(h.phase)) throw new Error("当前已处于计划模式");
      if (!h.modules.cfgPlanEnabled.get(h.session.settings)) throw new Error("原生计划模式已禁用");
      if (["goal", "goal_paused", "vibe"].includes(h.session.sessionManager.buildSessionContext().mode)) throw new Error("请先退出 goal/vibe 模式");
      h.previous = baseline(h); h.planPath ??= "local://PLAN.md";
      const oldState = h.session.getPlanModeState();
      const oldContext = h.session.sessionManager.buildSessionContext();
      try {
        await install(h);
        const transition = h.modules.resolvePlanModelTransition(h.session.model, h.session.resolveRoleModelWithThinking("plan"), false);
        if (transition.kind === "thinking") h.session.setThinkingLevel(transition.thinkingLevel);
        else if (transition.kind === "apply") await h.session.setModelTemporary(transition.model, transition.thinkingLevel);
        await persist(h, "plan", "planning");
        h.phase = "planning"; h.reentry = true;
      } catch (error) {
        h.session.setPlanModeState(oldState); h.session.setPlanProposalHandler(null);
        await h.session.restoreNonMCPToolPresentation(h.previous.previousEnabled, h.previous.previousMounted);
        await applyModel(h, h.previous.previousModel);
        h.session.sessionManager.appendModeChange(oldContext.mode ?? "none", oldContext.modeData);
        await h.session.sessionManager.flush();
        throw error;
      }
    } else if (request.op === "pause" || request.op === "leave") {
      if (h.phase === "off") throw new Error("当前未处于计划模式");
      if (h.phase === "planning") {
        let content;
        try { content = (await readDocument(h)).content; }
        catch (error) { if (error.code !== "ENOENT" && !message(error).includes("计划文件已不存在")) throw error; }
        if (content?.trim()) {
          if (typeof ctx.ui.confirm !== "function") throw new Error("无法确认退出计划模式，请使用支持确认对话框的客户端");
          if (!(await ctx.ui.confirm("退出计划模式？", "退出计划模式但不批准计划？"))) throw new Error("已取消退出计划模式");
          if (!same(request.identity, h.identity) || !current(h)) throw new Error("计划身份已过期，请重新加载");
        }
      }
      if (h.phase !== "paused") await exit(h, request.op === "pause");
      else await persist(h, "none", "off");
      h.phase = request.op === "pause" && h.phase !== "paused" ? "paused" : "off";
      h.document = undefined; h.reviewId = undefined;
    } else if (request.op === "saveDocument") {
      if (h.phase !== "review" || request.path !== h.planPath || typeof request.content !== "string" || typeof request.revision !== "string") throw new Error("当前计划不可编辑");
      if (Buffer.byteLength(request.content, "utf8") > LIMIT) throw new Error("计划正文超过 1MiB 上限");
      const latest = await readDocument(h);
      if (request.revision !== latest.revision) { h.document = latest; h.error = CONFLICT; return snapshot(h); }
      const target = await file(h);
      const temporary = path.join(path.dirname(target), `.ompgui-plan-${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, request.content, { encoding: "utf8", flag: "wx" });
        const confirmed = await readDocument(h);
        if (confirmed.revision !== request.revision) { h.document = confirmed; h.error = CONFLICT; return snapshot(h); }
        await fs.rename(temporary, target);
        h.document = { ...latest, content: request.content, revision: hash(Buffer.from(request.content, "utf8")) };
      } finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    } else if (request.op === "decide") {
      if (h.phase !== "review" || request.reviewId !== h.reviewId || !["execute", "compact", "keep", "refine", "save"].includes(request.choice)) throw new Error("计划审阅已失效");
      const document = await readDocument(h);
      if (document.revision !== request.revision) throw new Error(CONFLICT);
      if (["execute", "compact", "keep"].includes(request.choice)) {
        if (!document.content.trim()) throw new Error("计划内容为空，请补充后再批准");
        const model = validateModel(h, request.executionModel);
        if (request.choice === "keep") {
          const usage = h.session.getContextUsage({ contextWindow: model.contextWindow });
          if (usage?.percent > 95) throw new Error(`上下文 ${usage.tokens} / ${usage.contextWindow} 超过95%，不能保留完整上下文`);
        }
        h.executionModel = request.executionModel;
      }
      if (request.choice === "save" && (typeof request.savePath !== "string" || !path.isAbsolute(request.savePath))) throw new Error("缺少主进程确认的保存路径");
      h.document = document;
      h.controller = new AbortController();
      h.operation = { id: randomUUID(), choice: request.choice, status: "running", origin: { ...h.identity } };
      h.phase = "applying";
      setTimeout(() => void perform(h, request, document), 0);
    } else throw new Error("无效的计划操作");
    publish(h); return snapshot(h);
  }
  for (const event of ["session_before_switch", "session_before_branch", "session_before_tree"]) api.on(event, () => {
    if (internalSwitch && event === "session_before_switch") { internalSwitch = false; return; }
    if (host?.operation?.status === "running") return { cancel: true };
  });
  for (const event of ["session_switch", "session_branch", "session_tree"]) api.on(event, (_event, ctx) => {
    if (host?.operation?.status === "running") return;
    if (host) { host.unsubscribe?.(); host = undefined; }
    // 状态重新绑定由可信主进程的 status 引导，读取本身不反复重建工具。
  });
  api.on("session_shutdown", async () => {
    if (host) { cancel(host); host.unsubscribe?.(); host = undefined; }
    await closeControl();
  });
  api.registerCommand("ompgui-plan", {
    description: "桌面端原生计划模式",
    async handler(args, ctx) {
      let request;
      try {
        request = JSON.parse(args);
        if (!request || typeof request !== "object" || typeof request.requestId !== "string") throw new Error("无效的计划请求");
        if (shutdown) throw new Error("计划控制通道已关闭");
        const channel = await (controlPromise ??= startControl());
        // cancel 必须绕过长任务队列，否则 stop 会排在被取消任务之后。
        const execute = () => action(request, ctx);
        const result = request.op === "cancel" ? await execute() : await (queue = queue.catch(() => {}).then(execute));
        reply(ctx, request.requestId, { ok: true, data: { ...result, _planControl: { endpoint: channel.endpoint, token: channel.token } } });
      } catch (error) { reply(ctx, request?.requestId, { ok: false, error: message(error) }); }
    },
  });
}
