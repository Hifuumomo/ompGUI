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

export function decorateProjectDiff(
  rows: readonly ProjectDiffRow[],
  path: string,
) {
  return highlightDiff(
    rows.map((row) => ({ ...row })),
    fileLanguage(path),
  );
}
