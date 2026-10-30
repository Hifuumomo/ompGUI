// @vitest-environment jsdom

import { act } from "react";
import { expect, it, vi } from "vitest";

import { MessageFileLinks } from "./MessageFileLinks";

import { type ToolInspection } from "./Transcript";
import { InlineFileDetails } from "./InlineFileDetails";

import {
  container,
  render,
  codeGutter,
  selection,
  args,
} from "./transcript-test-harness";

const nativeDiff = Array.from(
  { length: 3000 },
  (_, index) => `+${index + 1}|line\r\n`,
).join("");
const edit: ToolInspection = {
  ...selection("huge.txt"),
  toolName: "edit",
  args: {
    input:
      "*** Begin Patch\n[huge.txt#A123]\nPUT 1.=1:\n+line\n*** End Patch\n",
  },
  result: {
    details: {
      path: "huge.txt",
      op: "update",
      oldText: "old",
      newText: "new",
      diff: nativeDiff,
    },
  },
};
/** 验证源码前缀截断保留 UTF-16 与 CRLF 原始边界。参数：无。返回值：测试完成 Promise。 */
async function boundedSourceReview() {
  const limit = 256 * 1024;
  const prefix = "x".repeat(limit - 1);
  const content = prefix + "😀必须不显示的尾部";
  const record: ToolInspection = {
    ...selection("huge.txt"),
    toolName: "write",
    args: { path: "huge.txt", content },
  };
  await render(<InlineFileDetails inspection={record} />);
  expect(container.querySelector(".file-review-source")!.textContent).toBe(
    prefix,
  );
  expect(container.textContent).toContain("已截断预览");
  expect(record.args).toEqual({ path: "huge.txt", content });
  const exact = {
    ...record,
    args: { path: "huge.txt", content: "x".repeat(limit) },
  };
  await render(<InlineFileDetails inspection={exact} />);
  expect(
    container.querySelector(".file-review-source")!.textContent!.length,
  ).toBe(limit);
  expect(container.textContent).not.toContain("已截断预览");
  const splitCrLf = {
    ...record,
    args: { path: "huge.txt", content: prefix + "\r\n不能显示的后缀" },
  };
  await render(<InlineFileDetails inspection={splitCrLf} />);
  expect(container.querySelector(".file-review-source")!.textContent).toBe(
    prefix + "\r",
  );
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(splitCrLf.args.content).toBe(prefix + "\r\n不能显示的后缀");
}
it("大源码保留真实前缀、代理对和CRLF边界", boundedSourceReview);
/** 验证原生差异按真实行前缀预览并保留原始证据。参数：无。返回值：测试完成 Promise。 */
async function boundedDiffReview() {
  await render(<InlineFileDetails inspection={edit} />);
  const pane = container.querySelector(".file-review-native-diff")!;
  const rows = pane.querySelectorAll(".file-code-row");
  expect(rows).toHaveLength(2000);
  expect(pane.querySelectorAll('[data-kind="addition"]')).toHaveLength(2000);
  expect(pane.textContent).toBe("line\r\n".repeat(2000));
  expect(codeGutter(rows[0]).getAttribute("data-new-line")).toBe("1");
  expect(codeGutter(rows[1999]).getAttribute("data-new-line")).toBe("2000");
  const counts = container.querySelector(".file-review-counts")!;
  expect(counts.getAttribute("data-additions")).toBe("2000");
  expect(counts.getAttribute("data-deletions")).toBe("0");
  expect(container.textContent).toContain("已截断预览");
  expect(edit.result).toMatchObject({ details: { diff: nativeDiff } });
}
it("大原生差异只展示真实2000行并提示截断", boundedDiffReview);
/** 验证差异尾换行不多算一行且溢出行明确截断。参数：无。返回值：测试完成 Promise。 */
async function diffEndingBoundary() {
  for (const ending of ["\n", "\r\n"]) {
    const exactDiff = Array.from(
      { length: 2000 },
      (_, index) => `+${index + 1}|line${ending}`,
    ).join("");
    const boundary: ToolInspection = {
      ...edit,
      result: {
        details: {
          path: "huge.txt",
          op: "update",
          oldText: "old",
          newText: "new",
          diff: exactDiff,
        },
      },
    };
    await render(<InlineFileDetails inspection={boundary} />);
    const exactPane = container.querySelector(".file-review-native-diff")!;
    expect(exactPane.textContent).toBe(`line${ending}`.repeat(2000));
    expect(exactPane.querySelectorAll(".file-code-row")).toHaveLength(2000);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(boundary.result).toMatchObject({ details: { diff: exactDiff } });
    const overflowDiff = exactDiff + `+2001|不能显示的第2001行${ending}`;
    const overflow: ToolInspection = {
      ...edit,
      result: {
        details: {
          path: "huge.txt",
          op: "update",
          oldText: "old",
          newText: "new",
          diff: overflowDiff,
        },
      },
    };
    await render(<InlineFileDetails inspection={overflow} />);
    const overflowPane = container.querySelector(".file-review-native-diff")!;
    expect(overflowPane.textContent).toBe(`line${ending}`.repeat(2000));
    expect(overflowPane.querySelectorAll(".file-code-row")).toHaveLength(2000);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(overflowPane.textContent).not.toContain("不能显示的第2001行");
    expect(overflow.result).toMatchObject({
      details: { diff: overflowDiff },
    });
  }
}
it("差异LF和CRLF尾换行不多计行且第2001行明确截断", diffEndingBoundary);

