// @vitest-environment node
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffLines } from "diff";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectBrowser } from "./project-browser";
import { ProjectCache } from "./project-cache";
import { projectFileVersion } from "./project-file-version";
import { createProjectReader } from "./project-reader";
import { gitOutput, runProjectGit } from "./project-git";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "review-reader-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
function fixture() {
  const read = vi.fn(createProjectBrowser(fs).readProjectFile);
  const run = vi.fn(runProjectGit);
  const compare = vi.fn(async (before: string, after: string) =>
    diffLines(before, after, { stripTrailingCr: true }),
  );
  const cache = new ProjectCache(1024 * 1024);
  const reader = createProjectReader({
    cache,
    read,
    run,
    compare,
    lstat: fs.lstat,
    readlink: fs.readlink,
    version: (path, follow) => projectFileVersion(fs, path, follow),
  });
  return { reader, read, run, compare, cache };
}

it("文件 A/B/A 复用源码；外部修改、删除重建都会失效", async () => {
  const { reader, read } = fixture();
  const a = join(root, "a.ts");
  const b = join(root, "b.ts");
  await fs.writeFile(a, "old");
  await fs.writeFile(b, "other");
  expect(await reader.source(a)).toBe("old");
  await reader.source(b);
  expect(await reader.source(a)).toBe("old");
  expect(read).toHaveBeenCalledTimes(2);
  await fs.writeFile(a, "new content");
  expect(await reader.source(a)).toBe("new content");
  await fs.unlink(a);
  await expect(reader.source(a)).rejects.toThrow();
  await fs.writeFile(a, "rebuilt");
  expect(await reader.source(a)).toBe("rebuilt");
});

it("Diff 缓存命中不重新调用 Git/比较；源码复用；内容和基线变化分别失效", async () => {
  const f = fixture();
  const path = join(root, "a.ts");
  await gitOutput(runProjectGit, root, ["init"]);
  await fs.writeFile(path, "old\n");
  await gitOutput(runProjectGit, root, ["add", "."]);
  await gitOutput(runProjectGit, root, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "base",
  ]);
  const base = (await gitOutput(runProjectGit, root, ["rev-parse", "HEAD"]))
    .toString()
    .trim();
  const request = {
    cwd: root,
    base,
    file: { path, name: "a.ts", kind: "file" as const },
  };
  await fs.writeFile(path, "new\n");
  const first = await f.reader.diff(request);
  expect(await f.reader.diff(request)).toBe(first);
  expect(f.run).toHaveBeenCalledTimes(2);
  expect(f.compare).toHaveBeenCalledOnce();
  expect(await f.reader.source(path)).toBe("new\n");
  expect(f.read).toHaveBeenCalledOnce();
  await fs.writeFile(path, "latest\n");
  expect((await f.reader.diff(request)).after).toBe("latest\n");
  expect((await f.reader.diff({ ...request, base: null })).before).toBe("");
  expect(f.compare).toHaveBeenCalledTimes(3);
});

it("超过缓存预算的源码仍完整读取且不长期保留", async () => {
  const f = fixture();
  const path = join(root, "a.ts");
  await fs.writeFile(path, "x".repeat(1024 * 1024));
  await f.reader.source(path);
  await f.reader.source(path);
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.cache.usage.entries).toBe(0);
});

it("同长度修改且恢复 mtime 后，仍通过 ctime 识别更新", async () => {
  const { reader } = fixture();
  const path = join(root, "same.txt");
  await fs.writeFile(path, "old");
  const info = await fs.stat(path);
  expect(await reader.source(path)).toBe("old");
  await fs.writeFile(path, "new");
  await fs.utimes(path, info.atime, info.mtime);
  expect(await reader.source(path)).toBe("new");
});
