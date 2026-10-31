import { useCallback, type KeyboardEvent, type MouseEvent } from "react";
import type { ProjectDiff, ProjectEntry } from "../../shared/project-browser";
import { projectImageType } from "../../shared/project-browser";
import { ProjectDiffView } from "./ProjectDiffView";
import { ProjectFileIcon } from "./ProjectFileIcon";
import { ReviewIconButton } from "./ReviewIconButton";
import { SourceError } from "./ProjectSource";
import { TreeChevron } from "./TreeChevron";

export type DiffLayout = "split" | "unified";

/** 单个文件差异的读取状态；未请求时不存在对应记录。 */
export type DiffResource =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: ProjectDiff }
  | { readonly status: "error"; readonly error: string };

interface Props {
  readonly entry: ProjectEntry;
  readonly base: string | null;
  readonly collapsed: boolean;
  /** 页面调度器提供的读取状态；undefined 表示尚未进入读取范围。 */
  readonly resource?: DiffResource;
  readonly layout: DiffLayout;
  readonly wrap: boolean;
  /** 评论定位的目标区块，供定位检查识别其中的错误。 */
  readonly revealTarget: boolean;
  readonly onToggle: (path: string) => void;
  readonly onOpenInFiles: (entry: ProjectEntry) => void;
  readonly onMenu: (
    entry: ProjectEntry,
    x: number,
    y: number,
    source: HTMLButtonElement,
  ) => void;
  /** 登记区块元素，供页面的可见性观察器与滚动定位使用。 */
  readonly register: (path: string, element: HTMLElement | null) => void;
}

const MORE_ICON = (
  <>
    <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />
  </>
);

/** 标题行右侧的行数：读取失败或不显示文本差异的文件以 — 表示。 */
function ChangeStats({
  resource,
  unavailable,
}: {
  readonly resource?: DiffResource;
  readonly unavailable: boolean;
}) {
  if (unavailable || resource?.status === "error")
    return (
      <span className="change-stats" aria-label="行数不可用">
        —
      </span>
    );
  if (resource?.status !== "ready") return null;
  const added = resource.value.rows.filter((row) => row.kind === "addition").length;
  const deleted = resource.value.rows.filter((row) => row.kind === "deletion").length;
  return (
    <span className="change-stats">
      <span className="change-stat-added">+{added}</span>
      <span className="change-stat-deleted">−{deleted}</span>
    </span>
  );
}

/**
 * 变更页中单个文件的连续 Diff 区块：吸顶标题行 + 可折叠的差异内容。
 * 占位和未加载状态不使用 role="status"，否则评论定位检查会一直等待。
 * @param props [in] 文件条目、读取状态、折叠状态与操作回调。
 * @returns 一个文件区块。
 */
export function ChangeFileSection(props: Props) {
  const { entry, collapsed, resource, register } = props;
  const deleted = entry.change === "deleted";
  const image = !!projectImageType(entry.path);
  const ref = useCallback(
    (element: HTMLElement | null) => register(entry.path, element),
    [register, entry.path],
  );
  const title = entry.previousPath
    ? `${entry.previousPath} → ${entry.path}`
    : entry.path;

  function body() {
    if (image)
      return <p className="change-section-note">图片文件，不显示文本差异</p>;
    if (!resource)
      return <div className="change-section-placeholder" aria-hidden="true" />;
    if (resource.status === "loading")
      return <p role="status">正在读取差异…</p>;
    if (resource.status === "error")
      return <SourceError message={resource.error} />;
    return (
      <ProjectDiffView
        diff={resource.value}
        path={entry.path}
        previousPath={entry.previousPath}
        mode={props.layout}
        wrap={props.wrap}
        base={props.base}
      />
    );
  }

  function onContextMenu(event: MouseEvent<HTMLElement>) {
    const source = event.currentTarget.querySelector<HTMLButtonElement>(
      ".change-section-toggle",
    );
    if (!source) return;
    event.preventDefault();
    props.onMenu(entry, event.clientX, event.clientY, source);
  }

  function onToggleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")))
      return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    props.onMenu(entry, bounds.left, bounds.bottom, event.currentTarget);
  }

  return (
    <section
      ref={ref}
      className="change-section"
      aria-label={`文件变更 ${entry.name}`}
      data-change-path={entry.path}
      data-collapsed={collapsed}
      data-reveal-target={props.revealTarget || undefined}
    >
      <div className="change-section-header" onContextMenu={onContextMenu}>
        <button
          type="button"
          className={`change-section-toggle ${entry.change ?? ""}`}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "展开" : "折叠"}文件差异 ${entry.name}`}
          title={title}
          onClick={() => props.onToggle(entry.path)}
          onKeyDown={onToggleKeyDown}
        >
          <TreeChevron open={!collapsed} />
          <ProjectFileIcon path={entry.path} />
          <span className="change-section-name">{entry.name}</span>
          <ChangeStats resource={resource} unavailable={image} />
        </button>
        {!deleted && (
          <ReviewIconButton
            icon="external"
            aria-label={`在文件中打开 ${entry.name}`}
            tooltip="在文件中打开"
            onClick={() => props.onOpenInFiles(entry)}
          />
        )}
        <ReviewIconButton
          icon={MORE_ICON}
          aria-label={`文件菜单 ${entry.name}`}
          tooltip="文件菜单"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            props.onMenu(entry, bounds.left, bounds.bottom, event.currentTarget);
          }}
        />
      </div>
      {!collapsed && body()}
    </section>
  );
}
