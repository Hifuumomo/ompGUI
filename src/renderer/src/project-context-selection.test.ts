import { describe, expect, it } from "vitest";
import { sourceContextRange, diffContextRows, diffChangeBlockRows } from "./project-context-selection";

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

describe("差异变更块", () => {
  const rows = [
    { kind: "context" as const, text: "前", ending: "\n", oldLine: 1, newLine: 1 },
    { kind: "deletion" as const, text: "删甲", ending: "\n", oldLine: 2 },
    { kind: "deletion" as const, text: "删乙", ending: "\n", oldLine: 3 },
    { kind: "addition" as const, text: "增甲", ending: "\n", newLine: 2 },
    { kind: "context" as const, text: "中", ending: "\n", oldLine: 4, newLine: 3 },
    { kind: "addition" as const, text: "增乙", ending: "\n", newLine: 4 },
    { kind: "context" as const, text: "后", ending: "\n", oldLine: 5, newLine: 5 },
    { kind: "deletion" as const, text: "删丙", ending: "\n", oldLine: 6 },
    { kind: "addition" as const, text: "增丙", ending: "\n", newLine: 6 },
  ];
  it("只选删除行或新增行时扩展到整个连续变更块，不按侧过滤", () => {
    expect(diffChangeBlockRows(rows, 2, 2)).toEqual(rows.slice(1, 4));
    expect(diffChangeBlockRows(rows, 3, 3)).toEqual(rows.slice(1, 4));
    expect(diffChangeBlockRows(rows, 5, 5)).toEqual([rows[5]]);
  });
  it("上下文行不扩展，颠倒索引等价", () => {
    expect(diffChangeBlockRows(rows, 0, 0)).toEqual([rows[0]]);
    expect(diffChangeBlockRows(rows, 4, 4)).toEqual([rows[4]]);
    expect(diffChangeBlockRows(rows, 0, 1)).toEqual(rows.slice(0, 4));
    expect(diffChangeBlockRows(rows, 3, 2)).toEqual(diffChangeBlockRows(rows, 2, 3));
  });
  it("跨多个变更块时保留中间的上下文行", () => {
    expect(diffChangeBlockRows(rows, 3, 7)).toEqual(rows.slice(1));
  });
  it("拒绝越界索引并保留原行对象引用", () => {
    expect(() => diffChangeBlockRows(rows, 0, 9)).toThrow();
    expect(() => diffChangeBlockRows(rows, -1, 0)).toThrow();
    expect(() => diffChangeBlockRows(rows, 0.5, 1)).toThrow();
    const result = diffChangeBlockRows(rows, 2, 2);
    expect(result[0]).toBe(rows[1]);
    expect(result[2]).toBe(rows[3]);
  });
});
