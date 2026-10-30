// 仅操作本次创建的隔离会话，验证删除持久化、上下文重载与失败恢复；不调用模型。
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");

async function main() {
  const project = path.resolve(__dirname, "..");
  const root = await fs.mkdtemp(path.join(project, "release", "tree-delete-"));
  buildSync({ entryPoints: [path.join(project, "src/main/rpc.ts")], bundle: true, platform: "node", format: "cjs", outfile: path.join(root, "runtime.cjs") });
  const { OmpRuntime } = require(path.join(root, "runtime.cjs"));
  const runtime = new OmpRuntime(() => {});
  const sessionId = randomUUID();
  const timestamp = new Date().toISOString();
  const entries = [["u", null], ["a", "u"], ["b", "a"], ["c", "b"], ["s", "a"]].map(([id, parentId], i) => ({ id, parentId, type: "message", timestamp, message: { role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: id }], timestamp: Date.now() } }));
  const sessionPath = path.join(root, "session.jsonl");
  await fs.writeFile(sessionPath, [{ type: "session", version: 3, id: sessionId, timestamp, cwd: root }, ...entries].map(JSON.stringify).join("\n") + "\n");
  const cancelFlag = path.join(root, "cancel-reload");
  const extension = path.join(root, "bridge.mjs");
  await fs.writeFile(extension, `import bridge from ${JSON.stringify(pathToFileURL(path.join(project, "resources/gui-bridge.mjs")).href)};\nimport { existsSync } from "node:fs";\nexport default api => { bridge(api); api.on("session_before_switch", () => existsSync(${JSON.stringify(cancelFlag)}) ? { cancel: true } : undefined); };\n`);
  const options = { executable: process.argv[2] || "omp.exe", cwd: root, agentDir: path.join(root, "agent"), profile: "default", sessionPath };
  try {
    await runtime.start({ ...options, sessionPath: undefined }, extension, true);
    const { model } = await runtime.request({ type: "get_state" });
    assert.ok(model, "隔离测试需要本机原生模型目录");
    await runtime.stop();
    const records = (await fs.readFile(sessionPath, "utf8")).trim().split("\n").map(JSON.parse);
    for (const record of records) if (record.message?.role === "assistant")
      Object.assign(record.message, { provider: model.provider, model: model.id, api: model.api, stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    await fs.writeFile(sessionPath, records.map(JSON.stringify).join("\n") + "\n");
    await runtime.start(options, extension);
    const read = () => runtime.request({ type: "get_entries" });
    const ids = snapshot => snapshot.entries.map(e => e.id);
    const before = await read();
    await assert.rejects(runtime.deleteTree({ sessionId, entryId: "b", entryIds: ["b"] }), /已变化/);
    assert.deepEqual(ids(await read()), ids(before));
    await fs.writeFile(cancelFlag, "cancel");
    await assert.rejects(runtime.deleteTree({ sessionId, entryId: "b", entryIds: ["b", "c"] }), /取消/);
    assert.deepEqual(ids(await read()), ids(before));
    await fs.unlink(cancelFlag);
    await runtime.deleteTree({ sessionId, entryId: "b", entryIds: ["b", "c"] });
    const after = await read();
    assert.ok(!ids(after).includes("b") && !ids(after).includes("c"));
    assert.equal(after.entries.at(-1).parentId, "s");
    const state = await runtime.request({ type: "get_state" });
    assert.equal(state.sessionId, sessionId);
    assert.equal(path.resolve(state.sessionFile), sessionPath);
    await runtime.stop();
    await runtime.start(options, extension);
    const persisted = await read();
    assert.ok(!ids(persisted).includes("b") && !ids(persisted).includes("c"));
    const activeBranch = persisted.entries.filter(e => e.id !== "u");
    await runtime.deleteTree({ sessionId, entryId: "a", entryIds: activeBranch.map(e => e.id) });
    const shortened = await read();
    assert.equal(shortened.entries.at(-1).parentId, "u");
    await runtime.deleteTree({ sessionId, entryId: "u", entryIds: ids(shortened) });
    assert.equal((await read()).entries.filter(e => e.type === "message").length, 0);
    await runtime.stop();
    await runtime.start(options, extension);
    assert.equal((await read()).entries.filter(e => e.type === "message").length, 0);
    assert.equal((await runtime.request({ type: "get_state" })).sessionId, sessionId);
    console.log("PASS: 子树校验、取消恢复、旁支删除、当前路径回退、根删除及重启持久化；同一会话文件，无模型调用");
  } finally { await runtime.stop(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
