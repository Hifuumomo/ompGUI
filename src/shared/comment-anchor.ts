/** UI-only geometry; never included in formatted prompt snapshots. */
export interface WebCommentAnchor {
  kind: "web";
  documentId: string;
  anchorId: string;
  rect?: { x: number; y: number; width: number; height: number };
  unavailable?: string;
}

/** PDF 用户空间坐标不可随缩放、旋转或虚拟页面重挂载改变。 */
export interface PdfCommentAnchor {
  kind: "pdf";
  documentId: string;
  anchorId: string;
  page: number;
  pageRect: [number, number, number, number];
  rect?: { x: number; y: number; width: number; height: number };
  unavailable?: string;
}
export type BrowserCommentAnchor = WebCommentAnchor | PdfCommentAnchor;

/** Versioned, exact preview DOM coordinates; offsets use DOM UTF-16 units. */
export interface MarkdownCommentDescriptor {
  version: 1;
  renderedText: string;
  start: { path: number[]; offset: number };
  end: { path: number[]; offset: number };
}

/** Exact source identity prevents markers from moving onto changed content. */
export interface LocalCommentAnchor {
  kind: "local";
  previousPath?: string;
  path: string;
  view: "source" | "diff" | "preview" | "path";
  identity?: string;
  startLine?: number;
  endLine?: number;
  row?: number;
  side?: "old" | "new";
  base?: string | null;
  /** Prefer the live Range; the descriptor permits exact reconstruction after remount. */
  range?: Range;
  markdown?: MarkdownCommentDescriptor;
  text?: string;
}

export type CommentSourceAnchor = BrowserCommentAnchor | LocalCommentAnchor;
