import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ProjectDiff, ProjectDiffRow } from "../../shared/project-browser";
import { validatePromptContext, type PromptContext } from "../../shared/prompt-context";
import { ContextActionsMenu } from "./ContextActionsMenu";
import { diffChangeBlockRows, diffContextRows } from "./project-context-selection";
import type { CodeRow } from "./file-code-model";
import type { LocalCommentAnchor } from "../../shared/comment-anchor";
import { LocalSourceMarkers, diffCommentIdentity } from "./LocalCommentMarkers";
import {
  decorateProjectDiff,
  pairProjectDiff,
  type DiffDisplayMode,
  type DiffPair,
} from "./project-diff-model";
import "./project-diff.css";

interface Props {
  readonly diff: ProjectDiff;
  readonly path: string;
  readonly previousPath?: string;
  readonly mode: DiffDisplayMode;
  readonly wrap: boolean;
  readonly base: string | null;
}

function DiffText({ row }: { readonly row: CodeRow }) {
  return (
    <code>
      <span className="project-diff-text">{row.tokens ?? row.text}</span>
      {!row.ending && (
        <span className="project-no-newline" title="文件末尾没有换行符">
          {" "}
          ⏎ 无末尾换行
        </span>
      )}
    </code>
  );
}
function DiffCell({
  row,
  side,
  indices,
}: {
  readonly row?: CodeRow;
  readonly side: "old" | "next";
  readonly indices: ReadonlyMap<CodeRow, number>;
}) {
  if (!row) return <div className="project-diff-cell gap" aria-hidden="true" />;
  const line = side === "old" ? row.oldLine : row.newLine;
  return (
    <div className={`project-diff-cell ${row.kind}`} data-line={line}
      data-diff-index={indices.get(row)} tabIndex={-1}>
      <span className="project-diff-number" aria-hidden="true">
        {line}
      </span>
      <span className="project-diff-sign" aria-hidden="true">
        {row.kind === "addition" ? "+" : row.kind === "deletion" ? "−" : ""}
      </span>
      <DiffText row={row} />
    </div>
  );
}
function DiffPane({
  pairs,
  side,
  label,
  indices,
}: {
  readonly pairs: readonly DiffPair[];
  readonly side: "old" | "next";
  readonly label: string;
  readonly indices: ReadonlyMap<CodeRow, number>;
}) {
  return (
    <section
      className="project-diff-pane"
      aria-label={side === "old" ? "修改前" : "修改后"}
      data-diff-side={side === "old" ? "old" : "new"}
    >
      <header title={label}>{label}</header>
      {pairs.map((pair, index) => (
        <DiffCell key={index} row={pair[side]} side={side} indices={indices} />
      ))}
    </section>
  );
}
function SplitDiff({
  rows,
  props,
  indices,
}: {
  readonly rows: readonly CodeRow[];
  readonly props: Props;
  readonly indices: ReadonlyMap<CodeRow, number>;
}) {
  const pairs = useMemo(() => pairProjectDiff(rows), [rows]);
  return (
    <div
      className="project-diff-split"
      style={{ "--diff-row-count": pairs.length + 1 } as CSSProperties}
    >
      <DiffPane
        pairs={pairs}
        indices={indices}
        side="old"
        label={`修改前 · ${props.base ? "HEAD" : "空基线"} · ${props.previousPath ?? props.path}`}
      />
      <DiffPane
        pairs={pairs}
        indices={indices}
        side="next"
        label={`修改后 · 工作区 · ${props.path}`}
      />
    </div>
  );
}
function UnifiedDiff({ rows, indices }: {
  readonly rows: readonly CodeRow[];
  readonly indices: ReadonlyMap<CodeRow, number>;
}) {
  return (
    <div className="project-diff-unified" aria-label="单栏差异" data-diff-side="unified">
      {rows.map((row, index) => (
        <div key={index} className={`project-diff-cell unified ${row.kind}`}
          data-diff-index={indices.get(row)} tabIndex={-1}>
          <span
            className="project-diff-number"
            data-old-line={row.oldLine}
            aria-hidden="true"
          >
            {row.oldLine}
          </span>
          <span
            className="project-diff-number"
            data-new-line={row.newLine}
            aria-hidden="true"
          >
            {row.newLine}
          </span>
          <span className="project-diff-sign" aria-hidden="true">
            {row.kind === "addition" ? "+" : row.kind === "deletion" ? "−" : ""}
          </span>
          <DiffText row={row} />
        </div>
      ))}
    </div>
  );
}

