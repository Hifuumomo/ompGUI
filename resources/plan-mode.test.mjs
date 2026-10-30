import { test } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createConnection } from "node:net";
import { registerPlanMode } from "./plan-mode.mjs";

/** 真实临时文件和事件驱动会话夹具；验证状态、磁盘和派发请求而非参数回声。 */
async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ompgui-plan-test-"));
  t.onTestFinished(async () => {
    for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
    await fs.rm(directory, { recursive: true, force: true });
  });
  const handlers = new Map();
  const listeners = new Set();
  const replies = new Map();
  const notifications = [];
  const requests = [];
  const history = new Map([["session-1", [{ mode: "none" }]]]);
  const durableSessions = new Set(["session-1"]);
  let id = "session-1";
  let mode = { mode: "none" };
  let thinking = "low";
  let tools = ["read", "grep", "mcp__server_tool"];
  let mounted = ["browser", "mcp__server_tool"];
  let planState;
  let proposalHandler;
  const models = [
    { provider: "local", id: "A", name: "Planning A", reasoning: true, contextWindow: 10000 },
    { provider: "local", id: "B", name: "Execution B", reasoning: true, contextWindow: 20000 },
    { provider: "local", id: "image", kind: "image", contextWindow: 0 },
  ];
  const emit = event => { for (const listener of [...listeners]) listener(event); };
  const sessionManager = {
    getSessionId: () => id,
    getSessionFile: () => path.join(directory, `${id}.jsonl`),
    getArtifactsDir: () => path.join(directory, id),
    getCwd: () => directory,
    buildSessionContext: () => mode,
    appendModeChange(value, data) { mode = { mode: value, modeData: data }; history.get(id).push(mode); },
    getEntries: () => history.get(id),
    getBranch: () => history.get(id),
    appendCustomEntry(customType, data) { history.get(id).push({ type: "custom", customType, data }); },
    // 模拟原生空会话的延迟建档，flush 本身不能让新会话落盘。
    async ensureOnDisk() { durableSessions.add(id); },
    async flush() { if (durableSessions.has(id)) await fs.writeFile(this.getSessionFile(), history.get(id).map(item => JSON.stringify(item)).join("\n")); },
    getSessionName: () => undefined,
    async setSessionName() {},
  };
  class CompactionCancelledError extends Error { constructor() { super("cancelled"); this.name = "CompactionCancelledError"; } }
  const session = {
    sessionManager, model: models[0], settings: {}, isStreaming: false, isCompacting: false,
    getPlanModeState: () => planState,
    setPlanModeState: value => { planState = value; },
    setPlanProposalHandler: value => { proposalHandler = value; },
    async preparePlanForReview(title) { return { details: { planFilePath: planState.planFilePath, title, planExists: true } }; },
    getEnabledToolNames: () => tools,
    getMountedXdevToolNames: () => mounted,
    async setActiveToolsByName(value) { assert.equal(planState?.enabled, true); tools = value; },
    async restoreNonMCPToolPresentation(enabled, mount) { tools = [...enabled, "mcp__server_tool"]; mounted = mount; },
    hasBuiltInTool: () => true,
    configuredThinkingLevel: () => thinking,
    setThinkingLevel: value => { thinking = value; },
    async setModelTemporary(model, level) { session.model = model; thinking = level; },
    resolveRoleModelWithThinking: role => ({ model: role === "plan" ? models[0] : models[1], explicitThinkingLevel: true, thinkingLevel: "high" }),
    getContextUsage: ({ contextWindow = 10000 } = {}) => ({ tokens: 2000, contextWindow, percent: 200000 / contextWindow }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    markPlanInternalAbortPending() {}, clearPlanInternalAbortPending() {},
    async abort() { session.isStreaming = false; },
    abortCompaction() { session.isCompacting = false; },
    setPlanReferencePath(value) { session.reference = value; }, markPlanReferenceSent() { session.referenceSent = true; },
    async newSession() {
      for (const handler of handlers.get("session_before_switch") ?? []) if ((await handler({}, ctx))?.cancel) return false;
      id = `session-${history.size + 1}`; history.set(id, []); mode = { mode: "none" };
      for (const handler of handlers.get("session_switch") ?? []) await handler({}, ctx);
      return true;
    },
    async compact(_instructions, options) { requests.push({ kind: "summary", options, model: session.model.id }); },
    async prompt(text, options) { requests.push({ kind: "prompt", text, options, model: session.model.id, thinking, sessionId: id, history: [...history.get(id)] }); session.isStreaming = true; emit({ type: "agent_start" }); },
    ...overrides.session,
  };
  const warnings = [];
  const ctx = { agent: { id: "main", kind: "main" }, sessionManager, modelRegistry: { getAvailable: () => models }, isIdle: () => !session.isStreaming && !session.isCompacting, ui: { notify: (text, level) => { if (level === "warning") warnings.push(text); try { notifications.push(JSON.parse(text)); } catch {} } } };
  const api = { pi: { AgentRegistry: { global: () => ({ get: () => ({ session }) }) } }, on(event, handler) { handlers.set(event, [...handlers.get(event) ?? [], handler]); }, registerCommand(name, command) { handlers.set(name, command); } };
  const modules = {
    cfgPlanEnabled: { get: () => true },
    resolvePlanModelTransition: (_model, resolved) => ({ kind: "thinking", thinkingLevel: resolved.thinkingLevel }),
    isMCPToolName: name => name.startsWith("mcp__"),
    resolveLocalRoot: options => path.join(options.getArtifactsDir(), "local"),
    resolvePlanFilePath: (url, options) => path.join(options.localProtocolOptions.getArtifactsDir(), "local", url.slice(8)),
    async copyLocalArtifacts(source, destination) { await fs.cp(source, destination, { recursive: true }); },
    planSaveFileName: () => "TEST_PLAN.md",
    autosaveApprovedPlan: async () => null,
    writeDeviceDispatch: (tool, result) => tool === "write" ? result.details?.xdev : undefined,
    PROPOSE_DEVICE_NAME: "propose",
    getSupportedEfforts: () => ["low", "high"], modelKind: model => model.kind ?? "chat",
    CompactionCancelledError,
    prompt: { render: (template, data) => template.replace(/{{(planContent|planFilePath)}}/g, (_match, key) => data[key] ?? "") },
    ...overrides.modules,
  };
  registerPlanMode(api, (_ctx, requestId, response) => replies.set(requestId, response), async () => { if (overrides.loadError) throw overrides.loadError; return modules; });
  let sequence = 0;
  async function call(action) {
    const requestId = String(++sequence);
    await handlers.get("ompgui-plan").handler(JSON.stringify({ ...action, requestId }), ctx);
    return replies.get(requestId);
  }
  const status = async () => (await call({ op: "status" })).data;
  const mutation = async action => call({ identity: (await status()).identity, ...action });
  async function ready(content = "# Test\n\n执行项A\n") {
    assert.equal((await mutation({ op: "enter" })).ok, true);
    const local = path.join(sessionManager.getArtifactsDir(), "local");
    await fs.mkdir(local, { recursive: true });
    await fs.writeFile(path.join(local, "PLAN.md"), content);
    await fs.writeFile(path.join(local, "research.txt"), "research");
    const prepared = await proposalHandler("Test");
    emit({ type: "tool_execution_end", toolName: "write", toolCallId: "proposal-1", result: { details: { xdev: { tool: "propose", mode: "execute", inner: prepared.details } } } });
    await until(async () => (await status()).phase === "review");
    return status();
  }
  /** 只读取持久化元数据，避免把模式日志或模型消息混入断言。 */
  const records = (sessionId = id) => history.get(sessionId).filter(entry => entry.type === "custom" && entry.customType === "ompgui-plan-status").map(entry => entry.data);
  async function decide(choice, extra = {}) {
    const snapshot = await status();
    return call({ op: "decide", identity: snapshot.identity, reviewId: snapshot.reviewId, revision: snapshot.document.revision, choice, executionModel: { provider: "local", modelId: "B", thinkingLevel: "high" }, ...extra });
  }
  return { session, ctx, call, status, mutation, ready, decide, emit, notifications, warnings, requests, history, records, directory, modules, handlers, get tools() { return tools; }, get planState() { return planState; } };
}
async function until(predicate) {
  for (let index = 0; index < 100; index++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail("native operation did not settle");
}

/** 测试使用真实本地 socket，不经扩展命令处理器发送取消。 */
function controlRequest(control, request, raw) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(control.endpoint);
    let response = "";
    socket.setTimeout(2000, () => socket.destroy(new Error("control response timeout")));
    socket.on("error", reject);
    socket.on("connect", () => socket.write(raw ?? `${JSON.stringify({ token: control.token, action: request })}\n`));
    socket.on("data", chunk => { response += chunk.toString("utf8"); });
    socket.on("end", () => {
      try { resolve(JSON.parse(response)); } catch (error) { reject(error); }
    });
  });
}

