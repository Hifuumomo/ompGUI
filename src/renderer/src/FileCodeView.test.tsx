import { expect, it, vi } from "vitest";
import { act } from "react";
import { FileCodeView } from "./FileCodeView";
import {
  click,
  codeGutter,
  container,
  render,
} from "./transcript-test-harness";

/** 验证非首行源码使用真实起始行及全文位宽。参数：无。返回值：验证 Promise。 */
async function offsetSource() {
  const content =
    "const first = 1;\r\nconst second = 2;\r\nconst third = 3;\r\n";
  await render(
    <FileCodeView content={content} path="file.ts" wrap startLine={98} />,
  );
  const rows = [...container.querySelectorAll(".file-code-row")];
  expect(rows.map((row) => codeGutter(row).dataset.line)).toEqual([
    "98",
    "99",
    "100",
  ]);
  expect(
    container
      .querySelector("pre")!
      .style.getPropertyValue("--file-code-gutter-width"),
  ).toBe("calc(3ch + 10px)");
  expect(container.querySelector("pre")!.textContent).toBe(content);
  expect(container.querySelector(".hljs-keyword")).not.toBeNull();
}
it("从真实 startLine 编号，保留原始正文与语法高亮", offsetSource);

/** 验证原生映射优先于起始行，分隔元行不编造行号。参数：无。返回值：验证 Promise。 */
async function mappedSource() {
  const content = "first\n…\nlast\n";
  await render(
    <FileCodeView
      content={content}
      path="file.txt"
      wrap
      startLine={300}
      lineNumbers={[7, null, 10002]}
    />,
  );
  const rows = [...container.querySelectorAll(".file-code-row")];
  expect(rows.map((row) => codeGutter(row).dataset.line)).toEqual([
    "7",
    undefined,
    "10002",
  ]);
  expect(
    container
      .querySelector("pre")!
      .style.getPropertyValue("--file-code-gutter-width"),
  ).toBe("calc(5ch + 10px)");
  expect(container.querySelector("pre")!.textContent).toBe(content);
}
it("逐行映射保留跳号和 null 分隔行，按真实最大编号预留位宽", mappedSource);

/** 验证渐进续显仍按同一原生映射编号，全文与位宽不变。参数：无。返回值：验证 Promise。 */
async function progressiveMapping() {
  const batchRows = 2000;
  const content = "line\n".repeat(batchRows + 1);
  const mapping = Array.from({ length: batchRows + 1 }, (_, index) =>
    index === batchRows - 1 ? null : 10000 + index * 2,
  );
  await render(
    <FileCodeView
      content={content}
      path="file.txt"
      wrap
      lineNumbers={mapping}
    />,
  );
  expect(container.querySelectorAll(".file-code-row")).toHaveLength(batchRows);
  const width = container
    .querySelector("pre")!
    .style.getPropertyValue("--file-code-gutter-width");
  expect(container.querySelector("pre")!.textContent).toBe(content);
  await click(
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="继续显示行号"]',
    )!,
  );
  const rows = [...container.querySelectorAll(".file-code-row")];
  expect(rows).toHaveLength(batchRows + 1);
  expect(codeGutter(rows[batchRows - 1]).dataset.line).toBeUndefined();
  expect(codeGutter(rows[batchRows]).dataset.line).toBe("14000");
  expect(container.querySelector(".file-code-tail")).toBeNull();
  expect(
    container
      .querySelector("pre")!
      .style.getPropertyValue("--file-code-gutter-width"),
  ).toBe(width);
  expect(container.querySelector("pre")!.textContent).toBe(content);
}
it("渐进装饰按原生逐行映射续显且不移动正文起点", progressiveMapping);

/** 验证连续起始行在渐进续显及原地更新后仍对应原生选择。参数：无。返回值：验证 Promise。 */
async function progressiveOffset() {
  const batchRows = 2000;
  const startLine = 8000;
  const content = "line\n".repeat(batchRows + 1);
  await render(
    <FileCodeView
      content={content}
      path="file.txt"
      wrap
      startLine={startLine}
    />,
  );
  expect(
    container
      .querySelector("pre")!
      .style.getPropertyValue("--file-code-gutter-width"),
  ).toBe("calc(5ch + 10px)");
  await click(
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="继续显示行号"]',
    )!,
  );
  const final = container.querySelectorAll(".file-code-row")[batchRows];
  expect(codeGutter(final).dataset.line).toBe(String(startLine + batchRows));
  await render(<FileCodeView content={content} path="file.txt" wrap />);
  const rows = container.querySelectorAll(".file-code-row");
  expect(codeGutter(rows[0]).dataset.line).toBe("1");
  expect(codeGutter(rows[batchRows]).dataset.line).toBe(String(batchRows + 1));
}
it("连续起始行在渐进续显及恢复默认编号时保持正确", progressiveOffset);

/** 验证统一差异始终沿用 hunk 真实行号，不受源码选项影响。参数：无。返回值：验证 Promise。 */
async function independentDiff() {
  await render(
    <FileCodeView
      content={"@@ -2 +3 @@\n-old\n+new\n"}
      path="file.txt"
      wrap
      format="unified"
      startLine={9000}
      lineNumbers={[9000, 9001, 9002]}
    />,
  );
  const deletion = container.querySelector('[data-kind="deletion"]')!;
  const addition = container.querySelector('[data-kind="addition"]')!;
  expect(codeGutter(deletion).dataset.oldLine).toBe("2");
  expect(codeGutter(addition).dataset.newLine).toBe("3");
  expect(
    container
      .querySelector('[aria-label="显示差异统计"]')!
      .getAttribute("data-additions"),
  ).toBe("1");
}
it("真实差异行号不受 startLine 和 lineNumbers 影响", independentDiff);

it("源码精确复制选择并引用完整原始行，未装饰尾部保留真实偏移", async () => {
  const content = Array.from({ length: 2005 }, (_, index) => `line ${index + 1}\r\n`).join("");
  const onContext = vi.fn();
  await render(<FileCodeView content={content} path="file.txt" wrap onContext={onContext} />);
  const tail = container.querySelector(".file-code-tail")!;
  const text = tail.firstChild!;
  const range = document.createRange();
  range.setStart(text, 2);
  range.setEnd(text, 8);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  await act(() => tail.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  expect(onContext.mock.calls[0][0]).toMatchObject({ text: "line 2001\r\n", copyText: "ne 200", startLine: 2001, endLine: 2001 });
  expect(container.querySelectorAll(".file-code-row")).toHaveLength(2000);
  window.getSelection()!.removeAllRanges();
});

it("源码容器及行元素边界直接映射模型偏移，不包含相邻行", async () => {
  const onContext = vi.fn();
  await render(<FileCodeView content={"first\nsecond\nthird\n"} path="file.txt" wrap onContext={onContext} />);
  const pre = container.querySelector("pre")!;
  const row = container.querySelectorAll(".file-code-row")[1];
  const range = document.createRange();
  range.setStart(pre, 1);
  range.setEnd(row, row.childNodes.length);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  await act(() => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  expect(onContext.mock.calls[0][0]).toMatchObject({ text: "second\n", copyText: "second\n", startLine: 2, endLine: 2 });
  window.getSelection()!.removeAllRanges();
});