type DiffSide = "old" | "new" | "unified";
interface DiffSelection {
  /** 实际选中的行：用于复制、sourceAnchor 和“已选 N 行”。 */
  rows: readonly ProjectDiffRow[];
  /** 扩展到连续变更块的行：只用于提示词的 context.rows。 */
  promptRows: readonly ProjectDiffRow[];
  side: DiffSide;
  range?: Range;
}

function diffRow(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest<HTMLElement>("[data-diff-index]") ?? null;
}

/** 元素端点可能落在行间，按范围方向取相邻真实行，不读取装饰文本推断身份。 */
function endpointRow(node: Node, offset: number, end: boolean): HTMLElement | null {
  const direct = diffRow(node);
  if (direct) return direct;
  const child = node.childNodes[end ? offset - 1 : offset];
  if (!(child instanceof Element)) return null;
  const rows = child.querySelectorAll<HTMLElement>("[data-diff-index]");
  return diffRow(child) ?? rows[end ? rows.length - 1 : 0] ?? null;
}

function selectedDiff(root: HTMLElement, rows: readonly ProjectDiffRow[]): DiffSelection | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) && !root.contains(range.endContainer)) return;
  const first = endpointRow(range.startContainer, range.startOffset, false);
  let last = endpointRow(range.endContainer, range.endOffset, true);
  const firstSide = first?.closest<HTMLElement>("[data-diff-side]");
  const lastSide = last?.closest<HTMLElement>("[data-diff-side]");
  if (!first || !last || !firstSide || !lastSide ||
      !root.contains(first) || !root.contains(last) || firstSide !== lastSide) {
    throw new Error("请在同一侧选择差异行，不能跨侧选择");
  }
  // 结束端点位于下一行文本开头（包括嵌套 token 的 offset 0）时排除该行。
  const text = last.querySelector(".project-diff-text");
  if (text && first !== last) {
    const prefix = document.createRange();
    prefix.selectNodeContents(text);
    prefix.setEnd(range.endContainer, range.endOffset);
    if (prefix.toString().length === 0) {
      const visible = [...firstSide.querySelectorAll<HTMLElement>("[data-diff-index]")];
      last = visible[visible.indexOf(last) - 1] ?? null;
    }
  }
  if (!last) throw new Error("无有效差异选区");
  const side = firstSide.dataset.diffSide as DiffSide;
  const firstIndex = Number(first.dataset.diffIndex);
  const lastIndex = Number(last.dataset.diffIndex);
  return {
    rows: diffContextRows(rows, firstIndex, lastIndex, side),
    promptRows: diffChangeBlockRows(rows, firstIndex, lastIndex),
    side,
    range,
  };
}