test("enter is native, role thinking changes without a model rebuild, pause restores presentation", async t => {
  const f = await fixture(t, { session: { setModelTemporary() { throw new Error("unnecessary model rebuild"); } } });
  const entered = await f.mutation({ op: "enter" });
  assert.equal(entered.data.phase, "planning");
  assert.equal(f.planState.enabled, true);
  assert(f.tools.includes("write"));
  assert.equal(f.requests.length, 0);
  const paused = await f.mutation({ op: "pause" });
  assert.equal(paused.data.phase, "paused");
  assert.equal(f.planState, undefined);
  assert(!f.tools.includes("write"));
  assert.equal((await f.mutation({ op: "leave" })).data.phase, "off");
});

test("ordinary sessions remain readable with missing native modules; plan entry fails explicitly", async t => {
  const f = await fixture(t, { loadError: new Error("module unavailable") });
  assert.equal((await f.status()).phase, "off");
  const result = await f.mutation({ op: "enter" });
  assert.equal(result.ok, false);
  assert.match(result.error, /升级到兼容版本/);
});

test("shadow write and goal conflicts cannot enter or weaken guards", async t => {
  const f = await fixture(t, { session: { hasBuiltInTool: () => false } });
  assert.equal((await f.mutation({ op: "enter" })).ok, false);
  assert.equal(f.planState, undefined);
  f.session.sessionManager.buildSessionContext = () => ({ mode: "goal_paused" });
  assert.match((await f.mutation({ op: "enter" })).error, /goal/);
});

