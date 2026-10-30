import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "vitest";
import { registerSeance } from "./seance.mjs";

/** 隔离原生契约边界；真实 CLI 的加载与模型调用由集成烟测覆盖。 */
function fixture(options = {}) {
  const hooks = new Map();
  const messages = [];
  const calls = [];
  const replies = [];
  const manager = { getCwd: () => process.cwd(), getSessionDir: () => tmpdir(), getSessionId: () => "target", flush: async () => { calls.push("flush"); await options.flush?.(); } };
  const session = {
    sessionManager: manager, effectiveExtensionRoots: [], isDisposed: false, isStreaming: false, isCompacting: false,
    agent: { state: { tools: options.noTask ? [] : [{ name: "task", execute: async (...args) => {
      calls.push(args);
      if (options.execute) return options.execute(...args);
      return { content: [{ type: "text", text: "Topics and decisions" }], details: { results: [{ id: "task1", exitCode: 0, resolvedModel: "local/model" }] } };
    } }] } },
    sendCustomMessage: async (message, delivery) => { messages.push({ ...message, delivery }); },
  };
  let command;
  const api = {
    pi: { AgentRegistry: { global: () => ({ get: () => ({ session: options.mismatch ? { ...session, sessionManager: { getSessionId: () => "other" } } : session }) }) } },
    on: (name, handler) => hooks.set(name, handler),
    registerCommand: (name, definition) => { assert.equal(name, "ompgui-seance"); command = definition; },
  };
  const ctx = { agent: { id: "agent" }, sessionManager: manager, isIdle: () => !options.busy, ui: { notify: (...args) => calls.push(args) } };
  registerSeance(api, (_ctx, _request, response) => replies.push(response), async () => ({
    resolveSeanceSource: async (selector, settings) => {
      calls.push(["source", selector, settings]);
      if (options.sourceError) throw new Error(options.sourceError);
      if (options.resolveSource) return options.resolveSource(selector);
      return { file: selector, id: options.sameSource ? "target" : "source", modelSelectors: ["saved/model"] };
    },
    discoverAgents: async () => ({ agents: [{ name: "seance", source: options.custom ? "project" : "bundled" }] }),
    isBundledSeance: agent => agent.source === "bundled",
    Snowflake: { next: () => "unique" },
  }));
  return { session, messages, calls, hooks, ctx, run: async (request = {}) => {
    await command.handler(JSON.stringify({ requestId: "request", op: "run", sourceSession: "source.jsonl", ...request }), ctx);
    return replies.at(-1);
  } };
}

// 只等待测试夹具明确的异步报告，不对真实供应商或外部进程轮询。
async function report(app) {
  for (let index = 0; index < 100 && app.messages.length === 0; index++)
    await new Promise(done => setTimeout(done, 5));
  assert.equal(app.messages.length, 1);
  return app.messages[0];
}

