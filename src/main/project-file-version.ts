import type { BigIntStats } from "node:fs";

interface FileSystem {
  readonly lstat: (
    path: string,
    options: { bigint: true },
  ) => Promise<BigIntStats>;
  readonly stat: (
    path: string,
    options: { bigint: true },
  ) => Promise<BigIntStats>;
}
function stamp(info: BigIntStats) {
  return [
    info.dev,
    info.ino,
    info.mode,
    info.size,
    info.mtimeNs,
    info.ctimeNs,
  ].join(":");
}

/** 链接源码需同时检查链接与目标；Diff 的 Git blob 则表示链接本身。 */
export async function projectFileVersion(
  fs: FileSystem,
  path: string,
  follow: boolean,
) {
  try {
    const info = await fs.lstat(path, { bigint: true });
    const target =
      follow && info.isSymbolicLink()
        ? stamp(await fs.stat(path, { bigint: true }))
        : "";
    return `${stamp(info)}:${target}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}
