import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { messageFilePath } from "../../shared/message-file-link";
import { projectImageType } from "../../shared/project-browser";
import type { ProjectImage } from "../../shared/project-browser";
import { MessageFileLinks, MessageFileMenu } from "./MessageFileLinks";
import { ProjectFileIcon } from "./ProjectFileIcon";
import { WebLinks } from "./WebLinks";
import "./file-reference-link.css";

/** 图片预览只通过当前项目作用域的安全桌面读取入口加载。 */
export const FileReferencePreview = createContext<
  ((href: string) => Promise<ProjectImage>) | undefined
>(undefined);

type Preview = {
  href: string;
  read: (href: string) => Promise<ProjectImage>;
  rect: DOMRect;
  visible: boolean;
  image?: ProjectImage;
  error?: string;
};

/**
 * 渲染消息和输入框共用的文件引用，阻止原生导航并复用安全链接交互。
 * @param props [in] href 为编码后的文件地址，children 为原始引用标签，onOpen 可覆盖上下文打开入口。
 * @returns 带文件图标、打开错误和按需图片预览的引用链接。
 */
export function FileReferenceLink({
  href,
  children,
  onOpen,
}: {
  href: string;
  children?: ReactNode;
  onOpen?: (href: string) => Promise<void>;
}) {
  return (
    <SafeLink
      href={messageFilePath(href) !== undefined ? href : undefined}
      onOpen={onOpen}
    >
      {children}
    </SafeLink>
  );
}

/**
 * 分发网页与文件链接；保留文件菜单、图标和错误，同时仅在悬停时读取白名单图片。
 * @param props [in] href 为链接地址，children 为标签，onOpen 为可选文件打开入口。
 * @returns 安全链接或不支持目标的纯文本；悬停图片使用视口内的 portal。
 */
