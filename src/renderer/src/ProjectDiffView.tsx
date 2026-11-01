import { useContext, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ProjectDiff, ProjectDiffRow } from "../../shared/project-browser";
import { validatePromptContext, type PromptContext } from "../../shared/prompt-context";
import { ContextActionsMenu } from "./ContextActionsMenu";
import { diffChangeBlockRows, diffContextRows } from "./project-context-selection";
import type { CodeRow } from "./file-code-model";
import type { CommentSourceAnchor, LocalCommentAnchor } from "../../shared/comment-anchor";
import { sameProjectPath } from "../../shared/message-file-link";
import { LocalCommentMarkers, LocalSourceMarkers, diffCommentIdentity } from "./LocalCommentMarkers";
import { LocalCommentReveal } from "./local-comment-reveal";
import {
  decorateProjectDiff,
  foldProjectDiff,
  pairProjectDiff,
  type DiffDisplayMode,
  type DiffPair,
  type DiffSegment,
} from "./project-diff-model";
import "./project-diff.css";

interface Props {
  readonly diff: ProjectDiff;
  readonly path: string;
  readonly previousPath?: string;
  readonly mode: DiffDisplayMode;
  readonly wrap: boolean;
  readonly base: string | null;
  /** 不传时显示全部行；传入后连续的未修改行折叠成灰条。 */
  readonly fold?: {
    /** 已展开段的 start（原始行索引）。 */
    readonly expanded: ReadonlySet<number>;
    readonly onExpand: (start: number) => void;
    readonly onCollapse: (start: number) => void;
  };
}

const NO_ROWS: ReadonlySet<number> = new Set();
const SELECT_ACROSS_FOLD = "选区跨过了折叠的未修改行，请先展开或分开选择";

/** 灰条（折叠）与收起条（展开后的上下两端）；灰条和上方收起条共用同一个 key，是同一个元素。 */
interface BarItem {
  readonly kind: "bar";
  readonly key: string;
  readonly start: number;
  readonly count: number;
  readonly edge: "top" | "bottom";
  readonly open: boolean;
}
/** 分段展开后的扁平列表：灰条、收起条和行是同一个父元素的直接子元素，key 不随折叠变化。 */
type FlatItem =
  | BarItem
  | { readonly kind: "row"; readonly key: string; readonly row: CodeRow }
  | { readonly kind: "pair"; readonly key: string; readonly pair: DiffPair };

