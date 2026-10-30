import { open, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { ReadOnlySession, SessionEntry } from "../shared/protocol";
import {
  sessionHistoryMessages,
  sessionHistoryTodos,
} from "../shared/session-history";
import { readSessionHeader, sessionsRoot } from "./sessions";

/** 还原原生外置图片，只接受内容哈希，绝不把会话中的任意字符串当文件路径。 */
async function hydrateImages(value: unknown, blobDir: string): Promise<void> {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) await hydrateImages(item, blobDir);
    return;
  }
  const object = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(object)) {
    if (key === "frames") continue;
    const imageField =
      key === "image_url" ||
      (key === "result" && object.type === "image_generation_call") ||
      (key === "data" &&
        (object.type === "image" || typeof object.mimeType === "string"));
    const hash =
      imageField && typeof child === "string"
        ? /^blob:sha256:([a-f0-9]{64})$/.exec(child)?.[1]
        : undefined;
    if (hash) {
      try {
        object[key] = (await readFile(join(blobDir, hash))).toString(
          key === "image_url" ? "utf8" : "base64",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } else await hydrateImages(child, blobDir);
  }
}

/** 只读解析原生 JSONL；不创建 SessionManager，不触发迁移、修复、锁定或写入。 */
export class SessionReader {
  private signature?: string; // 上次成功读取的 JSONL 文件签名。
  private snapshot?: ReadOnlySession; // 复用未修改的历史，仅更新独立数据库中的 recap。
  /**
   * 配置只读历史的外置资源目录和 recap 错误报告。
   * 参数：[in] fallbackBlobDir 非原生目录会话使用的图片目录；
   * [in] report 可选原生 recap 数据库读取错误回调。
   * 返回值：无。
   */
  constructor(
    private readonly fallbackBlobDir = join(dirname(sessionsRoot()), "blobs"), // 当前配置的原生图片目录。
    private readonly report?: (path: string, error: unknown) => void, // 非致命 recap 错误报告。
  ) {}

  /**
   * 返回一致文件快照，独立检查数据库中的 recap 变化。
   * 参数：[in] path 会话路径；[in] force 是否强制返回快照；
   * [in] attempt 文件变化时的当前重试次数。
   * 返回值：历史或 recap 变化后的快照；均未改变时为 null。
   */
  async read(
    path: string,
    force = false,
    attempt = 0,
  ): Promise<ReadOnlySession | null> {
    const absolute = resolve(path);
    const handle = await open(absolute, "r");
    try {
      const stat = await handle.stat();
      const signature = `${absolute}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      const summary = await readSessionHeader(
        absolute,
        join(dirname(this.fallbackBlobDir), "history.db"),
        this.report,
      );
      // Recap 由原生引擎独立写入 SQLite，不能用 JSONL 的 mtime 判断其变化。
      if (!force && signature === this.signature && this.snapshot) {
        const previous = this.snapshot.summary.recap;
        if (previous?.text === summary.recap?.text &&
            previous?.createdAt === summary.recap?.createdAt) return null;
        this.snapshot = { ...this.snapshot, summary };
        return this.snapshot;
      }
      const entries: SessionEntry[] = [];
      let headerId: string | undefined;
      let pending = "";
      // 读到启动时的文件大小，避免持续追加使一次刷新永不结束。
      const stream = handle.createReadStream({
        start: 0,
        end: Math.max(0, stat.size - 1),
        autoClose: false,
      });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      const accept = (line: string) => {
        if (!line.trim()) return;
        const entry = JSON.parse(line);
        if (entry.type === "title") return;
        if (!headerId) {
          if (entry.type !== "session" || typeof entry.id !== "string")
            throw new Error("会话文件头无效");
          headerId = entry.id;
          return;
        }
        if (
          typeof entry.id !== "string" ||
          !(entry.parentId === null || typeof entry.parentId === "string")
        )
          throw new Error("会话记录结构无效");
        entries.push(entry);
      };
      for await (const line of lines) {
        if (pending) accept(pending);
        pending = line;
      }
      // readline 也会交付没有换行的尾部；只有完整 JSON 才纳入快照。
      if (pending.trim()) {
        try {
          JSON.parse(pending);
        } catch {
          pending = "";
        }
        if (pending) accept(pending);
      }
      const after = await handle.stat();
      if (
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        headerId !== summary.id
      ) {
        if (attempt >= 2) throw new Error("会话文件正在变化，请稍后重试");
        return this.read(path, force, attempt + 1);
      }
      const snapshot = {
        entries,
        leafId: entries.at(-1)?.id ?? null,
      };
      const messages = sessionHistoryMessages(snapshot);
      const todoPhases = sessionHistoryTodos(snapshot);
      let ancestor = dirname(absolute);
      while (
        basename(ancestor) !== "sessions" &&
        dirname(ancestor) !== ancestor
      )
        ancestor = dirname(ancestor);
      const blobDir =
        basename(ancestor) === "sessions"
          ? join(dirname(ancestor), "blobs")
          : this.fallbackBlobDir;
      await hydrateImages(messages, blobDir);
      this.signature = signature;
      this.snapshot = { summary, messages, todoPhases };
      return this.snapshot;
    } finally {
      await handle.close();
    }
  }
}
