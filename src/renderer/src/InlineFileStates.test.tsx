// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  createTranscriptView,
  toolCall,
} from "./inline-transcript-test-helpers";

/** 区分原生空读取和未记录读取结果，所有正文均在会话内可读。参数：无。返回值：测试完成 Promise。 */
async function emptyAndMissingReads() {
  const view = createTranscriptView();
  await view.render({
    messages: [
      toolCall("empty-text", "read", { path: "empty.txt" }),
      { role: "toolResult", toolCallId: "empty-text", content: "" },
      toolCall("empty-blocks", "read", { path: "empty-array.txt" }),
      { role: "toolResult", toolCallId: "empty-blocks", content: [] },
      toolCall("missing", "read", { path: "missing.txt" }),
    ],
  });
  for (const id of ["empty-text", "empty-blocks"]) {
    await view.click(view.target(id));
    expect(view.row(id).textContent).toContain("文件内容为空");
    expect(view.row(id).textContent).not.toContain("未记录文件内容");
    expect(view.row(id).querySelectorAll(".file-code-text")).toHaveLength(0);
  }
  await view.click(view.target("missing"));
  expect(view.row("missing").textContent).toContain("未记录文件内容");
  expect(view.row("missing").textContent).not.toContain("文件内容为空");
}
it("空原生读取显示空文件，未记录结果保持明确的缺失状态", emptyAndMissingReads);

/** 失败写入显示真实错误，不把调用参数中的拟写内容作为成功文件正文。参数：无。返回值：测试完成 Promise。 */
async function failedWrite() {
  const view = createTranscriptView();
  await view.render({
    messages: [
      toolCall("failed-write", "write", {
        path: "denied.txt",
        content: "must-not-claim-write",
      }),
      {
        role: "toolResult",
        toolCallId: "failed-write",
        isError: true,
        errorMessage: "EACCES denied",
        content: [{ type: "text", text: "native write failure" }],
      },
    ],
  });
  await view.click(view.target("failed-write"));
  expect(
    view.row("failed-write").querySelector("summary")?.textContent,
  ).not.toContain("错误");
  expect(view.row("failed-write").classList.contains("process-error")).toBe(
    true,
  );
  expect(view.row("failed-write").textContent).toContain("EACCES denied");
  expect(view.row("failed-write").textContent).toContain(
    "native write failure",
  );
  expect(view.row("failed-write").textContent).not.toContain(
    "must-not-claim-write",
  );
  expect(view.row("failed-write").textContent).not.toContain("已完成");
}
it("失败写入保留真实失败输出且不冒充成功写入内容", failedWrite);

/** 原生读取中的图片继续作为图片呈现，文本保持字面源码。参数：无。返回值：测试完成 Promise。 */
async function imageAndLiteralRead() {
  const view = createTranscriptView();
  const image = {
    type: "image",
    mimeType: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bLEAAAAASUVORK5CYII=",
  };
  await view.render({
    messages: [
      toolCall("picture", "read", { path: "picture.png" }),
      {
        role: "toolResult",
        toolCallId: "picture",
        content: [{ type: "text", text: "<img src=x> **literal**" }, image],
      },
    ],
  });
  await view.click(view.target("picture"));
  expect(
    view.row("picture").querySelector(".file-review-source")?.textContent,
  ).toBe("<img src=x> **literal**");
  expect(view.row("picture").querySelectorAll("img")).toHaveLength(1);
  expect(view.row("picture").querySelector("img")?.getAttribute("src")).toBe(
    `data:image/png;base64,${image.data}`,
  );
  expect(view.row("picture").querySelector("strong")).toBeNull();
}
it("文件读取正文保持字面文本并保留原生图片", imageAndLiteralRead);
