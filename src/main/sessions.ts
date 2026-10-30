import { existsSync } from "node:fs";
import { access, open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionSummary } from "../shared/protocol";

/**
 * 解析原生会话文件的元数据，不读取或改写历史。
 * 参数：[in] file 原生 JSONL 文件路径。
 * 返回值：文件头、标题槽与文件时间组成的会话摘要。
 */
async function parseSessionHeader(file: string): Promise<SessionSummary> {
  const absolute = resolve(file);
  const handle = await open(absolute, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`会话路径不是文件：${absolute}`);
    // 只读有限前缀；当前格式第一行为固定标题槽，旧格式直接以 header 开始。
    const buffer = Buffer.alloc(Math.min(stat.size, 64 * 1024));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    // 丢弃前缀中尚未完整读到的历史行，避免截断 UTF-8 多字节字符。
    const prefix = buffer.subarray(0, bytesRead);
    const completeEnd =
      bytesRead < stat.size ? prefix.lastIndexOf(10) + 1 : bytesRead;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      prefix.subarray(0, completeEnd),
    );
    const lines = text.split("\n");
    let index = 0;
    while (index < lines.length && !lines[index].trim()) index++;
    let first = JSON.parse(lines[index++] ?? "") as Record<string, unknown>;
    let title: string | undefined;
    if (first.type === "title") {
      title = typeof first.title === "string" ? first.title.trim() : undefined;
      first = JSON.parse(lines[index++] ?? "") as Record<string, unknown>;
    }
    if (first.type !== "session" || typeof first.id !== "string") {
      throw new Error(`不是有效的 omp 会话文件：${absolute}`);
    }
    // 首条完整用户消息只用于无标题旧会话的列表标签，截断的历史行不做解析。
    if (!title && typeof first.title === "string") title = first.title.trim();
    if (!title) {
      for (let lineIndex = index; lineIndex < lines.length - 1; lineIndex++) {
        if (!lines[lineIndex].trim()) continue;
        const entry = JSON.parse(lines[lineIndex]) as Record<string, unknown>;
        const message = entry.message as
          { role?: string; content?: unknown } | undefined;
        if (message?.role !== "user") continue;
        if (typeof message.content === "string") title = message.content;
        else if (Array.isArray(message.content)) {
          title = message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join(" ");
        }
        break;
      }
    }
    const timestamp =
      typeof first.timestamp === "string"
        ? first.timestamp
        : stat.birthtime.toISOString();
    return {
      path: absolute,
      id: first.id,
      cwd: typeof first.cwd === "string" ? first.cwd : "",
      title:
        title?.split(/\r?\n/)[0].slice(0, 140) || `未命名会话 · ${timestamp}`,
      timestamp,
      modified: stat.mtimeMs,
      parentSession:
        typeof first.parentSession === "string"
          ? first.parentSession
          : undefined,
    };
  } finally {
    await handle.close();
  }
}

/**
 * 从原生数据库只读补充最新 recap；缺库或缺表表示尚无 recap。
 * 参数：[in,out] summaries 待补充的摘要；[in] database 原生数据库路径；
 * [in] report 可选错误报告回调。
 * 返回值：补充完成后的 Promise；无返回数据。
 */
async function enrichRecaps(
  summaries: SessionSummary[],
  database: string,
  report?: (path: string, error: unknown) => void,
): Promise<void> {
  try {
    await access(database);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") report?.(database, error);
    return;
  }
  try {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_recaps'").get()) return;
      // 时间戳相同也按原生递增 id 选择唯一最新记录，cwd 不做路径归一化。
      const latest = db.prepare(
        "SELECT recap, created_at FROM session_recaps WHERE session_id = ? AND cwd = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      );
      for (const summary of summaries) {
        const row = latest.get(summary.id, summary.cwd);
        if (row) summary.recap = {
          text: row.recap as string,
          createdAt: row.created_at as number,
        };
      }
    } finally {
      db.close();
    }
  } catch (error) {
    // Recap 损坏不能阻止打开仍然健康的 JSONL 历史。
    report?.(database, error);
  }
}

/**
 * 读取原生摘要并附带已存储的 recap，不生成或写入任何数据。
 * 参数：[in] file JSONL 路径；[in] database 原生历史数据库路径；
 * [in] report 可选 recap 读取错误报告回调。
 * 返回值：可包含最新原生 recap 的会话摘要。
 */