test("inspect resolves absolute source and saved model without launching or changing source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ompgui-seance-"));
  try {
    const path = join(directory, "source.jsonl");
    const original = '{"type":"session","id":"source"}\n';
    await writeFile(path, original);
    const app = fixture();
    assert.deepEqual((await app.run({ op: "inspect", sourceSession: path })).data, { path: resolve(path), modelSelectors: ["saved/model"] });
    assert.equal(app.messages.length, 0);
    assert.equal(app.calls.some(call => Array.isArray(call) && call[0] === "seance-unique"), false);
    assert.equal(await readFile(path, "utf8"), original);
    await app.run({ sourceSession: path });
    assert.equal(await readFile(path, "utf8"), original);
    assert.equal(app.messages.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("sync native task persists visible output without triggering another model turn", async () => {
  const app = fixture();
  const result = await app.run({ model: "override/model" });
  assert.deepEqual(result.data, { state: "completed", taskIds: ["task1"], model: "local/model", content: "Topics and decisions" });
  const invocation = app.calls.find(call => Array.isArray(call) && call[0] === "seance-unique");
  assert.deepEqual(invocation[1], {
    agent: "seance", sourceSession: resolve("source.jsonl"), model: "override/model",
    task: "Review this session's saved conversation and return a concise index of its main topics, decisions, and unresolved questions.",
    solutionSpace: "Historical summary; the selected transcript provides the evidence.",
  });
  assert.equal(app.messages[0].display, true);
  assert.equal(app.messages[0].content, "Topics and decisions");
  assert.deepEqual(app.messages[0].delivery, { triggerTurn: false });
  assert.ok(app.calls.includes("flush"));
});

test("native async admission propagates progress IDs/job/model without duplicate report", async () => {
  const app = fixture({ execute: async (_id, _params, _signal, update) => {
    update({ details: { progress: [{ id: "task2", resolvedModel: "saved/model" }] } });
    return { content: [{ type: "text", text: "Started" }], details: { async: { state: "running", jobId: "job2" } } };
  } });
  assert.deepEqual((await app.run()).data, { state: "running", taskIds: ["task2"], jobId: "job2", model: "saved/model", content: "Started" });
  assert.equal(app.messages.length, 0);
});

test("long sync admission returns promptly, blocks branch switching and persists final result", async () => {
  let finish;
  const app = fixture({ execute: () => new Promise(done => { finish = done; }) });
  assert.deepEqual((await app.run()).data, { state: "running", taskIds: [] });
  for (const event of ["session_before_switch", "session_before_branch", "session_before_tree"])
    assert.deepEqual(app.hooks.get(event)({}, app.ctx), { cancel: true });
  finish({ content: [{ type: "text", text: "Final consultation" }], details: { results: [{ id: "late", exitCode: 0 }] } });
  assert.equal((await report(app)).content, "Final consultation");
});

test("detached failure is an explicit persisted report", async () => {
  let fail;
  const app = fixture({ execute: () => new Promise((_done, reject) => { fail = reject; }) });
  assert.equal((await app.run()).data.state, "running");
  fail(new Error("provider unavailable"));
  const message = await report(app);
  assert.match(message.content, /provider unavailable/);
  assert.equal(message.details.error, "provider unavailable");
  assert.deepEqual(message.delivery, { triggerTurn: false });
});

test("failed native results and thrown errors surface, including abort reason", async () => {
  for (const result of [
    { content: [], isError: true },
    { content: [], details: { async: { state: "failed", jobId: "failed" } } },
    { content: [], details: { results: [{ id: "aborted", aborted: true, abortReason: "user stopped", exitCode: 0 }] } },
    { content: [], details: {} },
  ]) {
    const app = fixture({ execute: async () => result });
    assert.equal((await app.run()).ok, false);
    assert.match(app.messages[0].content, /Seance failed:/);
  }
});

test("preflight rejects missing task, custom shadow and busy/mismatched target", async () => {
  for (const options of [{ noTask: true }, { custom: true }, { busy: true }, { mismatch: true }, { sourceError: "missing source" }]) {
    const app = fixture(options);
    assert.equal((await app.run()).ok, false);
    assert.equal(app.calls.some(call => Array.isArray(call) && call[0] === "seance-unique"), false);
  }
  for (const request of [{ op: "unknown" }, { sourceSession: "" }, { model: [] }])
    assert.equal((await fixture().run(request)).ok, false);
});

test("consulting the current saved session remains supported", async () => {
  const app = fixture({ sameSource: true });
  assert.equal((await app.run()).ok, true);
  assert.equal(app.messages[0].content, "Topics and decisions");
});

test("sync report waits for busy target rather than injecting a steer/model turn", async () => {
  let finish;
  const app = fixture({ execute: () => new Promise(done => { finish = done; }) });
  await app.run();
  app.session.isStreaming = true;
  finish({ content: [{ type: "text", text: "Delayed report" }], details: { results: [{ id: "late", exitCode: 0 }] } });
  await new Promise(done => setTimeout(done, 40));
  assert.equal(app.messages.length, 0);
  app.session.isStreaming = false;
  assert.deepEqual((await report(app)).delivery, { triggerTurn: false });
});

test("batch starts flat tasks concurrently and retains branch protection through every report flush", async () => {
  const finishes = new Map();
  let finishLastFlush;
  let flushCount = 0;
  const app = fixture({
    execute: (_id, params) => new Promise(done => { finishes.set(params.sourceSession, done); }),
    flush: () => ++flushCount === 2 ? new Promise(done => { finishLastFlush = done; }) : undefined,
  });
  const first = resolve("first.jsonl");
  const second = resolve("second.jsonl");
  const admission = await app.run({
    op: "runBatch",
    requests: [{ sourceSession: first }, { sourceSession: second, model: "other/model" }],
  });
  // 两个 execute 在任何任务完成前均已进入；不是逐个等待执行的伪并行。
  assert.equal(finishes.size, 2);
  assert.deepEqual(admission.data, [
    { sourceSession: first, launch: { state: "running", taskIds: [] } },
    { sourceSession: second, launch: { state: "running", taskIds: [] } },
  ]);
  const invocations = app.calls.filter(call => Array.isArray(call) && call[0] === "seance-unique");
  assert.equal("model" in invocations[0][1], false);
  assert.equal(invocations[1][1].model, "other/model");
  assert.equal("batch" in invocations[0][1], false);
  finishes.get(first)({ content: [{ type: "text", text: "first report" }], details: { results: [{ id: "first", exitCode: 0 }] } });
  await report(app);
  for (const event of ["session_before_switch", "session_before_branch", "session_before_tree"])
    assert.deepEqual(app.hooks.get(event)({}, app.ctx), { cancel: true });
  assert.equal((await app.run()).ok, false);
  finishes.get(second)({ content: [{ type: "text", text: "second report" }], details: { results: [{ id: "second", exitCode: 0 }] } });
  for (let index = 0; index < 100 && !finishLastFlush; index++)
    await new Promise(done => setTimeout(done, 5));
  assert.equal(app.messages.length, 2);
  assert.deepEqual(app.hooks.get("session_before_switch")({}, app.ctx), { cancel: true });
  finishLastFlush();
  // flush 完成后的微任务释放最后一个执行租约。
  await new Promise(done => setTimeout(done, 0));
  for (const event of ["session_before_switch", "session_before_branch", "session_before_tree"])
    assert.equal(app.hooks.get(event)({}, app.ctx), undefined);
  assert.deepEqual(app.messages.map(message => message.details.sourceSession), [first, second]);
  assert.ok(app.messages.every(message => message.delivery.triggerTurn === false));
});

test("batch preserves successful admissions beside source/model failures and normalized duplicates", async () => {
  const started = [];
  const app = fixture({
    resolveSource: async selector => {
      if (selector === "missing") throw new Error("source not found");
      return { file: selector };
    },
    execute: async (_id, params) => {
      started.push(params.sourceSession);
      if (params.model === "missing/model") throw new Error("model unavailable");
      return { content: [{ type: "text", text: "started" }], details: { async: { state: "running", jobId: "native-job" } } };
    },
  });
  const response = await app.run({ op: "runBatch", requests: [
    { sourceSession: "good.jsonl" },
    { sourceSession: "./good.jsonl" },
    { sourceSession: "missing" },
    { sourceSession: "bad-model.jsonl", model: "missing/model" },
  ] });
  assert.equal(response.ok, true);
  assert.equal(response.data[0].launch.jobId, "native-job");
  assert.match(response.data[1].error, /重复/);
  assert.equal(response.data[2].error, "source not found");
  assert.equal(response.data[3].error, "model unavailable");
  assert.deepEqual(started, [resolve("good.jsonl"), resolve("bad-model.jsonl")]);
  // 异步成功项不重复写报告，只有失败项由桥接持久化。
  assert.equal(app.messages.length, 1);
  assert.equal(app.messages[0].details.sourceSession, resolve("bad-model.jsonl"));
  assert.equal(app.hooks.get("session_before_switch")({}, app.ctx), undefined);
});

test("invalid batch input never starts native tasks and does not leak an active lease", async () => {
  const app = fixture();
  for (const requests of [undefined, [], "source", [null], [{ sourceSession: "" }], [{ sourceSession: "source", model: [] }]]) {
    assert.equal((await app.run({ op: "runBatch", requests })).ok, false);
    assert.equal(app.hooks.get("session_before_switch")({}, app.ctx), undefined);
  }
  assert.equal(app.calls.length, 0);
  assert.equal((await app.run({ op: "runBatch", requests: [{ sourceSession: "valid.jsonl" }] })).data[0].launch.state, "completed");
});

test("detached sibling failure persists without releasing a still-running batch sibling", async () => {
  const executions = new Map();
  const app = fixture({
    execute: (_id, params) => new Promise((done, reject) => executions.set(params.sourceSession, { done, reject })),
  });
  const response = await app.run({ op: "runBatch", requests: [
    { sourceSession: "failing.jsonl" }, { sourceSession: "surviving.jsonl" },
  ] });
  assert.ok(response.data.every(item => item.launch.state === "running"));
  executions.get(resolve("failing.jsonl")).reject(new Error("provider disconnected"));
  assert.equal((await report(app)).details.error, "provider disconnected");
  assert.deepEqual(app.hooks.get("session_before_tree")({}, app.ctx), { cancel: true });
  executions.get(resolve("surviving.jsonl")).done({
    content: [{ type: "text", text: "surviving report" }],
    details: { results: [{ id: "surviving", exitCode: 0 }] },
  });
  for (let index = 0; index < 100 && app.messages.length < 2; index++)
    await new Promise(done => setTimeout(done, 5));
  await new Promise(done => setTimeout(done, 0));
  assert.equal(app.messages.length, 2);
  assert.equal(app.messages[1].content, "surviving report");
  assert.equal(app.hooks.get("session_before_tree")({}, app.ctx), undefined);
});
