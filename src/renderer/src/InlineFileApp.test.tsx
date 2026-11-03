// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createAppFixture } from "./inline-app-test-fixture";
import { toolCall } from "./inline-transcript-test-helpers";

/** 验证真实 App 中展开工具卡片仅展示原生读取结果。参数：无。返回值：测试完成 Promise。 */
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
  const card = app.container.querySelector<HTMLElement>(
    '[data-tool-id="config"]',
  )!;
  const toggle = card.querySelector<HTMLElement>(
    '[role="button"][aria-expanded]',
  )!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(card.querySelector(".file-review-source")).toBeNull();
  await app.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(card.querySelector(".file-review-source")?.textContent).toBe(content);
  expect(card.querySelector("a")).toBeNull();
  await app.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(card.querySelector(".file-review-source")).toBeNull();
  await app.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(card.querySelector(".file-review-source")?.textContent).toBe(content);
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
  "App 展开、收起和重新展开读取卡片均内嵌原生内容，不读磁盘或发送 RPC",
  nativeReadInline,
);
