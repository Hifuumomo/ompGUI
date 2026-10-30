import assert from "node:assert/strict";
import { test } from "vitest";
import { fixture } from "./tree-navigation-harness.mjs";

test("原有回退默认关闭摘要，显式 summarize 跳过三选", async () => {
  const app = fixture();
  assert.equal((await app.run()).data.cancelled, false);
  assert.deepEqual(app.calls[0], ["navigate", "target", { summarize: false }]);
  assert.equal(
    app.calls.some(([name]) => name === "select"),
    false,
  );
  await app.run({ summarize: true });
  assert.equal(
    app.calls.filter(([name]) => name === "default-summary").length,
    1,
  );
});

test("关闭原生摘要设置时不弹出三选", async () => {
  const app = fixture({ enabled: false });
  await app.run({ askSummary: true });
  assert.equal(
    app.calls.some(([name]) => name === "select"),
    false,
  );
  assert.deepEqual(app.calls[0], ["navigate", "target", { summarize: false }]);
});

test("取消三选显式取消且不改变原生上下文", async () => {
  const app = fixture({ selections: [undefined] });
  assert.deepEqual((await app.run({ askSummary: true })).data, {
    cancelled: true,
  });
  assert.equal(
    app.calls.some(([name]) => name === "navigate"),
    false,
  );
});

test("取消自定义输入回到原生三选，允许选择不摘要", async () => {
  const app = fixture({
    selections: ["Summarize with custom prompt", "No summary"],
    inputs: [undefined],
  });
  assert.equal((await app.run({ askSummary: true })).data.cancelled, false);
  assert.equal(app.calls.filter(([name]) => name === "select").length, 2);
  assert.equal(
    app.calls.some(([name]) => name === "generate"),
    false,
  );
});

test("自定义指令进入官方 helper，成功摘要回传原生事件", async () => {
  const app = fixture({
    selections: ["Summarize with custom prompt"],
    inputs: ["保留所有决策"],
  });
  assert.equal((await app.run({ askSummary: true })).data.cancelled, false);
  assert.equal(
    app.calls.find(([name]) => name === "generate")[2].customInstructions,
    "保留所有决策",
  );
  assert.equal(
    app.calls.find(([name]) => name === "hook")[1].summary.summary,
    "实际生成器的契约样本",
  );
  assert.equal(
    app.calls.some(([name]) => name === "default-summary"),
    false,
  );
});

test("自定义生成失败取消原生导航并显式失败，绝不调用默认摘要", async () => {
  const app = fixture({
    selections: ["Summarize with custom prompt"],
    inputs: ["保留决策"],
    failure: new Error("provider rejected"),
  });
  const result = await app.run({ askSummary: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, "provider rejected");
  assert.deepEqual(app.calls.find(([name]) => name === "hook")[1], {
    cancel: true,
  });
  assert.equal(
    app.calls.some(([name]) => name === "default-summary"),
    false,
  );
});

test("原生生成被中止时显式返回 cancelled", async () => {
  const app = fixture({
    selections: ["Summarize with custom prompt"],
    inputs: ["保留决策"],
    summaryResult: { aborted: true },
  });
  assert.equal((await app.run({ askSummary: true })).data.cancelled, true);
});

test("标签调用原生追加并等待落盘，空字符串清除标签", async () => {
  const app = fixture();
  await app.run({ op: "label", label: "测试标签" });
  await app.run({ op: "label", label: "" });
  assert.deepEqual(app.calls, [
    ["label", "target", "测试标签"],
    ["flush"],
    ["label", "target", undefined],
    ["flush"],
  ]);
});

test("错误操作与错误参数显式失败", async () => {
  const app = fixture();
  assert.equal((await app.run({ op: "unknown" })).ok, false);
  assert.equal((await app.run({ summarize: "yes" })).ok, false);
  assert.equal((await app.run({ op: "label", label: null })).ok, false);
});
