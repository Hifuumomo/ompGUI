import { useEffect, useRef, type CSSProperties } from "react";
import type {
  ProjectBrowser,
  ProjectEntry,
} from "../../shared/project-browser";
import { ProjectFileIcon, ProjectChangeIcon } from "./ProjectFileIcon";
import {
  decorateEntry,
  directoryChanged,
  treePath,
  type ProjectTreeNode,
} from "./project-tree-model";
import { useProjectResource } from "./useProjectResource";
import { TreeChevron } from "./TreeChevron";

export interface ProjectTreeContext {
  readonly browser: ProjectBrowser;
  readonly revision: number;
  readonly files: readonly ProjectEntry[];
  readonly selected?: string;
  readonly collapsed: ReadonlySet<string>;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string, open: boolean) => void;
  readonly onSelect: (entry: ProjectEntry) => void;
  readonly reveal?: ProjectEntry;
  readonly onFileMenu?: (
    entry: ProjectEntry,
    x: number,
    y: number,
    source: HTMLButtonElement,
  ) => void;
}
interface NodeProps {
  readonly node: ProjectTreeNode;
  readonly context: ProjectTreeContext;
  readonly depth: number;
}

interface TreeButtonProps {
  readonly props: NodeProps;
  readonly expanded: boolean;
}
/**
 * 渲染目录展开按钮或支持文件菜单的文件行。
 * @param props [in] 节点、树上下文及层级。
 * @param expanded [in] 当前目录是否展开。
 * @returns 可选择、定位与通过鼠标或键盘操作的文件树按钮。
 */
function TreeButton({ props, expanded }: TreeButtonProps) {
  const { node, context, depth } = props;
  const entry = decorateEntry(node.entry, context.files);
  const directory = entry.kind === "directory";
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (
      !context.reveal ||
      treePath(context.reveal.path) !== treePath(entry.path)
    )
      return;
    const element = button.current;
    if (!element) return;
    element.classList.remove("project-tree-reveal");
    // 强制重新启动动画，让连续点击同一个目录也能得到定位反馈。
    void element.offsetWidth;
    element.classList.add("project-tree-reveal");
    if (!element.scrollIntoView) return;
    // 目录在挂载后才异步读取：本行出现时，上方已展开的兄弟目录可能仍在加载，
    // 它们之后撑开的高度会把本行顶出视野。因此在布局稳定前逐帧校正位置，
    // 用户自己滚动、按键或点击后立即停止，最长校正 2 秒。
    const scroller = element.closest("nav");
    const offset = () =>
      element.getBoundingClientRect().top -
      (scroller?.getBoundingClientRect().top ?? 0) +
      (scroller?.scrollTop ?? 0);
    const deadline = performance.now() + 2000;
    const interrupts = ["wheel", "pointerdown", "keydown"] as const;
    let frame = 0;
    let last = Number.NaN;
    let steady = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      for (const type of interrupts) window.removeEventListener(type, stop, true);
    };
    const tick = () => {
      if (!element.isConnected) return stop();
      // 尽量把目标行滚到目录栏正中；靠近列表两端时受滚动范围限制，只能尽量接近。
      element.scrollIntoView({ block: "center" });
      const now = offset();
      steady = now === last ? steady + 1 : 0;
      last = now;
      if (steady >= 8 || performance.now() > deadline) return stop();
      frame = requestAnimationFrame(tick);
    };
    for (const type of interrupts)
      window.addEventListener(type, stop, { capture: true, passive: true });
    tick();
    return stop;
  }, [context.reveal, entry.path]);
  return (
    <button
      ref={button}
      className={`project-tree-row ${entry.change ?? ""}`}
      data-project-path={entry.path}
      style={{ "--tree-depth": depth } as CSSProperties}
      title={
        entry.previousPath
          ? `${entry.previousPath} → ${entry.path}`
          : entry.path
      }
      aria-label={`${directory ? "展开或折叠目录" : "查看文件"} ${entry.name}`}
      aria-expanded={directory ? expanded : undefined}
      aria-current={
        treePath(context.selected ?? "") === treePath(entry.path)
          ? "true"
          : undefined
      }
      disabled={entry.kind === "other"}
      onClick={() =>
        directory
          ? context.onToggle(entry.path, expanded)
          : context.onSelect(entry)
      }
      onContextMenu={(event) => {
        if (entry.kind !== "file" || !context.onFileMenu) return;
        event.preventDefault();
        context.onFileMenu(entry, event.clientX, event.clientY, event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (
          entry.kind !== "file" ||
          !context.onFileMenu ||
          !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
        )
          return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        context.onFileMenu(entry, bounds.left, bounds.bottom, event.currentTarget);
      }}
    >
      {directory ? (
        <TreeChevron open={expanded} />
      ) : (
        <ProjectFileIcon path={entry.path} />
      )}
      <span className="project-tree-name">{entry.name}</span>
      {directory ? (
        directoryChanged(entry.path, context.files) && (
          <span className="project-folder-dot" aria-label="包含变更" />
        )
      ) : (
        <ProjectChangeIcon change={entry.change} />
      )}
    </button>
  );
}

function TreeNode(props: NodeProps) {
  const { node, context, depth } = props;
  const path = treePath(node.entry.path);
  const expanded = node.children
    ? !context.collapsed.has(path)
    : context.expanded.has(path);
  return (
    <li>
      <TreeButton props={props} expanded={expanded} />
      {node.entry.kind === "directory" &&
        expanded &&
        (node.children ? (
          <TreeNodes
            nodes={node.children}
            context={context}
            depth={depth + 1}
          />
        ) : (
          <DirectoryTree
            path={node.entry.path}
            context={context}
            depth={depth + 1}
          />
        ))}
    </li>
  );
}

export function TreeNodes({
  nodes,
  context,
  depth,
}: {
  readonly nodes: readonly ProjectTreeNode[];
  readonly context: ProjectTreeContext;
  readonly depth: number;
}) {
  return (
    <ul>
      {nodes.map((node) => (
        <TreeNode
          key={node.entry.path}
          node={node}
          context={context}
          depth={depth}
        />
      ))}
    </ul>
  );
}

export function DirectoryTree({
  path,
  context,
  depth,
}: {
  readonly path: string;
  readonly context: ProjectTreeContext;
  readonly depth: number;
}) {
  const resource = useProjectResource(
    context.browser.listProjectDirectory,
    path,
    context.revision,
  );
  if (resource.status === "loading") return <p role="status">正在读取目录…</p>;
  if (resource.status === "error") return <p role="alert">{resource.error}</p>;
  return (
    <TreeNodes
      nodes={resource.value.map((entry) => ({ entry }))}
      context={context}
      depth={depth}
    />
  );
}