export function ProjectDiffView(props: Props) {
  const rows = useMemo(
    () => decorateProjectDiff(props.diff.rows, props.path),
    [props.diff.rows, props.path],
  );
  const root = useRef<HTMLDivElement>(null);
  const identity = useMemo(() => diffCommentIdentity(props.diff.rows), [props.diff.rows]);
  const [menu, setMenu] = useState<{
    x: number; y: number; copyText: string; selectedLineCount: number;
    context: Extract<PromptContext, { kind: "diff" }>;
    trigger: HTMLElement; whole: boolean;
    sourceAnchor: LocalCommentAnchor;
  }>();
  const [error, setError] = useState("");
  const indices = useMemo(() => {
    // 高亮会复制对象，先按原始对象建立索引，再按保持不变的顺序关联装饰行。
    const originals = new Map(props.diff.rows.map((row, index) => [row, index]));
    return new Map(rows.map((row, index) => [row, originals.get(props.diff.rows[index])!]));
  }, [rows, props.diff.rows]);
  useLayoutEffect(() => {
    setMenu(undefined);
    setError("");
  }, [props.mode, props.diff, props.path, props.base, props.previousPath]);

  function openMenu(target: HTMLElement, point?: { x: number; y: number }, whole = false) {
    const element = root.current;
    if (!element) return;
    setMenu(undefined);
    setError("");
    try {
      const row = diffRow(target);
      const selected = whole ? undefined : selectedDiff(element, props.diff.rows);
      const side = row?.closest<HTMLElement>("[data-diff-side]")?.dataset.diffSide as DiffSide | undefined;
      if (selected && side && selected.side !== side) {
        throw new Error("请在同一侧选择差异行，不能跨侧选择");
      }
      const chosen: DiffSelection = selected ?? (row && side
        ? {
          rows: diffContextRows(props.diff.rows, Number(row.dataset.diffIndex), Number(row.dataset.diffIndex), side),
          promptRows: diffChangeBlockRows(props.diff.rows, Number(row.dataset.diffIndex), Number(row.dataset.diffIndex)),
          side,
        }
        : { rows: props.diff.rows, promptRows: props.diff.rows, side: "unified" });
      const context: Extract<PromptContext, { kind: "diff" }> = {
        kind: "diff", path: props.path, previousPath: props.previousPath,
        base: props.base, side: chosen.side, rows: chosen.promptRows,
      };
      validatePromptContext(context);
      const rect = point ? undefined : chosen.range?.getBoundingClientRect() ?? (row ?? target).getBoundingClientRect();
      setMenu({
        x: point?.x ?? rect!.left, y: point?.y ?? rect!.bottom,
        copyText: chosen.rows.map((original) => original.text + original.ending).join(""),
        selectedLineCount: chosen.rows.length,
        context,
        sourceAnchor: {
          kind: "local", view: "diff", path: props.path, previousPath: props.previousPath, base: props.base, identity,
          side: chosen.side === "unified" ? chosen.rows[0]?.kind === "deletion" ? "old" : "new" : chosen.side,
          row: whole || (!selected && !row) ? undefined : props.diff.rows.indexOf(chosen.rows[0]),
        },
        trigger: whole || (!selected && !row)
          ? element.querySelector<HTMLElement>(".project-diff-summary") ?? element
          : row ?? element,
        whole: whole || (!selected && !row),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  const added = props.diff.rows.filter((row) => row.kind === "addition").length;
  const deleted = props.diff.rows.filter(
    (row) => row.kind === "deletion",
  ).length;
  const digits = String(
    Math.max(
      props.diff.before.split("\n").length,
      props.diff.after.split("\n").length,
    ),
  ).length;
  return (
    <div
      ref={root}
      tabIndex={0}
      aria-label="文件差异"
      onPointerDown={(event) => {
        const row = event.target instanceof Node ? diffRow(event.target) : null;
        if (row && window.getSelection()?.isCollapsed !== false) row.focus({ preventScroll: true });
      }}
      onContextMenu={(event) => {
        if (!(event.target instanceof HTMLElement)) return;
        const summary = event.target.closest(".project-diff-summary");
        const row = diffRow(event.target);
        event.preventDefault();
        if (!summary && !row) {
          setMenu(undefined);
          setError("");
          return;
        }
        openMenu(event.target, { x: event.clientX, y: event.clientY }, !!summary);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        event.stopPropagation();
        const focused = document.activeElement;
        openMenu(focused instanceof HTMLElement && root.current?.contains(focused) ? focused : event.currentTarget);
      }}
      className="project-diff-view file-code-view"
      data-wrap={props.wrap}
      style={{ "--diff-digits": `${digits}ch` } as CSSProperties}
    >
      <div className="project-diff-summary" tabIndex={-1}>
        <span>
          {props.base
            ? `HEAD ${props.base.slice(0, 8)} → 工作区`
            : "首次提交前 → 工作区"}
        </span>
        <span className="project-diff-added">+{added}</span>
        <span className="project-diff-deleted">−{deleted}</span>
        {!added && !deleted && <span>内容无差异</span>}
        {menu?.whole && <span role="status">整个文件差异 · {menu.context.rows.length} 行</span>}
      </div>
      {error && <p className="file-context-error" role="alert">{error}</p>}
      {props.mode === "split" ? (
        <SplitDiff rows={rows} props={props} indices={indices} />
      ) : (
        <UnifiedDiff rows={rows} indices={indices} />
      )}
      <LocalSourceMarkers root={root} path={props.path} previousPath={props.previousPath} view="diff" identity={identity} base={props.base} />
      {menu && <ContextActionsMenu
        x={menu.x} y={menu.y} copyText={menu.copyText} context={menu.context} selectedLineCount={menu.selectedLineCount}
        trigger={menu.trigger} sourceAnchor={menu.sourceAnchor} allowAppend onClose={() => setMenu(undefined)}
      />}
    </div>
  );
}
