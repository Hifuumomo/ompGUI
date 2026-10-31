import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectBrowser,
  ProjectChanges,
  ProjectEntry,
  ProjectReview,
} from "../../shared/project-browser";
import { treeAncestors, treePath } from "./project-tree-model";
import {
  DirectoryTree,
  TreeNodes,
  type ProjectTreeContext,
} from "./ProjectFileTree";
import "./project-file-tree.css";
import { TreeChevron } from "./TreeChevron";
import { LocalSourceMarkers } from "./LocalCommentMarkers";
import type { LocalCommentRevealRequest } from "./local-comment-reveal";
import { useProjectFileMenu } from "./useProjectFileMenu";

interface Props {
  readonly root: string;
  readonly browser: ProjectBrowser & ProjectReview;
  /** 仅用于改动标记与菜单项；变更未返回时传空列表，目录照常显示。 */
  readonly changes: ProjectChanges;
  readonly revision: number;
  readonly selected?: string;
  readonly onSelect: (entry: ProjectEntry) => void;
  readonly requestedDirectory?: ProjectEntry;
  /** 为 true 时只显示 requestedDirectory 的子树，并提供退回项目文件的入口。 */
  readonly directoryView?: boolean;
  readonly onExitDirectory?: () => void;
  readonly commentReveal?: LocalCommentRevealRequest;
  /** 页面隐藏时不渲染路径标记，避免两棵树重复定位同一评论。默认 true。 */
  readonly active?: boolean;
}

/** 文件页的目录始终按需展开，不使用变更树的“默认展开、记录折叠”语义。 */
const NO_COLLAPSED: ReadonlySet<string> = new Set();

function useTree(props: Props) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [rootOpen, setRootOpen] = useState(true);
  // 每次消息目录请求均重新展开目标；会话工作目录仍由外层保持。
  useEffect(() => {
    if (!props.requestedDirectory) return;
    setRootOpen(true);
    setExpanded(new Set([treePath(props.requestedDirectory.path)]));
  }, [props.requestedDirectory]);
  // 消息文件定位时展开祖先目录，使内容区的选中项在树中可见。
  useLayoutEffect(() => {
    setRootOpen(true);
    if (!props.selected) return;
    const ancestors = treeAncestors(props.selected);
    setExpanded((old) => new Set([...old, ...ancestors]));
  }, [props.selected, props.commentReveal]);
  function onToggle(path: string, open: boolean) {
    const key = treePath(path);
    setExpanded((current) =>
      new Set(
        open
          ? [...current].filter((item) => item !== key)
          : [...current, key],
      ),
    );
  }
  const context: ProjectTreeContext = useMemo(
    () => ({
      browser: props.browser,
      revision: props.revision,
      files: props.changes.files,
      selected: props.selected,
      collapsed: NO_COLLAPSED,
      expanded,
      onToggle,
      onSelect: props.onSelect,
      reveal: props.requestedDirectory,
    }),
    // onToggle 只依赖 setExpanded，保持稳定即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      props.browser,
      props.revision,
      props.changes.files,
      props.selected,
      expanded,
      props.onSelect,
      props.requestedDirectory,
    ],
  );
  return { rootOpen, setRootOpen, context };
}

/**
 * 渲染项目文件树并复用经过主进程路径核实的文件操作菜单。
 * 只负责文件页：始终显示完整项目树，不依赖变更列表是否读取成功。
 * @param props [in] 项目根目录、改动标记数据、选中项及回调。
 * @returns 文件侧栏、可见的菜单解析错误及不受侧栏裁切的菜单。
 */
export function ProjectFiles(props: Props) {
  const active = props.active ?? true;
  const tree = useTree(props);
  const root = useRef<HTMLElement>(null);
  const directoryView = !!props.directoryView && !!props.requestedDirectory;
  const menu = useProjectFileMenu({
    root: props.root,
    browser: props.browser,
    changes: props.changes,
    revision: props.revision,
    resetOn: [props.selected, props.requestedDirectory, active, tree.rootOpen],
  });
  const context: ProjectTreeContext = {
    ...tree.context,
    onFileMenu: menu.openMenu,
  };
  return (
    <aside ref={root} className="project-files" aria-label="项目文件浏览">
      <nav aria-label="项目文件列表">
        {directoryView && props.requestedDirectory ? (
          <>
            <div className="project-tree-directory-notice">
              <span title={props.requestedDirectory.path}>
                指定目录 · {props.requestedDirectory.path}
              </span>
              <button
                type="button"
                aria-label="返回项目文件"
                title="返回项目文件"
                onClick={props.onExitDirectory}
              >
                ×
              </button>
            </div>
            <TreeNodes
              nodes={[{ entry: props.requestedDirectory }]}
              context={context}
              depth={0}
            />
          </>
        ) : (
          <>
            <button
              className="project-tree-root"
              aria-expanded={tree.rootOpen}
              title={props.root}
              onClick={() => tree.setRootOpen(!tree.rootOpen)}
            >
              <TreeChevron open={tree.rootOpen} />
              项目文件
            </button>
            {tree.rootOpen && (
              <DirectoryTree path={props.root} context={context} depth={0} />
            )}
          </>
        )}
      </nav>
      {active && <LocalSourceMarkers root={root} view="path" />}
      {menu.menuError && <p role="alert">{menu.menuError}</p>}
      {menu.menuNode}
    </aside>
  );
}
