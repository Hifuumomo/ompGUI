// @vitest-environment jsdom
import { act, useState } from "react";
import { expect, it } from "vitest";
import {
  container,
  click,
  render,
  timeline,
  call,
  image,
} from "../transcript-test-harness";
import type { CardStatus } from "../tool-card-model";
import { Transcript } from "../Transcript";
import { CardFrame } from "./CardFrame";

/** 状态及原生工具标识可供回退和辅助技术读取。 */
it("呈现各状态文字和工具标识", async () => {
  const statuses: [CardStatus, string][] = [
    ["running", "◐ 运行中"],
    ["ok", "✓"],
    ["error", "✗ 失败"],
    ["cancelled", "已取消"],
    ["unknown", "未记录结果"],
  ];
  for (const [status, text] of statuses) {
    await render(
      <CardFrame
        toolId="original-id"
        kind="generic"
        status={status}
        title="动作"
      />,
    );
    expect(
      container.querySelector(".tool-card")?.getAttribute("data-tool-id"),
    ).toBe("original-id");
    expect(
      container.querySelector(".tool-card")?.getAttribute("data-status"),
    ).toBe(status);
    expect(container.textContent).toContain(text);
  }
});

/** 标题点击、Enter、Space 及正文 Esc 复用受控展开状态。 */
it("点击和键盘切换展开，Esc 收起并恢复焦点", async () => {
  /** 提供框的受控展开状态。返回值：工具框。 */
  function Example() {
    const [expanded, setExpanded] = useState(false);
    return (
      <CardFrame
        toolId="keyboard"
        kind="generic"
        status="ok"
        title="动作"
        expand={{ expanded, onToggle: () => setExpanded(!expanded) }}
        footer={
          <button className="footer-focus" onClick={() => setExpanded(true)}>
            展开全部
          </button>
        }
      >
        {expanded ? <pre>没有交互控件的源码</pre> : null}
      </CardFrame>
    );
  }
  await render(<Example />);
  const header = container.querySelector<HTMLElement>(".tool-card-header")!;
  await click(header);
  expect(header.getAttribute("aria-expanded")).toBe("true");
  await act(() => {
    header.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(header.getAttribute("aria-expanded")).toBe("false");
  await act(() => {
    header.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(header.getAttribute("aria-expanded")).toBe("true");
  const body = container.querySelector<HTMLElement>(".tool-card-body")!;
  body.focus();
  await act(() => {
    body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(header.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(header);
  const footer = container.querySelector<HTMLButtonElement>(".footer-focus")!;
  await click(footer);
  footer.focus();
  await act(() => {
    footer.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(header.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(header);
});

/** 缩略图必须沿用原生栅格校验，不加载外部或 SVG 图像。 */
it("通用框收起时显示安全原生图片，不加载 SVG", async () => {
  await render(
    <Transcript
      mode="full"
      sessionId="images"
      tools={[]}
      messages={timeline([
        call("images", "unknown"),
        {
          role: "toolResult",
          toolCallId: "images",
          content: [
            image,
            { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz4=" },
          ],
        },
      ])}
    />,
  );
  expect(container.querySelectorAll(".tool-card-images img")).toHaveLength(1);
  expect(
    container.querySelector(".tool-card-images img")?.getAttribute("src"),
  ).toMatch(/^data:image\/png;base64,/);
  expect(container.textContent).toContain("未加载不支持的图片格式或数据");
});
