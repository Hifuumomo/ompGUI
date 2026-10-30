import type { MessageContent } from "../../shared/protocol";
import { readable } from "./session";

/** 呈现原生内嵌图片，拒绝 SVG 和外部资源。[in] image：图片载荷；[in] label：说明。返回值：安全栅格图片或完整未加载证据。 */
export function NativeImage({
  image,
  label,
}: {
  image: MessageContent;
  label: string;
}) {
  const safe =
    typeof image.mimeType === "string" &&
    /^image\/(?:png|jpeg|gif|webp|avif|bmp)$/.test(image.mimeType) &&
    typeof image.data === "string" &&
    image.data.length > 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(image.data);
  if (!safe)
    return (
      <details className="transcript-evidence" open>
        <summary>{label} · 未加载不支持的图片格式或数据</summary>
        <pre>{readable(image)}</pre>
      </details>
    );
  return (
    <figure className="message-image">
      <img src={`data:${image.mimeType};base64,${image.data}`} alt={label} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}