export async function readSessionHeader(
  file: string,
  database = join(dirname(sessionsRoot()), "history.db"),
  report?: (path: string, error: unknown) => void,
): Promise<SessionSummary> {
  const summary = await parseSessionHeader(file);
  await enrichRecaps([summary], database, report);
  return summary;
}

/**
 * 按原生 v18.8.9 规则规范化并校验 profile 名称。
 * 参数：[in] profile 显式或环境提供的 profile。
 * 返回值：具名 profile；默认 profile 返回 undefined。
 */
function normalizeProfile(profile?: string): string | undefined {
  const name = profile?.trim();
  if (!name || name === "default") return undefined;
  if (
    name === "." ||
    name === ".." ||
    name.endsWith(".") ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name) ||
    /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\..*)?$/i.test(name)
  ) {
    throw new Error(`Invalid OMP profile "${profile}"`);
  }
  return name;
}

/**
 * 解析原生 profile/agentDir 的会话目录。
 * 参数：[in] agentDir 显式代理目录；[in] profile 原生配置 profile。
 * 返回值：原生 sessions 根目录。
 */
export function sessionsRoot(agentDir?: string, profile?: string): string {
  const selected = normalizeProfile(
    profile ?? process.env.OMP_PROFILE ?? process.env.PI_PROFILE,
  );
  const configRoot = join(homedir(), process.env.PI_CONFIG_DIR || ".omp");
  const defaultAgent = selected
    ? join(configRoot, "profiles", selected, "agent")
    : join(configRoot, "agent");
  let override = agentDir || process.env.PI_CODING_AGENT_DIR;
  // 默认模式不能继承父进程为低优先级 PI_PROFILE 派生的代理目录。
  if (!selected && override) {
    let inheritedProfile: string | undefined;
    try {
      inheritedProfile = normalizeProfile(process.env.PI_PROFILE);
    } catch {
      // 原生 snapshot 忽略未激活的无效 legacy profile，不影响有效默认配置。
    }
    if (
      inheritedProfile &&
      override === join(configRoot, "profiles", inheritedProfile, "agent")
    ) {
      override = undefined;
    }
  }
  const agent = !selected && override ? resolve(override) : defaultAgent;
  // 原生仅在已迁移的 XDG app/profile 目录存在时使用扁平 sessions 路径。
  if (
    (process.platform === "linux" || process.platform === "darwin") &&
    agent === defaultAgent &&
    process.env.XDG_DATA_HOME
  ) {
    const xdgRoot = selected
      ? join(process.env.XDG_DATA_HOME, "omp", "profiles", selected)
      : join(process.env.XDG_DATA_HOME, "omp");
    if (existsSync(xdgRoot)) return join(xdgRoot, "sessions");
  }
  return join(agent, "sessions");
}

/**
 * 只读枚举原生 sessions 根目录和 encoded-cwd 子目录。
 * 参数：[in] agentDir 可选代理目录；[in] profile 可选原生 profile；
 * [in] report 可选跳过报告回调，接收失败路径和原始错误。
 * 返回值：按最近修改时间排序的健康会话摘要；不存在的默认目录为空列表。
 */
export async function listNativeSessions(
  agentDir?: string,
  profile?: string,
  report?: (path: string, error: unknown) => void,
): Promise<SessionSummary[]> {
  const root = sessionsRoot(agentDir, profile);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    report?.(root, error);
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl"))
      files.push(join(root, entry.name));
    if (!entry.isDirectory()) continue;
    const bucket = join(root, entry.name);
    try {
      for (const child of await readdir(bucket, { withFileTypes: true })) {
        if (child.isFile() && child.name.endsWith(".jsonl"))
          files.push(join(bucket, child.name));
      }
    } catch (error) {
      // 单个被移除或不可读的 cwd bucket 不能隐藏其他工作目录的会话。
      report?.(bucket, error);
    }
  }
  const result: SessionSummary[] = [];
  // 顺序读取限制同时打开的句柄；每个文件最多读取 64 KiB，而不是整个历史。
  for (const file of files) {
    try {
      result.push(await parseSessionHeader(file));
    } catch (error) {
      // 列表隔离坏文件；显式恢复仍使用严格的 readSessionHeader 并抛出错误。
      report?.(file, error);
    }
  }
  await enrichRecaps(result, join(dirname(root), "history.db"), report);
  return result.sort((left, right) => right.modified - left.modified);
}
