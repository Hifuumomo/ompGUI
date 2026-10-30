// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RichContent } from "./RichContent";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let container: HTMLDivElement;
let root: Root;

/** Create a fresh visible React consumer. 参数：无。 @returns 返回值：无。 */
function prepareConsumer() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

/** Remove the rendered consumer. 参数：无。 @returns Cleanup completion. */
async function cleanConsumer() {
  /** Unmount the rendered consumer. 参数：无。 @returns 返回值：无。 */
  function unmount() {
    root.unmount();
  }
  await act(unmount);
  container.remove();
}

/** Render a native Markdown snapshot. @param text [in] Untrusted message text. @returns Render completion. */
async function renderText(text: string) {
  /** Commit this message snapshot. 参数：无。 @returns 返回值：无。 */
  function commit() {
    root.render(<RichContent text={text} />);
  }
  await act(commit);
}

beforeEach(prepareConsumer);
afterEach(cleanConsumer);
afterEach(() => { vi.unstubAllGlobals(); });

/** Register consumer-visible rich rendering boundaries. 参数：无。 @returns 返回值：无。 */
function richContentBoundaries() {
  /** Verify HTML, tracking images and command links stay inert. 参数：无。 @returns Test completion. */
  async function untrustedMarkdown() {
    await renderText(
      '[本地命令](file:///C:/Windows/System32/cmd.exe) [脚本](javascript:alert%281%29)\n\n<img src="https://tracker.invalid/pixel" onerror="alert(1)"><script>alert(1)</script>\n\n![远程像素](https://tracker.invalid/pixel)',
    );
    expect(container.querySelector("script, iframe, img, a")).toBeNull();
    expect(container.textContent).toContain("本地命令");
    expect(container.textContent).toContain("脚本");
    expect(container.textContent).toContain("远程像素");
    expect(container.textContent).toContain("图片未加载");
  }
  it(
    "不执行原始 HTML，不加载追踪图片，不创建本地命令或脚本链接",
    untrustedMarkdown,
  );

  /** Verify equations remain accessible and streaming updates replace their output. 参数：无。 @returns Test completion. */
  async function mathAndStreaming() {
    await renderText("行内 $x^2$\n\n$$\n\\frac{a}{b} = c\n$$");
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
    const annotations = [...container.querySelectorAll("annotation")].map(
      /** Read original TeX. @param annotation [in] Accessible KaTeX node. @returns Formula text. */
      (annotation) => annotation.textContent,
    );
    expect(annotations).toContain("x^2");
    expect(annotations).toContain("\\frac{a}{b} = c");
    await renderText("更新后 $y^3$");
    expect(container.querySelector("annotation")?.textContent).toBe("y^3");
    expect(container.querySelector(".katex-display")).toBeNull();
  }
  it("保留行内/块级公式，并实际更新流式内容", mathAndStreaming);

  /** Verify SVG geometry survives without active or remote resources. 参数：无。 @returns Test completion. */
  async function maliciousSvg() {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" onload="alert(1)"><style>@import url(https://tracker.invalid/a.css);</style><script>alert(1)</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">active</div></foreignObject><image href="https://tracker.invalid/pixel"/><defs><marker id="arrow"><path d="M0 0 L2 2"/></marker></defs><rect width="10" height="10" fill="url(https://tracker.invalid/a.svg#paint)" style="background:url(https://tracker.invalid/pixel)" onclick="alert(1)"/><path d="M0 0 L20 20" marker-end="url(#arrow)"/><a href="file:///C:/secret"><text>安全标签</text></a></svg>';
    await renderText(`\`\`\`svg\n${svg}\n\`\`\``);
    const preview = container.querySelector(".rich-diagram-preview")!;
    const rendered = preview.shadowRoot!.querySelector("svg")!;
    expect(rendered).not.toBeNull();
    expect(
      rendered.querySelector("script, style, foreignObject, image, a"),
    ).toBeNull();
    expect(rendered.querySelector("rect")).not.toBeNull();
    expect(rendered.querySelector("rect")?.hasAttribute("fill")).toBe(false);
    expect(
      rendered.querySelector("path[marker-end]")?.getAttribute("marker-end"),
    ).toBe("url(#arrow)");
    expect(rendered.textContent).toContain("安全标签");
    for (const element of [rendered, ...rendered.querySelectorAll("*")]) {
      for (const attribute of [...element.attributes]) {
        expect(attribute.name).not.toMatch(/^on/i);
        expect(attribute.name).not.toBe("style");
        expect(attribute.value).not.toContain("https://tracker.invalid");
      }
    }
    const source = container.querySelector("details")!;
    source.open = true;
    expect(source.textContent).toContain('onload="alert(1)"');
  }
  it(
    "SVG 仅在隔离预览中保留安全几何，移除脚本、事件、样式与外部资源",
    maliciousSvg,
  );
}

