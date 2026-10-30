// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  createTranscriptView,
  toolCall,
} from "./inline-transcript-test-helpers";

interface ReadScenario {
  content: string;
  display?: {
    text: string;
    startLine: number;
    lineNumbers?: Array<number | null>;
  };
  path?: string;
}

/** 通过真实会话工具目标展示原生 read 结果。[in] scenario：原生文本、可选展示元数据与读取路径。返回值：已展开工具行及其源码节点。 */
async function showRead(scenario: ReadScenario) {
  const view = createTranscriptView();
  await view.render({
    messages: [
      toolCall("read-display", "read", { path: scenario.path ?? "config.yml" }),
      {
        role: "toolResult",
        toolCallId: "read-display",
        content: [{ type: "text", text: scenario.content }],
        ...(scenario.display && {
          details: { displayContent: scenario.display },
        }),
      },
    ],
  });
  await view.click(view.target("read-display"));
  const row = view.row("read-display");
  const source = row.querySelector<HTMLElement>(".file-review-source")!;
  expect(source).not.toBeNull();
  return { row, source };
}

/** 读取与源码正文分离的真实显示行号。[in] source：源码展示节点。返回值：各行 gutter 行号，未编号行返回 null。 */
function displayedLines(source: HTMLElement) {
  return [...source.querySelectorAll(".file-code-gutter")].map((gutter) => {
    expect(gutter.textContent).toBe("");
    expect(gutter.getAttribute("aria-hidden")).toBe("true");
    return gutter.getAttribute("data-line");
  });
}

/** read 展示元数据中的正文不重复呈现快照头或原生行号前缀。参数：无。返回值：测试完成 Promise。 */
async function officialDisplayText() {
  const text = "shellPath: ...\nsetupVersion: 2";
  const { row, source } = await showRead({
    content: "[config.yml#6239]\n1:shellPath: ...\n2:setupVersion: 2",
    display: { text, startLine: 1 },
  });
  expect(source.textContent).toBe(text);
  expect(displayedLines(source)).toEqual(["1", "2"]);
  expect(row.textContent).not.toContain("[config.yml#6239]");
  expect(source.textContent).not.toContain("1:shellPath");
  expect(source.textContent).not.toContain("2:setupVersion");
}
it(
  "read 官方 displayContent 仅展示真实正文，行号只出现一次",
  officialDisplayText,
);

/** 读取部分文件时采用原生起始行，不从第一行重新编号。参数：无。返回值：测试完成 Promise。 */
async function originalStartLine() {
  const text = "shellPath: ...\nsetupVersion: 2";
  const { source } = await showRead({
    path: "config.yml:35-36",
    content: "[config.yml#6239]\n35:shellPath: ...\n36:setupVersion: 2",
    display: { text, startLine: 35 },
  });
  expect(source.textContent).toBe(text);
  expect(displayedLines(source)).toEqual(["35", "36"]);
}
it("read 片段的 gutter 使用原生 startLine=35", originalStartLine);

/** 非连续读取保留原生逐行映射，省略行不能生成不存在的行号。参数：无。返回值：测试完成 Promise。 */
async function noncontiguousLines() {
  const text = "first value\n…\nlast value";
  const { source } = await showRead({
    content: "[config.yml#6239]\n35:first value\n…\n48:last value",
    display: { text, startLine: 35, lineNumbers: [35, null, 48] },
  });
  expect(source.textContent).toBe(text);
  expect(displayedLines(source)).toEqual(["35", null, "48"]);
  expect(source.querySelectorAll(".file-code-row")).toHaveLength(3);
  expect(
    source.querySelectorAll(".file-code-gutter")[1].hasAttribute("data-line"),
  ).toBe(false);
}
it("read 非连续 lineNumbers 的 null 行不编造数字", noncontiguousLines);

/** 真实正文中的数字加冒号属于源码，不能按原生行号猜测剥离。参数：无。返回值：测试完成 Promise。 */
async function literalNumberPrefixes() {
  const text = "1:keep\n2:also-keep";
  const { source } = await showRead({
    content: "[config.yml#6239]\n1:1:keep\n2:2:also-keep",
    display: { text, startLine: 1 },
  });
  expect(source.textContent).toBe(text);
  expect(displayedLines(source)).toEqual(["1", "2"]);
}
it("displayContent.text 中真实的 1:keep 前缀保持原文", literalNumberPrefixes);

/** 没有原生展示元数据时保留完整返回文本，不猜测快照头或数字前缀。参数：无。返回值：测试完成 Promise。 */
async function plainReadWithoutMetadata() {
  const content = "[config.yml#6239]\n1:keep\n2:literal";
  const { source } = await showRead({ content });
  expect(source.textContent).toBe(content);
  expect(displayedLines(source)).toEqual([null, null, null]);
}
it("普通 read 缺少 displayContent 时不推测剥离原文", plainReadWithoutMetadata);

/** 原生续读提示保留在源码之外，不作为文件行参与编号。参数：无。返回值：测试完成 Promise。 */
async function preserveContinuationFooter() {
  const text = "shellPath: ...\nsetupVersion: 2";
  const footer = "[5 more lines in file. Use config.yml:3 to continue]";
  const { row, source } = await showRead({
    content: `[config.yml#6239]\n1:shellPath: ...\n2:setupVersion: 2\n\n${footer}`,
    display: { text, startLine: 1 },
  });
  expect(source.textContent).toBe(text);
  expect(row.textContent).toContain(footer);
  expect(source.textContent).not.toContain(footer);
  expect(source.querySelectorAll(".file-code-row")).toHaveLength(2);
  expect(displayedLines(source)).toEqual(["1", "2"]);
}
it("read 续读提示仍可见且不进入源码 gutter 行数", preserveContinuationFooter);

/** 展示元数据与原文不一致时在当前卡片报告错误，会话仍可查看两份真实文本。 */
async function mismatchedNativeFormat() {
  const { row, source } = await showRead({
    content: "unrecognized native result",
    display: { text: "recorded source", startLine: 1 },
  });
  expect(source.textContent).toBe("recorded source");
  expect(row.querySelector('[role="alert"]')?.textContent).toContain(
    "读取结果格式与展示正文不一致",
  );
  expect(row.querySelector('[aria-label="读取提示"]')?.textContent).toBe(
    "unrecognized native result",
  );
}
it("read 格式不一致在卡片内报告错误，不使整个会话崩溃", mismatchedNativeFormat);
