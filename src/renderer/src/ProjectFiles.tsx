import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { messageFileHref } from "../../shared/message-file-link";
import { FileContextMenu, type FileMenuTarget } from "./FileContextMenu";
import { PromptContexts } from "./PromptContexts";
import { validatePromptContext, type PromptContext } from "../../shared/prompt-context";
import type {
  ProjectBrowser,
  ProjectChanges,
  ProjectEntry,
  ProjectReview,
} from "../../shared/project-browser";
import { changesTree, treePath } from "./project-tree-model";
import {
  DirectoryTree,
  TreeNodes,
  type ProjectTreeContext,
} from "./ProjectFileTree";
import "./project-file-tree.css";
import type { ReviewScope } from "./CodeReviewPanel";
import { ReviewIconButton } from "./ReviewIconButton";
import { LocalSourceMarkers } from "./LocalCommentMarkers";
import type { LocalCommentRevealRequest } from "./local-comment-reveal";

interface Props {
  readonly root: string;
  readonly browser: ProjectBrowser & ProjectReview;
  readonly changes: ProjectChanges;
  readonly revision: number;
  readonly selected?: string;
  readonly onSelect: (entry: ProjectEntry) => void;
  readonly requestedDirectory?: ProjectEntry;
  readonly scope: ReviewScope;
  readonly onScopeChange: (scope: ReviewScope) => void;
  readonly commentReveal?: LocalCommentRevealRequest;
}

function useTree(props: Props) {
  const all = props.scope !== "changed";
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [rootOpen, setRootOpen] = useState(true);
  // 每次消息目录请求均重新展开目标；会话工作目录仍由外层保持。
  useEffect(() => {
    if (!props.requestedDirectory) return;
    setQuery("");
    setRootOpen(true);
    setExpanded(new Set([treePath(props.requestedDirectory.path)]));
  }, [props.requestedDirectory]);
  // 消息文件定位与范围切换时展开祖先目录，使内容区的选中项在树中可见。
  useLayoutEffect(() => {
    setQuery("");
    setRootOpen(true);
    if (!props.selected) return;
    const ancestors: string[] = [];
    let path = treePath(props.selected);
    while (path.includes("/")) {
      path = path.slice(0, path.lastIndexOf("/"));
      ancestors.push(path);
    }
    setExpanded((old) => new Set([...old, ...ancestors]));
    setCollapsed(
      (old) => new Set([...old].filter((path) => !ancestors.includes(path))),
    );
  }, [props.selected, props.scope, props.commentReveal]);
  const nodes = useMemo(
    () =>
      changesTree(
        props.root,
        props.changes.files.filter((file) =>
          file.path.toLowerCase().includes(query.toLowerCase()),
        ),
      ),
    [props.root, props.changes.files, query],
  );
  function onToggle(path: string, open: boolean) {
    const key = treePath(path);
    (all ? setExpanded : setCollapsed)((current) => {
      const remove = all ? open : !open;
      return new Set(
        remove
          ? [...current].filter((item) => item !== key)
          : [...current, key],
      );
    });
  }
  const context: ProjectTreeContext = {
    ...props,
    files: props.changes.files,
    collapsed,
    expanded,
    onToggle,
    reveal: props.requestedDirectory,
  };
  return {
    all,
    query,
    setQuery,
    rootOpen,
    setRootOpen,
    nodes,
    context,
  };
}

/**
 * 渲染项目文件树并复用经过主进程路径核实的文件操作菜单。
 * @param props [in] 项目根目录、文件数据、显示范围及选择回调。
 * @returns 文件侧栏、可见的菜单解析错误及不受侧栏裁切的菜单。
 */
