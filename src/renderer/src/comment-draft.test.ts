import { expect, it } from "vitest";
import type { PromptContext } from "../../shared/prompt-context";
import { activeDraftComments, addDraftComment, deleteDraftComment, newCommentDraft, prepareCommentSubmission, updateDraftComment } from "./comment-draft";

const source: PromptContext = { kind: "web", url: "https://example.test", title: "原始页面", text: "原文中的 [评论2] 不是引用" };
it("按原文顺序单次展开，重复编号相同且引用内容不递归解释", () => {
  let draft = addDraftComment(newCommentDraft(), 1, source, "解释甲");
  draft = addDraftComment(draft, 2, { ...source, text: "第二段" }, "解释乙");
  const result = prepareCommentSubmission({ ...draft, text: "比较 [评论2] 与 [评论1]，再看 [评论2]" }).text;
  expect(result.indexOf("解释乙")).toBeLessThan(result.indexOf("解释甲"));
  expect(result.match(/解释乙/g)).toHaveLength(2);
  expect(result).toContain("原文中的 [评论2] 不是引用");
  expect(result).toContain("https://example.test");
});
it("未知编号原样保留，奇数反斜杠仅移除一层且不激活标记", () => {
  const draft = addDraftComment(newCommentDraft(), 1, source, "解释");
  const escaped = { ...draft, text: String.raw`\[评论1] \\\[评论1] [评论99]` };
  expect(activeDraftComments(escaped)).toEqual([]);
  expect(prepareCommentSubmission(escaped).text).toBe(String.raw`[评论1] \\[评论1] [评论99]`);
  const even = { ...draft, text: String.raw`\\[评论1]` };
  expect(activeDraftComments(even).map((entry) => entry.number)).toEqual([1]);
  expect(prepareCommentSubmission(even).text.startsWith(String.raw`\\评论1`)).toBe(true);
});
it("删除最后一个token休眠，撤销恢复；显式删除只移除该编号未转义项", () => {
  const draft = addDraftComment(newCommentDraft("问题"), 1, source, "解释");
  expect(activeDraftComments({ ...draft, text: "问题" })).toEqual([]);
  expect(activeDraftComments({ ...draft, text: "问题 [评论1]" })).toHaveLength(1);
  const deleted = deleteDraftComment({ ...draft, text: String.raw`前 [评论1] 中 \[评论1] 后 [评论1]` }, draft.comments[0].id);
  expect(deleted.text).toBe(String.raw`前  中 \[评论1] 后 `);
  expect(deleted.comments).toEqual([]);
});
it("编辑仅改变评论，保留编号和原始快照，外部修改不污染快照", () => {
  const context = { ...source };
  const draft = addDraftComment(newCommentDraft(), 9, context, "原评论");
  context.text = "页面后来变了";
  const comment = "  新评论\n保留换行与末尾空白 \n";
  const edited = updateDraftComment(draft, draft.comments[0].id, comment);
  expect(edited.comments[0]).toMatchObject({ number: 9, comment, context: source });
  const payload = prepareCommentSubmission(edited).text;
  expect(payload).not.toContain("页面后来变了");
  expect(payload.endsWith(`评论：${comment}`)).toBe(true);
});
it("拒绝slash与已登记引用混发，但不阻止未知编号的普通命令", () => {
  const draft = addDraftComment(newCommentDraft(), 1, source, "解释");
  expect(() => prepareCommentSubmission({ ...draft, text: "/new [评论1]" })).toThrow();
  expect(prepareCommentSubmission({ ...draft, text: "/jobs [评论90]" }).text).toBe("/jobs [评论90]");
});

const png = { mimeType: "image/png" as const, width: 1, height: 1, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=" };
it("按首次有效token顺序追加图片，重复token复用编号且不发送转义、未知、休眠图片", () => {
  const one: PromptContext = { kind: "pdf", url: "https://example.test/a.pdf", title: "论文", page: 2, selection: "figure", text: "图注", image: png };
  const two: PromptContext = { kind: "web-region", url: "https://example.test/page", title: "区域", image: png };
  let draft = addDraftComment(newCommentDraft(), 1, one, "甲");
  draft = addDraftComment(draft, 2, two, "乙");
  draft = addDraftComment(draft, 3, one, "休眠");
  const prepared = prepareCommentSubmission(draft, "[评论2] [评论1] [评论2] \\[评论3] [评论99]", 1);
  expect(prepared.images).toEqual([{ type: "image", data: png.data, mimeType: "image/png" }, { type: "image", data: png.data, mimeType: "image/png" }]);
  expect(prepared.text.match(/附图：本条消息第2张图片/g)).toHaveLength(2);
  expect(prepared.text.match(/附图：本条消息第3张图片/g)).toHaveLength(1);
  expect(prepared.text).not.toContain("第4张图片");
  expect(prepared.text).not.toContain(png.data);
  expect(prepared).toMatchObject({ draftId: draft.id, revision: draft.revision });
  const deleted = deleteDraftComment(draft, draft.comments[1].id);
  expect(prepareCommentSubmission(deleted, "[评论2]").images).toEqual([]);
});
it("图像快照编辑不变，累计额度包含休眠记录且拒绝不改变原草稿", () => {
  const context: PromptContext = { kind: "pdf", url: "https://example.test/a.pdf", title: "论文", page: 1, selection: "region", text: "原文", image: { ...png } };
  const original = addDraftComment(newCommentDraft(), 1, context, "旧评论");
  context.image!.data = "被外部修改";
  const edited = updateDraftComment(original, original.comments[0].id, "新评论");
  expect(edited.comments[0].context).toMatchObject({ text: "原文", image: png });
  // 保留真实PNG头并补足载荷，额度以解码字节而不是base64字符串长度计算。
  const data = png.data.slice(0, 44) + "AAAA".repeat(6 * 1024 * 1024 - 11);
  const large = { ...png, data };
  const dormant = { ...original, text: "", comments: [1, 2, 3].map(number => ({ ...original.comments[0], id: String(number), number, context: { kind: "web-region" as const, url: "https://example.test", title: "大图", image: large } })) };
  expect(() => addDraftComment(dormant, 4, { kind: "web-region", url: "https://example.test", title: "大图", image: large }, "超额")).toThrow("64MiB");
  expect(dormant.comments).toHaveLength(3);
  expect(dormant.text).toBe("");
  const released = deleteDraftComment(dormant, "1");
  expect(addDraftComment(released, 4, { kind: "web-region", url: "https://example.test", title: "大图", image: large }, "可加入").comments).toHaveLength(3);
});
