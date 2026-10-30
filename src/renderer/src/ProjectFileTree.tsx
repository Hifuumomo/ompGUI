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
    element?.scrollIntoView?.({ block: "nearest" });
    element?.classList.remove("project-tree-reveal");
    // 强制重新启动动画，让连续点击同一个目录也能得到定位反馈。
    if (element) void element.offsetWidth;
    element?.classList.add("project-tree-reveal");
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
        <span className="project-tree-chevron" aria-hidden="true">
          {expanded ? "⌄" : "›"}
        </span>
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
