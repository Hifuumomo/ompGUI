import {
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { messageFileHref } from "../../shared/message-file-link";
import { FileContextMenu, type FileMenuTarget } from "./FileContextMenu";
import { PromptContexts } from "./PromptContexts";
import { validatePromptContext, type PromptContext } from "../../shared/prompt-context";
import type {
  ProjectChanges,
  ProjectEntry,
  ProjectReview,
} from "../../shared/project-browser";

interface Options {
  readonly root: string;
  readonly browser: ProjectReview;
  readonly changes: ProjectChanges;
  readonly revision: number;
  /**
   * 任一项变化都会关闭菜单并使未完成的路径解析失效（选中项、标签页、来源等）。
   * 数组长度必须在组件生命周期内保持不变。
   */
  readonly resetOn: readonly unknown[];
}

/**
 * 文件页与变更页共用的文件右键菜单：核实字面路径后打开 FileContextMenu，
 * 并提供绑定当前菜单请求的「添加 Git diff 到提示词」。
 * @param options [in] 工作目录、变更数据、刷新版本及重置依赖。
 * @returns openMenu 供树行与区块标题行调用；menuNode 需由调用方渲染；menuError 为可见的解析错误。
 */
export function useProjectFileMenu({ root, browser, changes, revision, resetOn }: Options) {
  const actions = useContext(PromptContexts);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    closeMenu,
    root,
    browser,
    revision,
    changes.files,
    changes.root,
    changes.base,
    actions,
    ...resetOn,
  ]);

  /**
   * 核实字面文件路径后打开共用菜单；仅最新请求允许更新界面。
   * @param entry [in] 文件树或区块标题行中的文件目标。
   * @param x [in] 菜单视口横坐标。
   * @param y [in] 菜单视口纵坐标。
   * @param source [in] 关闭菜单后恢复焦点的按钮。
   * @returns 无。
   */
  async function openMenu(entry: ProjectEntry, x: number, y: number, source: HTMLButtonElement) {
    closeMenu();
    menuSource.current = source;
    setMenuError("");
    const request = menuRequest.current;
    const href = messageFileHref(entry.path);
    try {
      const changed = changes.files.find((file) => file.path === entry.path);
      const resolved = changed?.change === "deleted"
        ? await window.desktop.resolveProjectFileLink(href, root, true)
        : await window.desktop.resolveProjectFileLink(href, root);
      if (request === menuRequest.current)
        setMenu({ href, entry: resolved, x, y });
    } catch (error) {
      if (request === menuRequest.current)
        setMenuError(error instanceof Error ? error.message : String(error));
    }
  }

  const changedFile = menu && changes.kind === "git"
    ? changes.files.find((file) => file.path === menu.entry.path)
    : undefined;

  /** 差异读取绑定当前菜单请求；切文件、刷新或切会话后不追加迟到结果。 */
  async function addDiff() {
    if (!menu || !changedFile || !actions) throw new Error("当前无法添加差异");
    const request = menuRequest.current;
    const diff = await browser.readProjectDiff({
      cwd: changes.root, base: changes.base, file: changedFile,
    });
    if (request !== menuRequest.current) throw new Error("引用已失效，请重新选择");
    if (!diff.rows.some((row) => row.kind === "addition" || row.kind === "deletion"))
      throw new Error("该文件没有文本差异可添加");
    const context: PromptContext = {
      kind: "diff", path: changedFile.path, previousPath: changedFile.previousPath,
      base: changes.base, side: "unified", rows: diff.rows,
    };
    try { validatePromptContext(context); }
    catch { throw new Error("差异过长，请在差异视图选择部分行"); }
    actions.append(context);
  }

  const menuNode: ReactNode = menu
    ? createPortal(
        <FileContextMenu
          key={`${root}:${menu.href}:${menuRequest.current}`}
          target={menu}
          cwd={root}
          onClose={closeMenu}
          onComment={actions && menu.entry.kind === "file" ? async () => {
            actions.comment({ kind: "file", path: menu.entry.path, text: "", representation: "reference" }, { x: menu.x, y: menu.y }, menuSource.current,
              { kind: "local", view: "path", path: menu.entry.path });
          } : undefined}
          onAddDiff={actions && changedFile && menu.entry.kind === "file" ? addDiff : undefined}
        />,
        document.body,
      )
    : null;

  return { openMenu, closeMenu, menuError, menuNode };
}
