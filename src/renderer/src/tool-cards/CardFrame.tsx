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

export type CardVariant = "tool" | "command";
export type CardTone = "default" | "danger" | "warn";

/** 各状态的默认图标；无图标的状态为 undefined。 */
const statusIcons: Record<CardStatus, string | undefined> = {
  running: "◐",
  ok: "✓",
  error: "✗",
  cancelled: undefined,
  unknown: undefined,
};

/** 各状态的默认状态文字，不含图标。 */
const statusTexts: Record<CardStatus, string | undefined> = {
  running: "运行中",
  ok: undefined,
  error: undefined,
  cancelled: "已取消",
  unknown: "未记录结果",
};

/** 判断可选节点是否有可渲染内容；参数：[in] node 节点。返回值：非空、非 false、非空串时为 true。 */
function hasNode(node: ReactNode): boolean {
  return node != null && node !== false && node !== "";
}

/** 工具框外壳；参数：[in] props 标题、状态、耗时、展开操作、输入区、Output 区和底部信息。返回值：嵌入式边框、支持键盘和吸顶的工具框。 */
export function CardFrame({
  toolId,
  kind,
  status,
  variant = "tool",
  tone = "default",
  icon,
  title,
  meta,
  statusText,
  durationMs,
  aside,
  expand,
  stickyExpanded,
  output,
  outputLabel,
  footer,
  children,
  result,
}: {
  toolId: string;
  kind: CardKind;
  status: CardStatus;
  variant?: CardVariant;
  tone?: CardTone;
  /** 覆盖默认图标；null 表示不显示。 */
  icon?: ReactNode | null;
  title: ReactNode;
  meta?: ReactNode;
  /** 状态文字，不得包含图标字符；空串表示不显示。 */
  statusText?: ReactNode;
  /** 只在 variant="tool" 时显示于标题末尾。 */
  durationMs?: number;
  /** 顶部边框右端，只在 variant="tool" 时显示。 */
  aside?: ReactNode;
  expand?: { expanded: boolean; onToggle: () => void };
  /** 子行独立展开时只启用测量，不赋予整框标题切换操作。 */
  stickyExpanded?: boolean;
  /** Output 分隔线下方的结果区。 */
  output?: ReactNode;
  outputLabel?: ReactNode;
  /** 底部边框文字。 */
  footer?: ReactNode;
  /** 输入区。 */
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
  const command = variant === "command";
  const resolvedIcon = icon !== undefined ? icon : statusIcons[status];
  const iconNode = hasNode(resolvedIcon) ? (
    <span className="tool-card-icon">{resolvedIcon}</span>
  ) : null;
  const resolvedStatusText = statusText ?? statusTexts[status];
  const hasInput = hasNode(children);
  const hasOutput = hasNode(output);
  const images = <ToolResultImages result={imageResult} />;
  // 图片放在最后一个区域末尾；只有图片时放进输入区。
  const inputShown = hasInput || (hasImages && !hasOutput);
  const showBody = inputShown || hasOutput;
  const showDivider = hasOutput && (command || inputShown);
  const footerShown = command
    ? hasNode(footer) || iconNode !== null
    : hasNode(footer);
  return (
    <section
      className="tool-card"
      data-variant={variant}
      data-tool-id={toolId}
      data-kind={kind}
      data-status={status}
      data-tone={tone}
      data-sticky={sticky}
      data-expanded={stickyExpanded ?? expand?.expanded}
      onKeyDown={onCardKey}
    >
      <div className="tool-card-box" data-has-result={hasOutput}>
        <header
          ref={header}
          className="tool-card-header"
          role={expand ? "button" : undefined}
          tabIndex={expand ? 0 : undefined}
          aria-expanded={expand?.expanded}
          onClick={expand ? onClick : undefined}
          onKeyDown={expand ? onHeaderKey : undefined}
        >
          {command ? (
            <span className="tool-card-title">{title}</span>
          ) : (
            <>
              <span className="tool-card-legend">
                {iconNode}
                <span className="tool-card-title">{title}</span>
                {hasNode(meta) && <span className="tool-card-meta">{meta}</span>}
                {hasNode(resolvedStatusText) && (
                  <span className="tool-card-status">{resolvedStatusText}</span>
                )}
                {durationMs !== undefined && (
                  <span className="tool-card-duration">
                    ({durationText(durationMs)})
                  </span>
                )}
              </span>
              {hasNode(aside) && <span className="tool-card-aside">{aside}</span>}
            </>
          )}
        </header>
        {showBody && (
          <div
            ref={panel}
            className="tool-card-body"
            tabIndex={expand?.expanded ? 0 : undefined}
            onClickCapture={() => setTimeout(measure, 0)}
          >
            {inputShown && (
              <div className="tool-card-input">
                {children}
                {!hasOutput && images}
              </div>
            )}
            {showDivider && (
              <div className="tool-card-divider">
                <span>{outputLabel ?? "Output"}</span>
              </div>
            )}
            {hasOutput && (
              <div className="tool-card-result">
                {output}
                {images}
              </div>
            )}
          </div>
        )}
        {footerShown && (
          <footer className="tool-card-footer">
            <span>
              {command && iconNode}
              {command && iconNode && hasNode(footer) ? " " : null}
              {footer}
            </span>
          </footer>
        )}
      </div>
    </section>
  );
}
