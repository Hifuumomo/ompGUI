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

/** 多文件统一差异隔离目标，文件头及无尾换行元信息不计增删，真实正文和上下文采用各侧 hunk 起点。参数：无。返回值：测试 Promise。 */
async function selectedDiffReview() {
  const selected =
    "--- a/one.txt\n+++ b/one.txt\n@@ -7,2 +11,2 @@\n same\r\n---x\r\n+++x\r\n\\ No newline at end of file";
  const other =
    "--- a/two.txt\n+++ b/two.txt\n@@ -1 +1 @@\n-private-other\n+other-new\n";
  const record: ToolInspection = {
    ...selection("one.txt"),
    toolName: "edit",
    args: { input: `${other}${selected}` },
  };
  await render(<InlineFileDetails inspection={record} />);
  const pane = container.querySelector(".file-review-diff")!;
  expect(pane.textContent).toBe(
    "--- a/one.txt\n+++ b/one.txt\n@@ -7,2 +11,2 @@\nsame\r\n--x\r\n++x\r\n\\ No newline at end of file",
  );
  const deletions = pane.querySelectorAll('[data-kind="deletion"]');
  const additions = pane.querySelectorAll('[data-kind="addition"]');
  expect(deletions).toHaveLength(1);
  expect(additions).toHaveLength(1);
  expect(deletions[0].querySelector(".file-code-text")!.textContent).toBe(
    "--x\r\n",
  );
  expect(codeGutter(deletions[0]).getAttribute("data-old-line")).toBe("8");
  expect(codeGutter(deletions[0]).hasAttribute("data-new-line")).toBe(false);
  expect(additions[0].querySelector(".file-code-text")!.textContent).toBe(
    "++x\r\n",
  );
  expect(codeGutter(additions[0]).getAttribute("data-new-line")).toBe("12");
  expect(codeGutter(additions[0]).hasAttribute("data-old-line")).toBe(false);
  const rows = [...pane.querySelectorAll(".file-code-row")];
  expect(rows).toHaveLength(7);
  expect(rows[3].getAttribute("data-kind")).toBe("context");
  expect(rows[3].querySelector(".file-code-text")!.textContent).toBe(
    "same\r\n",
  );
  expect(codeGutter(rows[3]).getAttribute("data-old-line")).toBe("7");
  expect(codeGutter(rows[3]).getAttribute("data-new-line")).toBe("11");
  const metadata = [rows[0], rows[1], rows[2], rows[6]];
  for (const row of metadata) {
    expect(row.getAttribute("data-kind")).toBe("metadata");
    expect(codeGutter(row).hasAttribute("data-old-line")).toBe(false);
    expect(codeGutter(row).hasAttribute("data-new-line")).toBe(false);
  }
  const counts = container.querySelector(".file-review-counts")!;
  expect(counts.getAttribute("data-additions")).toBe("1");
  expect(counts.getAttribute("data-deletions")).toBe("1");
  expect(container.textContent).not.toContain("private-other");
  expect(container.querySelector('[role="alert"]')).toBeNull();
}
it(
  "真实多文件diff隔离目标，unified文件头不计增删且正文对应真实行号",
  selectedDiffReview,
);

/** 两侧跨行语法状态分别投影，共享上下文应采用新侧语义，不能残留已删除行打开的注释。参数：无。返回值：测试 Promise。 */
async function crossSideSyntaxReview() {
  const diff =
    "--- a/comment.ts\n+++ b/comment.ts\n@@ -1,2 +1 @@\n-/*\n plain\n";
  const record: ToolInspection = {
    ...selection("comment.ts"),
    toolName: "edit",
    args: { input: diff },
  };
  await render(<InlineFileDetails inspection={record} />);
  const pane = container.querySelector(".file-review-diff")!;
  const deletion = pane.querySelector('[data-kind="deletion"]')!;
  const context = pane.querySelector('[data-kind="context"]')!;
  expect(deletion.querySelector(".file-code-text")!.textContent).toBe("/*\n");
  expect(deletion.querySelector(".hljs-comment")!.textContent).toContain("/*");
  expect(codeGutter(deletion).getAttribute("data-old-line")).toBe("1");
  expect(context.querySelector(".file-code-text")!.textContent).toBe("plain\n");
  expect(context.querySelector(".hljs-comment")).toBeNull();
  expect(codeGutter(context).getAttribute("data-old-line")).toBe("2");
  expect(codeGutter(context).getAttribute("data-new-line")).toBe("1");
  const counts = container.querySelector(".file-review-counts")!;
  expect(counts.getAttribute("data-additions")).toBe("0");
  expect(counts.getAttribute("data-deletions")).toBe("1");
  expect(record.args).toEqual({ input: diff });
}
it("差异新侧上下文不残留已删除代码的跨行注释高亮", crossSideSyntaxReview);

/** 已识别 HTML 文件的源码即使含可执行标签、链接或长行也不能成为 DOM。参数：无。返回值：测试 Promise。 */
async function literalOperationContent() {
  const content =
    '<img src="https://invalid.test/image" onerror="alert(1)">\n<script>alert(1)</script>\n<svg onload="alert(1)"></svg>\n[link](https://invalid.test)\n' +
    "长行".repeat(10000);
  const record: ToolInspection = {
    ...selection("literal.html"),
    toolName: "write",
    args: { path: "literal.html", content },
  };
  await render(<InlineFileDetails inspection={record} />);
  expect(container.querySelector(".file-review-source")!.textContent).toBe(
    content,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("a")).toBeNull();
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector(".file-review-source svg")).toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
}
it(
  "历史文件正文保持纯文本及完整长行，不解释HTML或Markdown链接",
  literalOperationContent,
);

/** TOML 多行字符串连续高亮，行号不进入正文，tab、CRLF、独立CR、emoji、空行及尾换行保真。参数：无。返回值：测试 Promise。 */
async function multilineTomlReview() {
  for (const quote of ['"""', "'''"]) {
    const content =
      `title = "记录 😀"\r\nprompt = ${quote}\r\n\t首行\r\n` +
      `# 仍属于字符串\r\nkey = "不是键"\r\n${quote}\r\nactive = true\r# 独立CR\r\n\r\n`;
    const record: ToolInspection = {
      ...selection("reporter.toml"),
      toolName: "write",
      args: { path: "reporter.toml", content },
    };
    await render(<InlineFileDetails inspection={record} />);
    const pane = container.querySelector(".file-review-source")!;
    expect(pane.textContent).toBe(content);
    const rows = [...pane.querySelectorAll(".file-code-row")];
    expect(
      rows
        .map((row) => row.querySelector(".file-code-text")!.textContent)
        .join(""),
    ).toBe(content);
    for (const [index, row] of rows.entries()) {
      expect(codeGutter(row).getAttribute("data-line")).toBe(String(index + 1));
    }
    // 内部行没有新的引号，仍须继承整段字符串语义，不能逐行独立高亮。
    expect(rows[2].querySelector(".hljs-string")!.textContent).toContain(
      "首行",
    );
    expect(rows[3].querySelector(".hljs-string")!.textContent).toContain(
      "# 仍属于字符串",
    );
    expect(rows[4].querySelector(".hljs-string")!.textContent).toContain(
      'key = "不是键"',
    );
    expect(rows[6].querySelector(".hljs-string")).toBeNull();
    expect(container.querySelector(".file-review-counts")).toBeNull();
    expect(record.args).toEqual({ path: "reporter.toml", content });
  }
}
it(
  "TOML三引号跨行高亮且tabs、CRLF、独立CR、emoji、尾换行和可复制正文保真",
  multilineTomlReview,
);
