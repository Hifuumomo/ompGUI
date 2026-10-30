import { parentPort } from "node:worker_threads";
import * as fs from "node:fs/promises";
import { diffLines } from "diff";
import { createProjectBrowser } from "./project-browser";
import { ProjectCache, projectCacheBudget } from "./project-cache";
import { projectFileVersion } from "./project-file-version";
import { createProjectReader } from "./project-reader";
import { runProjectGit } from "./project-git";
import type { ProjectReply, ProjectWork } from "./project-worker-protocol";
import { searchMentionFiles } from "./mention-files";

const port = parentPort!;
const browser = createProjectBrowser(fs);
const reader = createProjectReader({
  cache: new ProjectCache(projectCacheBudget(process.env.OMP_PROJECT_CACHE_MB)),
  version: (path, follow) => projectFileVersion(fs, path, follow),
  run: runProjectGit,
  read: browser.readProjectFile,
  lstat: fs.lstat,
  readlink: fs.readlink,
  // 同步算法只在独立线程中执行，不占用 Electron 主线程，也不逐轮等待定时器。
  compare: async (before, after) =>
    diffLines(before, after, { stripTrailingCr: true }),
});

/**
 * 在独立线程中执行文件操作并回传明确成功或错误结果。
 * 参数：[in] job 主进程提交的文件任务及请求 id。
 * 返回值：无。
 */
port.on("message", async (job: ProjectWork) => {
  let reply: ProjectReply;
  try {
    const value =
      job.type === "source"
        ? await reader.source(job.path)
        : job.type === "diff"
          ? await reader.diff(job.request)
          : await searchMentionFiles(job.cwd, job.query);
    reply = { id: job.id, value };
  } catch (error) {
    reply = {
      id: job.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  port.postMessage(reply);
});
