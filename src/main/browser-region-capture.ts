import { nativeImage, type WebContents } from "electron";
import type { PromptContextImage } from "../shared/prompt-context";
import { finishRegionCapture, prepareRegionCapture, type PageRegionSelection } from "./browser-context";

interface CaptureTransaction { selection: PageRegionSelection; cancelled: boolean }
const captures = new WeakMap<WebContents, CaptureTransaction>();

/** 导航、隐藏和新选择必须立即撤销；无法中断的 capturePage 结果只会被丢弃。 */
export function cancelRegionCapture(contents: WebContents): void {
  const current = captures.get(contents);
  if (!current) return;
  current.cancelled = true;
  captures.delete(contents);
  if (!contents.isDestroyed()) void finishRegionCapture(contents, current.selection, true).catch(() => {});
}

/** isCurrent 由 controller 核对 scope/document/navigation/generation/contextEpoch 及可见性。 */
export async function captureBrowserRegion(
  contents: WebContents,
  selection: PageRegionSelection,
  isCurrent: () => boolean,
): Promise<PromptContextImage> {
  cancelRegionCapture(contents);
  const transaction: CaptureTransaction = { selection, cancelled: false };
  captures.set(contents, transaction);
  let finished = false;
  try {
    if (!isCurrent() || contents.isDestroyed()) throw new Error("页面已变化，请重新框选");
    const prepared = await prepareRegionCapture(contents, selection);
    if (transaction.cancelled || captures.get(contents) !== transaction || !isCurrent()) throw new Error("页面已变化，请重新框选");
    const captured = await contents.capturePage();
    if (transaction.cancelled || captures.get(contents) !== transaction || !isCurrent() || contents.isDestroyed()) throw new Error("页面已变化，请重新框选");
    if (captured.isEmpty()) throw new Error("页面截图为空，请重新框选");
    // 去除多 scale representation，只以实际像素与 CSS viewport 的比率换算。
    const bitmap = nativeImage.createFromBuffer(captured.toPNG({ scaleFactor: 1 }));
    const size = bitmap.getSize();
    const { viewport, rect } = prepared;
    if (bitmap.isEmpty() || size.width <= 0 || size.height <= 0 ||
      Math.abs(size.width - size.height * viewport.width / viewport.height) > 1 ||
      Math.abs(size.height - size.width * viewport.height / viewport.width) > 1) throw new Error("页面截图尺寸不匹配，请重新框选");
    const sx = size.width / viewport.width, sy = size.height / viewport.height;
    const x = Math.floor(rect.x * sx), y = Math.floor(rect.y * sy);
    const right = Math.ceil((rect.x + rect.width) * sx), bottom = Math.ceil((rect.y + rect.height) * sy);
    if (x < 0 || y < 0 || right > size.width || bottom > size.height || right <= x || bottom <= y) throw new Error("页面截图超出可见范围，请重新框选");
    let image = bitmap.crop({ x, y, width: right - x, height: bottom - y });
    const width = right - x, height = bottom - y;
    const scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(4_194_304 / (width * height)));
    if (scale < 1) image = image.resize({ width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), quality: "best" });
    if (image.isEmpty()) throw new Error("页面截图为空，请重新框选");
    const png = image.toPNG();
    if (!png.length || png.length > 20 * 1024 * 1024) throw new Error("选区图片过大，请缩小区域");
    if (transaction.cancelled || captures.get(contents) !== transaction || !isCurrent()) throw new Error("页面已变化，请重新框选");
    if (!await finishRegionCapture(contents, prepared)) throw new Error("页面已变化，请重新框选");
    finished = true;
    if (transaction.cancelled || captures.get(contents) !== transaction || !isCurrent()) throw new Error("页面已变化，请重新框选");
    const finalSize = image.getSize();
    return { mimeType: "image/png", data: png.toString("base64"), width: finalSize.width, height: finalSize.height };
  } finally {
    if (captures.get(contents) === transaction) captures.delete(contents);
    if (!finished && !contents.isDestroyed()) await finishRegionCapture(contents, selection, true).catch(() => {});
  }
}
