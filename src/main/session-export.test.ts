// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { AgentMessage } from "../shared/protocol";
import { sessionMainContent } from "./session-export";
import { SessionReader } from "./session-reader";

it("只复制用户文本和最终回答，保留 Markdown 并排除内部内容", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "# 问题\n\n```ts\nrun();\n```" }, { type: "image", data: "private-image" }] },
    { role: "assistant", content: "先检查文件" },
    { role: "assistant", stopReason: "toolUse", content: [{ type: "text", text: "调用说明" }, { type: "toolCall", name: "read", arguments: {} }] },
    { role: "toolResult", content: "private-tool-result" },
    { role: "custom", content: "private-custom-summary" },
    { role: "compactionSummary", content: "private-compaction" },
    { role: "branchSummary", content: "private-branch-summary" },
    { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "private-thinking" }, { type: "text", text: "**最终**\n\n- 项目\n" }] },
  ];
  expect(sessionMainContent(messages)).toBe("## User\n\n# 问题\n\n```ts\nrun();\n```\n\n## Assistant\n\n**最终**\n\n- 项目\n");
});

it("每轮只保留最后回答，旧记录没有 stopReason 时也不混入中间 commentary", () => {
  expect(sessionMainContent([
    { role: "user", content: "第一问" },
    { role: "assistant", content: "中间说明" },
    { role: "assistant", content: "最终回答" },
    { role: "user", content: "第二问" },
    { role: "assistant", stopReason: "stop", content: "第二答" },
  ])).toBe("## User\n\n第一问\n\n## Assistant\n\n最终回答\n\n## User\n\n第二问\n\n## Assistant\n\n第二答");
});

it.each(["error", "aborted", "length", "toolUse"])("不把 %s 结束或含工具调用的消息当最终回答", (stopReason) => {
  expect(sessionMainContent([
    { role: "user", content: "问题" },
    { role: "assistant", content: "旧的说明" },
    { role: "assistant", stopReason, content: "未完成内容" },
  ])).toBe("## User\n\n问题");
  expect(sessionMainContent([
    { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "工具说明" }, { type: "toolCall", name: "read" }] },
  ])).toBe("");
});

it("工具结果后没有最终回答时不导出此前纯文本说明；空内容不制造标题", () => {
  expect(sessionMainContent([
    { role: "assistant", content: "即将调用工具" },
    { role: "toolResult", content: "工具正文" },
    { role: "user", content: [{ type: "image", data: "image" }] },
    { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "思考" }] },
  ])).toBe("");
});

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("独立 reader 只导出活动分支，不修改另一个 reader 或原始文件，损坏父链明确失败", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-export-test-"));
  roots.push(root);
  const path = join(root, "session.jsonl");
  const header = { type: "session", id: "export", version: 3, cwd: root, timestamp: "2026-10-19T00:00:00Z" };
  const records = [
    { type: "message", id: "user", parentId: null, message: { role: "user", content: "根问题" } },
    { type: "message", id: "other", parentId: "user", message: { role: "assistant", content: "旁支回答", stopReason: "stop" } },
    { type: "message", id: "current", parentId: "user", message: { role: "assistant", content: "当前回答", stopReason: "stop" } },
  ];
  const original = [header, ...records].map((record) => JSON.stringify(record)).join("\n") + "\n";
  await writeFile(path, original);
  const activeReader = new SessionReader();
  await activeReader.read(path, true);
  const exported = await new SessionReader().read(path, true);
  expect(sessionMainContent(exported!.messages)).toBe("## User\n\n根问题\n\n## Assistant\n\n当前回答");
  expect(await activeReader.read(path)).toBeNull();
  expect(await readFile(path, "utf8")).toBe(original);
  await writeFile(path, [header, { ...records[2], parentId: "missing" }].map((record) => JSON.stringify(record)).join("\n") + "\n");
  await expect(new SessionReader().read(path, true)).rejects.toThrow("缺少节点");
  await expect(new SessionReader().read(join(root, "missing.jsonl"), true)).rejects.toThrow();
});
