import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectBrowser,
  ProjectEntry,
  ProjectReview,
} from "../../shared/project-browser";
import { ProjectFiles } from "./ProjectFiles";
import { ProjectSource } from "./ProjectSource";
import { reviewKeys, useReviewFocus } from "./code-review-focus";
import "./code-review.css";
import { useProjectChanges } from "./useProjectChanges";
import type { DiffDisplayMode } from "./project-diff-model";
import { ProjectFileIcon } from "./ProjectFileIcon";
import { sameProjectPath } from "../../shared/message-file-link";
import { projectPreviewKind } from "../../shared/project-browser";
import { ReviewIconButton } from "./ReviewIconButton";
import { PaneResizeHandle } from "./PaneResizeHandle";
import { LocalCommentReveal, type LocalCommentRevealRequest, type LocalCommentRevealResult } from "./local-comment-reveal";

interface Props {
  readonly cwd: string;
  readonly browser: ProjectBrowser & ProjectReview;
  readonly suspended: boolean;
  readonly onClose: () => void;
  readonly requestedFile?: ProjectEntry;
  readonly commentReveal?: LocalCommentRevealRequest;
  readonly onCommentReveal?: (result: LocalCommentRevealResult) => void;
}

function useReviewState(props: Props) {
  const [selection, setSelection] = useState(() =>
    requestSelection(props.requestedFile, props.cwd),
  );
  const { scope, directory } = selection;
  const [revision, setRevision] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [filesVisible, setFilesVisible] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [preview, setPreview] = useState(true);
  const [pathOnly, setPathOnly] = useState(false);
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
    const next = requestSelection(request.file, props.cwd);
    setSelection({
      ...next,
      scope: anchor.view === "diff" || request.file.change === "deleted" ? "changed" : next.scope,
      mode: anchor.view === "diff" ? "split" : "source",
    });
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
  const entries = changes.status === "ready" ? changes.value.files : [];
  const changed = entries.find(
    (entry) =>
      selection.file && sameProjectPath(entry.path, selection.file.path),
  );
  const activeScope =
    changes.status === "ready" &&
    changes.value.kind === "plain" &&
    scope === "changed"
      ? "all"
      : scope;
  const file =
    activeScope === "changed" && changes.status === "ready" && !changed
      ? undefined
      : selectedFile(entries, selection.file);
  const canDiff =
    changes.status === "ready" &&
    changes.value.kind === "git" &&
    !!changed &&
    file?.kind === "file" &&
    withinProject(file.path, changes.value.root);
  const mode = canDiff ? selection.mode : "source";
  // 刷新后已退出变更列表的文件不继续作为隐藏的选中项。
  useEffect(() => {
    if (
      changes.status === "ready" &&
      activeScope === "changed" &&
      selection.file &&
      !changed
    )
      setSelection((old) => ({ ...old, file: undefined }));
  }, [changes, activeScope, selection.file, changed]);
  function setFile(file: ProjectEntry) {
    cancelReveal();
    setPathOnly(false);
    setSelection((old) => ({ ...old, file }));
  }
  function setMode(mode: DiffDisplayMode) {
    if (mode !== "source" && !canDiff) return;
    cancelReveal();
    setPathOnly(false);
    setSelection((old) => ({ ...old, mode }));
  }
  function setScope(next: ReviewScope) {
    cancelReveal();
    setPathOnly(false);
    setSelection((old) => ({
      ...old,
      scope: next,
      mode: next === "changed" ? "split" : "source",
      file:
        next === "changed"
          ? changed
          : next === "all"
            ? file &&
              withinProject(file.path, props.cwd) &&
              file.change !== "deleted"
              ? file
              : undefined
            : undefined,
    }));
  }
  return {
    cancelReveal,
    pathOnly,
    revealRequestId,
    scope: activeScope,
    setScope,
    directory,
    canDiff,
    changes,
    mode,
    setMode,
    file,
    setFile,
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
export type ReviewScope = "changed" | "all" | "directory";

/** 使用目录边界比较，避免把 project-other 当作 project 的子目录。 */
function withinProject(path: string, root: string) {
  const normalize = (value: string) => {
    const result = value.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-z]:/i.test(result) ? result.toLowerCase() : result;
  };
  return normalize(path).startsWith(`${normalize(root)}/`);
}

function requestSelection(
  file: ProjectEntry | undefined,
  cwd: string,
): {
  file?: ProjectEntry;
  directory?: ProjectEntry;
  scope: ReviewScope;
  mode: DiffDisplayMode;
} {
  if (!file) return { scope: "changed", mode: "split" };
  if (file.kind === "directory")
    return { file, directory: file, scope: "directory", mode: "source" };
  if (withinProject(file.path, cwd))
    return { file, scope: "all", mode: "source" };
  const parent = file.path.replace(/\\/g, "/").replace(/[^/]+$/, "");
  const path = parent.replace(/\/+$/, "") || "/";
  const directoryPath = /^[a-z]:$/i.test(path) ? `${path}/` : path;
  return {
    file,
    directory: {
      path: directoryPath,
      name: path.split("/").pop() || path,
      kind: "directory",
    },
    scope: "directory",
    mode: "source",
  };
}
type ReviewState = ReturnType<typeof useReviewState>;

function ReviewHeader({
  state: s,
  props,
}: {
  readonly state: ReviewState;
  readonly props: Props;
}) {
  return (
    <header className="code-review-header">
      <div>
        <strong>文件与变更</strong>
        <small title={props.cwd}>{props.cwd}</small>
      </div>
      <ReviewIconButton
        icon="refresh"
        tooltip="刷新目录与当前文件"
        aria-label="刷新项目代码"
        onClick={() => s.setRevision((value) => value + 1)}
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

function ReviewToolbar({ state: s }: { readonly state: ReviewState }) {
  const previewing = s.preview && s.mode === "source";
  return (
    <div className="code-review-toolbar">
      <ReviewIconButton
        icon={s.filesVisible ? "collapse" : "expand"}
        tooltip={s.filesVisible ? "收起项目文件栏" : "展开项目文件栏"}
        aria-label="显示项目文件"
        aria-pressed={s.filesVisible}
        onClick={() => s.setFilesVisible(!s.filesVisible)}
      />
      {s.file && <ProjectFileIcon path={s.file.path} />}
      <span title={s.file?.path}>{s.file?.name ?? "项目源码"}</span>
      <DiffMode state={s} />
      {s.file && projectPreviewKind(s.file.path) && (
        <ReviewIconButton
          icon="preview"
          aria-label="渲染预览"
          tooltip={previewing ? "显示源码" : "显示渲染预览"}
          aria-pressed={previewing}
          onClick={() => {
            s.setPreview(!previewing);
            if (!previewing) s.setMode("source");
          }}
        />
      )}
      <ReviewIconButton
        icon="wrap"
        aria-label="自动换行"
        tooltip={s.wrap ? "关闭自动换行" : "开启自动换行"}
        aria-pressed={s.wrap}
        onClick={() => s.setWrap(!s.wrap)}
      />
    </div>
  );
}

function DiffMode({ state: s }: { readonly state: ReviewState }) {
  if (s.changes.status !== "ready" || s.changes.value.kind !== "git")
    return <small>只读</small>;
  const modes: readonly DiffDisplayMode[] = ["split", "unified", "source"];
  const labels = {
    split: "并排 Diff",
    unified: "单栏 Diff",
    source: "全部源码",
  };
  const next = modes[(modes.indexOf(s.mode) + 1) % modes.length];
  return (
    <ReviewIconButton
      aria-label={`差异显示方式：${labels[s.mode]}`}
      aria-disabled={!s.canDiff}
      data-diff-mode={s.mode}
      tooltip={
        s.canDiff
          ? `${labels[s.mode]}；点击切换为${labels[next]}`
          : "全部源码；当前无可显示的文件差异"
      }
      onClick={() => s.setMode(s.canDiff ? next : "source")}
      icon={
        <>
          <rect x="2.5" y="3" width="19" height="18" rx="3" stroke="#858993" />
          {s.mode === "source" ? (
            <path d="M7 8h10M7 12h10M7 16h7" />
          ) : s.mode === "split" ? (
            <>
              <rect
                x="5.5"
                y="6"
                width="5.5"
                height="12"
                rx="1"
                fill="#efa0ab"
                stroke="none"
              />
              <rect
                x="13"
                y="6"
                width="5.5"
                height="12"
                rx="1"
                fill="#8cddb0"
                stroke="none"
              />
            </>
          ) : (
            <>
              <rect
                x="5.5"
                y="6"
                width="13"
                height="5"
                rx="1"
                fill="#efa0ab"
                stroke="none"
              />
              <rect
                x="5.5"
                y="13"
                width="13"
                height="5"
                rx="1"
                fill="#8cddb0"
                stroke="none"
              />
            </>
          )}
        </>
      }
    />
  );
}

function ReviewBody({
  state: s,
  props,
}: {
  readonly state: ReviewState;
  readonly props: Props;
}) {
  // 消息指定的源码可独立读取，不必等待 Git 状态或目录列表成功。
  const changes =
    s.changes.status === "ready"
      ? s.changes.value
      : {
          kind: "plain" as const,
          root: props.cwd,
          base: null,
          files: [],
        };
  const file = selectedFile(changes.files, s.file);
  return (
    <div className="code-review-body">
      <div className="code-review-files" hidden={!s.filesVisible}>
        <PaneResizeHandle storageKey="omp-desktop.file-tree-width" label="调整文件目录宽度" edge="right" initialWidth={220} minWidth={120} reserve={180} />
        {s.changes.status === "loading" &&
        props.requestedFile?.kind !== "directory" ? (
          <p role="status">正在读取项目变更…</p>
        ) : s.changes.status === "error" &&
          props.requestedFile?.kind !== "directory" ? (
          <p role="alert">{s.changes.error}</p>
        ) : (
          <ProjectFiles
            root={props.cwd}
            browser={props.browser}
            changes={changes}
            revision={s.revision}
            selected={s.file?.path}
            scope={s.scope}
            onScopeChange={s.setScope}
            requestedDirectory={s.directory}
            onSelect={s.setFile}
            commentReveal={props.commentReveal}
          />
        )}
      </div>
      <section
        className="code-review-source"
        aria-label="项目源码"
        tabIndex={0}
      >
        {s.pathOnly ? null :
        props.commentReveal?.sourceAnchor.view === "diff" && s.mode !== "split"
          ? s.changes.status === "loading" ? <p role="status">正在读取项目变更…</p> : null :
        file && file.kind === "file" ? (
          <ProjectSource
            file={file}
            browser={props.browser}
            changes={changes}
            mode={s.mode}
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
  const readyRequest = !props.suspended && request && request.requestId === state.revealRequestId &&
    state.file && sameProjectPath(state.file.path, request.file.path) &&
    (request.sourceAnchor.view !== "diff" || state.mode === "split") &&
    (request.sourceAnchor.view !== "preview" || state.preview) &&
    (request.sourceAnchor.view !== "source" || (!state.preview && state.mode === "source"))
      ? request : undefined;
  const reveal = useMemo(() => ({ request: readyRequest, complete }), [readyRequest, complete]);
  useLayoutEffect(() => {
    if (!request || props.suspended || request.requestId !== state.revealRequestId) return;
    let cancelled = false, frame = 0;
    const inspect = () => {
      if (cancelled || completed.current === request.requestId) return;
      const container = root.current;
      if (!container || container.querySelector('[role="status"]')) return;
      const invalidDiff = request.sourceAnchor.view === "diff" && state.changes.status !== "loading" && !state.canDiff;
      const error = container.querySelector(request.sourceAnchor.view === "path"
        ? '.code-review-files [role="alert"]' : '.code-review-source [role="alert"]');
      const emptySource = request.sourceAnchor.view !== "path" && container.querySelector(".code-review-source .code-review-empty");
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
  }, [request, props.suspended, state.revealRequestId, state.canDiff, state.changes.status, complete, root]);
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
      <ReviewHeader state={state} props={props} />
      <ReviewToolbar state={state} />
      {state.changes.status === "ready" && state.changes.refreshing && (
        <p role="status">正在刷新项目变更…</p>
      )}
      {state.changes.status === "ready" && state.changes.error && (
        <p role="alert">刷新失败：{state.changes.error}</p>
      )}
      <ReviewBody state={state} props={props} />
    </section>
    </LocalCommentReveal.Provider>
  );
}
