import { FileReviewSource } from "./FileReviewContent";
import type { MessageContent } from "../../shared/protocol";
import { readNotices } from "./native-read-notices";

/** 原生 read 保存的展示正文，独立于发给模型的带编号文本。 */
export interface ReadDisplayContent {
  readonly text: string;
  readonly startLine: number;
  readonly lineNumbers?: ReadonlyArray<number | null>;
}

interface NativeReadResult {
  readonly details?: { readonly displayContent?: ReadDisplayContent };
}

/** 契约：oh-my-pi v18.8.6 tools/read.ts 的 details.displayContent。 */
export function readDisplayContent(result: unknown) {
  return (result as NativeReadResult | undefined)?.details?.displayContent;
}

export function NativeReadContent({
  display,
  path,
  wrap,
  original,
  maxLines,
}: {
  display: ReadDisplayContent;
  path: string;
  wrap?: boolean;
  original: unknown;
  maxLines?: number;
}) {
  const notices = readNotices(
    original as string | MessageContent[] | undefined,
    display,
  );
  return (
    <>
      {display.text === "" && <p className="muted">文件内容为空</p>}
      <FileReviewSource
        content={display.text}
        path={path}
        wrap={wrap}
        startLine={display.startLine}
        lineNumbers={display.lineNumbers}
        maxLines={maxLines}
      />
      {!notices.matched && (
        <p className="inline-error" role="alert">
          读取结果格式与展示正文不一致，以下保留原生读取结果。
        </p>
      )}
      {notices.text.trim() && (
        <pre className="file-read-notices" aria-label="读取提示">
          {notices.text}
        </pre>
      )}
    </>
  );
}