test("only successful native propose metadata creates a review", async t => {
  const f = await fixture(t);
  await f.mutation({ op: "enter" });
  for (const event of [
    { toolName: "write", result: { details: { planFilePath: "local://PLAN.md", title: "fake", planExists: true } } },
    { toolName: "write", isError: true, result: { details: { xdev: { tool: "propose", mode: "execute", inner: { planExists: true } } } } },
    { toolName: "read", result: { details: { xdev: { tool: "propose", mode: "execute", inner: { planExists: true } } } } },
  ]) f.emit({ type: "tool_execution_end", toolCallId: Math.random().toString(), ...event });
  assert.equal((await f.status()).phase, "planning");
  assert.equal(f.notifications.filter(item => item.snapshot?.phase === "review").length, 0);
});

test("revision conflict preserves external bytes and returns current baseline", async t => {
  const f = await fixture(t);
  const review = await f.ready();
  const target = path.join(f.session.sessionManager.getArtifactsDir(), "local", "PLAN.md");
  await fs.writeFile(target, "external edit");
  const result = await f.mutation({ op: "saveDocument", path: review.document.path, revision: review.document.revision, content: "my edit" });
  assert.equal(result.data.error, "计划已在磁盘修改，请先处理冲突");
  assert.equal(result.data.document.content, "external edit");
  assert.equal(await fs.readFile(target, "utf8"), "external edit");
  assert.equal((await f.call({ op: "decide", identity: review.identity, reviewId: review.reviewId, revision: review.document.revision, choice: "keep", executionModel: { provider: "local", modelId: "B" } })).ok, false);
  assert.equal(f.requests.length, 0);
});

test("save supports empty editing and exact 1MiB; missing file is not recreated", async t => {
  const f = await fixture(t);
  let review = await f.ready();
  for (const content of ["", "中".repeat(349525) + "x"]) {
    const result = await f.mutation({ op: "saveDocument", path: review.document.path, revision: review.document.revision, content });
    assert.equal(result.ok, true); review = result.data;
  }
  assert.equal((await f.mutation({ op: "saveDocument", path: review.document.path, revision: review.document.revision, content: "x".repeat(1048577) })).ok, false);
  await fs.unlink(path.join(f.session.sessionManager.getArtifactsDir(), "local", "PLAN.md"));
  assert.match((await f.mutation({ op: "saveDocument", path: review.document.path, revision: review.document.revision, content: "restore" })).error, /已不存在/);
});

for (const choice of ["execute", "keep", "compact"]) test(`${choice} executes edited plan exactly once with chosen non-cycle model`, async t => {
  const f = await fixture(t);
  const before = await f.ready();
  const saved = await f.mutation({ op: "saveDocument", path: before.document.path, revision: before.document.revision, content: "# Test\n\n执行项B\n" });
  assert.equal(saved.ok, true);
  const admitted = await f.decide(choice);
  assert.equal(admitted.data.operation.status, "running");
  assert.equal((await f.decide(choice)).ok, false);
  await until(async () => (await f.status()).operation?.status === "completed");
  const after = await f.status();
  const prompts = f.requests.filter(item => item.kind === "prompt");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].text, /执行项B/);
  assert.equal(prompts[0].model, "B"); assert.equal(prompts[0].thinking, "high");
  assert.equal(after.phase, "off"); assert.equal(f.planState, undefined);
  const record = f.records()[0];
  assert.equal(record.kind, choice === "execute" ? "continued" : "approved");
  assert.equal(record.operationId, after.operation.id);
  assert.equal(record.choice, choice);
  assert.equal(record.planPath, "local://PLAN.md");
  assert.equal(record.revision, 1);
  assert.deepEqual(record.model, { provider: "local", modelId: "B", name: "Execution B", thinkingLevel: "high" });
  assert.equal(record.document, undefined);
  assert.equal(record.contextPercent, choice === "keep" ? 10 : undefined);
  assert.deepEqual(prompts[0].history.filter(entry => entry.type === "custom").map(entry => entry.data), [record]);
  assert.equal(f.records().length, 1);
  const disk = (await fs.readFile(after.identity.sessionFile, "utf8")).split("\n").map(line => JSON.parse(line));
  assert.deepEqual(disk.filter(entry => entry.type === "custom").map(entry => entry.data), [record]);
  if (choice === "execute") {
    assert.notEqual(after.identity.sessionId, before.identity.sessionId);
    assert.equal(after.operation.origin.epoch, before.identity.epoch);
    assert.equal(await fs.readFile(path.join(f.session.sessionManager.getArtifactsDir(), "local", "research.txt"), "utf8"), "research");
    assert(f.history.has(before.identity.sessionId));
    assert.deepEqual(f.records(before.identity.sessionId).map(item => item.kind), ["executedElsewhere"]);
    assert.equal(f.records(before.identity.sessionId)[0].targetSessionId, undefined);
    assert.equal(record.sourceSessionFile, before.identity.sessionFile);
  } else assert.equal(after.identity.sessionId, before.identity.sessionId);
  if (choice === "compact") { assert.equal(f.requests[0].kind, "summary"); assert.equal(f.requests[0].options.suppressContinuation, true); assert.match(f.requests[0].options.internalGuidance, /MUST distill/); }
});