export function ProjectFiles(props: Props) {
  const tree = useTree(props);
  const root = useRef<HTMLElement>(null);
  const actions = useContext(PromptContexts);
  const label = tree.all ? "项目文件" : "已更改的文件";
  const [menu, setMenu] = useState<FileMenuTarget>();
  const [menuError, setMenuError] = useState("");
  const menuRequest = useRef(0);
  const menuSource = useRef<HTMLButtonElement | undefined>(undefined);
  /** 关闭菜单并使未完成的路径解析失效。参数：无。返回值：无。 */
  const closeMenu = useCallback(() => {
    menuRequest.current++;
    setMenu(undefined);
    if (document.activeElement?.closest(".file-context-menu"))
      menuSource.current?.focus({ preventScroll: true });
  }, []);

  // 工作目录、目标或树内容切换后，不得保留旧目标或迟到的解析结果。
  useLayoutEffect(() => {
    closeMenu();
    setMenuError("");
    return () => {
      menuRequest.current++;
    };
  }, [
    closeMenu,
    props.root,
    props.browser,
    props.selected,
    props.scope,
    props.requestedDirectory,
    props.revision,
    props.changes.files,
    props.changes.root,
    props.changes.base,
    actions,
    tree.query,
    tree.rootOpen,
  ]);

  /**
   * 核实字面文件路径后打开共用菜单；仅最新请求允许更新界面。
   * @param entry [in] 文件树中的文件目标。
   * @param x [in] 菜单视口横坐标。
   * @param y [in] 菜单视口纵坐标。
   * @param source [in] 关闭菜单后恢复焦点的文件按钮。
   * @returns 无。
   */
  async function openMenu(entry: ProjectEntry, x: number, y: number, source: HTMLButtonElement) {
    closeMenu();
    menuSource.current = source;
    setMenuError("");
    const request = menuRequest.current;
    const href = messageFileHref(entry.path);
    try {
      const changed = props.changes.files.find((file) => file.path === entry.path);
      const resolved = changed?.change === "deleted"
        ? await window.desktop.resolveProjectFileLink(href, props.root, true)
        : await window.desktop.resolveProjectFileLink(href, props.root);
      if (request === menuRequest.current)
        setMenu({ href, entry: resolved, x, y });
    } catch (error) {
      if (request === menuRequest.current)
        setMenuError(error instanceof Error ? error.message : String(error));
    }
  }
  const context: ProjectTreeContext = {
    ...tree.context,
    onFileMenu: openMenu,
  };
  const changedFile = menu && props.changes.kind === "git"
    ? props.changes.files.find((file) => file.path === menu.entry.path)
    : undefined;

  /** 差异读取绑定当前菜单请求；切文件、刷新或切会话后不追加迟到结果。 */
  async function addDiff() {
    if (!menu || !changedFile || !actions) throw new Error("当前无法添加差异");
    const request = menuRequest.current;
    const diff = await props.browser.readProjectDiff({
      cwd: props.changes.root, base: props.changes.base, file: changedFile,
    });
    if (request !== menuRequest.current) throw new Error("引用已失效，请重新选择");
    if (!diff.rows.some((row) => row.kind === "addition" || row.kind === "deletion"))
      throw new Error("该文件没有文本差异可添加");
    const context: PromptContext = {
      kind: "diff", path: changedFile.path, previousPath: changedFile.previousPath,
      base: props.changes.base, side: "unified", rows: diff.rows,
    };
    try { validatePromptContext(context); }
    catch { throw new Error("差异过长，请在差异视图选择部分行"); }
    actions.append(context);
  }
  return (
    <aside ref={root} className="project-files" aria-label="项目文件浏览">
      <div
        className="project-tree-modes"
        role="group"
        aria-label="文件显示范围"
      >
        <ReviewIconButton
          icon="files"
          aria-label="全部文件"
          tooltip="全部文件"
          aria-pressed={props.scope === "all"}
          onClick={() => props.onScopeChange("all")}
        />
        {props.changes.kind === "git" && (
          <ReviewIconButton
            icon="changes"
            aria-label="已更改"
            tooltip={`已更改（${props.changes.files.length} 个文件）`}
            aria-pressed={props.scope === "changed"}
            onClick={() => props.onScopeChange("changed")}
          >
            <span className="project-tree-count" aria-hidden="true">
              {props.changes.files.length}
            </span>
          </ReviewIconButton>
        )}
        {props.requestedDirectory && (
          <ReviewIconButton
            icon="directory"
            aria-label="指定目录"
            tooltip="指定目录"
            aria-pressed={props.scope === "directory"}
            onClick={() => props.onScopeChange("directory")}
          />
        )}
      </div>
      {!tree.all && (
        <input
          aria-label="筛选变更文件"
          placeholder="筛选文件…"
          value={tree.query}
          onChange={(event) => tree.setQuery(event.target.value)}
        />
      )}
      {props.changes.kind === "plain" && (
        <p className="project-tree-notice">非 Git 项目，无 Git 差异</p>
      )}
      <nav aria-label="项目文件列表">
        <button
          className="project-tree-root"
          aria-expanded={tree.rootOpen}
          onClick={() => tree.setRootOpen(!tree.rootOpen)}
        >
          <span aria-hidden="true">{tree.rootOpen ? "⌄" : "›"}</span>
          {props.scope === "directory" && props.requestedDirectory
            ? props.requestedDirectory.path
            : label}
        </button>
        {tree.rootOpen &&
          (tree.all ? (
            props.scope === "directory" && props.requestedDirectory ? (
              <TreeNodes
                nodes={[{ entry: props.requestedDirectory }]}
                context={context}
                depth={0}
              />
            ) : (
              <DirectoryTree
                path={props.root}
                context={context}
                depth={0}
              />
            )
          ) : (
            <TreeNodes nodes={tree.nodes} context={context} depth={0} />
          ))}
        {!tree.all && !tree.nodes.length && (
          <p>{tree.query ? "没有匹配的变更文件" : "工作区没有未提交变更"}</p>
        )}
      </nav>
      <LocalSourceMarkers root={root} view="path" />
      {menuError && <p role="alert">{menuError}</p>}
      {menu && createPortal(
        <FileContextMenu
          key={`${props.root}:${menu.href}:${menuRequest.current}`}
          target={menu}
          cwd={props.root}
          onClose={closeMenu}
          onComment={actions && menu.entry.kind === "file" ? async () => {
            actions.comment({ kind: "file", path: menu.entry.path, text: "", representation: "reference" }, { x: menu.x, y: menu.y }, menuSource.current,
              { kind: "local", view: "path", path: menu.entry.path });
          } : undefined}
          onAddDiff={actions && changedFile && menu.entry.kind === "file" ? addDiff : undefined}
        />,
        document.body,
      )}
    </aside>
  );
}
