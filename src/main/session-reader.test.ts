// @vitest-environment node
import {
  mkdtemp,
  writeFile,
  readFile,
  appendFile,
  stat,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SessionReader } from "./session-reader";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const header = {
  type: "session",
  id: "read-only",
  version: 3,
  cwd: "D:/test",
  timestamp: "2026-10-14T00:00:00Z",
};
const record = (id: string, parentId: string | null, text: string) => ({
  type: "message",
  id,
  parentId,
  timestamp: header.timestamp,
  message: { role: "user", content: text },
});
async function fixture(records: unknown[]) {
  const root = await mkdtemp(join(tmpdir(), "omp-reader-test-"));
  roots.push(root);
  const path = join(root, "session.jsonl");
  await writeFile(
    path,
    [header, ...records].map((entry) => JSON.stringify(entry)).join("\n") +
      "\n",
  );
  return { root, path };
}

it("反复查看不写文件、不创建副本，只展示当前父链", async () => {
  const { root, path } = await fixture([
    record("one", null, "根"),
    record("branch", "one", "旁支"),
    record("two", "one", "当前分支"),
  ]);
  const before = await stat(path);
  const original = await readFile(path);
  const reader = new SessionReader();
  expect(
    (await reader.read(path))?.messages.map((message) => message.content),
  ).toEqual(["根", "当前分支"]);
  expect(await reader.read(path)).toBeNull();
  await reader.read(path, true);
  expect(await readFile(path)).toEqual(original);
  expect((await stat(path)).mtimeMs).toBe(before.mtimeMs);
  expect(await readdir(root)).toEqual(["session.jsonl"]);
});

it("忽略尚未写完的末行，写完后刷新；截断重写后不残留旧内容", async () => {
  const { path } = await fixture([record("one", null, "完整消息")]);
  const next = JSON.stringify(record("two", "one", "新的消息"));
  await appendFile(path, next.slice(0, 25));
  const reader = new SessionReader();
  expect((await reader.read(path))?.messages).toHaveLength(1);
  await appendFile(path, next.slice(25) + "\n");
  expect((await reader.read(path))?.messages).toHaveLength(2);
  await writeFile(
    path,
    [header, record("replacement", null, "替换后")]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  expect(
    (await reader.read(path))?.messages.map((message) => message.content),
  ).toEqual(["替换后"]);
});

it("缺失、损坏及父链异常明确失败，原文件保持不变", async () => {
  const { path } = await fixture([record("one", "missing", "消息")]);
  const original = await readFile(path);
  await expect(new SessionReader().read(path)).rejects.toThrow("缺少节点");
  expect(await readFile(path)).toEqual(original);
  await expect(new SessionReader().read(path + ".missing")).rejects.toThrow();
});

it("只读快照恢复原生 TODO 手动编辑和清空，不混入旁支", async () => {
  const phases = [
    {
      name: "阶段",
      tasks: [{ content: "工作", status: "blocked", blocker: "等待输入" }],
    },
  ];
  const { path } = await fixture([
    {
      type: "custom",
      id: "plan",
      parentId: null,
      timestamp: header.timestamp,
      customType: "user_todo_edit",
      data: { phases },
    },
    {
      type: "custom",
      id: "other",
      parentId: "plan",
      timestamp: header.timestamp,
      customType: "user_todo_edit",
      data: { phases: [] },
    },
    record("leaf", "plan", "当前分支"),
  ]);
  const reader = new SessionReader();
  expect((await reader.read(path))?.todoPhases).toEqual(phases);
  await appendFile(
    path,
    JSON.stringify({
      type: "custom",
      id: "clear",
      parentId: "leaf",
      timestamp: header.timestamp,
      customType: "user_todo_edit",
      data: { phases: [] },
    }) + "\n",
  );
  expect((await reader.read(path))?.todoPhases).toEqual([]);
});
