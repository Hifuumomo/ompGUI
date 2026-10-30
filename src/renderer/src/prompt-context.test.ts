import { describe, expect, it } from "vitest";
import { formatPromptContext } from "./prompt-context";

describe("上下文引用", () => {
  it("将元数据和嵌套围栏隔离，保留中文、CRLF与评论", () => {
    const result = formatPromptContext({ kind: "file", path: "a```/中文.ts", text: "甲\r\n\r\n```\n乙", representation: "source", startLine: 2, endLine: 5 }, "解释这段");
    expect(result).toContain("````text\n文件：a```/中文.ts");
    expect(result).toContain("源行：2–5");
    expect(result).toContain("甲\r\n\r\n```\n乙\n（源码选区无末尾换行）\n````");
    expect(result).toContain("评论：解释这段");
  });
  it("保留重命名、空基线、删除新增行身份与末尾换行语义", () => {
    const result = formatPromptContext({ kind: "diff", path: "new.ts", previousPath: "old.ts", base: null, side: "unified", rows: [
      { kind: "deletion", text: "同文", ending: "\r\n", oldLine: 8 },
      { kind: "addition", text: "同文", ending: "", newLine: 9 },
    ] });
    expect(result).toContain("空基线");
    expect(result).toContain("旧路径：old.ts");
    expect(result).toContain("旧:8 新:- -同文\r\n旧:- 新:9 +同文");
    expect(result).toContain("无末尾换行");
  });
  it("拒绝超限引用且不静默截断", () => {
    expect(() => formatPromptContext({ kind: "web", url: "https://example.com", title: "页面", text: "甲".repeat(65537) })).toThrow("所选内容过长");
  });
});

it("PDF和网页区域格式包含可读来源与图号，不包含图片base64", () => {
  const image = { mimeType: "image/png" as const, width: 1, height: 1, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=" };
  const pdf = { kind: "pdf" as const, url: "https://example.test/paper", title: "论文", page: 3, selection: "figure" as const, text: "图注", image };
  const result = formatPromptContext(pdf, "解释图形", 2);
  expect(result).toContain("PDF：论文");
  expect(result).toContain("页码：第3页");
  expect(result).toContain("选择类型：图块");
  expect(result).toContain("附图：本条消息第2张图片");
  expect(result).toContain("图注");
  expect(result).not.toContain(image.data);
  expect(formatPromptContext(pdf)).toContain("包含选区图片");
  expect(formatPromptContext({ kind: "web-region", url: pdf.url, title: "网页", image })).toContain("网页区域截图");
});
