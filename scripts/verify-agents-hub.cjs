// Uses an isolated project and agent directory; never invokes a model.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const TIMEOUT_MS = 60_000;

async function verify(runtime) {
  const initial = await runtime.agentsHub({ op: "list" });
  assert.ok(initial.agents.length, "Native bundled agents must be discovered");
  const name = initial.agents[0].name;
  const disabled = await runtime.agentsHub({
    op: "toggle",
    name,
    disabled: true,
  });
  assert.equal(
    disabled.agents.find((agent) => agent.name === name).disabled,
    true,
  );
  await verifyOverrides(runtime, name);
  await verifyCreation(runtime);
  const searched = await runtime.agentsHub({ op: "search", query: name });
  assert.ok(searched.matches.includes(name));
  await assert.rejects(
    runtime.agentsHub({ op: "override", name, property: "invalid" }),
  );
  assert.equal((await runtime.request({ type: "get_state" })).messageCount, 0);
  console.log(
    "真实 omp：发现、搜索、启停、三类属性覆盖/清除、新建/重复拒绝通过；无模型调用。",
  );
}

async function verifyOverrides(runtime, name) {
  for (const property of ["model", "prewalk", "advisor"]) {
    const value = property === "model" ? "@smol" : "off";
    const result = await runtime.agentsHub({
      op: "override",
      name,
      property,
      value,
    });
    const key = property === "model" ? "overrideModel" : `${property}Override`;
    assert.equal(
      result.agents.find((agent) => agent.name === name)[key],
      value,
    );
    const cleared = await runtime.agentsHub({ op: "override", name, property });
    assert.equal(
      cleared.agents.find((agent) => agent.name === name)[key],
      undefined,
    );
  }
}

async function verifyCreation(runtime) {
  const spec = {
    identifier: "gui-test-agent",
    whenToUse: "Use this agent when verifying the GUI.",
    systemPrompt: "Verify the requested change.",
  };
  const saved = await runtime.agentsHub({ op: "save", scope: "project", spec });
  assert.ok(
    saved.agents.some(
      (agent) => agent.name === spec.identifier && agent.source === "project",
    ),
  );
  await assert.rejects(
    runtime.agentsHub({ op: "save", scope: "project", spec }),
    /already exists/,
  );
}

async function main() {
  const project = path.resolve(__dirname, "..");
  const root = await fs.mkdtemp(
    path.join(project, "release", "verify-agents-hub-"),
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
    console.error("agents verification exceeded 60 seconds");
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
  } finally {
    await runtime.stop();
    clearTimeout(timeout);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
