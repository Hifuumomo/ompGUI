import { describe, expect, it } from "vitest";
import { sourceContextRange, diffContextRows } from "./project-context-selection";

describe("源码引用范围", () => {
  it("反向选择扩展整行，末端为下一行开头则排除该行", () => {
    expect(sourceContextRange("甲\r\n乙\r\n丙", 6, 1)).toEqual({ text: "甲\r\n乙\r\n", copyText: "\r\n乙\r\n", startLine: 1, endLine: 2 });
  });
  it("支持开头空行及未装饰的2005行尾部", () => {
    expect(sourceContextRange("\n乙", 0, 1).text).toBe("\n");
    const text = Array.from({ length: 2005 }, (_, i) => `行${i + 1}`).join("\n");
    const result = sourceContextRange(text, text.lastIndexOf("行2005"), text.length);
    expect(result).toEqual({ text: "行2005", copyText: "行2005", startLine: 2005, endLine: 2005 });
    expect(() => sourceContextRange("", 0, 0)).toThrow();
  });
  it("孤立 CR 按源码行处理，末尾光标不生成空行", () => {
    expect(sourceContextRange("甲\r乙\r", 2, 3)).toEqual({ text: "乙\r", copyText: "乙", startLine: 2, endLine: 2 });
    expect(sourceContextRange("甲\r\n", 3, 3)).toEqual({ text: "甲\r\n", copyText: "", startLine: 1, endLine: 1 });
  });
  it("重复文本依模型索引和侧别区分，空gap不成为代码", () => {
    const rows = [
      { kind: "deletion" as const, text: "重复", ending: "\n", oldLine: 4 },
      { kind: "addition" as const, text: "重复", ending: "", newLine: 5 },
    ];
    expect(diffContextRows(rows, 1, 0, "old")).toEqual([rows[0]]);
    expect(diffContextRows(rows, 0, 1, "new")).toEqual([rows[1]]);
    expect(diffContextRows(rows, 0, 1, "unified")).toEqual(rows);
    expect(() => diffContextRows(rows, 0, 2, "old")).toThrow();
  });
});
