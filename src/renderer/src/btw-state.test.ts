import { expect, it } from "vitest";
import type { BtwRecord } from "../../shared/protocol";
import { consumeBtwDraft, createBtwScope, getBtwCopyText, sameBtwIdentity } from "./btw-state";

it("隔离不同文件及配置身份，统一 Windows 路径大小写", () => {
  const a = { sessionId: "id", cwd: "C:\\work", sessionFile: "C:\\work\\one.jsonl", agentDir: "C:\\agent", profile: "one" };
  expect(sameBtwIdentity(a, { ...a, cwd: "c:/WORK/", sessionFile: "c:/work/ONE.jsonl" })).toBe(true);
  expect(sameBtwIdentity(a, { ...a, sessionFile: "C:/work/two.jsonl" })).toBe(false);
  expect(sameBtwIdentity(a, { ...a, profile: "two" })).toBe(false);
  expect(sameBtwIdentity(a, { ...a, agentDir: undefined })).toBe(false);
  const scope = createBtwScope(a, "scope");
  a.cwd = "changed";
  expect(scope.identity.cwd).toBe("C:\\work");
});
it("接受只清原提交版本，编辑后即使文字相同也不消费", () => {
  const draft = { text: "问题", revision: 3, selection: { start: 1, end: 2, direction: "backward" as const } };
  expect(consumeBtwDraft(draft, 2)).toBe(draft);
  expect(consumeBtwDraft(draft, 3)).toEqual({ text: "", revision: 4, selection: { start: 0, end: 0, direction: "none" } });
});
it("复制最后非空追问答案，保留空白并回退根答案", () => {
  const record: BtwRecord = { id: "one", leafId: null, question: "q", answer: " root \n", status: "complete", createdAt: 1, updatedAt: 1,
    followUps: [{ question: "f", answer: " answer \n", status: "complete", createdAt: 2, updatedAt: 2 },
      { question: "empty", answer: " \n", status: "complete", createdAt: 3, updatedAt: 3 }] };
  expect(getBtwCopyText(record)).toBe(" answer \n");
  expect(getBtwCopyText({ ...record, followUps: [] })).toBe(" root \n");
  expect(getBtwCopyText({ ...record, answer: " ", followUps: [] })).toBeUndefined();
});
