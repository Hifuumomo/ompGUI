import {
  createContext,
  useContext,
  useRef,
  type ReactNode,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { CardKind, CardStatus } from "../tool-card-model";
import { durationText } from "../duration-text";
import { useStickyMeasure } from "../use-sticky-measure";
import type { MessageContent } from "../../../shared/protocol";
import { ToolImagePreview } from "./ToolImagePreview";

export const CardResultContext = createContext<unknown>(undefined);

/** 移除详情中的图片，由框尾统一展示。参数：[in] result 原生结果。返回值：保留其他字段的结果。 */
export function withoutResultImages<T>(result: T): T {
  if (!result || typeof result !== "object") return result;
  const payload = result as Record<string, unknown>;
  return {
    ...payload,
    images: undefined,
    ...(Array.isArray(payload.content)
      ? {
          content: payload.content.filter(
            (part: unknown) =>
              !part ||
              typeof part !== "object" ||
              !("type" in part) ||
              part.type !== "image",
          ),
        }
      : {}),
  } as T;
}

/** 展示去重后的原生结果图片。参数：[in] result 原生结果。返回值：框尾图片缩略图。 */
export function ToolResultImages({ result }: { result: unknown }) {
  if (!result || typeof result !== "object") return null;
  const payload = result as Record<string, unknown>;
  const seen = new Set<string>();
  const images = [
    ...(Array.isArray(payload.content) ? payload.content : []),
    ...(Array.isArray(payload.images) ? payload.images : []),
  ].filter((part): part is MessageContent => {
    if (!part || typeof part !== "object" || part.type !== "image")
      return false;
    const key = JSON.stringify(part);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return images.length ? (
    <div className="tool-card-images">
      {images.map((image, index) => (
        <ToolImagePreview key={index} image={image} label="工具输出图片" />
      ))}
    </div>
  ) : null;
}

const statusLabels: Record<CardStatus, string> = {
  running: "◐ 运行中",
  ok: "✓",
  error: "✗ 失败",
  cancelled: "已取消",
  unknown: "未记录结果",
};

/** 工具框外壳；参数：[in] props 标题、状态、耗时、展开操作及正文。返回值：支持键盘和吸顶的工具框。 */
export function CardFrame({
  toolId,
  kind,
  status,
  tone = "default",
  plainHeader,
  title,
  meta,
  statusText,
  durationMs,
  expand,
  stickyExpanded,
  footer,
  children,
  result,
}: {
  toolId: string;
  kind: CardKind;
  status: CardStatus;
  tone?: "default" | "danger";
  plainHeader?: boolean;
  title: ReactNode;
  meta?: ReactNode;
  statusText?: ReactNode;
  durationMs?: number;
  expand?: { expanded: boolean; onToggle: () => void };
  /** 子行独立展开时只启用测量，不赋予整框标题切换操作。 */
  stickyExpanded?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
  result?: unknown;
}) {
  const inheritedResult = useContext(CardResultContext);
  const imageResult = result ?? inheritedResult;
  const imagePayload =
    imageResult && typeof imageResult === "object"
      ? (imageResult as Record<string, unknown>)
      : undefined;
  const hasImages = [imagePayload?.content, imagePayload?.images].some(
    (parts) =>
      Array.isArray(parts) &&
      parts.some(
        (part: unknown) =>
          !!part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "image",
      ),
  );
  const header = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { sticky, measure } = useStickyMeasure(
    panel,
    stickyExpanded ?? expand?.expanded ?? false,
  );
  /** 标题内链接和按钮保留各自操作。参数：[in] event 点击事件。返回值：无。 */
  function onClick(event: MouseEvent<HTMLElement>) {
    if ((event.target as Element).closest("a,button,input,select,textarea"))
      return;
    expand?.onToggle();
  }
  /** 原生按钮式键盘展开；参数：[in] event 键盘事件。返回值：无。 */
  function onHeaderKey(event: KeyboardEvent<HTMLElement>) {
    if (
      event.target !== event.currentTarget ||
      (event.key !== "Enter" && event.key !== " ")
    )
      return;
    event.preventDefault();
    expand?.onToggle();
  }
  /** Esc 收起并恢复标题焦点；参数：[in] event 键盘事件。返回值：无。 */
  function onCardKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented || !expand?.expanded)
      return;
    event.preventDefault();
    event.stopPropagation();
    expand.onToggle();
    header.current?.focus();
    requestAnimationFrame(() =>
      header.current?.scrollIntoView?.({ block: "nearest" }),
    );
  }
  return (
    <section
      className="tool-card"
      data-tool-id={toolId}
      data-kind={kind}
      data-status={status}
      data-tone={tone}
      data-sticky={sticky}
      data-expanded={stickyExpanded ?? expand?.expanded}
      data-plain-header={!!plainHeader}
      onKeyDown={onCardKey}
    >
      <header
        ref={header}
        className="tool-card-header"
        role={expand ? "button" : undefined}
        tabIndex={expand ? 0 : undefined}
        aria-expanded={expand?.expanded}
        onClick={expand ? onClick : undefined}
        onKeyDown={expand ? onHeaderKey : undefined}
      >
        <span className="tool-card-title">{title}</span>
        {meta != null && <span className="tool-card-meta">{meta}</span>}
        <span className="tool-card-status">
          {statusText ?? statusLabels[status]}
        </span>
        {durationMs !== undefined && (
          <span className="tool-card-duration">{durationText(durationMs)}</span>
        )}
      </header>
      {(children != null || hasImages) && (
        <div
          ref={panel}
          className="tool-card-body"
          tabIndex={expand?.expanded ? 0 : undefined}
          onClickCapture={() => setTimeout(measure, 0)}
        >
          {children}
          <ToolResultImages result={imageResult} />
        </div>
      )}
      {footer != null && <footer className="tool-card-footer">{footer}</footer>}
    </section>
  );
}
