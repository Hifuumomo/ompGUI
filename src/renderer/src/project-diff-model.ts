import type { ProjectDiffRow } from "../../shared/project-browser";
import type { CodeRow } from "./file-code-model";
import { fileLanguage, highlightDiff } from "./file-code-highlight";

export type DiffDisplayMode = "split" | "unified" | "source";
export interface DiffPair {
  readonly old?: CodeRow;
  readonly next?: CodeRow;
}

/** 一个变更块内按序对齐增删行；空白占位不产生虚构行号。 */
export function pairProjectDiff(rows: readonly CodeRow[]): readonly DiffPair[] {
  const pairs: DiffPair[] = [];
  let removed: CodeRow[] = [];
  let added: CodeRow[] = [];
  function flush() {
    const count = Math.max(removed.length, added.length);
    for (let index = 0; index < count; index += 1)
      pairs.push({ old: removed[index], next: added[index] });
    removed = [];
    added = [];
  }
  for (const row of rows) {
    if (row.kind === "deletion") {
      removed.push(row);
      continue;
    }
    if (row.kind === "addition") {
      added.push(row);
      continue;
    }
    flush();
    pairs.push({ old: row, next: row });
  }
  flush();
  return pairs;
}

export type DiffSegment =
  | { readonly kind: "rows"; readonly rows: readonly CodeRow[] }
  | { readonly kind: "fold"; readonly start: number; readonly count: number }
  | { readonly kind: "expanded"; readonly start: number; readonly rows: readonly CodeRow[] };

/**
 * 按原始行索引分段；只折叠连续的未修改行（kind 为 context），返回的段按原顺序覆盖全部行。
 * start 是被隐藏范围的首个原始行索引，同一份差异每次算出的值相同，可作为段的身份。
 * @param rows [in] 整个文件的差异行。
 * @param expanded [in] 已手动展开的段的 start。
 * @param pinned [in] 必须可见的原始行索引；范围内含这些行的段不折叠。
 * @param context [in] 改动行前后保留的未修改行数。
 */
export function foldProjectDiff(
  rows: readonly CodeRow[],
  expanded: ReadonlySet<number>,
  pinned: ReadonlySet<number>,
  context = 3,
): readonly DiffSegment[] {
  const segments: DiffSegment[] = [];
  function pushRows(from: number, to: number) {
    if (to <= from) return;
    const last = segments[segments.length - 1];
    const slice = rows.slice(from, to);
    // 相邻的普通行合并到同一个 rows 段。
    if (last?.kind === "rows")
      segments[segments.length - 1] = { kind: "rows", rows: [...last.rows, ...slice] };
    else segments.push({ kind: "rows", rows: slice });
  }
  let a = 0;
  while (a < rows.length) {
    let b = a + 1;
    const unmodified = rows[a].kind === "context";
    while (b < rows.length && (rows[b].kind === "context") === unmodified) b += 1;
    if (!unmodified) {
      pushRows(a, b);
      a = b;
      continue;
    }
    const lead = a === 0 ? 0 : context;
    const trail = b === rows.length ? 0 : context;
    const start = a + lead;
    const end = b - trail;
    const count = end - start;
    const hasPinned = [...pinned].some((index) => index >= start && index < end);
    if (count < 2 || hasPinned) {
      pushRows(a, b);
    } else {
      pushRows(a, start);
      segments.push(
        expanded.has(start)
          ? { kind: "expanded", start, rows: rows.slice(start, end) }
          : { kind: "fold", start, count },
      );
      pushRows(end, b);
    }
    a = b;
  }
  return segments;
}

export function decorateProjectDiff(
  rows: readonly ProjectDiffRow[],
  path: string,
) {
  return highlightDiff(
    rows.map((row) => ({ ...row })),
    fileLanguage(path),
  );
}