test("keep threshold and unavailable/invalid thinking reject before exiting plan", async t => {
  const f = await fixture(t);
  await f.ready();
  for (const executionModel of [{ provider: "local", modelId: "missing" }, { provider: "local", modelId: "B", thinkingLevel: "nonsense" }, { provider: "local", modelId: "image" }]) assert.equal((await f.decide("keep", { executionModel })).ok, false);
  f.session.getContextUsage = ({ contextWindow = 10000 } = {}) => ({ tokens: contextWindow, contextWindow, percent: 100 });
  assert.match((await f.decide("keep")).error, /95%/);
  assert.equal(f.planState.enabled, true); assert.equal(f.requests.length, 0);
});

test("compact failure returns guarded review and never silently executes", async t => {
  const f = await fixture(t, { session: { async compact() { throw new Error("summary rejected"); } } });
  const before = await f.ready();
  await f.decide("compact");
  await until(async () => (await f.status()).operation?.status === "failed");
  const after = await f.status();
  assert.equal(after.phase, "review"); assert.notEqual(after.reviewId, before.reviewId);
  assert.equal(f.planState.enabled, true); assert.equal(f.requests.length, 0);
  assert.deepEqual(f.records().map(item => item.kind), ["failed"]);
  assert.equal(f.records()[0].error, "summary rejected");
});

test("cancel interrupts compaction immediately and does not dispatch execution", async t => {
  let release;
  const f = await fixture(t, { session: { async compact() { await new Promise(resolve => { release = resolve; }); }, abortCompaction() { release?.(); } } });
  await f.ready();
  const admitted = await f.decide("compact");
  await until(() => !!release);
  assert.equal((await f.call({ op: "cancel", identity: admitted.data.operation.origin, operationId: admitted.data.operation.id })).ok, true);
  await until(async () => (await f.status()).operation?.status === "cancelled");
  assert.equal(f.requests.filter(item => item.kind === "prompt").length, 0);
  assert.deepEqual(f.records().map(item => item.kind), ["compactCancelled"]);
  assert.match(f.records()[0].document, /执行项A/);
});

test("authenticated socket cancels blocked compact without entering the command lane or publishing credentials", async t => {
  let release;
  let aborted = 0;
  const f = await fixture(t, { session: {
    async compact() { f.session.isCompacting = true; await new Promise(resolve => { release = resolve; }); f.session.isCompacting = false; },
    abortCompaction() { aborted++; release?.(); },
  } });
  await f.ready();
  const admitted = await f.decide("compact");
  await until(() => !!release);
  const control = admitted.data._planControl;
  assert.match(control.token, /^[a-f0-9]{64}$/);
  const action = { op: "cancel", identity: admitted.data.operation.origin, operationId: admitted.data.operation.id };
  // 原生维护期间 slash admission 不可用；socket 必须完全独立。
  const command = f.handlers.get("ompgui-plan");
  f.handlers.set("ompgui-plan", { handler() { throw new Error("manual maintenance blocks prompt admission"); } });
  const result = await controlRequest(control, action);
  assert.equal(result.ok, true);
  assert.equal(aborted, 1);
  assert.equal(result.data._planControl, undefined);
  await until(() => f.notifications.some(item => item.snapshot?.operation?.status === "cancelled"));
  f.handlers.set("ompgui-plan", command);
  assert.equal((await f.status()).operation.status, "cancelled");
  assert.equal(f.requests.filter(item => item.kind === "prompt").length, 0);
  assert.equal(JSON.stringify(f.notifications).includes(control.token), false);
  assert.equal(JSON.stringify(f.notifications).includes(control.endpoint), false);
  assert.equal(JSON.stringify(f.notifications).includes("_planControl"), false);
});

test("socket cancellation rejects credentials, stale origin/id, unsupported actions and oversized requests", async t => {
  let release;
  let aborted = 0;
  const f = await fixture(t, { session: {
    async compact() { await new Promise(resolve => { release = resolve; }); },
    abortCompaction() { aborted++; release?.(); },
  } });
  await f.ready();
  const admitted = await f.decide("compact");
  await until(() => !!release);
  const control = admitted.data._planControl;
  const action = { op: "cancel", identity: admitted.data.operation.origin, operationId: admitted.data.operation.id };
  assert.equal((await controlRequest({ ...control, token: "0".repeat(64) }, action)).ok, false);
  assert.equal((await controlRequest(control, { ...action, operationId: "other" })).ok, false);
  for (const key of ["sessionId", "sessionFile", "epoch"])
    assert.equal((await controlRequest(control, { ...action, identity: { ...action.identity, [key]: "other" } })).ok, false);
  assert.equal((await controlRequest(control, { ...action, op: "status" })).ok, false);
  assert.equal((await controlRequest(control, action, "{broken\n")).ok, false);
  assert.equal((await controlRequest(control, action, `${" ".repeat(8192)}\n`)).ok, false);
  assert.equal(aborted, 0);
  assert.equal((await controlRequest(control, action)).ok, true);
  await until(async () => (await f.status()).operation?.status === "cancelled");
  assert.equal(f.requests.filter(item => item.kind === "prompt").length, 0);
});

