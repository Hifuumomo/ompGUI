// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createAppFixture } from "./inline-app-test-fixture";
import { toolCall } from "./inline-transcript-test-helpers";

/** 验证真实 App 中点击文件名和工具行都仅展示原生读取结果。参数：无。返回值：测试完成 Promise。 */
async function nativeReadInline() {
  const content =
    '[ui]\r\ntheme = "light"\r\n# [literal](https://example.test)\r\n';
  const app = await createAppFixture([
    toolCall("config", "read", { path: "C:\\Config\\config.toml:5-8" }),
    {
      role: "toolResult",
      toolCallId: "config",
      content: [{ type: "text", text: content }],
    },
  ]);
  const before = [...app.commands];
  const row = app.container.querySelector<HTMLDetailsElement>(
    '.tool-row[data-tool-id="config"]',
  )!;
  const target = app.container.querySelector<HTMLButtonElement>(
    '.tool-row[data-tool-id="config"] > summary button[data-tool-id="config"]',
  )!;
  expect(target.textContent).toBe("config.toml");
  expect(row.open).toBe(false);
  await app.click(
    app.container.querySelector<HTMLElement>(".process-group > summary")!,
  );
  await app.click(target);
  expect(row.open).toBe(true);
  expect(row.querySelector(".file-review-source")?.textContent).toBe(content);
  expect(row.querySelector("a")).toBeNull();
  await app.click(row.querySelector<HTMLElement>("summary")!);
  expect(row.open).toBe(false);
  await app.click(row.querySelector<HTMLElement>("summary")!);
  expect(row.querySelector(".file-review-source")?.textContent).toBe(content);
  expect(app.previewToolFile).not.toHaveBeenCalled();
  expect(app.commands).toEqual(before);
  expect(
    app.container.querySelector('[role="dialog"], .file-review-pane'),
  ).toBeNull();
  for (const label of [
    "技术详情",
    "原始调用参数",
    "完整调用载荷",
    "完整原始结果",
    "操作对象查看器",
  ])
    expect(app.container.textContent).not.toContain(label);
}
it(
  "App 点击 config.toml 文件名和行摘要均内嵌原生内容，不读磁盘或发送 RPC",
  nativeReadInline,
);
