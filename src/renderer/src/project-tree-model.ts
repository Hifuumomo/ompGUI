import type { ProjectEntry } from "../../shared/project-browser";

export interface ProjectTreeNode {
  readonly entry: ProjectEntry;
  readonly children?: readonly ProjectTreeNode[];
}
export const treePath = (path: string) =>
  path.replaceAll("\\", "/").replace(/\/$/, "");

/** 从变更路径构造完整层次；已删除文件无需在磁盘中存在。 */
export function changesTree(
  root: string,
  files: readonly ProjectEntry[],
): readonly ProjectTreeNode[] {
  const nodes = new Map<
    string,
    { entry: ProjectEntry; children?: ProjectTreeNode[] }
  >();
  const roots: ProjectTreeNode[] = [];
  for (const file of files) {
    const parts = treePath(file.path)
      .slice(treePath(root).length + 1)
      .split("/");
    let parent = roots;
    let path = treePath(root);
    parts.forEach((name, index) => {
      path += `/${name}`;
      let node = nodes.get(path);
      if (!node) {
        const directory = index < parts.length - 1;
        node = {
          entry: directory ? { name, path, kind: "directory" } : file,
          children: directory ? [] : undefined,
        };
        nodes.set(path, node);
        parent.push(node);
      }
      parent = node.children ?? parent;
    });
  }
  return sortNodes(roots);
}

function sortNodes(
  nodes: readonly ProjectTreeNode[],
): readonly ProjectTreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: node.children && sortNodes(node.children),
    }))
    .sort((a, b) => {
      if (a.entry.kind !== b.entry.kind)
        return a.entry.kind === "directory" ? -1 : 1;
      return a.entry.name.localeCompare(b.entry.name, "zh-CN", {
        numeric: true,
      });
    });
}

export function directoryChanged(path: string, files: readonly ProjectEntry[]) {
  return files.some((file) =>
    treePath(file.path).startsWith(`${treePath(path)}/`),
  );
}

export function decorateEntry(
  entry: ProjectEntry,
  files: readonly ProjectEntry[],
) {
  return (
    files.find((file) => treePath(file.path) === treePath(entry.path)) ?? entry
  );
}