test("session shutdown closes the private server and removes its Unix directory", async t => {
  const f = await fixture(t);
  const control = (await f.status())._planControl;
  for (const handler of f.handlers.get("session_shutdown")) await handler({}, f.ctx);
  await assert.rejects(controlRequest(control, { op: "cancel", identity: {}, operationId: "old" }));
  if (process.platform !== "win32") await assert.rejects(fs.stat(path.dirname(control.endpoint)), { code: "ENOENT" });
  assert.equal((await f.call({ op: "status" })).ok, false);
});

for (const feedback of [undefined, "继续完善中文反馈"]) test(`refine preserves native planning; feedback=${feedback ?? "empty"}`, async t => {
  const f = await fixture(t); await f.ready();
  await f.decide("refine", { feedback });
  await until(async () => (await f.status()).operation?.status === "completed");
  const after = await f.status();
  assert.equal(after.phase, "planning"); assert.equal(after.reviewId, undefined); assert.equal(f.planState.enabled, true);
  assert.equal(f.requests.length, feedback ? 1 : 0);
  if (feedback) { assert.equal(f.requests[0].text, feedback); assert.equal(f.requests[0].model, "A"); }
  assert.deepEqual(f.records().map(item => item.kind), ["refined"]);
  assert.match(f.records()[0].document, /执行项A/);
  assert.equal(f.records()[0].revision, 1);
});

test("save writes user destination then creates empty session without execution", async t => {
  const f = await fixture(t); const before = await f.ready();
  const savePath = path.join(f.directory, "saved.md");
  await f.decide("save", { savePath });
  await until(async () => (await f.status()).operation?.status === "completed");
  const after = await f.status();
  assert.equal(await fs.readFile(savePath, "utf8"), before.document.content);
  assert.equal(after.operation.savedPath, savePath); assert.notEqual(after.identity.sessionId, before.identity.sessionId);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.records(before.identity.sessionId).map(item => item.kind), ["saved"]);
  assert.deepEqual(f.records().map(item => item.kind), ["saved"]);
  assert.equal(f.records()[0].savedPath, savePath);
  assert.equal(f.records()[0].sourceSessionFile, before.identity.sessionFile);
  assert.equal(f.records(before.identity.sessionId)[0].targetSessionId, undefined);
  const targetDisk = (await fs.readFile(after.identity.sessionFile, "utf8")).split("\n").map(line => JSON.parse(line));
  const sourceDisk = (await fs.readFile(before.identity.sessionFile, "utf8")).split("\n").map(line => JSON.parse(line));
  assert.deepEqual(targetDisk.filter(entry => entry.type === "custom").map(entry => entry.data), f.records());
  assert.deepEqual(sourceDisk.filter(entry => entry.type === "custom").map(entry => entry.data), f.records(before.identity.sessionId));
});

test("save failure stays in review; saved file survives cancelled new-session", async t => {
  const f = await fixture(t); await f.ready();
  await f.decide("save", { savePath: path.join(f.directory, "missing", "saved.md") });
  await until(async () => (await f.status()).operation?.status === "failed");
  assert.equal((await f.status()).phase, "review");
  const savePath = path.join(f.directory, "saved.md");
  f.session.newSession = async () => false;
  await f.decide("save", { savePath });
  await until(async () => (await f.status()).operation?.status === "failed");
  assert.equal((await f.status()).operation.savedPath, savePath);
  assert.equal((await f.status()).phase, "review");
  assert.equal(f.planState.enabled, true);
  assert.match(await fs.readFile(savePath, "utf8"), /执行项A/);
});

test("planning pause asks once and cancellation preserves native mode", async t => {
  const f = await fixture(t);
  await f.mutation({ op: "enter" });
  const local = path.join(f.session.sessionManager.getArtifactsDir(), "local");
  await fs.mkdir(local, { recursive: true }); await fs.writeFile(path.join(local, "PLAN.md"), "draft");
  let asked = 0;
  f.ctx.ui.confirm = async () => { asked++; return false; };
  assert.match((await f.mutation({ op: "pause" })).error, /已取消/);
  assert.equal(f.planState.enabled, true); assert.equal(asked, 1);
  f.ctx.ui.confirm = async () => { asked++; return true; };
  assert.equal((await f.mutation({ op: "pause" })).data.phase, "paused");
  assert.equal(asked, 2);
});

test("new-session rejection restores review guard and does not dispatch", async t => {
  const f = await fixture(t, { session: { newSession: async () => false } });
  const before = await f.ready();
  await f.decide("execute");
  await until(async () => (await f.status()).operation?.status === "failed");
  const after = await f.status();
  assert.equal(after.phase, "review"); assert.equal(after.identity.sessionId, before.identity.sessionId);
  assert.notEqual(after.reviewId, before.reviewId); assert.equal(f.planState.enabled, true);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.records().map(item => item.kind), ["executedElsewhere", "failed"]);
  assert.equal(f.records()[1].error, "新建会话已取消");
});

