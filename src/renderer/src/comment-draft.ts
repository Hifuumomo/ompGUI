import type { PromptContext } from "../../shared/prompt-context";
import { COMMENT_DRAFT_IMAGE_LIMIT, promptContextImageBytes, validatePromptContext } from "../../shared/prompt-context";
import type { CommentSourceAnchor } from "../../shared/comment-anchor";
import { COMMENT_PROMPT_PREAMBLE, formatContextComment } from "./prompt-context";

/** 来源快照不可变；UI 锚点从不进入模型提示词。 */
export interface DraftComment {
  id: string;
  number: number;
  revision: number;
  context: PromptContext;
  comment: string;
  sourceAnchor?: CommentSourceAnchor;
}
export interface CommentDraft {
  id: string;
  revision: number;
  text: string;
  comments: readonly DraftComment[];
  /** 同一草稿内只增不减，撤销恢复的旧 token 不会绑定到新评论；新草稿从 1 开始。 */
  nextNumber: number;
}
export function newCommentDraft(text = ""): CommentDraft {
  return { id: crypto.randomUUID(), revision: 0, text, comments: [], nextNumber: 1 };
}
export function commentToken(number: number): string { return `[评论${number}]`; }
export function validateComment(comment: string): string {
  if (!comment.trim()) throw new Error("请输入评论");
  if (comment.length > 16000) throw new Error("评论不能超过 16000 字符");
  return comment;
}
/** 只扫描原文一次；替换内容中的 token 不会再次解释。 */
export function transformCommentTokens(text: string, comments: readonly DraftComment[], mode: "expand" | "remove" | "scan", removeId?: string, imageNumbers?: ReadonlyMap<string, number>) {
  const byNumber = new Map(comments.map((entry) => [String(entry.number), entry]));
  const active = new Set<string>();
  const output = text.replace(/(\\*)\[评论([1-9]\d*)\]/g, (whole: string, slashes: string, number: string) => {
    const entry = byNumber.get(number);
    if (!entry) return whole;
    if (slashes.length % 2) return mode === "expand" ? whole.slice(1) : whole;
    active.add(entry.id);
    if (mode === "remove" && entry.id === removeId) return slashes;
    if (mode !== "expand") return whole;
    return `${slashes}${formatContextComment(entry.number, entry.context, entry.comment, imageNumbers?.get(entry.id))}`;
  });
  return { text: output, active };
}
export function activeDraftComments(draft: CommentDraft): DraftComment[] {
  const { active } = transformCommentTokens(draft.text, draft.comments, "scan");
  return draft.comments.filter((entry) => active.has(entry.id));
}
export function addDraftComment(draft: CommentDraft, number: number, context: PromptContext, comment: string, sourceAnchor?: CommentSourceAnchor): CommentDraft {
  validatePromptContext(context);
  // dormant 记录也占内存；拒绝前不修改草稿，删除记录后自然释放额度。
  let imageBytes = "image" in context && context.image ? promptContextImageBytes(context.image) : 0;
  for (const entry of draft.comments) {
    if ("image" in entry.context && entry.context.image) imageBytes += promptContextImageBytes(entry.context.image);
  }
  if (imageBytes > COMMENT_DRAFT_IMAGE_LIMIT) throw new Error("评论图片累计超过 64MiB，请删除部分评论后重试");
  const entry: DraftComment = { id: crypto.randomUUID(), number, revision: 0, context: structuredClone(context), comment: validateComment(comment), sourceAnchor };
  const separator = !draft.text || draft.text.endsWith("\n\n") ? "" : draft.text.endsWith("\n") ? "\n" : "\n\n";
  return { ...draft, revision: draft.revision + 1, text: draft.text + separator + commentToken(number), comments: [...draft.comments, entry], nextNumber: Math.max(draft.nextNumber, number + 1) };
}
export function updateDraftComment(draft: CommentDraft, id: string, comment: string): CommentDraft {
  const value = validateComment(comment);
  return { ...draft, revision: draft.revision + 1, comments: draft.comments.map((entry) => entry.id === id ? { ...entry, comment: value, revision: entry.revision + 1 } : entry) };
}
export function deleteDraftComment(draft: CommentDraft, id: string): CommentDraft {
  return { ...draft, revision: draft.revision + 1, text: transformCommentTokens(draft.text, draft.comments, "remove", id).text, comments: draft.comments.filter((entry) => entry.id !== id) };
}
export function prepareCommentSubmission(draft: CommentDraft, text = draft.text, imageOffset = 0) {
  const { active } = transformCommentTokens(text, draft.comments, "scan");
  if (active.size && /^\s*\//.test(text)) throw new Error("评论引用不能与 / 命令混发，请作为普通提示词发送");
  const images: Array<{ type: "image"; data: string; mimeType: "image/png" }> = [];
  const imageNumbers = new Map<string, number>();
  // Set 的插入顺序就是原文第一次出现顺序；重复 token 共享同一个附件序号。
  const byId = new Map(draft.comments.map(entry => [entry.id, entry]));
  for (const id of active) {
    const entry = byId.get(id)!;
    validatePromptContext(entry.context);
    if ("image" in entry.context && entry.context.image) {
      imageNumbers.set(id, imageOffset + images.length + 1);
      images.push({ type: "image", data: entry.context.image.data, mimeType: "image/png" });
    }
  }
  const expanded = transformCommentTokens(text, draft.comments, "expand", undefined, imageNumbers);
  // 撤回排队消息或回退后，展开文本可能回到输入框；已带说明的原文不再重复添加。
  const preamble = active.size && !text.startsWith(COMMENT_PROMPT_PREAMBLE) ? `${COMMENT_PROMPT_PREAMBLE}\n\n` : "";
  return { draftId: draft.id, revision: draft.revision, text: preamble + expanded.text, images };
}
