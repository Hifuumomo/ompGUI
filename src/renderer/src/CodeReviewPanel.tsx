import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectBrowser,
  ProjectChanges,
  ProjectEntry,
  ProjectReview,
} from "../../shared/project-browser";
import { ProjectFiles } from "./ProjectFiles";
import { ProjectSource } from "./ProjectSource";
import { ProjectChangesPage } from "./ProjectChangesPage";
import type { DiffLayout } from "./ChangeFileSection";
import { ReviewTabs, type ReviewTab } from "./ReviewTabs";
import { reviewKeys, useReviewFocus } from "./code-review-focus";
import "./code-review.css";
import { useProjectChanges } from "./useProjectChanges";
import { ProjectFileIcon } from "./ProjectFileIcon";
import { sameProjectPath } from "../../shared/message-file-link";
import { projectPreviewKind } from "../../shared/project-browser";
import { ReviewIconButton } from "./ReviewIconButton";
import { PaneResizeHandle } from "./PaneResizeHandle";
import { LocalCommentReveal, type LocalCommentRevealRequest, type LocalCommentRevealResult } from "./local-comment-reveal";

export type { ReviewTab } from "./ReviewTabs";

interface Props {
  readonly cwd: string;
  readonly browser: ProjectBrowser & ProjectReview;
  readonly suspended: boolean;
  readonly onClose: () => void;
  readonly requestedFile?: ProjectEntry;
  readonly commentReveal?: LocalCommentRevealRequest;
  readonly onCommentReveal?: (result: LocalCommentRevealResult) => void;
}

/** 文件页的选中状态；变更页没有“选中文件”，当前文件由滚动位置派生。 */
interface ReviewSelection {
  readonly tab: ReviewTab;
  readonly filesFile?: ProjectEntry;
  readonly directory?: ProjectEntry;
  readonly directoryView: boolean;
}

const NO_FILES: readonly ProjectEntry[] = [];

function useReviewState(props: Props) {
  const [selection, setSelection] = useState<ReviewSelection>(() =>
    requestSelection(props.requestedFile, props.cwd),
  );
  const [revision, setRevision] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [filesVisible, setFilesVisible] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [preview, setPreview] = useState(true);
  const [pathOnly, setPathOnly] = useState(false);
  const [layout, setLayout] = useState<DiffLayout>("split");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // 变更页首次打开时才挂载，之后用 hidden 切换以保留树状态与滚动位置。
  const [opened, setOpened] = useState(false);
  const previousRequest = useRef(props.requestedFile);
  const [revealRequestId, setRevealRequestId] = useState<string | undefined>(undefined);
  function cancelReveal() {
    if (props.commentReveal && revealRequestId === props.commentReveal.requestId) {
      setRevealRequestId(undefined);
      props.onCommentReveal?.({ requestId: revealRequestId, status: "cancelled" });
    }
  }
  useLayoutEffect(() => {
    const request = props.commentReveal;
    if (!request) { setRevealRequestId(undefined); return; }
    const anchor = request.sourceAnchor;
    setPathOnly(anchor.view === "path");
    // Diff 与已删除文件的路径只能在变更页定位；文件页的选中项保持不动。
    const toChanges = anchor.view === "diff" ||
      (anchor.view === "path" && request.file.change === "deleted");
    if (toChanges) {
      setSelection((old) => ({ ...old, tab: "changes" }));
      setCollapsed((old) =>
        new Set([...old].filter((path) => !sameProjectPath(path, request.file.path))));
    } else {
      setSelection(requestSelection(request.file, props.cwd));
    }
    if (anchor.view === "diff") setLayout("split");
    if (anchor.view !== "path") setPreview(anchor.view === "preview");
    setFilesVisible(true);
    setRevealRequestId(request.requestId);
  }, [props.commentReveal, props.cwd]);
  // 消息点击切回当前源码；新的请求对象也允许重新打开同一路径并刷新内容。
  useEffect(() => {
    if (!props.requestedFile || props.requestedFile === previousRequest.current)
      return;
    previousRequest.current = props.requestedFile;
    cancelReveal();
    setPathOnly(false);
    setSelection(requestSelection(props.requestedFile, props.cwd));
    setFullscreen(false);
    setFilesVisible(true);
    setRevision((value) => value + 1);
  }, [props.requestedFile]);
  const changes = useProjectChanges(props.browser, props.cwd, revision);
  const entries = changes.status === "ready" ? changes.value.files : NO_FILES;
  // 非 Git 项目没有变更页，停在文件页。
  const plain = changes.status === "ready" && changes.value.kind === "plain";
  const tab: ReviewTab = plain ? "files" : selection.tab;
  useLayoutEffect(() => {
    if (tab === "changes") setOpened(true);
  }, [tab]);
  const file = selectedFile(entries, selection.filesFile);
  // 评论定位的 Diff 必须出现在当前变更列表里，并位于项目目录内。
  const request = props.commentReveal;
  const diffTarget = request && changes.status === "ready" && changes.value.kind === "git"
    ? entries.find((entry) => sameProjectPath(entry.path, request.file.path))
    : undefined;
  const canDiff = !!diffTarget && diffTarget.kind === "file" &&
    changes.status === "ready" && withinProject(diffTarget.path, changes.value.root);
  function navigate(update: (old: ReviewSelection) => ReviewSelection) {
    cancelReveal();
    setPathOnly(false);
    setSelection(update);
  }
  return {
    cancelReveal,
    pathOnly,
    revealRequestId,
    tab,
    plain,
    changesMounted: opened || tab === "changes",
    setTab(next: ReviewTab) {
      if (next === "changes" && plain) return;
      navigate((old) => ({ ...old, tab: next }));
    },
    directory: selection.directory,
    directoryView: selection.directoryView,
    exitDirectory() {
      navigate((old) => ({
        ...old,
        directoryView: false,
        filesFile:
          old.filesFile?.kind === "file" &&
          withinProject(old.filesFile.path, props.cwd) &&
          old.filesFile.change !== "deleted"
            ? old.filesFile
            : undefined,
      }));
    },
    canDiff,
    changes,
    file,
    setFile(next: ReviewSelection["filesFile"] & ProjectEntry) {
      navigate((old) => ({ ...old, filesFile: next }));
    },
    /** 变更页区块的“在文件中打开”：切到文件页并选中该文件。 */
    openInFiles(entry: ProjectEntry) {
      navigate((old) => ({ ...old, tab: "files", filesFile: entry, directoryView: false }));
    },
    layout,
    toggleLayout: () => setLayout((old) => (old === "split" ? "unified" : "split")),
    collapsed,
    toggleSection: (path: string) =>
      setCollapsed((old) => {
        const next = new Set(old);
        if (!next.delete(path)) next.add(path);
        return next;
      }),
    expandSection: (path: string) =>
      setCollapsed((old) => {
        if (!old.has(path)) return old;
        const next = new Set(old);
        next.delete(path);
        return next;
      }),
    setAllCollapsed: (paths: readonly string[], collapse: boolean) =>
      setCollapsed(collapse ? new Set(paths) : new Set()),
    revision,
    setRevision: (value: Parameters<typeof setRevision>[0]) => { cancelReveal(); setRevision(value); },
    fullscreen,
    setFullscreen,
    filesVisible,
    setFilesVisible,
    wrap,
    setWrap,
    preview,
    setPreview: (value: boolean) => { cancelReveal(); setPathOnly(false); setPreview(value); },
  };
}

