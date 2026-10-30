import assert from "node:assert/strict";
import { test } from "vitest";
import { fixture } from "./tree-navigation-harness.mjs";

test("加载模块前即可取消，取消请求无需 entryId", async () => {
  const loading = Promise.withResolvers();
  const app = fixture({ loading: loading.promise });
  const navigation = app.run();
  const cancelled = await app.run({ op: "cancel", entryId: undefined });
  assert.deepEqual(cancelled.data, { cancelRequested: true });
  loading.resolve();
  assert.deepEqual((await navigation).data, { cancelled: true });
  assert.equal(
    app.calls.some(([name]) => name === "navigate"),
    false,
  );
  assert.equal(app.calls.filter(([name]) => name === "abort").length, 1);
});

test("取消真正中止自定义摘要的原生 event.signal", async () => {
  const started = Promise.withResolvers();
  const app = fixture({
    selections: ["Summarize with custom prompt"],
    inputs: ["重点"],
    generate: async (_entries, { signal }) => {
      started.resolve(signal);
      await new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      return { aborted: true };
    },
  });
  const navigation = app.run({ askSummary: true });
  const signal = await started.promise;
  assert.equal(signal.aborted, false);
  assert.deepEqual((await app.run({ op: "cancel", entryId: undefined })).data, {
    cancelRequested: true,
  });
  assert.equal(signal.aborted, true);
  assert.deepEqual((await navigation).data, { cancelled: true });
  assert.equal(
    app.calls.some(([name]) => name === "default-summary"),
    false,
  );
});

test("取消空闲导航不声称已中止；同会话并发导航明确拒绝", async () => {
  const loading = Promise.withResolvers();
  const app = fixture({ loading: loading.promise });
  assert.deepEqual((await app.run({ op: "cancel", entryId: undefined })).data, {
    cancelRequested: false,
  });
  const navigation = app.run();
  const second = await app.run({ entryId: "other" });
  assert.equal(second.ok, false);
  assert.match(second.error, /已有树导航/);
  await app.run({ op: "cancel" });
  loading.resolve();
  await navigation;
});

test("自定义摘要使用原生秘密映射，原样保存返回的替换标记", async () => {
  const secret = "private-value";
  const token = "<secret:1>";
  const app = fixture({
    selections: ["Summarize with custom prompt"],
    inputs: [secret],
    obfuscator: {
      obfuscates: () => true,
      obfuscate: (text) => text.replaceAll(secret, token),
    },
    generate: async (_entries, options) => {
      assert.equal(options.customInstructions, token);
      assert.deepEqual(
        options.convertToLlm([{ role: "user", content: secret }]),
        [{ role: "user", content: token }],
      );
      assert.deepEqual(options.metadata, { native: true });
      return { summary: token, readFiles: [token] };
    },
  });
  assert.equal((await app.run({ askSummary: true })).ok, true);
  const [, result] = app.calls.find(([name]) => name === "hook");
  assert.equal(result.summary.summary, token);
  assert.deepEqual(result.summary.details.readFiles, [token]);
});
