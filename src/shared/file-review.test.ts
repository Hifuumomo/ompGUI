// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getFileReviewEvidence } from "./file-review";

/** 注册文件查看器的原生内容与文件归属边界回归。参数：无。返回值：无。 */
function fileReviewConsumers(): void {
  /** 验证截图中的原生 write 保留完整 Unicode 和末尾换行。参数：无。返回值：无。 */
  function screenshotWrite(): void {
    const args = {
      i: "Creating first text file",
      path: "文件1.txt",
      content: "这是第一个文件。\n",
    };
    const result = {
      role: "toolResult",
      toolName: "write",
      isError: false,
      content: [
        {
          type: "text",
          text: "[文件1.txt#C14A]\nSuccessfully wrote 25 bytes to 文件1.txt",
        },
      ],
      details: { resolvedPath: "D:\\Code\\ompGUI测试\\文件1.txt" },
    };
    expect(getFileReviewEvidence("write", args, result, "文件1.txt")).toEqual({
      kind: "write",
      content: "这是第一个文件。\n",
    });
    expect(
      getFileReviewEvidence(
        "functions.write",
        JSON.stringify(args),
        result,
        "文件1.txt",
      ),
    ).toEqual({ kind: "write", content: "这是第一个文件。\n" });
    expect(
      getFileReviewEvidence("write", args, result, "文件2.txt"),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "write",
        args,
        result,
        "D:\\Code\\ompGUI测试\\文件1.txt",
      ),
    ).toBeUndefined();
  }
  it(
    "真实截图 write 默认正文来自原生完整参数而非 Success 摘要",
    screenshotWrite,
  );

  /** 验证空内容及失败/未完成状态不会被 helper 改写成成功或伪正文。参数：无。返回值：无。 */
  function emptyAndOutcome(): void {
    for (const result of [
      undefined,
      { isError: true },
      { status: "cancelled" },
    ]) {
      expect(
        getFileReviewEvidence(
          "write",
          { path: "空.txt", content: "" },
          result,
          "空.txt",
        ),
      ).toEqual({ kind: "write", content: "" });
    }
    for (const args of [
      null,
      [],
      '{"path":"空.txt","content":"',
      { path: "空.txt" },
      { path: "空.txt", content: null },
      { path: "空.txt", text: "猜测正文" },
    ]) {
      expect(
        getFileReviewEvidence(
          "write",
          args,
          { content: "Successfully wrote" },
          "空.txt",
        ),
      ).toBeUndefined();
    }
    expect(
      getFileReviewEvidence(
        "unknown_write",
        { path: "空.txt", content: "伪造" },
        undefined,
        "空.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "write",
        { path: "local://空.txt", content: "非磁盘" },
        undefined,
        "local://空.txt",
      ),
    ).toBeUndefined();
    for (const content of ["\u0000binary", "\u000b", "\uD800", "\uDC00"]) {
      expect(
        getFileReviewEvidence(
          "write",
          { path: "空.txt", content },
          undefined,
          "空.txt",
        ),
      ).toBeUndefined();
    }
    expect(
      getFileReviewEvidence(
        "write",
        { path: "空.txt", content: "😀\t\r\n" },
        undefined,
        "空.txt",
      ),
    ).toEqual({ kind: "write", content: "😀\t\r\n" });
  }
  it(
    "空字符串有效，失败状态由消费者呈现，不从结果补救缺失内容",
    emptyAndOutcome,
  );

  /** 验证真实原生单文件和多文件 oldText/newText 的归属与完整性。参数：无。返回值：无。 */
  function nativeSnapshots(): void {
    const input =
      "*** Begin Patch\n[C:/工作/甲.txt#A1B2]\nPUT 1.=1:\n+新甲\n[C:/工作/乙.txt#C3D4]\nPUT 1.=1:\n+新乙\n*** End Patch\n";
    const first = {
      path: "C:\\工作\\甲.txt",
      op: "update",
      oldText: "旧甲\n",
      newText: "新甲\n",
      diff: "-1|旧甲\n+1|新甲",
    };
    const second = {
      path: "C:\\工作\\乙.txt",
      op: "update",
      oldText: "旧乙\n",
      newText: "新乙\n",
    };
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        {
          details: { perFileResults: [first, second], diff: "不可跨文件串用" },
        },
        "C:/工作/乙.txt",
      ),
    ).toEqual({
      kind: "replacements",
      changes: [{ before: "旧乙\n", after: "新乙\n" }],
    });
    expect(
      getFileReviewEvidence(
        "edit",
        JSON.stringify({ input }),
        { details: first },
        "C:/工作/甲.txt",
      ),
    ).toEqual({
      kind: "replacements",
      changes: [{ before: "旧甲\n", after: "新甲\n", nativeDiff: first.diff }],
    });
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        {
          details: { perFileResults: [first, second], diff: "不可跨文件串用" },
        },
        "C:/工作/甲.txt",
      ),
    ).toEqual({
      kind: "replacements",
      changes: [{ before: "旧甲\n", after: "新甲\n", nativeDiff: first.diff }],
    });
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { details: { ...first, oldText: "", newText: "", diff: undefined } },
        "C:/工作/甲.txt",
      ),
    ).toEqual({ kind: "replacements", changes: [{ before: "", after: "" }] });
    for (const diff of [
      "",
      "\n",
      "Successfully edited",
      '{"status":"success"}',
      "-1|旧甲\nunknown footer",
    ]) {
      expect(
        getFileReviewEvidence(
          "edit",
          { input },
          { details: { ...first, diff } },
          "C:/工作/甲.txt",
        ),
      ).toEqual({
        kind: "replacements",
        changes: [{ before: "旧甲\n", after: "新甲\n" }],
      });
    }
    const nativeDiff = " 1|保留\r\n\r\n-2|旧甲\r\n+2|新甲\r\n";
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { details: { ...first, diff: nativeDiff } },
        "C:/工作/甲.txt",
      ),
    ).toEqual({
      kind: "replacements",
      changes: [{ before: "旧甲\n", after: "新甲\n", nativeDiff }],
    });
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        {
          details: {
            perFileResults: [
              first,
              { ...second, oldText: undefined, snapshotsPruned: true },
            ],
          },
        },
        "C:/工作/乙.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { details: first },
        "C:/工作/乙.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { details: { ...first, path: "C:/其他/甲.txt" } },
        "C:/工作/甲.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { details: { perFileResults: [first, first] } },
        "C:/工作/甲.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { details: { ...first, snapshotsPruned: true } },
        "C:/工作/甲.txt",
      ),
    ).toBeUndefined();
  }
  it("原生 details/perFileResults 完整快照仅返回所选文件", nativeSnapshots);

  /** 验证 hashline 新文本、裁剪结果、未知替换参数不伪造历史 diff。参数：无。返回值：无。 */
  function unavailableHistory(): void {
    const input =
      "*** Begin Patch\n[甲.txt#A1B2]\nPUT 1.=1:\n+新甲\n*** End Patch\n";
    const result = {
      details: {
        path: "D:\\工作\\甲.txt",
        op: "update",
        oldText: "旧甲",
        newText: "新甲",
        diff: "-1|旧甲\n+1|新甲",
      },
    };
    expect(
      getFileReviewEvidence("edit", input, undefined, "甲.txt"),
    ).toBeUndefined();
    expect(getFileReviewEvidence("edit", { input }, result, "甲.txt")).toEqual({
      kind: "replacements",
      changes: [
        { before: "旧甲", after: "新甲", nativeDiff: result.details.diff },
      ],
    });
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { details: { perFileResults: [result.details] } },
        "甲.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { role: "assistant", details: result.details },
        "甲.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { toolName: "write", details: result.details },
        "甲.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { toolName: "replace_content", details: result.details },
        "甲.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { details: { ...result.details, op: "remove" } },
        "甲.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { input },
        { details: { ...result.details, path: "乙.txt" } },
        "甲.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { path: "甲.txt", old_text: "旧甲", new_text: "新甲" },
        undefined,
        "甲.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { input: input.replace("*** End Patch\n", "") },
        { details: { ...result.details, path: "甲.txt" } },
        "甲.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence("mystery", { input }, result, "甲.txt"),
    ).toBeUndefined();
  }
  it(
    "单文件原生操作按同调用关联，多文件和无旧文不能猜历史",
    unavailableHistory,
  );

  /** 验证实际 unified diff 保留 hunk 语义且不泄露其他文件。参数：无。返回值：无。 */
  function selectedUnified(): void {
    const first =
      "--- a/甲.txt\n+++ b/甲.txt\n@@ -1,2 +1,2 @@\n--- 伪文件头\n+++ 伪文件头\n 保留\n";
    const second =
      "--- a/乙.txt\n+++ b/乙.txt\n@@ -1 +1 @@\n-旧乙\n+新乙\n\\ No newline at end of file\n";
    const input = first + second;
    expect(
      getFileReviewEvidence("edit", { input }, undefined, "甲.txt"),
    ).toEqual({ kind: "diff", content: first });
    expect(
      getFileReviewEvidence(
        "apply_patch",
        { patch: input },
        undefined,
        "乙.txt",
      ),
    ).toEqual({ kind: "diff", content: second });
    expect(
      getFileReviewEvidence(
        "edit",
        JSON.stringify({ input }),
        undefined,
        "乙.txt",
      ),
    ).toEqual({ kind: "diff", content: second });
    expect(
      getFileReviewEvidence(
        "edit",
        { input: first + second.trimEnd() },
        undefined,
        "甲.txt",
      ),
    ).toEqual({ kind: "diff", content: first });
    expect(
      getFileReviewEvidence(
        "edit",
        { input: first + second.trimEnd() },
        undefined,
        "乙.txt",
      ),
    ).toEqual({ kind: "diff", content: second.trimEnd() });
    expect(
      getFileReviewEvidence(
        "edit",
        { input: input.replace("新乙", "\u0000") },
        undefined,
        "乙.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence(
        "edit",
        { input: input.replace("新乙", "\uD800") },
        undefined,
        "乙.txt",
      ),
    ).toBeUndefined();
    expect(
      getFileReviewEvidence("edit", input, undefined, "丙.txt"),
    ).toBeUndefined();
  }
  it("多文件 unified 按 hunk 计数隔离文件且保持原文", selectedUnified);

  /** 验证新增/删除、CRLF、多 hunk 和残缺 unified 的消费边界。参数：无。返回值：无。 */
  function unifiedBoundaries(): void {
    const added = "--- /dev/null\n+++ b/新.txt\n@@ -0,0 +1 @@\n+新行\n";
    const removed = "--- a/旧.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-旧行\n";
    const hunks =
      "--- a/甲.txt\n+++ b/甲.txt\n@@ -1 +1 @@\n-一\n+壹\n@@ -5 +5 @@\n-五\n+伍\n";
    for (const [input, path] of [
      [added, "新.txt"],
      [removed, "旧.txt"],
      [hunks.replace(/\n/g, "\r\n"), "甲.txt"],
    ]) {
      expect(getFileReviewEvidence("edit", { input }, undefined, path)).toEqual(
        { kind: "diff", content: input },
      );
    }
    for (const input of [
      "--- a/甲.txt\n+++ b/甲.txt\n",
      hunks.replace("+伍\n", ""),
      hunks.replace("@@ -1 +1 @@", "@@ -1,2 +1 @@"),
      hunks + "unexpected\n",
      hunks.replace("+++ b/甲.txt", "+++ b/乙.txt"),
      hunks.replace("@@ -1 +1 @@", "@@ -0 +1 @@"),
      hunks.replace("@@ -1 +1 @@", "@@ -9007199254740992 +1 @@"),
      hunks.replace("-一\n", "\\ No newline at end of file\n-一\n"),
      hunks.replace(
        "-一\n",
        "-一\n\\ No newline at end of file\n\\ No newline at end of file\n",
      ),
    ]) {
      expect(
        getFileReviewEvidence("edit", { input }, undefined, "甲.txt"),
      ).toBeUndefined();
    }
  }
  it("完整新增删除有效，残缺计数及跨路径重命名不伪造修改", unifiedBoundaries);
}

describe("file review evidence consumers", fileReviewConsumers);
