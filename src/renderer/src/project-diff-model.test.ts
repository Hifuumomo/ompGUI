import { expect, it } from "vitest";
import type { CodeRow } from "./file-code-model";
import { foldProjectDiff, type DiffSegment } from "./project-diff-model";

const NONE: ReadonlySet<number> = new Set();

/** 用字符串描述差异：c 未修改，a 新增，d 删除，m 元数据。 */
function rowsOf(pattern: string): CodeRow[] {
  const kinds = { c: "context", a: "addition", d: "deletion", m: "metadata" } as const;
  return [...pattern].map((char, index) => ({
    kind: kinds[char as keyof typeof kinds], text: `line ${index}`, ending: "\n",
  }));
}
const shape = (segments: readonly DiffSegment[]) => segments.map((segment) =>
  segment.kind === "rows" ? `rows:${segment.rows.length}`
    : segment.kind === "fold" ? `fold:${segment.start}+${segment.count}`
      : `open:${segment.start}+${segment.rows.length}`);
const fold = (pattern: string, expanded = NONE, pinned = NONE) =>
  foldProjectDiff(rowsOf(pattern), expanded, pinned);

it("开头、中间、结尾的未修改行各保留 3 行并给出 start 和 count", () => {
  // 0-9 未修改，10 新增，11-20 未修改。
  expect(shape(fold("c".repeat(10) + "a" + "c".repeat(10)))).toEqual(["fold:0+7", "rows:7", "fold:14+7"]);
  // 两处改动之间的未修改行前后各留 3 行。
  expect(shape(fold("a" + "c".repeat(10) + "d"))).toEqual(["rows:4", "fold:4+4", "rows:4"]);
});

it("两处改动之间正好 6、7、8 行未修改", () => {
  expect(shape(fold("a" + "c".repeat(6) + "a"))).toEqual(["rows:8"]);
  expect(shape(fold("a" + "c".repeat(7) + "a"))).toEqual(["rows:9"]);
  expect(shape(fold("a" + "c".repeat(8) + "a"))).toEqual(["rows:4", "fold:4+2", "rows:4"]);
});

it("开头或结尾正好 3、4、5 行未修改", () => {
  for (const make of [(n: number) => "c".repeat(n) + "a", (n: number) => "a" + "c".repeat(n)]) {
    expect(shape(fold(make(3)))).toEqual(["rows:4"]);
    expect(shape(fold(make(4)))).toEqual(["rows:5"]);
  }
  expect(shape(fold("c".repeat(5) + "a"))).toEqual(["fold:0+2", "rows:4"]);
  expect(shape(fold("a" + "c".repeat(5)))).toEqual(["rows:4", "fold:4+2"]);
});

it("没有改动的文件整体收成一个灰条，0 行或 1 行不折叠", () => {
  expect(shape(fold("c".repeat(30)))).toEqual(["fold:0+30"]);
  expect(shape(fold(""))).toEqual([]);
  expect(shape(fold("c"))).toEqual(["rows:1"]);
});

it("全部新增或全部删除的文件没有灰条", () => {
  expect(shape(fold("a".repeat(20)))).toEqual(["rows:20"]);
  expect(shape(fold("d".repeat(20)))).toEqual(["rows:20"]);
});

it("元数据行不参与折叠，并像改动一样保留前后各 3 行未修改行", () => {
  // 0-9 未修改，10 元数据，11-20 未修改；元数据行本身始终可见。
  expect(shape(fold("c".repeat(10) + "m" + "c".repeat(10)))).toEqual(["fold:0+7", "rows:7", "fold:14+7"]);
});

it("expanded 命中时返回 expanded 段，pinned 命中时留在 rows 且优先于 expanded", () => {
  const pattern = "c".repeat(10) + "a";
  expect(shape(fold(pattern, new Set([0])))).toEqual(["open:0+7", "rows:4"]);
  // start 不是段的首个隐藏行时不命中。
  expect(shape(fold(pattern, new Set([1])))).toEqual(["fold:0+7", "rows:4"]);
  expect(shape(fold(pattern, NONE, new Set([3])))).toEqual(["rows:11"]);
  expect(shape(fold(pattern, new Set([0]), new Set([3])))).toEqual(["rows:11"]);
  // 可见的上下文行被 pinned 不影响折叠。
  expect(shape(fold(pattern, NONE, new Set([8])))).toEqual(["fold:0+7", "rows:4"]);
});

it("所有段按顺序拼起来覆盖全部行，没有重复或遗漏", () => {
  const patterns = ["", "c", "a", "c".repeat(30), "c".repeat(9) + "ad" + "c".repeat(9) + "m" + "c".repeat(12) + "a" + "c".repeat(4)];
  for (const pattern of patterns) {
    const rows = rowsOf(pattern);
    for (const expanded of [NONE, new Set(foldProjectDiff(rows, NONE, NONE).flatMap((segment) => segment.kind === "fold" ? [segment.start] : []))]) {
      const joined = foldProjectDiff(rows, expanded, NONE).flatMap((segment) =>
        segment.kind === "fold" ? rows.slice(segment.start, segment.start + segment.count) : segment.rows);
      expect(joined).toHaveLength(rows.length);
      joined.forEach((row, index) => expect(row).toBe(rows[index]));
    }
  }
});