describe("RichContent 安全与内容边界", richContentBoundaries);

it("原会话中紧邻中文正文的括号、冒号加粗按预期渲染", async () => {
  await renderText([
    "**阻挡阵列 BSA（Beam Stop Array）**由多个小阻挡块构成。",
    "- **遮挡区域：**使用 \\(g^C\\) 的预测值；",
    "- **未遮挡区域：**保留已有的散射校正测量值。",
    "- **BSA 不动：**相邻视角缺失区域近似重叠，互补信息不足；",
    "- **BSA 移动过小：**遮挡区域仍有较多重叠，补全效果受限；",
    "- **BSA 移动足够大：**相邻视角可以暴露当前被遮挡区域及其邻域。",
  ].join("\n\n"));
  expect([...container.querySelectorAll("strong")].map((node) => node.textContent)).toEqual([
    "阻挡阵列 BSA（Beam Stop Array）",
    "遮挡区域：",
    "未遮挡区域：",
    "BSA 不动：",
    "BSA 移动过小：",
    "BSA 移动足够大：",
  ]);
  expect(container.textContent).not.toContain("**");
  expect(container.querySelector("annotation")?.textContent).toBe("g^C");
});

it("中文加粗在流式补齐结束标记后生效，不提前吞掉正文", async () => {
  await renderText("前文**（说明）");
  expect(container.querySelector("strong")).toBeNull();
  expect(container.textContent).toBe("前文**（说明）");
  await renderText("前文**（说明）**后文");
  expect(container.querySelector("strong")?.textContent).toBe("（说明）");
  expect(container.textContent).toBe("前文（说明）后文");
});

it("中文加粗兼容不改写代码、转义、公式或纯 ASCII 表达式中的星号", async () => {
  await renderText([
    "`**代码**`",
    "```md\n**代码块**\n```",
    String.raw`\*\*转义\*\*`,
    "2 ** 3 与 alpha**(beta)**gamma",
    String.raw`\(a**b\)`,
  ].join("\n\n"));
  expect(container.querySelector("strong")).toBeNull();
  expect(container.querySelector("p code")?.textContent).toBe("**代码**");
  expect(container.querySelector(".rich-code")?.textContent).toBe("**代码块**");
  expect(container.textContent).toContain("**转义**");
  expect(container.textContent).toContain("2 ** 3 与 alpha**(beta)**gamma");
  expect(container.querySelector("annotation")?.textContent).toBe("a**b");
});

it.each([
  ["$x_1^2$", "x_1^2"],
  [String.raw`\(x_1^2\)`, "x_1^2"],
] as const)("行内公式 %s 只渲染，不提供源码操作", async (text, value) => {
  await renderText(text);
  expect(container.querySelector("annotation")?.textContent?.trim()).toBe(value);
  expect(container.querySelector(".katex-display, button, .rich-math-source")).toBeNull();
});

it.each([
  ["$$\n\\frac{a}{b}\n$$", String.raw`\frac{a}{b}`],
  ["\\[\n\\frac{a}{b}\n\\]", String.raw`\frac{a}{b}`],
  ["```math\nx^2\n```", "x^2"],
] as const)("行间公式 %s 可通过图标往返切换源码与渲染", async (text, value) => {
  await renderText(text);
  const formula = container.querySelector(".rich-math-display")!;
  expect(formula.querySelector("annotation")?.textContent?.trim()).toBe(value);
  expect(formula.querySelector(".katex-display")).not.toBeNull();
  await act(() => formula.querySelector<HTMLButtonElement>("button")!.click());
  expect(formula.querySelector(".katex")).toBeNull();
  expect(formula.querySelector(".rich-math-source")?.textContent).toBe(text);
  await act(() => formula.querySelector<HTMLButtonElement>("button")!.click());
  expect(formula.querySelector("annotation")?.textContent?.trim()).toBe(value);
  expect(formula.querySelector(".rich-math-source")).toBeNull();
});

it("行间公式独立切换，源码模式在流式更新时显示最新内容", async () => {
  await renderText(String.raw`\[a_1\]` + "\n\n" + String.raw`\[b_2\]`);
  const first = container.querySelector(".rich-math")!;
  await act(() => first.querySelector<HTMLButtonElement>("button")!.click());
  expect(first.querySelector(".rich-math-source")?.textContent).toBe(String.raw`\[a_1\]`);
  expect(container.querySelectorAll(".katex")).toHaveLength(1);
  await renderText(String.raw`\[a_1^2\]` + "\n\n" + String.raw`\[b_2\]`);
  expect(first.querySelector(".rich-math-source")?.textContent).toBe(String.raw`\[a_1^2\]`);
  expect(container.querySelector("annotation")?.textContent).toBe("b_2");
});

