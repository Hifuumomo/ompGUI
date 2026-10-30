import { useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import { LocalSourceMarkers } from "./LocalCommentMarkers";
import { ContextActionsMenu, type ContextActionsMenuProps } from "./ContextActionsMenu";
import { PromptContexts } from "./PromptContexts";
import type {
  ProjectBrowser,
  ProjectEntry,
  ProjectChanges,
  ProjectReview,
  ProjectPreviewKind,
} from "../../shared/project-browser";
import {
  projectImageType,
  projectPreviewKind,
} from "../../shared/project-browser";
import { FileCodeView } from "./FileCodeView";
import { useProjectResource } from "./useProjectResource";
import { ProjectDiffView } from "./ProjectDiffView";
import type { DiffDisplayMode } from "./project-diff-model";
import "./project-image.css";
import { MarkdownPreview } from "./MarkdownPreview";
import { HtmlPreview } from "./HtmlPreview";
import { describeMarkdownRange } from "./local-comment-reveal";

interface Props {
  readonly file: ProjectEntry;
  readonly browser: ProjectBrowser & ProjectReview;
  readonly changes: ProjectChanges;
  readonly mode: DiffDisplayMode;
  readonly revision: number;
  readonly wrap: boolean;
  readonly preview: boolean;
}

/** 文件读取经 IPC 只保留错误消息；将缺失错误转为侧栏提示，其他错误保持可见。 */
function SourceError({ message }: { readonly message: string }) {
  return (
    <p role="alert">
      {/(?:^|\s)(?:ENOENT|ENOTDIR):/.test(message) ? "找不到该文件" : message}
    </p>
  );
}

function PlainSource({ file, browser, revision, wrap }: Props) {
  const resource = useProjectResource(
    browser.readProjectFile,
    file.path,
    revision,
  );
  const actions = useContext(PromptContexts);
  const [menu, setMenu] = useState<ContextActionsMenuProps>();
  useLayoutEffect(() => { setMenu(undefined); }, [file.path, revision, resource, actions]);
  if (resource.status === "loading") return <p role="status">正在读取文件…</p>;
  if (resource.status === "error") return <SourceError message={resource.error} />;
  if (!resource.value.length)
    return <p className="code-review-empty">此文件为空</p>;
  return <>
    <FileCodeView content={resource.value} path={file.path} wrap={wrap} onContext={(value) => {
      const { text, copyText, startLine, endLine, x, y, trigger } = value;
      setMenu({ x, y, copyText, trigger, context: { kind: "file", path: file.path, text,
        startLine, endLine, representation: startLine === undefined ? "reference" : "source" },
        sourceAnchor: { kind: "local", view: "source", path: file.path, identity: resource.value, startLine, endLine },
        onClose: () => setMenu(undefined) });
    }} />
    {menu && <ContextActionsMenu {...menu} />}
  </>;
}

/** 可预览文档读取原文后按类型渲染；源码视图由工具栏切换。 */
function DocumentSource({
  file,
  browser,
  revision,
  kind,
}: Props & { readonly kind: ProjectPreviewKind }) {
  const resource = useProjectResource(
    browser.readProjectFile,
    file.path,
    revision,
  );
  const actions = useContext(PromptContexts);
  const [menu, setMenu] = useState<ContextActionsMenuProps>();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { setMenu(undefined); }, [file.path, revision, resource, actions]);
  if (resource.status === "loading") return <p role="status">正在读取文件…</p>;
  if (resource.status === "error") return <SourceError message={resource.error} />;
  const Preview = kind === "markdown" ? MarkdownPreview : HtmlPreview;
  function openContext(element: HTMLDivElement, x: number, y: number, keyboard = false) {
    const selection = window.getSelection();
    let text = "";
    let selectedRange: Range | undefined;
    if (selection && !selection.isCollapsed && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
      text = selection.toString();
      selectedRange = range.cloneRange();
      if (keyboard) {
        const rects = range.getClientRects();
        const rect = rects[rects.length - 1];
        if (rect) { x = rect.right; y = rect.bottom; }
      }
    } else if (keyboard) {
      const rect = element.getBoundingClientRect();
      x = rect.left; y = rect.top;
    }
    setMenu({ x, y, copyText: text, trigger: element, onClose: () => setMenu(undefined),
      sourceAnchor: { kind: "local", view: selectedRange ? "preview" : "source", path: file.path,
        identity: resource.status === "ready" ? resource.value : undefined, range: selectedRange, text,
        markdown: selectedRange ? describeMarkdownRange(element, selectedRange) : undefined },
      context: { kind: "file", path: file.path, text, representation: text ? "preview" : "reference" } });
  }
  return <>
    <div ref={root} tabIndex={kind === "markdown" ? 0 : undefined}
      onContextMenu={kind === "markdown" ? (event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        openContext(event.currentTarget, event.clientX, event.clientY);
      } : undefined}
      onKeyDown={kind === "markdown" ? (event) => {
        if (event.defaultPrevented || (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))) return;
        event.preventDefault(); event.stopPropagation();
        openContext(event.currentTarget, 0, 0, true);
      } : undefined}>
      <Preview text={resource.value} file={file} browser={browser} revision={revision} />
    </div>
    {kind === "markdown" && <LocalSourceMarkers root={root} path={file.path} view="preview" identity={resource.value} />}
    {kind === "markdown" && <LocalSourceMarkers root={root} path={file.path} view="source" identity={resource.value} />}
    {menu && <ContextActionsMenu {...menu} />}
  </>;
}