/** 使用目录边界比较，避免把 project-other 当作 project 的子目录。 */
function withinProject(path: string, root: string) {
  const normalize = (value: string) => {
    const result = value.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-z]:/i.test(result) ? result.toLowerCase() : result;
  };
  return normalize(path).startsWith(`${normalize(root)}/`);
}

/** 入口映射：消息链接与打开面板一律落在文件页；目录和项目外文件进入指定目录视图。 */
function requestSelection(
  file: ProjectEntry | undefined,
  cwd: string,
): ReviewSelection {
  if (!file) return { tab: "files", directoryView: false };
  if (file.kind === "directory")
    return { tab: "files", filesFile: file, directory: file, directoryView: true };
  if (withinProject(file.path, cwd))
    return { tab: "files", filesFile: file, directoryView: false };
  const parent = file.path.replace(/\\/g, "/").replace(/[^/]+$/, "");
  const path = parent.replace(/\/+$/, "") || "/";
  const directoryPath = /^[a-z]:$/i.test(path) ? `${path}/` : path;
  return {
    tab: "files",
    filesFile: file,
    directory: {
      path: directoryPath,
      name: path.split("/").pop() || path,
      kind: "directory",
    },
    directoryView: true,
  };
}
type ReviewState = ReturnType<typeof useReviewState>;

function ReviewHeader({
  state: s,
  props,
  idPrefix,
}: {
  readonly state: ReviewState;
  readonly props: Props;
  readonly idPrefix: string;
}) {
  const ready = s.changes.status === "ready" ? s.changes.value : undefined;
  return (
    <header className="code-review-header">
      <ReviewTabs
        idPrefix={idPrefix}
        tab={s.tab}
        onChange={s.setTab}
        changeCount={ready?.kind === "git" ? ready.files.length : undefined}
        changesDisabled={s.plain}
        changesHint="非 Git 项目，无 Git 差异"
      />
      <ReviewIconButton
        icon={s.fullscreen ? "minimize" : "maximize"}
        aria-label={s.fullscreen ? "侧栏显示文件与变更" : "全屏显示文件与变更"}
        tooltip={s.fullscreen ? "退出全屏" : "全屏显示文件与变更"}
        onClick={() => s.setFullscreen(!s.fullscreen)}
      />
      <ReviewIconButton
        icon="close"
        aria-label="关闭文件与变更"
        tooltip="关闭文件与变更（Esc）"
        aria-keyshortcuts="Escape"
        onClick={() => { s.cancelReveal(); props.onClose(); }}
      />
    </header>
  );
}

