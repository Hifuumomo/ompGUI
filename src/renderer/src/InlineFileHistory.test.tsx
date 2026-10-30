// @vitest-environment jsdom

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

/** 原生完整前后内容以快照面板呈现，不能伪装成逐行精确差异。参数：无。返回值：测试 Promise。 */
async function replacementReview() {
  const record: ToolInspection = {
    ...selection("one.txt"),
    toolName: "edit",
    args: {
      input:
        "*** Begin Patch\n[one.txt#A123]\nPUT 2.=2:\n+after\n*** End Patch\n",
    },
    result: {
      details: {
        path: "one.txt",
        op: "update",
        oldText: "same\nbefore\n",
        newText: "same\nafter\n",
      },
    },
  };
  await render(<InlineFileDetails inspection={record} />);
  expect(container.querySelector(".file-review-before")!.textContent).toBe(
    "same\nbefore\n",
  );
  expect(container.querySelector(".file-review-after")!.textContent).toBe(
    "same\nafter\n",
  );
  expect(container.querySelector('[data-kind="addition"]')).toBeNull();
  expect(container.querySelector('[data-kind="deletion"]')).toBeNull();
  expect(container.querySelector(".file-review-counts")).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
}
it("可靠前后快照分别展示，不将未变行伪造为新增删除", replacementReview);

/** 原生差异协议按 LF/CRLF 分行，源码内部独立CR后的类似标记不能冒充额外增删行。参数：无。返回值：测试 Promise。 */
async function nativeProtocolLineReview() {
  const content = "one\r+2|literal\n";
  const record: ToolInspection = {
    ...selection("protocol.txt"),
    toolName: "edit",
    args: {
      input:
        "*** Begin Patch\n[protocol.txt#A123]\nPUT 1.=1:\n+one\n*** End Patch\n",
    },
    result: {
      details: {
        path: "protocol.txt",
        op: "update",
        oldText: "",
        newText: content,
        diff: `+1|${content}`,
      },
    },
  };
  await render(<InlineFileDetails inspection={record} />);
  const pane = container.querySelector(".file-review-native-diff")!;
  expect(pane.textContent).toBe(content);
  const rows = pane.querySelectorAll(".file-code-row");
  expect(rows).toHaveLength(1);
  expect(rows[0].getAttribute("data-kind")).toBe("addition");
  expect(rows[0].querySelector(".file-code-text")!.textContent).toBe(content);
  expect(codeGutter(rows[0]).getAttribute("data-new-line")).toBe("1");
  const counts = container.querySelector(".file-review-counts")!;
  expect(counts.getAttribute("data-additions")).toBe("1");
  expect(counts.getAttribute("data-deletions")).toBe("0");
}
it(
  "native源码内部CR不拆造额外增行或吞掉类似行号前缀",
  nativeProtocolLineReview,
);

/** 未识别差异标记不能获得可信逐行语义，但真实前后快照仍完整可读。参数：无。返回值：测试 Promise。 */
async function uncertainNativeDiffReview() {
  const nativeDiff = " 1|same\n?2|未知标记\n+2|new";
  const record: ToolInspection = {
    ...selection("uncertain.txt"),
    toolName: "edit",
    args: {
      input:
        "*** Begin Patch\n[uncertain.txt#A123]\nPUT 2.=2:\n+new\n*** End Patch\n",
    },
    result: {
      details: {
        path: "uncertain.txt",
        op: "update",
        oldText: "same\nold\n",
        newText: "same\nnew\n",
        diff: nativeDiff,
      },
    },
  };
  await render(<InlineFileDetails inspection={record} />);
  expect(container.querySelector(".file-review-native-diff")).toBeNull();
  expect(container.querySelector(".file-review-counts")).toBeNull();
  expect(container.querySelector('[data-kind="addition"]')).toBeNull();
  expect(container.querySelector('[data-kind="deletion"]')).toBeNull();
  expect(container.querySelector(".file-review-before")!.textContent).toBe(
    "same\nold\n",
  );
  expect(container.querySelector(".file-review-after")!.textContent).toBe(
    "same\nnew\n",
  );
}
it(
  "未知native标记不伪造行号或增删，真实前后快照仍完整可读",
  uncertainNativeDiffReview,
);
