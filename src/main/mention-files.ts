import * as fs from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

const RESULT_LIMIT = 30;
const EXCLUDED_DIRECTORIES: Record<string, true> = {
  node_modules: true,
  ".git": true,
};

type Match = { path: string; rank: number; gaps: number };

/**
 * 按字符顺序计算模糊匹配间隔，不把查询当成文件系统路径。
 * 参数：[in] value 小写候选路径或文件名；[in] query 小写查询。
 * 返回值：匹配类别与间隔数；不匹配时返回 undefined。
 */
function score(value: string, query: string): [number, number] | undefined {
  if (value === query) return [0, 0];
  if (value.startsWith(query)) return [1, 0];
  const substring = value.indexOf(query);
  if (substring !== -1) return [2, substring];
  let position = 0;
  let first = -1;
  for (const character of query) {
    const next = value.indexOf(character, position);
    if (next === -1) return;
    if (first === -1) first = next;
    position = next + 1;
  }
  return [3, position - first - query.length];
}

/**
 * 确定排序：文件名优先于路径，再按紧密度、长度与字符序排列。
 * 参数：[in] left 左侧匹配；[in] right 右侧匹配。
 * 返回值：标准排序比较值，不依赖系统 locale 或目录枚举顺序。
 */
function compareMatches(left: Match, right: Match): number {
  const difference =
    left.rank - right.rank ||
    left.gaps - right.gaps ||
    left.path.length - right.path.length;
  if (difference) return difference;
  const a = left.path.toLowerCase();
  const b = right.path.toLowerCase();
  if (a !== b) return a < b ? -1 : 1;
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

/**
 * 仅枚举工作目录内部普通文件，为 @ 补全返回最多三十条真实相对路径。
 * 参数：[in] cwd 绝对工作目录；[in] query 文件名或相对路径模糊查询，可为空。
 * 返回值：正斜线相对路径；非法目录、权限及文件系统错误通过 Promise 拒绝。
 */
export async function searchMentionFiles(
  cwd: string,
  query: string,
): Promise<string[]> {
  if (!isAbsolute(cwd)) throw new Error("文件引用工作目录必须是绝对路径");
  const root = await fs.realpath(cwd);
  const needle = query.replaceAll("\\", "/").toLowerCase();
  const matches: Match[] = [];

  /**
   * 异步遍历目录元数据，跳过依赖、Git 内部目录及符号链接，不读取内容。
   * 参数：[in] directory 当前工作目录内的绝对目录。
   * 返回值：枚举完成的 Promise；读取错误明确拒绝。
   */
  async function visit(directory: string): Promise<void> {
    const entries = await fs.opendir(directory);
    for await (const entry of entries) {
      const absolute = join(directory, entry.name);
      // 不跟随链接或 junction，避免越出 cwd、循环遍历或进入外部依赖树。
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!Object.hasOwn(EXCLUDED_DIRECTORIES, entry.name.toLowerCase()))
          await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const path = relative(root, absolute).split(sep).join("/");
      const nameScore = score(entry.name.toLowerCase(), needle);
      const pathScore = nameScore ?? score(path.toLowerCase(), needle);
      if (!pathScore) continue;
      const [rank, gaps] = pathScore;
      const match = { path, rank: rank + (nameScore ? 0 : 4), gaps };
      // 只保存最佳三十条；已满时跳过更差候选，避免逐文件重复排序。
      if (
        matches.length === RESULT_LIMIT &&
        compareMatches(match, matches[RESULT_LIMIT - 1]) >= 0
      )
        continue;
      matches.push(match);
      matches.sort(compareMatches);
      if (matches.length > RESULT_LIMIT) matches.pop();
    }
  }

  await visit(root);
  const paths: string[] = [];
  for (const match of matches) paths.push(match.path);
  return paths;
}
