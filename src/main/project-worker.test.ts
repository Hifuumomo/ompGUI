// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ProjectWorkerClient } from "./project-worker-client";

let root: string;
let client: ProjectWorkerClient;
beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "review-worker-"));
  const output = join(root, "worker.cjs");
  buildSync({
    entryPoints: [resolve("src/main/project-worker.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: output,
  });
  client = new ProjectWorkerClient(() => new Worker(output));
});
afterAll(async () => {
  await client.close();
  await fs.rm(root, { recursive: true, force: true });
});

it("真实线程返回完整新增差异及缓存结果，源文件修改后读取最新内容", async () => {
  const path = join(root, "large.ts");
  const content = Array.from(
    { length: 500 },
    (_, i) => `const x${i} = ${i};\n`,
  ).join("");
  await fs.writeFile(path, content);
  const request = {
    cwd: root,
    base: null,
    file: { path, name: "large.ts", kind: "file" as const },
  };
  const first = await client.diff(request);
  expect(first.after).toBe(content);
  expect(first.rows).toHaveLength(500);
  expect(await client.diff(request)).toEqual(first);
  await fs.writeFile(path, "changed\n");
  expect(await client.source(path)).toBe("changed\n");
});

it("线程读取错误明确返回，后续合法读取正常", async () => {
  await expect(client.source(join(root, "missing"))).rejects.toThrow();
  const path = join(root, "ok.txt");
  await fs.writeFile(path, "ok");
  expect(await client.source(path)).toBe("ok");
});

it("线程启动失败会拒绝请求，不挂起或返回假结果", async () => {
  const broken = new ProjectWorkerClient(
    () => new Worker(join(root, "missing-worker.cjs")),
  );
  await expect(broken.source("unused")).rejects.toThrow();
  await broken.close();
});

/**
 * 验证文件补全真实跨线程运行且不依赖会话或文件内容解码。
 * 参数：无。
 * 返回值：跨线程搜索断言完成的 Promise。
 */
async function searchesMentionFilesInWorker(): Promise<void> {
  const cwd = join(root, "mention-workspace");
  await fs.mkdir(join(cwd, "src"), { recursive: true });
  await fs.writeFile(join(cwd, "src", "File Mention.ts"), Buffer.from([0, 255]));
  expect(await client.searchMentionFiles(cwd, "flmnt")).toEqual([
    "src/File Mention.ts",
  ]);
  expect(await client.searchMentionFiles(cwd, "src\\File")).toEqual([
    "src/File Mention.ts",
  ]);
  await expect(
    client.searchMentionFiles(join(cwd, "missing"), ""),
  ).rejects.toThrow();
  expect(await client.searchMentionFiles(cwd, "")).toEqual([
    "src/File Mention.ts",
  ]);
}

it("真实文件线程提供独立于 OMP 连接的文件引用搜索", searchesMentionFilesInWorker);