/** 文件页：完整项目树 + 源码或渲染预览，不依赖变更列表是否读取成功。 */
function ReviewFilesPage({
  state: s,
  props,
}: {
  readonly state: ReviewState;
  readonly props: Props;
}) {
  // 变更未返回时目录照常显示，返回后再补改动标记。
  const fallback: ProjectChanges = useMemo(
    () => ({ kind: "plain", root: props.cwd, base: null, files: NO_FILES }),
    [props.cwd],
  );
  const changes = s.changes.status === "ready" ? s.changes.value : fallback;
  const file = s.file;
  const previewing = s.preview;
  return (
    <>
      <div className="code-review-toolbar">
        <ReviewIconButton
          icon={s.filesVisible ? "collapse" : "expand"}
          tooltip={s.filesVisible ? "收起项目文件栏" : "展开项目文件栏"}
          aria-label="显示项目文件"
          aria-pressed={s.filesVisible}
          onClick={() => s.setFilesVisible(!s.filesVisible)}
        />
        {file && <ProjectFileIcon path={file.path} />}
        <span title={file?.path}>{file?.name ?? "项目源码"}</span>
        {file && projectPreviewKind(file.path) && (
          <ReviewIconButton
            icon="preview"
            aria-label="渲染预览"
            tooltip={previewing ? "显示源码" : "显示渲染预览"}
            aria-pressed={previewing}
            onClick={() => s.setPreview(!previewing)}
          />
        )}
        <ReviewIconButton
          icon="wrap"
          aria-label="自动换行"
          tooltip={s.wrap ? "关闭自动换行" : "开启自动换行"}
          aria-pressed={s.wrap}
          onClick={() => s.setWrap(!s.wrap)}
        />
        <ReviewIconButton
          icon="refresh"
          tooltip="刷新目录与当前文件"
          aria-label="刷新项目代码"
          onClick={() => s.setRevision((value) => value + 1)}
        />
      </div>
      <div className="code-review-body">
        <div className="code-review-files" hidden={!s.filesVisible}>
          <PaneResizeHandle storageKey="omp-desktop.file-tree-width" label="调整文件目录宽度" edge="right" initialWidth={220} minWidth={120} reserve={180} />
          <ProjectFiles
            root={props.cwd}
            browser={props.browser}
            changes={changes}
            revision={s.revision}
            selected={s.file?.path}
            onSelect={s.setFile}
            requestedDirectory={s.directory}
            directoryView={s.directoryView}
            onExitDirectory={s.exitDirectory}
            commentReveal={props.commentReveal}
            active={s.tab === "files"}
          />
        </div>
        <section
          className="code-review-source"
          aria-label="项目源码"
          tabIndex={0}
        >
          {s.pathOnly ? null :
          file && file.kind === "file" ? (
            <ProjectSource
              file={file}
              browser={props.browser}
              changes={changes}
              mode="source"
              revision={s.revision}
              wrap={s.wrap}
              preview={s.preview}
            />
          ) : (
            <div className="code-review-empty">
              <strong>浏览项目代码</strong>
              <p>从左侧选择文件，查看源码与行号。</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function selectedFile(files: readonly ProjectEntry[], selected?: ProjectEntry) {
  if (!selected) return undefined;
  const { name, path, kind } = selected;
  // 提交或还原后不沿用旧的重命名路径、删除状态。
  return (
    files.find((entry) => sameProjectPath(entry.path, path)) ?? {
      name,
      path,
      kind,
    }
  );
}

export function CodeReviewPanel(props: Props) {
  // 项目根目录已由文件树承载，不再作为消息定位节点重复显示。
  if (
    props.requestedFile &&
    sameProjectPath(props.requestedFile.path, props.cwd)
  ) {
    props = { ...props, requestedFile: undefined };
  }
  const state = useReviewState(props);
  const root = useReviewFocus();
  const idPrefix = useId();
  const completed = useRef<string | undefined>(undefined);
  const latestRequest = useRef(props.commentReveal);
  latestRequest.current = props.commentReveal;
  const callback = useRef(props.onCommentReveal);
  callback.current = props.onCommentReveal;
  const complete = useCallback((result: LocalCommentRevealResult) => {
    if (latestRequest.current?.requestId !== result.requestId || completed.current === result.requestId) return;
    completed.current = result.requestId;
    callback.current?.(result);
  }, []);
  const request = props.commentReveal;
  const view = request?.sourceAnchor.view;
  // Diff 与已删除文件的路径落在变更页，其余落在文件页。
  const targetsChanges = view === "diff" || (view === "path" && request?.file.change === "deleted");
  const tabReady = targetsChanges
    ? state.tab === "changes"
    : state.tab === "files" && !!state.file && !!request && sameProjectPath(state.file.path, request.file.path);
  const readyRequest = !props.suspended && request && request.requestId === state.revealRequestId &&
    tabReady &&
    (view !== "diff" || (state.layout === "split" && state.canDiff)) &&
    (view !== "preview" || state.preview) &&
    (view !== "source" || !state.preview)
      ? request : undefined;
  const reveal = useMemo(() => ({ request: readyRequest, complete }), [readyRequest, complete]);
  // 定位到变更页 Diff 时，目标区块即使未进入视口或已折叠也要展开并读取。
  const revealPath = request && view === "diff" && state.tab === "changes" &&
    request.requestId === state.revealRequestId ? request.file.path : undefined;
  useLayoutEffect(() => {
    if (!request || props.suspended || request.requestId !== state.revealRequestId) return;
    let cancelled = false, frame = 0;
    const inspect = () => {
      if (cancelled || completed.current === request.requestId) return;
      const container = root.current;
      if (!container) return;
      // 隐藏页面或隐藏目录栏里的读取状态不影响当前定位；占位区块不使用 role="status"。
      const busy = [...container.querySelectorAll('[role="status"]')].some((node) => !node.closest("[hidden]"));
      if (busy) return;
      const page = '.review-page:not([hidden])';
      const invalidDiff = view === "diff" && state.changes.status !== "loading" && !state.canDiff;
      const error = container.querySelector(view === "path"
        ? `${page} .code-review-files [role="alert"]`
        : `${page} .code-review-source [role="alert"], ${page} .change-section[data-reveal-target] [role="alert"]`);
      const emptySource = view !== "path" && view !== "diff" && container.querySelector(`${page} .code-review-source .code-review-empty`);
      if (invalidDiff || error || emptySource)
        complete({ requestId: request.requestId, status: "unavailable", reason: error?.textContent || "来源当前不可定位" });
    };
    frame = requestAnimationFrame(inspect);
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(inspect);
    });
    if (root.current) observer.observe(root.current, { childList: true, subtree: true });
    return () => { cancelled = true; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [request, view, props.suspended, state.revealRequestId, state.canDiff, state.tab, state.changes.status, complete, root]);
  return (
    <LocalCommentReveal.Provider value={reveal}>
    <section
      ref={root}
      id="project-code-review"
      className="code-review-panel"
      data-fullscreen={state.fullscreen}
      role={state.fullscreen ? "dialog" : "region"}
      aria-modal={state.fullscreen || undefined}
      aria-label="文件与变更"
      tabIndex={-1}
      inert={props.suspended}
      onKeyDown={(event) =>
        reviewKeys(event, {
          fullscreen: state.fullscreen,
          onClose: () => { state.cancelReveal(); props.onClose(); },
        })
      }
    >
      {!state.fullscreen && <PaneResizeHandle storageKey="omp-desktop.review-width" label="调整文件与变更侧栏宽度" initialWidth={560} minWidth={280} />}
      <ReviewHeader state={state} props={props} idPrefix={idPrefix} />
      <div
        role="tabpanel"
        id={`${idPrefix}-panel-files`}
        aria-labelledby={`${idPrefix}-tab-files`}
        className="review-page"
        hidden={state.tab !== "files"}
      >
        <ReviewFilesPage state={state} props={props} />
      </div>
      {state.changesMounted && (
        <div
          role="tabpanel"
          id={`${idPrefix}-panel-changes`}
          aria-labelledby={`${idPrefix}-tab-changes`}
          className="review-page"
          hidden={state.tab !== "changes"}
        >
          <ProjectChangesPage
            cwd={props.cwd}
            browser={props.browser}
            state={state.changes}
            revision={state.revision}
            active={state.tab === "changes"}
            filesVisible={state.filesVisible}
            wrap={state.wrap}
            layout={state.layout}
            collapsed={state.collapsed}
            commentReveal={props.commentReveal}
            revealPath={revealPath}
            onToggleFiles={() => state.setFilesVisible(!state.filesVisible)}
            onToggleWrap={() => state.setWrap(!state.wrap)}
            onToggleLayout={state.toggleLayout}
            onRefresh={() => state.setRevision((value) => value + 1)}
            onToggleSection={state.toggleSection}
            onExpandSection={state.expandSection}
            onToggleAll={state.setAllCollapsed}
            onOpenInFiles={state.openInFiles}
            onShowFiles={() => state.setTab("files")}
          />
        </div>
      )}
    </section>
    </LocalCommentReveal.Provider>
  );
}
