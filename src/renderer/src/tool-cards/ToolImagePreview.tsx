import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MessageContent } from "../../../shared/protocol";
import { NativeImage } from "../TranscriptNativeImage";

/** 仅为工具图片提供放大窗口；图片来源由 NativeImage 的原生校验生成。 */
export function ToolImagePreview({
  image,
  label,
}: {
  image: MessageContent;
  label: string;
}) {
  const [preview, setPreview] = useState<{
    source: string;
    trigger: HTMLButtonElement;
  } | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    if (!preview) return;
    closeButton.current?.focus();
    /** 在应用模态窗口的 document 捕获处理器之前消费预览窗口的键盘操作。 */
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "Tab") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") setPreview(null);
      else closeButton.current?.focus();
    }
    window.addEventListener("keydown", handleKey, true);
    return () => {
      window.removeEventListener("keydown", handleKey, true);
      if (preview.trigger.isConnected) preview.trigger.focus();
    };
  }, [preview]);

  return (
    <>
      <NativeImage
        image={image}
        label={label}
        onOpen={(source, trigger) => setPreview({ source, trigger })}
      />
      {preview &&
        createPortal(
          <div
            className="tool-image-backdrop"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (event.target === event.currentTarget) setPreview(null);
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div
              className="tool-image-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <div className="tool-image-toolbar">
                <strong className="tool-image-title" id={titleId}>
                  放大图片：{label}
                </strong>
                <button
                  ref={closeButton}
                  type="button"
                  className="tool-image-close"
                  aria-label="关闭图片预览"
                  onClick={() => setPreview(null)}
                >
                  关闭
                </button>
              </div>
              <img
                className="tool-image-full"
                src={preview.source}
                alt={label}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