/** 构造指定行数的读取记录。[in] lines：行数。返回值：读取检查记录与完整正文。 */
function bigRead(lines: number) {
  const text = Array.from({ length: lines }, (_, index) => `row ${index + 1}`).join("\n");
  const record: ToolInspection = {
    ...selection("big.txt"),
    result: { content: [{ type: "text", text }] },
  };
  return { record, text };
}

const rowCount = () => container.querySelectorAll(".file-code-row").length;
const footerButtons = () =>
  [...container.querySelectorAll<HTMLButtonElement>(".inline-detail-footer button")];

it("文件超过 12 行默认只预览前 12 行，点击展开全部后原地显示全部", async () => {
  const { record, text } = bigRead(30);
  await render(<InlineFileDetails inspection={record} />);
  expect(rowCount()).toBe(12);
  expect(container.querySelector(".inline-file-content")!.getAttribute("data-preview")).toBe("true");
  const expand = footerButtons().find((button) => button.textContent === "展开全部 30 行")!;
  expect(expand.getAttribute("aria-controls")).toBe(container.querySelector(".inline-file-content")!.id);
  expect(footerButtons().some((button) => button.textContent === "在侧栏打开")).toBe(false);
  await act(() => expand.click());
  expect(rowCount()).toBe(30);
  expect(container.querySelector(".file-review-source")!.textContent).toBe(text);
  expect(record.result).toEqual({ content: [{ type: "text", text }] });
});

it("文件不超过 12 行时没有脚注栏", async () => {
  await render(<InlineFileDetails inspection={bigRead(12).record} />);
  expect(rowCount()).toBe(12);
  expect(container.querySelector(".inline-detail-footer")).toBeNull();
});

it("超过 400 行只提供侧栏入口，侧栏打开收到文件引用", async () => {
  const open = vi.fn(async () => {});
  await render(
    <MessageFileLinks.Provider value={open}>
      <InlineFileDetails inspection={bigRead(401).record} />
    </MessageFileLinks.Provider>,
  );
  expect(rowCount()).toBe(12);
  expect(footerButtons().map((button) => button.textContent)).toEqual(["在侧栏打开"]);
  await act(() => footerButtons()[0].click());
  expect(open).toHaveBeenCalledExactlyOnceWith("big.txt");
});

it("恰好 400 行仍可原地展开；超限但没有侧栏入口时退回原地展开", async () => {
  const open = vi.fn(async () => {});
  await render(
    <MessageFileLinks.Provider value={open}>
      <InlineFileDetails inspection={bigRead(400).record} />
    </MessageFileLinks.Provider>,
  );
  expect(footerButtons().map((button) => button.textContent)).toEqual(["展开全部 400 行", "在侧栏打开"]);
  await render(<InlineFileDetails inspection={bigRead(401).record} />);
  expect(footerButtons().map((button) => button.textContent)).toEqual(["展开全部 401 行"]);
});

it("写入内容超过 12 行时预览不改动原始参数", async () => {
  const content = Array.from({ length: 20 }, (_, index) => `w${index + 1}`).join("\n");
  const record: ToolInspection = { ...selection("w.txt"), toolName: "write", args: { path: "w.txt", content } };
  await render(<InlineFileDetails inspection={record} />);
  expect(rowCount()).toBe(12);
  expect(record.args).toEqual({ path: "w.txt", content });
});