test("external navigation is blocked while applying but internal execute is allowed", async t => {
  let release;
  const f = await fixture(t, { session: { compact: async () => new Promise(resolve => { release = resolve; }) } });
  await f.ready(); await f.decide("compact"); await until(() => !!release);
  for (const name of ["session_before_switch", "session_before_branch", "session_before_tree"])
    assert.equal((await f.handlers.get(name)[0]({}, f.ctx)).cancel, true);
  release(); await until(async () => (await f.status()).operation?.status === "completed");
});

test("persisted review restores with fresh epoch and rejects stale decisions", async t => {
  const f = await fixture(t); const before = await f.ready();
  for (const handler of f.handlers.get("session_tree")) await handler({}, f.ctx);
  const restored = await f.status();
  assert.equal(restored.phase, "review"); assert.notEqual(restored.identity.epoch, before.identity.epoch);
  assert.notEqual(restored.reviewId, before.reviewId);
  assert.equal((await f.call({ op: "decide", identity: before.identity, reviewId: before.reviewId, revision: before.document.revision, choice: "keep", executionModel: { provider: "local", modelId: "B" } })).ok, false);
  assert.equal(f.requests.length, 0);
});

test("empty approval and mismatched identity cannot remove native guards", async t => {
  const f = await fixture(t); const review = await f.ready("");
  assert.match((await f.decide("execute")).error, /计划内容为空/);
  assert.equal((await f.call({ op: "leave", identity: { ...review.identity, epoch: "stale" } })).ok, false);
  assert.equal(f.planState.enabled, true);
});

test("tool rebuild failure rolls back model, tools, state and journal mode", async t => {
  const f = await fixture(t, { session: { async setActiveToolsByName() { throw new Error("rebuild failed"); } } });
  assert.match((await f.mutation({ op: "enter" })).error, /rebuild failed/);
  assert.equal(f.planState, undefined); assert(!f.tools.includes("write"));
  assert.equal(f.session.sessionManager.buildSessionContext().mode, "none");
  assert.equal(f.session.configuredThinkingLevel(), "low");
});

test("a successful propose is deduplicated and late proposal cannot reopen a refined review", async t => {
  const f = await fixture(t); const before = await f.ready();
  await f.decide("refine");
  await until(async () => (await f.status()).operation?.status === "completed");
  f.emit({ type: "tool_execution_end", toolName: "write", toolCallId: "proposal-1", result: { details: { xdev: { tool: "propose", mode: "execute", inner: { planFilePath: before.document.path, title: "Test", planExists: true } } } } });
  assert.equal((await f.status()).phase, "planning");
});

test("invalid UTF-8 is rejected without overwriting disk", async t => {
  const f = await fixture(t); const before = await f.ready();
  const target = path.join(f.session.sessionManager.getArtifactsDir(), "local", "PLAN.md");
  const bytes = Buffer.from([0xff, 0xfe, 0x41]);
  await fs.writeFile(target, bytes);
  assert.equal((await f.mutation({ op: "saveDocument", path: before.document.path, revision: before.document.revision, content: "replacement" })).ok, false);
  assert.deepEqual(await fs.readFile(target), bytes);
  assert.equal((await f.decide("keep")).ok, false); assert.equal(f.planState.enabled, true);
});

test("a symlink cannot grant access outside the session local root", async t => {
  const f = await fixture(t); const before = await f.ready();
  const target = path.join(f.session.sessionManager.getArtifactsDir(), "local", "PLAN.md");
  const outside = path.join(f.directory, "outside.md");
  await fs.writeFile(outside, "private outside"); await fs.unlink(target);
  try { await fs.symlink(outside, target, "file"); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) { t.skip("host does not permit symlink creation"); return; } throw error; }
  const result = await f.mutation({ op: "saveDocument", path: before.document.path, revision: before.document.revision, content: "replacement" });
  assert.equal(result.ok, false); assert.match(result.error, /越出|普通文件/);
  assert.equal(await fs.readFile(outside, "utf8"), "private outside");
});

test("missing capabilities on persisted plan fail closed on every bootstrap attempt", async t => {
  const f = await fixture(t); await f.ready();
  for (const handler of f.handlers.get("session_tree")) await handler({}, f.ctx);
  f.session.preparePlanForReview = undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.call({ op: "status" });
    assert.equal(result.ok, false); assert.match(result.error, /升级到兼容版本/);
  }
});

test("pre-start execution dispatch error restores guarded review", async t => {
  const f = await fixture(t, { session: { async prompt() { throw new Error("provider authentication rejected"); } } });
  const before = await f.ready(); await f.decide("keep");
  await until(async () => (await f.status()).operation?.status === "failed");
  const after = await f.status();
  assert.equal(after.phase, "review"); assert.notEqual(after.reviewId, before.reviewId);
  assert.equal(f.planState.enabled, true); assert.match(after.operation.error, /authentication rejected/);
  assert.deepEqual(f.records().map(item => item.kind), ["approved", "failed"]);
  assert.equal(new Set(f.records().map(item => item.operationId)).size, 1);
});

