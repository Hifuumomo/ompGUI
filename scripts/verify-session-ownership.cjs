// 使用真实 omp 和独立临时数据验证租约；不读取用户会话、不调用模型。
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { buildSync } = require("esbuild");

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ompgui-lease-test-"));
  const project = path.resolve(__dirname, "..");
  const runtimes = [];
  try {
    buildSync({
      entryPoints: [path.join(project, "src/main/rpc.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: path.join(root, "runtime.cjs"),
    });
    const { OmpRuntime } = require(path.join(root, "runtime.cjs"));
    buildSync({
      entryPoints: [path.join(project, "src/main/model-runtime.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: path.join(root, "models.cjs"),
    });
    const { ModelRuntime } = require(path.join(root, "models.cjs"));
    const target = path.join(root, "session.jsonl");
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    await fs.writeFile(
      target,
      [
        { type: "session", version: 3, id, timestamp, cwd: root },
        {
          type: "message",
          id: "u1",
          parentId: null,
          timestamp,
          message: { role: "user", content: "隔离租约测试，不请求模型" },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
    );
    const options = {
      executable: process.argv[2] || process.env.OMP_EXECUTABLE || "omp.exe",
      cwd: root,
      profile: "default",
      agentDir: path.join(root, "agent"),
      sessionPath: target,
    };
    const bridge = path.join(project, "resources/gui-bridge.mjs");
    const first = new OmpRuntime(() => {});
    const second = new OmpRuntime(() => {});
    runtimes.push(first, second);
    await first.start(options, bridge);
    const state = await first.request({ type: "get_state" });
    assert.equal(state.sessionId, id);
    assert.equal(path.resolve(state.sessionFile), target);
    const before = await fs.readFile(target);
    const models = new ModelRuntime(() => {});
    runtimes.push(models);
    // 即使目标已被占用，模型准备也必须忽略目标路径并使用无文件的独立会话。
    await models.prepare(options, bridge);
    const independent = await models.request({ type: "get_state" });
    assert.notEqual(independent.sessionId, id);
    assert.ok(!independent.sessionFile);
    await models.request({ type: "get_available_models" });
    await assert.rejects(
      models.request({ type: "prompt", message: "不得发送" }),
      /仅接受模型/,
    );
    assert.deepEqual(await fs.readFile(target), before);
    const files = await fs.readdir(root);
    await assert.rejects(second.start(options, bridge), /SESSION_OCCUPIED/);
    assert.deepEqual(await fs.readFile(target), before);
    assert.deepEqual(await fs.readdir(root), files);
    await first.stop();
    await second.start(options, bridge);
    assert.equal((await second.request({ type: "get_state" })).sessionId, id);
    await second.stop();

    // 同时争用必须恰好有一个成功，不允许二者检查后都进入会话。
    const outcomes = await Promise.allSettled([
      first.start(options, bridge),
      second.start(options, bridge),
    ]);
    assert.equal(
      outcomes.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const failure = outcomes.find((result) => result.status === "rejected");
    assert.match(String(failure.reason), /SESSION_OCCUPIED/);
    assert.deepEqual(await fs.readFile(target), before);
    assert.deepEqual(await fs.readdir(root), files);
    console.log(
      "PASS: 独立内存模型进程、占用拒绝、释放后续聊、并发互斥；原文件内容及目录成员不变",
    );
  } finally {
    await Promise.all(runtimes.map((runtime) => runtime.stop()));
    // root 仅来自本次 mkdtemp，不删除会话目录或用户配置。
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
