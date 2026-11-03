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

/** 状态及原生工具标识可供回退和辅助技术读取；图标与状态文字分开渲染。 */
it("呈现各状态图标、状态文字和工具标识", async () => {
  const statuses: [CardStatus, string | undefined, string | undefined][] = [
    ["running", "◐", "运行中"],
    ["ok", "✓", undefined],
    ["error", "✗", undefined],
    ["cancelled", undefined, "已取消"],
    ["unknown", undefined, "未记录结果"],
  ];
  for (const [status, icon, text] of statuses) {
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
    expect(container.querySelector(".tool-card-icon")?.textContent).toBe(icon);
    expect(container.querySelector(".tool-card-status")?.textContent).toBe(
      text,
    );
  }
});

/** 命令框的状态只在底部边框，标题行里没有状态文字。 */
it("命令框标题行没有状态文字，底部边框带图标", async () => {
  await render(
    <CardFrame
      toolId="cmd"
      kind="bash"
      status="ok"
      variant="command"
      title="$ npm test"
      footer="exit 0"
    />,
  );
  expect(
    container.querySelector(".tool-card")?.getAttribute("data-variant"),
  ).toBe("command");
  expect(
    container.querySelector(".tool-card-header .tool-card-status"),
  ).toBeNull();
  expect(
    container.querySelector(".tool-card-footer .tool-card-icon")?.textContent,
  ).toBe("✓");
  expect(container.querySelector(".tool-card-footer")?.textContent).toContain(
    "exit 0",
  );
});

/** 分隔线只在输入区和结果区同时存在时出现，命令框有结果就出现。 */
it("Output 分隔线与 data-has-result", async () => {
  await render(
    <CardFrame toolId="a" kind="generic" status="ok" title="动作" output="结果">
      输入
    </CardFrame>,
  );
  expect(container.querySelector(".tool-card-divider")?.textContent).toBe(
    "Output",
  );
  expect(
    container.querySelector(".tool-card-box")?.getAttribute("data-has-result"),
  ).toBe("true");
  await render(
    <CardFrame toolId="b" kind="generic" status="ok" title="动作" output="结果" />,
  );
  expect(container.querySelector(".tool-card-divider")).toBeNull();
  await render(
    <CardFrame
      toolId="c"
      kind="bash"
      status="ok"
      variant="command"
      title="$ x"
      output="结果"
      outputLabel="Output · cell 3"
    />,
  );
  expect(container.querySelector(".tool-card-divider")?.textContent).toBe(
    "Output · cell 3",
  );
  await render(
    <CardFrame toolId="d" kind="generic" status="ok" title="动作">
      输入
    </CardFrame>,
  );
  expect(
    container.querySelector(".tool-card-box")?.getAttribute("data-has-result"),
  ).toBe("false");
});

/** aside、icon={null}、statusText="" 的取舍。 */
it("aside 渲染在顶部边框右端，icon 和 statusText 可关闭", async () => {
  await render(
    <CardFrame
      toolId="e"
      kind="generic"
      status="running"
      title="动作"
      aside="已唤醒"
      icon={null}
      statusText=""
    />,
  );
  expect(container.querySelector(".tool-card-aside")?.textContent).toBe(
    "已唤醒",
  );
  expect(container.querySelector(".tool-card-icon")).toBeNull();
  expect(container.querySelector(".tool-card-status")).toBeNull();
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