test("stop during an internal newSession keeps origin identity and completes necessary plan copy", async t => {
  const f = await fixture(t);
  await f.ready();
  const original = f.session.newSession;
  let release;
  f.session.newSession = async () => { const result = await original(); await new Promise(resolve => { release = resolve; }); return result; };
  const admitted = await f.decide("execute");
  await until(() => !!release);
  const during = await f.status();
  assert.equal(during.operation.id, admitted.data.operation.id);
  assert.equal((await controlRequest(admitted.data._planControl, { op: "cancel", identity: admitted.data.operation.origin, operationId: admitted.data.operation.id })).ok, true);
  release();
  await until(async () => (await f.status()).operation?.status === "cancelled");
  const after = await f.status();
  assert.notEqual(after.identity.sessionId, admitted.data.identity.sessionId);
  assert.equal(await fs.readFile(path.join(f.session.sessionManager.getArtifactsDir(), "local", "research.txt"), "utf8"), "research");
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.records(admitted.data.identity.sessionId).map(item => item.kind), ["executedElsewhere"]);
  assert.deepEqual(f.records().map(item => item.kind), ["stopped"]);
  assert.equal(f.records()[0].sourceSessionFile, admitted.data.identity.sessionFile);
});

test("refinement revision survives session rebind and is counted from durable history", async t => {
  const f = await fixture(t);
  await f.ready();
  await f.decide("refine");
  await until(async () => (await f.status()).operation?.status === "completed");
  f.emit({ type: "tool_execution_end", toolName: "write", toolCallId: "proposal-2", result: { details: { xdev: { tool: "propose", mode: "execute", inner: { planFilePath: "local://PLAN.md", title: "Test", planExists: true } } } } });
  await until(async () => (await f.status()).phase === "review");
  for (const handler of f.handlers.get("session_tree")) await handler({}, f.ctx);
  assert.equal((await f.status()).phase, "review");
  await f.decide("refine");
  await until(async () => (await f.status()).operation?.status === "completed");
  assert.deepEqual(f.records().map(item => item.revision), [1, 2]);
  const disk = (await fs.readFile(f.session.sessionManager.getSessionFile(), "utf8")).split("\n").map(line => JSON.parse(line));
  assert.deepEqual(disk.filter(entry => entry.type === "custom").map(entry => entry.data.revision), [1, 2]);
});

for (const failure of ["append", "ensureOnDisk", "flush"]) test(`metadata ${failure} failure warns without preventing execution`, async t => {
  const f = await fixture(t);
  await f.ready();
  const manager = f.session.sessionManager;
  if (failure === "append") manager.appendCustomEntry = () => { throw new Error("metadata unavailable"); };
  else if (failure === "ensureOnDisk") manager.ensureOnDisk = async () => { throw new Error("metadata unavailable"); };
  else {
    const flush = manager.flush.bind(manager);
    manager.flush = async () => {
      if (f.records().length) throw new Error("metadata unavailable");
      await flush();
    };
  }
  await f.decide("keep");
  await until(async () => (await f.status()).operation?.status === "completed");
  assert.equal(f.requests.filter(item => item.kind === "prompt").length, 1);
  assert(f.warnings.some(text => /计划状态保存失败：metadata unavailable/.test(text)));
  assert.equal((await f.status()).phase, "off");
});

test("terminal publication and dispatch wait for metadata flush", async t => {
  const f = await fixture(t);
  await f.ready();
  let release;
  const manager = f.session.sessionManager;
  const flush = manager.flush.bind(manager);
  manager.flush = async () => {
    if (f.records().length) await new Promise(resolve => { release = resolve; });
    await flush();
  };
  const admitted = await f.decide("keep");
  await until(() => !!release);
  assert.equal(f.requests.length, 0);
  assert.equal((await f.status()).operation.status, "running");
  assert(!f.notifications.some(item => item.snapshot?.operation?.id === admitted.data.operation.id && item.snapshot.operation.status === "completed"));
  release();
  await until(() => f.notifications.some(item => item.snapshot?.operation?.status === "completed"));
  const disk = await fs.readFile(manager.getSessionFile(), "utf8");
  assert.match(disk, /ompgui-plan-status/);
  assert.equal(f.requests.length, 1);
});

test("failed execution in the new session never appends failure to the source", async t => {
  const f = await fixture(t, { session: { async prompt() { throw new Error("target rejected"); } } });
  const source = await f.ready();
  await f.decide("execute");
  await until(async () => (await f.status()).operation?.status === "failed");
  assert.deepEqual(f.records(source.identity.sessionId).map(item => item.kind), ["executedElsewhere"]);
  assert.deepEqual(f.records().map(item => item.kind), ["continued", "failed"]);
  assert.equal(f.records()[1].sourceSessionFile, source.identity.sessionFile);
  assert.equal(f.records()[1].error, "target rejected");
  assert.equal((await f.status()).phase, "off");
});

