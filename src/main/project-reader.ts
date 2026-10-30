import { resolve } from "node:path";
import type { ProjectDiffRequest } from "../shared/project-browser";
import type { ProjectCache } from "./project-cache";
import { readDiff, type ProjectDiffDependencies } from "./project-diff";

interface Dependencies extends ProjectDiffDependencies {
  readonly cache: ProjectCache;
  readonly version: (path: string, follow: boolean) => Promise<string>;
}

/** 文件版本每次都校验；只有内容变化才重读、重算。读期间变化的快照不入缓存。 */
export function createProjectReader(deps: Dependencies) {
  async function source(path: string): Promise<string> {
    const file = resolve(path);
    const key = `source:${file}`;
    const version = await deps.version(file, true);
    return deps.cache.load({
      key,
      version,
      read: () => deps.read(file),
      valid: async () => version === (await deps.version(file, true)),
    });
  }

  async function diff(request: ProjectDiffRequest) {
    const file = resolve(request.file.path);
    const version = await deps.version(file, false);
    return deps.cache.load({
      key: `diff:${resolve(request.cwd)}:${file}`,
      version: JSON.stringify([
        version,
        request.base,
        request.file.previousPath,
        request.file.change,
      ]),
      read: () => readDiff({ ...deps, read: source }, request),
      valid: async () => version === (await deps.version(file, false)),
    });
  }
  return { source, diff };
}
