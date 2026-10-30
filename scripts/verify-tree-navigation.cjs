// 在仓库根目录执行；仅使用新建的隔离会话，不调用模型生成摘要。
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { buildSync } = require("esbuild");
const TEST_TIMEOUT_MS = 60_000;

async function fixture(root) {
  const timestamp = new Date().toISOString();
  const id = randomUUID();
  const messages = ["最初请求", "最初回复", "下一请求", "下一回复"];
  const entries = messages.map((text, index) => ({
    type: "message",
    id: `m${index}`,
    parentId: index ? `m${index - 1}` : null,
    timestamp,
    message: {
      role: index % 2 ? "assistant" : "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  }));
  const sessionPath = path.join(root, "session.jsonl");
  await fs.writeFile(
    sessionPath,
    [{ type: "session", version: 3, id, timestamp, cwd: root }, ...entries]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  const agentDir = path.join(root, "agent");
  await fs.mkdir(agentDir);
  await fs.writeFile(
    path.join(agentDir, "config.yml"),
    "branchSummary:\n  enabled: true\n",
  );
  return { id, sessionPath, agentDir };
}

async function verifyNavigation(runtime, session) {
  const before = await runtime.request({ type: "get_state" });
  await runtime.navigateTree("m1", { summarize: false });
  assert.equal((await runtime.request({ type: "get_entries" })).leafId, "m1");
  await runtime.navigateTree("m2");
  assert.equal((await runtime.request({ type: "get_entries" })).leafId, "m1");
  const after = await runtime.request({ type: "get_state" });
  assert.equal(after.sessionId, session.id);
  assert.equal(after.sessionFile, before.sessionFile);
  assert.equal(path.resolve(after.sessionFile), session.sessionPath);
}

function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.entry.id === id) return node;
    const match = findNode(node.children, id);
    if (match) return match;
  }
}

async function verifyLabels(runtime, session) {
  await runtime.setTreeLabel("m1", "检查点");
  assert.equal(
    findNode((await runtime.request({ type: "get_tree" })).tree, "m1").label,
    "检查点",
  );
  await runtime.setTreeLabel("m1", undefined);
  assert.equal(
    findNode((await runtime.request({ type: "get_tree" })).tree, "m1").label,
    undefined,
  );
  const records = (await fs.readFile(session.sessionPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const changes = records.filter(
    (entry) => entry.type === "label" && entry.targetId === "m1",
  );
  assert.equal(changes.length, 2);
  assert.equal(changes[0].label, "检查点");
  assert.equal(changes[1].label, undefined);
}

/** 摘要菜单与自定义输入取消走真实 rpc-ui，所有分支均在模型调用前结束。 */
async function verifySummaryUI(runtime, replies) {
  replies.push({ method: "select", cancelled: true });
  const before = (await runtime.request({ type: "get_entries" })).leafId;
  await assert.rejects(
    runtime.navigateTree("m3", { askSummary: true }),
    /树导航已取消/,
  );
  assert.equal((await runtime.request({ type: "get_entries" })).leafId, before);
  replies.push(
    { method: "select", value: "Summarize with custom prompt" },
    { method: "input", cancelled: true },
    { method: "select", value: "No summary" },
  );
  await runtime.navigateTree("m3", { askSummary: true });
  assert.equal(replies.length, 0);
  replies.push({ method: "select", cancelNavigation: true });
  await assert.rejects(
    runtime.navigateTree("m1", { askSummary: true }),
    /树导航已取消/,
  );
  assert.equal(replies.length, 0);
  await assert.rejects(runtime.cancelTreeNavigation(), /没有进行中的树导航/);
}

async function runChecks(runtime, session, replies) {
  await verifyNavigation(runtime, session);
  await verifySummaryUI(runtime, replies);
  await verifyLabels(runtime, session);
  await assert.rejects(
    runtime.bridge("ompgui-tree", { op: "unknown", entryId: "m1" }),
    /操作/,
  );
  console.log(
    "真实 omp：同文件导航、用户节点恢复、摘要菜单取消/跳过、自定义输入返回菜单、标签追加与清除落盘通过；未调用模型。",
  );
}

/** 从真实目录取得会话模型，再给隔离助手记录补齐原生持久化字段。 */
async function connectFixture(runtime, options) {
  const { root, session, bridge } = options;
  const launch = {
    executable: process.argv[2] || "omp.exe",
    cwd: root,
    agentDir: session.agentDir,
  };
  await runtime.start(launch, bridge, true);
  const { model } = await runtime.request({ type: "get_state" });
  assert.ok(model, "隔离测试必须有真实目录模型");
  await runtime.stop();
  const records = (await fs.readFile(session.sessionPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const updated = records.map((entry) =>
    entry.message?.role === "assistant"
      ? {
          ...entry,
          message: {
            ...entry.message,
            provider: model.provider,
            model: model.id,
            api: model.api,
            stopReason: "stop",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
          },
        }
      : entry,
  );
  await fs.writeFile(
    session.sessionPath,
    updated.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  await runtime.start({ ...launch, sessionPath: session.sessionPath }, bridge);
}

function createRuntime(project, root) {
  buildSync({
    entryPoints: [path.join(project, "src/main/rpc.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(root, "runtime.cjs"),
  });
  const { OmpRuntime } = require(path.join(root, "runtime.cjs"));
  const replies = [];
  const runtime = new OmpRuntime((frame) => {
    if (["desktop_log", "desktop_error"].includes(frame.type))
      console.error(frame);
    if (
      frame.type !== "extension_ui_request" ||
      !["select", "input"].includes(frame.method)
    )
      return;
    const response = replies.shift();
    assert.ok(response, `出现意外原生 UI：${frame.method}`);
    assert.equal(frame.method, response.method);
    if (response.cancelNavigation) void runtime.cancelTreeNavigation();
    else void runtime.respondUI({ id: frame.id, ...response });
  });
  return { runtime, replies };
}

async function verifyConnected(runtime, options, replies) {
  await connectFixture(runtime, options);
  await runChecks(runtime, options.session, replies);
}

async function main() {
  const project = process.cwd();
  const root = await fs.mkdtemp(
    path.join(project, "release", "tree-navigation-"),
  );
  const session = await fixture(root);
  const { runtime, replies } = createRuntime(project, root);
  const previousKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "isolated-test-key-no-model-requests";
  let timer;
  try {
    await Promise.race([
      verifyConnected(
        runtime,
        {
          root,
          session,
          bridge:
            process.argv[3] || path.join(project, "resources/gui-bridge.mjs"),
        },
        replies,
      ),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("原生会话树验证超过 60 秒")),
          TEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await runtime.stop();
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
