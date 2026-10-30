// @vitest-environment jsdom
import { act } from "react";
import { expect, it } from "vitest";

import { type ToolInspection } from "./Transcript";
import { InlineFileDetails } from "./InlineFileDetails";

import {
  container,
  render,
  codeGutter,
  selection,
  args,
} from "./transcript-test-harness";

/** 原生差异只显示已记录行及真实行号，不补造跳过上下文，快照按需挂载。参数：无。返回值：测试 Promise。 */
const before = "未变行\n".repeat(10000) + "旧内容";
const after = "未变行\n".repeat(10000) + "新内容";
const nativeDiff =
  " 1|---\r\n\r\n 9999||原生表格\r\n-10001|旧内容\r\n+10001|新内容\r\n 10002|原生已记录正文";
const record: ToolInspection = {
  ...selection("one.txt"),
  toolName: "edit",
  args: {
    input:
      "*** Begin Patch\n[one.txt#A123]\nPUT 10001.=10001:\n+新内容\n[two.txt#B123]\nPUT 1.=1:\n+其他\n*** End Patch\n",
  },
  result: {
    details: {
      diff: "不能使用的跨文件顶层差异",
      perFileResults: [
        {
          path: "one.txt",
          op: "update",
          oldText: before,
          newText: after,
          diff: nativeDiff,
        },
        {
          path: "two.txt",
          op: "update",
          oldText: "其他旧内容",
          newText: "其他新内容",
          diff: "+1|其他文件秘密",
        },
      ],
    },
  },
};
/** 验证原生差异各行的真实类型、正文及历史行号。[in] rows：实际差异DOM行。返回值：无。 */
function expectNativeDiffRows(rows: NodeListOf<Element>) {
  expect(rows).toHaveLength(6);
  expect(codeGutter(rows[1]).hasAttribute("data-line")).toBe(false);
  expect(codeGutter(rows[1]).hasAttribute("data-old-line")).toBe(false);
  expect(codeGutter(rows[1]).hasAttribute("data-new-line")).toBe(false);
  expect(codeGutter(rows[0]).getAttribute("data-line")).toBe("1");
  expect(codeGutter(rows[2]).getAttribute("data-line")).toBe("9999");
  expect(codeGutter(rows[2]).hasAttribute("data-old-line")).toBe(false);
  expect(codeGutter(rows[2]).hasAttribute("data-new-line")).toBe(false);
  expect(rows[3].getAttribute("data-kind")).toBe("deletion");
  expect(rows[3].querySelector(".file-code-text")!.textContent).toBe(
    "旧内容\r\n",
  );
  expect(codeGutter(rows[3]).getAttribute("data-old-line")).toBe("10001");
  expect(codeGutter(rows[3]).hasAttribute("data-new-line")).toBe(false);
  expect(rows[4].getAttribute("data-kind")).toBe("addition");
  expect(rows[4].querySelector(".file-code-text")!.textContent).toBe(
    "新内容\r\n",
  );
  expect(codeGutter(rows[4]).getAttribute("data-new-line")).toBe("10001");
  expect(codeGutter(rows[4]).hasAttribute("data-old-line")).toBe(false);
  expect(rows[5].getAttribute("data-kind")).toBe("context");
  expect(rows[5].querySelector(".file-code-text")!.textContent).toBe(
    "原生已记录正文",
  );
  expect(codeGutter(rows[5]).getAttribute("data-line")).toBe("10002");
  expect(codeGutter(rows[5]).hasAttribute("data-old-line")).toBe(false);
  expect(codeGutter(rows[5]).hasAttribute("data-new-line")).toBe(false);
}

/** 验证原生差异隔离其他文件并按需显示真实快照。参数：无。返回值：测试完成 Promise。 */
async function nativeDiffReview() {
  await render(<InlineFileDetails inspection={record} />);
  const pane = container.querySelector(".file-review-native-diff")!;
  expect(pane.textContent).toBe(
    "---\r\n\r\n|原生表格\r\n旧内容\r\n新内容\r\n原生已记录正文",
  );
  expectNativeDiffRows(pane.querySelectorAll(".file-code-row"));
  const counts = container.querySelector(".file-review-counts")!;
  expect(counts.getAttribute("data-additions")).toBe("1");
  expect(counts.getAttribute("data-deletions")).toBe("1");
  expect(container.textContent).not.toContain("其他文件秘密");
  expect(container.textContent).not.toContain("跨文件顶层差异");
  expect(container.querySelector(".file-review-before")).toBeNull();
  const snapshots = container.querySelector<HTMLDetailsElement>(
    ".file-review-snapshots",
  )!;
  expect(snapshots.open).toBe(false);
  /** 显式展开原始快照。参数：无。返回值：无。 */
  function expandSnapshots() {
    snapshots.open = true;
    snapshots.dispatchEvent(new Event("toggle"));
  }
  await act(expandSnapshots);
  expect(container.querySelector(".file-review-before")!.textContent).toBe(
    before,
  );
  expect(container.querySelector(".file-review-after")!.textContent).toBe(
    after,
  );
}
it("原生行号差异不补造跳过上下文且快照保真、按需展开", nativeDiffReview);
