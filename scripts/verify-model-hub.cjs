// 隔离配置与会话验证模型管理桥接；不会向模型发送提示词。
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");

async function verifyActions(runtime) {
  const initial = await runtime.modelHub({ op: "list" });
  assert.ok(initial.models.length, "应读取到原生模型目录");
  assert.ok(initial.roles.some((role) => role.role === "default"));
  const model = initial.models.find(
    (entry) => entry.provider === "anthropic" && entry.reasoning,
  );
  assert.ok(model, "隔离配置应有 Anthropic 思考模型");
  const selector = model.selector;
  await verifyModelControls(runtime, selector);
  const assigned = await runtime.modelHub({
    op: "assign",
    role: "smol",
    selector,
    thinkingLevel: "low",
    scope: "global",
  });
  assert.ok(
    assigned.roles
      .find((role) => role.role === "smol")
      .global.includes(model.id),
  );
  const searched = await runtime.modelHub({ op: "search", query: model.id });
  assert.ok(searched.matches.includes(selector), "原生模糊搜索应命中模型");
  const cycled = await runtime.modelHub({
    op: "cycle",
    order: ["default", "smol"],
  });
  assert.deepEqual(cycled.cycleOrder, ["default", "smol"]);
  await runtime.modelHub({ op: "savePreset", name: "gui-verification" });
  const preset = await runtime.modelHub({
    op: "switchPreset",
    name: "gui-verification",
  });
  assert.equal(preset.presets.active, "gui-verification");
  const cleared = await runtime.modelHub({
    op: "clear",
    role: "smol",
    scope: "global",
  });
  assert.equal(
    cleared.roles.find((role) => role.role === "smol").global,
    undefined,
  );
  assert.equal((await runtime.request({ type: "get_state" })).messageCount, 0);
  await assert.rejects(runtime.modelHub({ op: "unsupported" }));
  console.log(
    "真实 omp：模型目录、角色设置/清除、模糊搜索、循环顺序、预设保存/切换通过；没有模型调用。",
  );
}

async function verifyModelControls(runtime, selector) {
  const before = await runtime.modelHub({ op: "list" });
  const temporary = await runtime.modelHub({
    op: "temporary",
    selector,
    target: "session",
  });
  assert.equal(temporary.currentSelector, selector);
  assert.deepEqual(
    temporary.roles.map((role) => [role.role, role.global, role.project]),
    before.roles.map((role) => [role.role, role.global, role.project]),
  );
  const fallback = await runtime.modelHub({
    op: "fallback",
    role: "default",
    chain: [selector],
  });
  assert.deepEqual(fallback.fallbackChains.default, [selector]);
  const compaction = await runtime.modelHub({
    op: "compaction",
    selector,
    value: "80%",
  });
  assert.ok(
    compaction.models.find((model) => model.selector === selector).compaction,
  );
}

async function main() {
  const project = path.resolve(__dirname, "..");
  const root = await fs.mkdtemp(
    path.join(project, "release", "verify-model-hub-"),
  );
  buildSync({
    entryPoints: [path.join(project, "src/main/rpc.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(root, "runtime.cjs"),
  });
  const { OmpRuntime } = require(path.join(root, "runtime.cjs"));
  const runtime = new OmpRuntime((frame) => {
    if (frame.type === "desktop_log" || frame.type === "desktop_error")
      console.error(frame);
  });
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "isolated-verification-no-model-requests";
  try {
    await runtime.start(
      {
        executable: process.argv[2] || "omp.exe",
        cwd: root,
        agentDir: path.join(root, "agent"),
      },
      path.join(project, "resources/gui-bridge.mjs"),
      true,
    );
    await verifyActions(runtime);
  } finally {
    await runtime.stop();
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
