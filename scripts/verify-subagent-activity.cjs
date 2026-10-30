// Uses an isolated project and agent directory; never invokes a model.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const TIMEOUT_MS = 60_000;

async function verify(runtime) {
  const subscription = await runtime.request({
    type: "set_subagent_subscription",
    level: "progress",
  });
  assert.equal(subscription.level, "progress");
  assert.deepEqual(await runtime.request({ type: "get_subagents" }), {
    subagents: [],
  });
  await assert.rejects(
    runtime.request({
      type: "get_subagent_messages",
      subagentId: "unknown-agent",
    }),
    /Unknown subagent/,
  );
  assert.equal(
    (await runtime.request({ type: "set_subagent_subscription", level: "off" }))
      .level,
    "off",
  );
  assert.equal((await runtime.request({ type: "get_state" })).messageCount, 0);
  console.log(
    "真实 omp：子代理订阅、列表、未知代理拒绝与取消订阅通过；无模型调用。",
  );
}

async function main() {
  const project = path.resolve(__dirname, "..");
  const root = await fs.mkdtemp(
    path.join(project, "release", "verify-subagent-activity-"),
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
  const timeout = setTimeout(() => {
    console.error("subagent activity verification exceeded 60 seconds");
    process.exit(1);
  }, TIMEOUT_MS);
  process.env.ANTHROPIC_API_KEY = "isolated-verification-no-model-requests";
  try {
    await runtime.start(
      {
        executable: process.argv[2] || "omp.exe",
        cwd: root,
        agentDir: path.join(root, "agent"),
        profile: "default",
      },
      path.join(project, "resources/gui-bridge.mjs"),
      true,
    );
    await verify(runtime);
    if (process.argv[3])
      await verifyHistory(runtime, path.resolve(process.argv[3]));
  } finally {
    await runtime.stop();
    clearTimeout(timeout);
  }
}

async function verifyHistory(runtime, rootSessionFile) {
  const before = await fs.readFile(rootSessionFile);
  const { subagents } = await runtime.subagentHistory({
    op: "list",
    rootSessionFile,
  });
  assert.ok(subagents.length, "真实历史会话应包含子代理");
  for (const agent of subagents) {
    const result = await runtime.subagentHistory({
      op: "messages",
      rootSessionFile,
      subagentId: agent.id,
      fromByte: 0,
    });
    assert.ok(result.messages.length, `历史代理 ${agent.id} 应包含对话`);
    console.log(
      JSON.stringify({
        id: agent.id,
        status: agent.status,
        model: agent.progress?.resolvedModel,
        messages: result.messages.length,
      }),
    );
  }
  await assert.rejects(
    runtime.subagentHistory({
      op: "messages",
      rootSessionFile,
      subagentId: "not-owned",
    }),
  );
  assert.deepEqual(await fs.readFile(rootSessionFile), before);
  console.log("真实历史子代理恢复、对话读取与根会话只读校验通过。");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