test("failure after native switch records only in the actual target session", async t => {
  const f = await fixture(t);
  const source = await f.ready();
  const original = f.session.newSession;
  f.session.newSession = async () => { await original(); throw new Error("target initialization failed"); };
  await f.decide("execute");
  await until(async () => (await f.status()).operation?.status === "failed");
  assert.deepEqual(f.records(source.identity.sessionId).map(item => item.kind), ["executedElsewhere"]);
  assert.deepEqual(f.records().map(item => item.kind), ["failed"]);
  assert.equal(f.records()[0].error, "target initialization failed");
});

test("native compaction cancellation preserves the plan snapshot without dispatch", async t => {
  const f = await fixture(t);
  const source = await f.ready();
  f.session.compact = async () => { throw new f.modules.CompactionCancelledError(); };
  await f.decide("compact");
  await until(async () => (await f.status()).operation?.status === "cancelled");
  assert.deepEqual(f.records().map(item => item.kind), ["compactCancelled"]);
  assert.equal(f.records()[0].document, source.document.content);
  assert.equal(f.requests.length, 0);
});

test("stopping refine dispatch records one stopped result beside its refinement", async t => {
  const f = await fixture(t);
  await f.ready();
  let started = false;
  f.session.prompt = async () => { started = true; await new Promise(() => {}); };
  const admitted = await f.decide("refine", { feedback: "继续完善" });
  await until(() => started);
  await f.call({ op: "cancel", identity: admitted.data.operation.origin, operationId: admitted.data.operation.id });
  await until(async () => (await f.status()).operation?.status === "cancelled");
  assert.deepEqual(f.records().map(item => item.kind), ["refined", "stopped"]);
  assert.equal(new Set(f.records().map(item => `${item.operationId}:${item.kind}`)).size, 2);
});

test("save cancellation after switching leaves saved cards in both sessions and stops only the target", async t => {
  const f = await fixture(t);
  const source = await f.ready();
  const original = f.session.newSession;
  let release;
  f.session.newSession = async () => { const result = await original(); await new Promise(resolve => { release = resolve; }); return result; };
  const savePath = path.join(f.directory, "saved-after-stop.md");
  const admitted = await f.decide("save", { savePath });
  await until(() => !!release);
  await f.call({ op: "cancel", identity: admitted.data.operation.origin, operationId: admitted.data.operation.id });
  release();
  await until(async () => (await f.status()).operation?.status === "cancelled");
  assert.deepEqual(f.records(source.identity.sessionId).map(item => item.kind), ["saved"]);
  assert.deepEqual(f.records().map(item => item.kind), ["saved", "stopped"]);
  assert.equal(await fs.readFile(savePath, "utf8"), source.document.content);
  assert.equal(f.requests.length, 0);
});

test("terminal failure notification waits for its failure record to reach disk", async t => {
  const f = await fixture(t, { session: { async compact() { throw new Error("summary unavailable"); } } });
  await f.ready();
  const manager = f.session.sessionManager;
  const flush = manager.flush.bind(manager);
  let release;
  manager.flush = async () => {
    if (f.records().some(item => item.kind === "failed")) await new Promise(resolve => { release = resolve; });
    await flush();
  };
  await f.decide("compact");
  await until(() => !!release);
  assert.equal((await f.status()).operation.status, "running");
  assert(!f.notifications.some(item => item.snapshot?.operation?.status === "failed"));
  release();
  await until(() => f.notifications.some(item => item.snapshot?.operation?.status === "failed"));
  assert.match(await fs.readFile(manager.getSessionFile(), "utf8"), /"kind":"failed"/);
  assert.equal(f.records().length, 1);
});

test("an already-recorded operation kind is flushed without appending a duplicate", async t => {
  const f = await fixture(t);
  await f.ready();
  const admitted = await f.decide("keep");
  const existing = { version: 1, operationId: admitted.data.operation.id, kind: "approved", choice: "keep", planPath: "local://PLAN.md" };
  f.session.sessionManager.appendCustomEntry("ompgui-plan-status", existing);
  await until(async () => (await f.status()).operation?.status === "completed");
  assert.deepEqual(f.records(), [existing]);
  assert.equal(f.requests.filter(item => item.kind === "prompt").length, 1);
});

test("refinement stays pending until native prompt admission, with its snapshot already durable", async t => {
  const f = await fixture(t);
  await f.ready();
  let admit;
  const prompt = f.session.prompt;
  f.session.prompt = async (...args) => {
    await new Promise(resolve => { admit = resolve; });
    return prompt(...args);
  };
  const feedbackImages = [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }];
  await f.decide("refine", { feedback: "补充并发边界", feedbackImages });
  await until(() => !!admit);
  assert.equal((await f.status()).operation.status, "running");
  assert.equal(f.records()[0].kind, "refined");
  assert.match(f.records()[0].document, /执行项A/);
  assert.equal(f.requests.length, 0);
  admit();
  await until(async () => (await f.status()).operation.status === "completed");
  assert.equal((await f.status()).phase, "planning");
  assert.equal(f.session.isStreaming, true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].text, "补充并发边界");
  assert.deepEqual(f.requests[0].options.images, feedbackImages);
  assert.equal(f.requests[0].options.synthetic, undefined);
  assert.equal(f.records().length, 1);
});