it("块级公式保留 TeX 换行、空行及 Markdown 容器边界", async () => {
  const matrix = "\\[\n\\begin{aligned}\na_1 &= b \\\\\nc &= d\n\\end{aligned}\n\\]";
  await renderText(`${matrix}\n\n\\[\na+b\n\n+c\n\\]\n\n> \\[\n> z_1^2\n> \\]\n\n后续正文`);
  expect([...container.querySelectorAll("annotation")].map((node) => node.textContent?.trim())).toEqual([
    "\\begin{aligned}\na_1 &= b \\\\\nc &= d\n\\end{aligned}",
    "a+b\n\n+c",
    "z_1^2",
  ]);
  expect(container.querySelector(".katex-error")).toBeNull();
  expect(container.querySelector("blockquote .rich-math-display")).not.toBeNull();
  expect(container.lastElementChild?.textContent).toContain("后续正文");
});

it("普通代码、转义分隔符及未完成公式不被当作数学内容", async () => {
  await renderText([
    "`\\(inline\\)` 与 `$literal$`",
    "```text\n\\[fenced\\]\n```",
    String.raw`\\(escaped\\)`,
    String.raw`尚未完成 \(a_1`,
  ].join("\n\n"));
  expect(container.querySelector(".rich-math, .katex")).toBeNull();
  expect(container.querySelector("p code")?.textContent).toBe(String.raw`\(inline\)`);
  expect(container.querySelector(".rich-code")?.textContent).toBe("\\[fenced\\]");
  expect(container.textContent).toContain("尚未完成");
});

it("流式未闭合块级公式保留正文，补齐后正确渲染且不吞掉后续列表", async () => {
  await renderText("公式：\n\n\\[\n\\frac{a}{");
  expect(container.querySelector(".rich-math")).toBeNull();
  expect(container.textContent).toContain("公式：");
  await renderText("公式：\n\n\\[\n\\frac{a}{b}\n\\]\n\n- 后续内容\n- \\[\n  c_1^2\n  \\]");
  expect([...container.querySelectorAll("annotation")].map((node) => node.textContent?.trim())).toEqual([
    String.raw`\frac{a}{b}`,
    "c_1^2",
  ]);
  expect(container.querySelector("li")?.textContent).toBe("后续内容");
  expect(container.querySelector("li .rich-math-display")).not.toBeNull();
});

it("无效公式保留错误和源码，公式命令不能加载资源或创建活动链接", async () => {
  await renderText(String.raw`\[\frac{a}{\]`);
  expect(container.querySelector(".katex-error")).not.toBeNull();
  await act(() => container.querySelector<HTMLButtonElement>('.rich-math-controls button[aria-label="查看公式源码"]')!.click());
  expect(container.querySelector(".rich-math-source")?.textContent).toBe(String.raw`\[\frac{a}{\]`);
  await act(() => container.querySelector<HTMLButtonElement>('.rich-math-controls button[aria-label="渲染公式"]')!.click());
  await renderText(String.raw`\[\href{https://tracker.invalid}{外链}+\includegraphics{https://tracker.invalid/pixel}\]`);
  expect(container.querySelector("a, img, iframe, script")).toBeNull();
});

it.each([
  ["```latex\n\\frac{a}{b}\n```", String.raw`\frac{a}{b}`],
  ["```latex\n$$\n\\frac{a}{b}\n$$\n```", String.raw`\frac{a}{b}`],
  ["```tex\n\\[\\frac{a}{b}\\]\n```", String.raw`\frac{a}{b}`],
] as const)("latex 代码块 %j 可渲染并可切换源码", async (text, value) => {
  await renderText(text);
  const formula = container.querySelector(".rich-math-display")!;
  expect(formula.querySelector("annotation")?.textContent?.trim()).toBe(value);
  expect(formula.querySelector(".katex-display")).not.toBeNull();
  expect(container.querySelector(".rich-code")).toBeNull();
  await act(() => formula.querySelector<HTMLButtonElement>("button")!.click());
  expect(formula.querySelector(".katex")).toBeNull();
  expect(formula.querySelector(".rich-math-source")?.textContent).toBe(text.split("\n").slice(1, -1).join("\n"));
});

it.each([
  ["$$$$"],
  ["\\frac{a}{"],
  ["\\documentclass{article}\n\\begin{document}x\\end{document}"],
] as const)("latex 代码块无法渲染时保持原样 %j", async (body) => {
  await renderText("```latex\n" + body + "\n```");
  expect(container.querySelector(".rich-math, .katex")).toBeNull();
  expect(container.querySelector(".rich-code")?.textContent).toBe(body);
});