/** 图片按原始字节以 data URL 显示，不经过文本解码与 Diff。 */
function ImageSource({ file, browser, revision }: Props) {
  const resource = useProjectResource(
    browser.readProjectImage,
    file.path,
    revision,
  );
  const [size, setSize] = useState<{
    src: string;
    width: number;
    height: number;
  }>();
  if (resource.status === "loading") return <p role="status">正在读取图片…</p>;
  if (resource.status === "error") return <SourceError message={resource.error} />;
  const { mimeType, data, byteSize } = resource.value;
  const src = `data:${mimeType};base64,${data}`;
  const bytes =
    byteSize < 1024
      ? `${byteSize} B`
      : byteSize < 1024 * 1024
        ? `${(byteSize / 1024).toFixed(1)} KB`
        : `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
  return (
    <figure className="project-image">
      <div className="project-image-canvas">
        <img
          src={src}
          alt={file.name}
          onLoad={(event) =>
            setSize({
              src,
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
        />
      </div>
      <figcaption>
        {size?.src === src && `${size.width} × ${size.height} · `}
        {bytes}
      </figcaption>
    </figure>
  );
}

function GitSource(props: Props) {
  const { file, browser, changes, revision, wrap, mode } = props;
  const { name, path, kind, change, previousPath } = file;
  const read = useCallback(
    () =>
      browser.readProjectDiff({
        cwd: changes.root,
        base: changes.base,
        file: { name, path, kind, change, previousPath },
      }),
    [
      browser,
      changes.root,
      changes.base,
      name,
      path,
      kind,
      change,
      previousPath,
    ],
  );
  const resource = useProjectResource(read, file.path, revision);
  if (resource.status === "loading") return <p role="status">正在读取差异…</p>;
  if (resource.status === "error") return <SourceError message={resource.error} />;
  return (
    <ProjectDiffView
      diff={resource.value}
      path={file.path}
      previousPath={file.previousPath}
      mode={mode}
      wrap={wrap}
      base={changes.base}
    />
  );
}

export function ProjectSource(props: Props) {
  if (projectImageType(props.file.path))
    return props.file.change === "deleted" ? (
      <p className="code-review-empty">此图片已删除，没有当前文件可预览。</p>
    ) : (
      <ImageSource {...props} />
    );
  const previewKind = projectPreviewKind(props.file.path);
  if (
    props.preview &&
    props.mode === "source" &&
    props.file.change !== "deleted" &&
    previewKind
  )
    return <DocumentSource {...props} kind={previewKind} />;
  if (props.file.change === "deleted" && props.mode === "source")
    return (
      <p className="code-review-empty">
        此文件已删除，没有当前源码；请选择 Diff 查看删除内容。
      </p>
    );
  return props.changes.kind === "git" && props.mode !== "source" ? (
    <GitSource {...props} />
  ) : (
    <PlainSource {...props} />
  );
}
