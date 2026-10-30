// 隔离原生配置验证角色切换，不发送提示词、不访问用户会话。
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");

async function main() {
  const project = path.resolve(__dirname, "..");
  const root = await fs.mkdtemp(path.join(project, "release", "role-cycle-"));
  buildSync({
    entryPoints: [path.join(project, "src/main/rpc.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(root, "runtime.cjs"),
  });
  const { OmpRuntime } = require(path.join(root, "runtime.cjs"));
  const runtime = new OmpRuntime(() => {});
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "isolated-test-key-no-model-requests";
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
    const { models } = await runtime.request({ type: "get_available_models" });
    const model = models.find(
      (entry) => entry.provider === "anthropic" && entry.reasoning,
    );
    assert.ok(model, "隔离配置应提供 Anthropic 思考模型");
    const selector = `${model.provider}/${model.id}`;
    await runtime.setRole("smol", `${selector}:low`, "global");
    await runtime.setRole("default", `${selector}:medium`, "global");
    await runtime.setRole("slow", `${selector}:high`, "global");
    const before = await runtime.getRoles();
    await runtime.request({
      type: "set_model",
      provider: model.provider,
      modelId: model.id,
    });
    const first = await runtime.cycleRoleModel("forward");
    assert.deepEqual(first.order, ["smol", "default", "slow"]);
    assert.equal(first.role, "slow");
    assert.equal(first.thinkingLevel, "high");
    const second = await runtime.cycleRoleModel("forward");
    assert.equal(second.role, "smol");
    assert.equal(second.thinkingLevel, "low");
    const reverse = await runtime.cycleRoleModel("backward");
    assert.equal(reverse.role, "slow");
    assert.deepEqual(await runtime.getRoles(), before);
    assert.equal(
      (await runtime.request({ type: "get_state" })).messageCount,
      0,
    );
    await assert.rejects(runtime.cycleRoleModel("invalid"), /无效/);
    console.log("原生角色正向、反向、同模型不同思考等级及无配置改写验证通过");
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
