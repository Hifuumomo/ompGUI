import { expect, it, vi } from "vitest";
import {
  MAX_OUTPUT_CANDIDATES,
  confirmFiles,
  isFilePath,
  outputPaths,
  parseOutput,
  parseSearchLine,
  parseShellLine,
  type OutputPiece,
} from "./output-file-links";

/** 取出被识别为路径的片段。[in] pieces：解析结果。返回值：路径列表。 */
function pathsOf(pieces: OutputPiece[]) {
  return pieces.filter((piece) => piece.path !== undefined).map((piece) => piece.path);
}

/** 拼回原文，用于确认解析不丢字符。[in] pieces：解析结果。返回值：拼接文本。 */
function textOf(pieces: OutputPiece[]) {
  return pieces.map((piece) => piece.text).join("");
}

it("tsc 的 path(行,列) 只把路径识别为链接，原文不变", () => {
  const line = "src/App.tsx(12,3): error TS2322: Type 'string' is not assignable.";
  const pieces = parseShellLine(line);
  expect(pathsOf(pieces)).toEqual(["src/App.tsx"]);
  expect(textOf(pieces)).toBe(line);
});

it("eslint、vitest、grep 的 path:行[:列] 识别路径，行列号留在文本中", () => {
  for (const [line, path] of [
    ["src/renderer/src/a.test.ts:12:5  error  no-unused-vars", "src/renderer/src/a.test.ts"],
    [" ❯ src/z.test.ts:9", "src/z.test.ts"],
    ["C:\\Code\\app\\main.ts:3:1 warning", "C:\\Code\\app\\main.ts"],
  ]) {
    const pieces = parseShellLine(line);
    expect(pathsOf(pieces)).toEqual([path]);
    expect(textOf(pieces)).toBe(line);
  }
});

it("git 状态行与 diff --stat 行识别路径", () => {
  expect(pathsOf(parseShellLine(" M src/renderer/src/inline-tool.css"))).toEqual([
    "src/renderer/src/inline-tool.css",
  ]);
  expect(pathsOf(parseShellLine("?? src/renderer/src/output-file-links.ts"))).toEqual([
    "src/renderer/src/output-file-links.ts",
  ]);
  const stat = " src/renderer/src/inline-tool.css | 5 +++--";
  const pieces = parseShellLine(stat);
  expect(pathsOf(pieces)).toEqual(["src/renderer/src/inline-tool.css"]);
  expect(textOf(pieces)).toBe(stat);
});

it("网址单独识别，末尾标点不属于网址，网址内部不再识别路径", () => {
  const pieces = parseShellLine("see https://example.com/docs/a.md:12, ok");
  expect(pieces.find((piece) => piece.url)?.url).toBe("https://example.com/docs/a.md:12");
  expect(pathsOf(pieces)).toEqual([]);
  expect(textOf(pieces)).toBe("see https://example.com/docs/a.md:12, ok");
});

it.each([
  "console.log(1,2)",
  "main.ts:4:1",
  "c7f4269 feat: 工具详情按行数预览",
  "version 1.2.3 released",
  "README.md",
  "Merge branch/foo.ts",
])("不应识别为文件：%s", (line) => {
  const pieces = parseShellLine(line);
  expect(pathsOf(pieces)).toEqual([]);
  expect(textOf(pieces)).toBe(line);
});

it("路径必须带目录分隔符和扩展名", () => {
  expect(isFilePath("src/a.ts")).toBe(true);
  expect(isFilePath("C:\\a\\b.txt")).toBe(true);
  expect(isFilePath("a.ts")).toBe(false);
  expect(isFilePath("src/Makefile")).toBe(false);
  expect(isFilePath("console.log")).toBe(false);
});

it("搜索结果行：路径是链接，行列号单独标记，其余原样保留", () => {
  const line = "src/a/one.ts:12:needle here";
  const pieces = parseSearchLine(line);
  expect(pathsOf(pieces)).toEqual(["src/a/one.ts"]);
  expect(pieces.find((piece) => piece.location)?.text).toBe(":12");
  expect(textOf(pieces)).toBe(line);
  expect(pathsOf(parseSearchLine("src/a/b.ts"))).toEqual(["src/a/b.ts"]);
  expect(pathsOf(parseSearchLine("src/a/b.ts 一段说明文字"))).toEqual([]);
  expect(pathsOf(parseSearchLine("no match here"))).toEqual([]);
});

it("整段输出按行解析并保留换行，候选路径最多 200 个", () => {
  const text = Array.from({ length: 250 }, (_, index) => `dir/f${index}.ts:1`).join("\r\n") + "\n";
  const pieces = parseOutput(text, "search");
  expect(textOf(pieces)).toBe(text);
  expect(outputPaths(pieces)).toHaveLength(MAX_OUTPUT_CANDIDATES);
});

it("存在性确认合并去重并缓存，失败按不存在处理", async () => {
  const probe = vi.fn(async (path: string) => {
    if (path === "d/boom.ts") throw new Error("denied");
    return path === "d/a.ts";
  });
  const found = await confirmFiles(probe, ["d/a.ts", "d/b.ts", "d/a.ts", "d/boom.ts"]);
  expect([...found]).toEqual(["d/a.ts"]);
  expect(probe).toHaveBeenCalledTimes(3);
  await confirmFiles(probe, ["d/a.ts"]);
  expect(probe).toHaveBeenCalledTimes(3);
});