export function SafeLink({
  href,
  children,
  onOpen,
}: {
  href?: string;
  children?: ReactNode;
  onOpen?: (href: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const openWeb = useContext(WebLinks);
  const navigation = useRef(0);
  const contextOpen = useContext(MessageFileLinks);
  const openFile = onOpen ?? contextOpen;
  const showMenu = useContext(MessageFileMenu);
  const read = useContext(FileReferencePreview);
  const [preview, setPreview] = useState<Preview>();
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const popup = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const hoverTimer = useRef<number | undefined>(undefined);
  const external = !!href && /^https?:\/\//i.test(href);
  const filePath = href ? messageFilePath(href) : undefined;
  const file = filePath !== undefined && !!openFile;
  const current = preview && preview.href === href && preview.read === read ? preview : undefined;

  /** 关闭悬停并使所有未完成读取失效。参数：无。@returns 返回值：无。 */
  const closePreview = useCallback(function closePreview() {
    request.current++;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
    setPreview(undefined);
  }, []);

  /** 在引用或会话入口变化时失效旧读取。参数：无。@returns 卸载时的失效清理函数。 */
  function resetScope() {
    navigation.current++;
    setError("");
    setStatus("");
    closePreview();
    /** 防止卸载后的读取修改状态。参数：无。@returns 返回值：无。 */
    function invalidate() {
      navigation.current++;
      request.current++;
      clearTimeout(hoverTimer.current);
    }
    return invalidate;
  }
  useLayoutEffect(resetScope, [href, read, closePreview]);

  /** 监听失焦、滚动、窗口变化和 Escape，避免悬停浮层脱离引用。参数：无。@returns 监听清理函数或无。 */
  function watchDismissal() {
    if (!current) return;
    /** Escape 关闭当前预览。@param event [in] 键盘事件。@returns 返回值：无。 */
    function dismissKey(event: KeyboardEvent) {
      if (event.key === "Escape") closePreview();
    }
    window.addEventListener("blur", closePreview);
    window.addEventListener("resize", closePreview);
    window.addEventListener("scroll", closePreview, true);
    window.addEventListener("keydown", dismissKey);
    document.addEventListener("visibilitychange", closePreview);
    /** 移除本次悬停的全局监听。参数：无。@returns 返回值：无。 */
    function removeListeners() {
      window.removeEventListener("blur", closePreview);
      window.removeEventListener("resize", closePreview);
      window.removeEventListener("scroll", closePreview, true);
      window.removeEventListener("keydown", dismissKey);
      document.removeEventListener("visibilitychange", closePreview);
    }
    return removeListeners;
  }
  useEffect(watchDismissal, [!!current, closePreview]);

  /** 将预览置于链接下方，空间不足时翻转并限制到视口。参数：无。@returns 返回值：无。 */
  function placePreview() {
    if (!current || !popup.current) return;
    const bounds = popup.current.getBoundingClientRect();
    const margin = 8;
    const below = current.rect.bottom + margin;
    const top = below + bounds.height <= window.innerHeight - margin
      ? below
      : current.rect.top - bounds.height - margin;
    setPosition({
      left: Math.max(margin, Math.min(current.rect.left, window.innerWidth - bounds.width - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - bounds.height - margin)),
    });
  }
  useLayoutEffect(placePreview, [current]);

  /** 连续悬停 500ms 后才显示并读取图片；提前离开不发起读取。 */
  function showPreview(event: MouseEvent<HTMLAnchorElement>) {
    if (!file || !read || !projectImageType(filePath!)) return;
    closePreview();
    const token = request.current;
    const snapshot: Preview = { href: href!, read, rect: event.currentTarget.getBoundingClientRect(), visible: true };
    setPreview({ ...snapshot, visible: false });
    hoverTimer.current = window.setTimeout(async () => {
      hoverTimer.current = undefined;
      if (request.current !== token) return;
      setPreview(snapshot);
      try {
        const image = await snapshot.read(snapshot.href);
        if (request.current === token) setPreview({ ...snapshot, image });
      } catch (failure) {
        if (request.current === token) setPreview({
          ...snapshot,
          error: `无法预览图片：${failure instanceof Error ? failure.message : String(failure)}`,
        });
      }
    }, 500);
  }

  /** 打开批准的目标并阻止聊天窗口导航。@param event [in] 主键或中键点击事件。@returns 打开操作完成。 */
  async function openLink(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (event.button > 1) return;
    closePreview();
    const token = ++navigation.current;
    setError("");
    setStatus("");
    try {
      if (external) {
        const result = await openWeb!(href!);
        if (navigation.current === token && result === "deferred")
          setStatus("网页已在侧栏载入，关闭当前对话框后查看");
      } else await openFile!(href!);
    } catch (failure) {
      if (navigation.current === token)
        setError(`打开链接失败：${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }

  /** 展示文件原生菜单并保留可见错误。@param event [in] 右键或键盘菜单事件。@returns 菜单操作完成。 */
  async function openMenu(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    event.stopPropagation();
    closePreview();
    // 键盘菜单键没有指针坐标，改用链接左下角。
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = event.clientX !== 0 || event.clientY !== 0;
    try {
      await showMenu!(href!, pointer ? event.clientX : rect.left, pointer ? event.clientY : rect.bottom);
      setError("");
    } catch (failure) {
      setError(`无法打开文件菜单：${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }

  /** 呈现浏览器解码图片失败而不静默消失。参数：无。@returns 返回值：无。 */
  function imageFailed() {
    if (current) setPreview({ ...current, image: undefined, error: "无法预览图片：图片解码失败" });
  }

  /** 去除文件引用的行内代码外观，保留普通 Markdown 链接的标签语义。@param child [in] 标签子节点。@returns 显示用子节点。 */
  function linkLabel(child: ReactNode) {
    return isValidElement<{ children?: ReactNode }>(child) && child.type === "code"
      ? child.props.children
      : child;
  }

  if ((external && !openWeb) || (!external && !file)) return (
    <span className="rich-blocked-link" title="不支持此链接，或当前视图未启用链接预览">{children}</span>
  );
  return (
    <>
      <a
        className={`rich-link${file ? " rich-file-link" : ""}`}
        href={href}
        title={file ? `在右侧预览：${filePath}` : undefined}
        onClick={openLink}
        onAuxClick={openLink}
        onContextMenu={file && showMenu ? openMenu : undefined}
        onMouseEnter={showPreview}
        onMouseLeave={closePreview}
        onBlur={closePreview}
        rel="noreferrer noopener"
      >
        {file && <ProjectFileIcon path={filePath!} variant="link" />}
        {Children.map(children, linkLabel)}
      </a>
      {error && <span className="rich-link-error" role="alert">{error}</span>}
      {status && <span className="rich-link-status" role="status">{status}</span>}
      {current?.visible && createPortal(
        <div className="file-reference-preview" role="tooltip" aria-label={`图片预览：${filePath}`} ref={popup} style={position}>
          {current.image ? (
            <img src={`data:${current.image.mimeType};base64,${current.image.data}`} alt={filePath} onLoad={placePreview} onError={imageFailed} />
          ) : current.error ? <span role="alert">{current.error}</span> : <span role="status">图片加载中…</span>}
        </div>,
        document.body,
      )}
    </>
  );
}