function flattenDiff(
  segments: readonly DiffSegment[],
  split: boolean,
  indices: ReadonlyMap<CodeRow, number>,
): readonly FlatItem[] {
  const items: FlatItem[] = [];
  function pushRows(rows: readonly CodeRow[]) {
    // 并排按段单独配对，隐藏的行不参与配对。
    if (split) {
      for (const pair of pairProjectDiff(rows))
        items.push({ kind: "pair", key: `r${indices.get((pair.old ?? pair.next)!)}`, pair });
    } else {
      for (const row of rows) items.push({ kind: "row", key: `r${indices.get(row)}`, row });
    }
  }
  for (const segment of segments) {
    if (segment.kind === "rows") {
      pushRows(segment.rows);
    } else if (segment.kind === "fold") {
      items.push({ kind: "bar", key: `f${segment.start}`, start: segment.start, count: segment.count, edge: "top", open: false });
    } else {
      const count = segment.rows.length;
      items.push({ kind: "bar", key: `f${segment.start}`, start: segment.start, count, edge: "top", open: true });
      pushRows(segment.rows);
      items.push({ kind: "bar", key: `b${segment.start}`, start: segment.start, count, edge: "bottom", open: true });
    }
  }
  return items;
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

function FoldArrow() {
  return (
    <svg className="project-diff-fold-icon" width="16" height="16" viewBox="0 0 16 16"
      aria-hidden="true" focusable="false">
      <path d="m3.5 10 4.5-4.5 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
/**
 * 灰条或收起条。并排时右侧窗格用 aria-hidden 的 div 呈现相同外观，避免读屏和 Tab 经过两次。
 * @param mirror [in] 为 true 时渲染右侧窗格的镜像。
 */
function FoldBar({ item, mirror, onActivate }: {
  readonly item: BarItem;
  readonly mirror?: boolean;
  readonly onActivate: (item: BarItem, source: HTMLElement) => void;
}) {
  const common = {
    className: "project-diff-fold",
    "data-fold-start": item.start,
    "data-fold-edge": item.edge,
  };
  if (mirror)
    return <div {...common} aria-hidden="true" onClick={(event) => onActivate(item, event.currentTarget)} />;
  return (
    <button
      type="button"
      {...common}
      aria-expanded={item.open}
      aria-label={`${item.open ? "收起" : "展开"} ${item.count} 行未修改`}
      onClick={(event) => onActivate(item, event.currentTarget)}
    >
      <span className="project-diff-fold-text">
        {item.open && <FoldArrow />}
        {item.open ? `收起 ${item.count} 行未修改` : `${item.count} 行未修改`}
      </span>
    </button>
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
  items,
  side,
  label,
  indices,
  onActivate,
}: {
  readonly items: readonly FlatItem[];
  readonly side: "old" | "next";
  readonly label: string;
  readonly indices: ReadonlyMap<CodeRow, number>;
  readonly onActivate: (item: BarItem, source: HTMLElement) => void;
}) {
  return (
    <section
      className="project-diff-pane"
      aria-label={side === "old" ? "修改前" : "修改后"}
      data-diff-side={side === "old" ? "old" : "new"}
    >
      <header title={label}>{label}</header>
      {items.map((item) =>
        item.kind === "bar" ? (
          <FoldBar key={item.key} item={item} mirror={side === "next"} onActivate={onActivate} />
        ) : item.kind === "pair" ? (
          <DiffCell key={item.key} row={item.pair[side]} side={side} indices={indices} />
        ) : null,
      )}
    </section>
  );
}
function SplitDiff({
  items,
  props,
  indices,
  onActivate,
}: {
  readonly items: readonly FlatItem[];
  readonly props: Props;
  readonly indices: ReadonlyMap<CodeRow, number>;
  readonly onActivate: (item: BarItem, source: HTMLElement) => void;
}) {
  return (
    <div
      className="project-diff-split"
      style={{ "--diff-row-count": items.length + 1 } as CSSProperties}
    >
      <DiffPane
        items={items}
        indices={indices}
        side="old"
        label={`修改前 · ${props.base ? "HEAD" : "空基线"} · ${props.previousPath ?? props.path}`}
        onActivate={onActivate}
      />
      <DiffPane
        items={items}
        indices={indices}
        side="next"
        label={`修改后 · 工作区 · ${props.path}`}
        onActivate={onActivate}
      />
    </div>
  );
}
function UnifiedDiff({ items, indices, onActivate }: {
  readonly items: readonly FlatItem[];
  readonly indices: ReadonlyMap<CodeRow, number>;
  readonly onActivate: (item: BarItem, source: HTMLElement) => void;
}) {
  return (
    <div className="project-diff-unified" aria-label="单栏差异" data-diff-side="unified">
      {items.map((item) => {
        if (item.kind === "bar") return <FoldBar key={item.key} item={item} onActivate={onActivate} />;
        if (item.kind !== "row") return null;
        const row = item.row;
        return (
          <div key={item.key} className={`project-diff-cell unified ${row.kind}`}
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
        );
      })}
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

/** 端点落在灰条或收起条上时沿兄弟元素找真实行：结束端点向前，起始端点向后。 */
function adjacentRow(bar: Element, end: boolean): HTMLElement | null {
  for (
    let node = end ? bar.previousElementSibling : bar.nextElementSibling;
    node;
    node = end ? node.previousElementSibling : node.nextElementSibling
  ) {
    const row = node.matches("[data-diff-index]")
      ? (node as HTMLElement)
      : node.querySelector<HTMLElement>("[data-diff-index]");
    if (row) return row;
  }
  return null;
}

/** 元素端点可能落在行间，按范围方向取相邻真实行，不读取装饰文本推断身份。 */
function endpointRow(node: Node, offset: number, end: boolean): HTMLElement | null {
  const direct = diffRow(node);
  if (direct) return direct;
  const bar = (node instanceof Element ? node : node.parentElement)?.closest(".project-diff-fold");
  if (bar) return adjacentRow(bar, end);
  const child = node.childNodes[end ? offset - 1 : offset];
  if (!(child instanceof Element)) return null;
  if (child.classList.contains("project-diff-fold")) return adjacentRow(child, end);
  const rows = child.querySelectorAll<HTMLElement>("[data-diff-index]");
  return diffRow(child) ?? rows[end ? rows.length - 1 : 0] ?? null;
}

function selectedDiff(
  root: HTMLElement,
  rows: readonly ProjectDiffRow[],
  segments: readonly DiffSegment[],
): DiffSelection | undefined {
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
  // 隐藏的行不在 DOM 中，切片会把它们带进复制内容和提示词，所以选区不能跨过灰条。
  const low = Math.min(firstIndex, lastIndex);
  const high = Math.max(firstIndex, lastIndex);
  if (segments.some((segment) => segment.kind === "fold" && low < segment.start && high >= segment.start + segment.count))
    throw new Error(SELECT_ACROSS_FOLD);
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
  const registry = useContext(LocalCommentMarkers);
  const reveal = useContext(LocalCommentReveal);
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

  const fold = props.fold;
  const expanded = fold?.expanded;
  const onExpand = fold?.onExpand;
  /** 评论定位请求指向本文件时的目标行；身份、基线或路径不一致时不 pin，定位照常报告不可定位。 */
  const revealRow = useMemo(
    () => diffAnchorRow(reveal.request?.sourceAnchor, props, identity),
    [reveal.request, props.path, props.previousPath, props.base, identity],
  );
  /** 含评论标记的行和正在定位的行必须可见，所在的段不折叠。 */
  const pinned = useMemo(() => {
    if (!fold) return NO_ROWS;
    const set = new Set<number>();
    for (const entry of registry.entries) {
      const row = diffAnchorRow(entry.sourceAnchor, props, identity);
      if (row !== undefined) set.add(row);
    }
    if (revealRow !== undefined) set.add(revealRow);
    return set;
  }, [!!fold, registry.entries, revealRow, props.path, props.previousPath, props.base, identity]);
  const segments = useMemo<readonly DiffSegment[]>(
    () => (expanded ? foldProjectDiff(rows, expanded, pinned) : [{ kind: "rows", rows }]),
    [rows, expanded, pinned],
  );
  const items = useMemo(
    () => flattenDiff(segments, props.mode === "split", indices),
    [segments, props.mode, indices],
  );

  // 定位到折叠段内的行：先展开这一段，否则请求清除后又会收起，评论弹窗的 trigger 随之失效。
  useLayoutEffect(() => {
    if (!onExpand || revealRow === undefined) return;
    const hit = foldProjectDiff(rows, NO_ROWS, NO_ROWS).find(
      (segment) => segment.kind === "fold" && revealRow >= segment.start && revealRow < segment.start + segment.count,
    );
    if (hit?.kind === "fold") onExpand(hit.start);
  }, [rows, revealRow, onExpand]);

  // 从下方收起条收起时，上方内容消失，让灰条留在点击时的视口位置，焦点落到灰条。
  const pendingCollapse = useRef<{ start: number; top: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const pending = pendingCollapse.current;
    if (!pending) return;
    pendingCollapse.current = undefined;
    const bar = root.current?.querySelector<HTMLElement>(
      `button[data-fold-start="${pending.start}"][data-fold-edge="top"]`,
    );
    if (!bar) return;
    bar.focus({ preventScroll: true });
    const delta = bar.getBoundingClientRect().top - pending.top;
    const scroller = root.current?.closest<HTMLElement>(".code-review-changes-scroll");
    if (scroller && delta) scroller.scrollTop += delta;
  }, [items]);

  function activateBar(item: BarItem, source: HTMLElement) {
    if (!fold) return;
    // 右侧窗格的 div 点击后，焦点移到左侧对应的按钮。
    const anchor = () => root.current?.querySelector<HTMLElement>(
      `button[data-fold-start="${item.start}"][data-fold-edge="top"]`,
    );
    if (!item.open) {
      fold.onExpand(item.start);
      anchor()?.focus({ preventScroll: true });
      return;
    }
    if (item.edge === "bottom")
      pendingCollapse.current = { start: item.start, top: source.getBoundingClientRect().top };
    fold.onCollapse(item.start);
    if (item.edge === "top") anchor()?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    setMenu(undefined);
    setError("");
  }, [props.mode, props.diff, props.path, props.base, props.previousPath, expanded, !!fold]);

  function openMenu(target: HTMLElement, point?: { x: number; y: number }, whole = false) {
    const element = root.current;
    if (!element) return;
    setMenu(undefined);
    setError("");
    try {
      const row = diffRow(target);
      const selected = whole ? undefined : selectedDiff(element, props.diff.rows, segments);
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
        <SplitDiff items={items} props={props} indices={indices} onActivate={activateBar} />
      ) : (
        <UnifiedDiff items={items} indices={indices} onActivate={activateBar} />
      )}
      <LocalSourceMarkers root={root} path={props.path} previousPath={props.previousPath} view="diff" identity={identity} base={props.base} />
      {menu && <ContextActionsMenu
        x={menu.x} y={menu.y} copyText={menu.copyText} context={menu.context} selectedLineCount={menu.selectedLineCount}
        trigger={menu.trigger} sourceAnchor={menu.sourceAnchor} allowAppend onClose={() => setMenu(undefined)}
      />}
    </div>
  );
}

/** 评论来源指向本文件差异的某一行时返回该行索引；条件与 resolveLocalCommentTarget 一致。 */
function diffAnchorRow(
  anchor: CommentSourceAnchor | undefined,
  props: Pick<Props, "path" | "previousPath" | "base">,
  identity: string,
): number | undefined {
  if (anchor?.kind !== "local" || anchor.view !== "diff" || !sameProjectPath(anchor.path, props.path) ||
      anchor.identity !== identity || anchor.base !== props.base || anchor.previousPath !== props.previousPath)
    return;
  return anchor.row;
}
