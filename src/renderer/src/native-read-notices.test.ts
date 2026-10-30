import { expect, it } from "vitest";
import { readNotices } from "./native-read-notices";

const footer = "\n\n[5 more lines in file. Use config.yml:3 to continue]";

it.each([
  { text: "first\nlast", original: "[config.yml#6239]\n35:first\n36:last" },
  { text: "first\nlast\n", original: "[config.yml#6239]\n35:first\n36:last" },
  {
    text: "first\nlast\n",
    original: "[config.yml#6239]\n35:first\n36:last\n37:",
  },
  { text: "first\nlast", original: "35|first\n36|last" },
  { text: "first\nlast\n", original: "35|first\n36|last\n37|" },
  { text: "first\nlast", original: "first\nlast" },
])("读取提示与不同原生编号模式的正文分离：$original", ({ text, original }) => {
  expect(readNotices(original + footer, { text, startLine: 35 })).toEqual({
    matched: true,
    text: footer,
  });
});

it("保留快照头前的路径解析提示及正文后的截断提示", () => {
  const prefix = "[Resolved file: config.yml]\n";
  expect(
    readNotices(prefix + "[config.yml#6239]\n1:literal" + footer, {
      text: "literal",
      startLine: 1,
    }),
  ).toEqual({ matched: true, text: prefix + footer });
});

it("空正文的提示仍可见", () => {
  expect(
    readNotices("[config.yml#6239]\nFile is empty", { text: "", startLine: 1 }),
  ).toEqual({ matched: true, text: "File is empty" });
});

it("格式不匹配明确返回失败状态及原文，不抛渲染异常或丢失结果", () => {
  expect(
    readNotices("unexpected native output", { text: "source", startLine: 1 }),
  ).toEqual({ matched: false, text: "unexpected native output" });
});