it.each([
  ["```latex\n\\begin{equation}\nE=mc^2\n\\label{eq:e}\n\\end{equation}\n```", "E=mc^2"],
  ["```latex\n\\begin{equation*}\nE=mc^2\n\\end{equation*}\n```", "E=mc^2"],
  ["```latex\n\\begin{equation}\nx=1 \\tag{1}\n\\end{equation}\n```", "x=1 \\tag{1}"],
  [
    "```latex\n\\begin{equation}\n\\begin{aligned}\na &= b,\\\\\nc &= d.\n\\end{aligned}\n\\label{eq:ols-summary}\n\\end{equation}\n```",
    "\\begin{aligned}\na &= b,\\\\\nc &= d.\n\\end{aligned}",
  ],
] as const)("latex 代码块中的 equation 环境忽略 \\label 后可渲染 %j", async (text, value) => {
  await renderText(text);
  const formula = container.querySelector(".rich-math-display")!;
  expect(formula.querySelector("annotation")?.textContent?.trim()).toBe(value);
  expect(formula.querySelector(".katex-display")).not.toBeNull();
  expect(container.querySelector(".rich-code, .katex-error")).toBeNull();
});

it.each([
  'flowchart TD\nA["上<br onclick=alert(1)>下"] --> B[结束]',
  'flowchart TD\nA["上<br style=color:red>下"] --> B[结束]',
  'flowchart TD\nA["上<br/><img src=https://tracker.invalid/pixel>下"] --> B[结束]',
  'flowchart TD\nA["上<br/><script>alert(1)</script>下"] --> B[结束]',
  '%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\nA["上<br/>下"] --> B[结束]',
  'flowchart TD\nA["上<br/>下"] --> B[结束]\nclassDef remote fill:url(https://tracker.invalid/a.svg)',
])("Mermaid 换行不放行属性、其他 HTML 或外部配置：%s", async (source) => {
  await renderText("```mermaid\n" + source + "\n```");
  expect(container.querySelector(".rich-diagram-preview")).toBeNull();
  expect(container.querySelector(".rich-diagram-notice")?.textContent).toContain("无法预览");
  expect(container.querySelector(".rich-code")?.textContent).toBe(source);
  expect(document.querySelector(".rich-diagram-layout, script, img")).toBeNull();
});

it("代码块复制按钮走主进程剪贴板，不依赖 Web Clipboard 权限", async () => {
  const copyText = vi.fn(async (_text: string) => {});
  vi.stubGlobal("desktop", { copyText });
  await renderText("```ts\nconst a = 1;\n```");
  const button = () => container.querySelector<HTMLButtonElement>(".rich-source-toolbar button")!;
  expect(button().textContent).toBe("复制");
  await act(async () => button().click());
  expect(copyText).toHaveBeenCalledTimes(1);
  expect(copyText.mock.calls[0][0]).toBe(container.querySelector(".rich-code")!.textContent);
  expect(button().textContent).toBe("已复制");
});

it("代码块复制失败时显示原因，内容变化后恢复为初始文案", async () => {
  const copyText = vi.fn(async (_text: string) => { throw new Error("所选内容过长，请缩小范围"); });
  vi.stubGlobal("desktop", { copyText });
  await renderText("```ts\nconst a = 1;\n```");
  const button = () => container.querySelector<HTMLButtonElement>(".rich-source-toolbar button")!;
  await act(async () => button().click());
  expect(button().textContent).toBe("复制失败：所选内容过长，请缩小范围");
  await renderText("```ts\nconst a = 1;\nconst b = 2;\n```");
  expect(button().textContent).toBe("复制");
});

it("行间公式右上角复制按钮走主进程剪贴板并复制公式源码", async () => {
  const copyText = vi.fn(async (_text: string) => {});
  vi.stubGlobal("desktop", { copyText });
  const text = String.raw`\[a_1\]`;
  await renderText(text);
  const button = () => container.querySelector<HTMLButtonElement>('.rich-math-controls button[aria-label^="复制"], .rich-math-controls button[aria-label="已复制"]')!;
  expect(button().getAttribute("aria-label")).toBe("复制公式源码");
  await act(async () => button().click());
  expect(copyText).toHaveBeenCalledTimes(1);
  expect(copyText.mock.calls[0][0]).toBe(text);
  expect(button().getAttribute("aria-label")).toBe("已复制");
});

it("行间公式复制失败时提示原因，内容变化后恢复为初始提示", async () => {
  const copyText = vi.fn(async (_text: string) => { throw new Error("剪贴板不可用"); });
  vi.stubGlobal("desktop", { copyText });
  await renderText(String.raw`\[a_1\]`);
  const button = () => container.querySelector<HTMLButtonElement>('.rich-math-controls button[aria-label^="复制"]')!;
  await act(async () => button().click());
  expect(button().getAttribute("aria-label")).toBe("复制失败：剪贴板不可用");
  await renderText(String.raw`\[a_1^2\]`);
  expect(button().getAttribute("aria-label")).toBe("复制公式源码");
});
