export type ToolTarget =
  | { kind: "file"; label: string; path: string }
  | { kind: "command"; label: string; command: string }
  | { kind: "url"; label: string; url: string }
  | { kind: "query"; label: string; text: string };

/**
 * 判断是否为 grep/glob 类搜索工具；其输出按行解析为可点击的文件位置。
 * 参数：[in] name 原生工具名。返回值：是搜索类工具时为 true。
 */
export function isSearchTool(name: string): boolean {
  const op = operation(name);
  return op === "grep" || op === "glob";
}

export interface ToolDescription {
  verb: string;
  targets: ToolTarget[];
  summary?: string;
}

/**
 * 识别工具名的末级名称，不以命名空间或调用 ID 猜测目标。
 * 参数：[in] name 原生工具名。返回值：已知操作类别或空字符串。
 */
function operation(name: string): string {
  const normalized = name.toLowerCase();
  const leaf = normalized.split(/__|[.:/]/).pop() ?? "";
  const aliases: Record<string, string> = {
    read: "read",
    read_file: "read",
    write: "write",
    write_file: "write",
    create_text_file: "write",
    edit: "edit",
    apply_patch: "edit",
    replace_content: "edit",
    bash: "bash",
    psh: "bash",
    pwsh: "bash",
    powershell: "bash",
    shell: "bash",
    execute_shell_command: "bash",
    grep: "grep",
    search_for_pattern: "grep",
    glob: "glob",
    find_file: "glob",
    web_search: "search",
  };
  if (Object.prototype.hasOwnProperty.call(aliases, leaf)) return aliases[leaf];
  // MCP 常见命名 mcp__provider_read_file 只有 provider 前使用双下划线。
  if (normalized.startsWith("mcp__")) {
    for (const alias of Object.keys(aliases)) {
      if (leaf.endsWith(`_${alias}`)) return aliases[alias];
    }
  }
  return "";
}

/**
 * 只解析完整 JSON；流式残片不提供文件授权证据。
 * 参数：[in] args 原始参数。返回值：完整解码值或未解析的原文。
 */
function decodeArgs(args: unknown): unknown {
  if (typeof args !== "string") return args;
  try {
    return JSON.parse(args) as unknown;
  } catch {
    return args;
  }
}

/**
 * 从明确的字符串字段取值，不递归猜测正文中的路径。
 * 参数：[in] args 参数对象；[in] keys 原生字段名。返回值：首个字符串字段或 undefined。
 */
function stringField(
  args: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    if (typeof args[key] === "string") return args[key] as string;
  }
  return undefined;
}

/**
 * 分类显式路径；只有原生阅读/搜索调用允许解释选择器，写入和补丁文件名保持字面语义。
 * 参数：[in] raw 原生路径证据；[in] selectors 是否支持原生阅读选择器。
 * 返回值：保留资源语义的目标或 undefined。
 */
function pathTarget(raw: string, selectors: boolean): ToolTarget | undefined {
  const text = raw.trim();
  if (!text || /[\u0000-\u001f]/.test(text)) return undefined;
  // URI 永远不转成本地文件，包括 file:// 和虚拟工具资源。
  if (
    (/^[a-z][a-z\d+.-]*:\/\//i.test(text) ||
      /^(?:https?|file|data|javascript|vbscript|mailto|urn|skill|artifact|agent|local|proc|ssh|issue|pr|mcp|omp|xd|history):/i.test(
        text,
      )) &&
    !/^[a-z]:[\\/]/i.test(text)
  ) {
    return /^https?:\/\//i.test(text)
      ? { kind: "url", label: text, url: text }
      : { kind: "query", label: text, text };
  }
  if (
    /\.(?:zip|jar|apk|whl|tar|tgz|gz|bz2|xz|rar|7z|iso|cab|deb|rpm|cpio|ar|lzh|arj|asar|svgz):/i.test(
      text,
    )
  ) {
    return { kind: "query", label: text, text };
  }
  let path = text;
  // 只有支持选择器的调用才先去范围再解快照；literal write/edit 不能授权到不同的基本文件。
  if (selectors) {
    path = path.replace(
      /(?::(?:raw|img|conflicts|(?:-?\d+(?:[-+]\d*)?)(?:,(?:-?\d+(?:[-+]\d*)?))*))+$/i,
      "",
    );
    const snapshot = /^\[([^\r\n]+)#[0-9a-f]{4}\]$/i.exec(path);
    if (snapshot) path = snapshot[1];
  }
  const withoutDrive = path.replace(/^[a-z]:[\\/]/i, "");
  if (!path || /[?:*\[\]{}]/.test(withoutDrive)) {
    return { kind: "query", label: text, text };
  }
  // 单独的根路径仍然是显式磁盘证据；是否为普通文件由可信读取端判断。
  const label = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return { kind: "file", label, path };
}

/**
 * 提取实际补丁文件头，不把新增内容里的伪文件头当作目标。
 * 参数：[in] input 原生 hashline 或 unified 补丁。返回值：按出现顺序排列的显式路径。
 */
function patchPaths(input: string): string[] {
  const paths: string[] = [];
  const lines = input.split(/\r?\n/);
  let oldRemaining = 0;
  let newRemaining = 0;
  let inPatch = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // Hunk 正文也可能恰好出现 ---/+++ 字样，按计数消费而非重新解释文件头。
    if (oldRemaining > 0 || newRemaining > 0) {
      if (line.startsWith("-")) oldRemaining -= 1;
      else if (line.startsWith("+")) newRemaining -= 1;
      else if (line.startsWith(" ")) {
        oldRemaining -= 1;
        newRemaining -= 1;
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldRemaining = Number(hunk[1] ?? 1);
      newRemaining = Number(hunk[2] ?? 1);
      continue;
    }
    if (line === "*** Begin Patch") {
      inPatch = true;
      continue;
    }
    if (line === "*** End Patch") {
      inPatch = false;
      continue;
    }
    const hashline = /^\[([^\r\n]+)#[0-9a-f]{4}\]$/i.exec(line);
    if (inPatch && hashline) paths.push(hashline[1]);
    const heading = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line);
    if (inPatch && heading) paths.push(heading[1]);
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (inPatch && move) paths.push(move[1]);
    const hashMove = /^MV (?:"([^"\r\n]+)"|([^\r\n]+))$/.exec(line);
    if (inPatch && hashMove) paths.push(hashMove[1] ?? hashMove[2]);
    // Unified 的旧/新头必须成对，避免将普通删除行解释成文件路径。
    if (line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) {
      for (const header of [line.slice(4), lines[index + 1].slice(4)]) {
        let path = header.split("\t")[0];
        if (path === "/dev/null") continue;
        if (path.startsWith('"')) {
          try {
            path = JSON.parse(path) as string;
          } catch {
            continue;
          }
        }
        paths.push(path.replace(/^[ab]\//, ""));
      }
      index += 1;
    }
  }
  return paths;
}

/**
 * 生成 UI 与可信预览授权共用的工具说明；只展示证据，绝不执行命令或访问文件。
 * 参数：[in] name 原生工具名；[in] args 原生对象、完整 JSON 或未完成的参数。
 * 返回值：中文操作、明确目标及可选原生意图摘要；无证据时目标为空。
 */
export function describeToolCall(name: string, args: unknown): ToolDescription {
  const op = operation(name);
  const verbs: Record<string, string> = {
    read: "读取",
    write: "写入",
    edit: "编辑",
    bash: "执行命令",
    grep: "搜索",
    glob: "查找文件",
    search: "搜索网页",
  };
  const description: ToolDescription = {
    verb: verbs[op] ?? "调用工具",
    targets: [],
  };
  const decoded = decodeArgs(args);
  const object =
    decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)
      ? (decoded as Record<string, unknown>)
      : undefined;
  const seen = new Set<string>();
  /** 添加目标且按实际值去重。参数：[in] target 分类目标。返回值：无。 */
  function add(target: ToolTarget | undefined): void {
    if (!target) return;
    const value =
      target.kind === "file"
        ? target.path
        : target.kind === "command"
          ? target.command
          : target.kind === "url"
            ? target.url
            : target.text;
    const key = `${target.kind}:${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      description.targets.push(target);
    }
  }
  if (!op) {
    description.summary = name;
    return description;
  }
  if (object) {
    const intent = stringField(object, ["i", "intent"]);
    if (intent) description.summary = intent;
    if (op === "bash") {
      const command = stringField(object, ["command", "cmd"]);
      if (command?.trim()) add({ kind: "command", label: command, command });
    } else if (op === "search") {
      const query = stringField(object, ["query"]);
      if (query?.trim()) add({ kind: "query", label: query, text: query });
    } else {
      const path = stringField(object, [
        "path",
        "file_path",
        "filePath",
        "relative_path",
        "filename",
      ]);
      if (path !== undefined) {
        const paths = op === "grep" || op === "glob" ? path.split(";") : [path];
        const selectors = /(?:^|__|[.:/])(?:read|grep)$/i.test(name);
        for (const item of paths) add(pathTarget(item, selectors));
      }
      if (op === "grep" || op === "glob") {
        const query = stringField(object, ["pattern", "query", "file_mask"]);
        if (query?.trim()) add({ kind: "query", label: query, text: query });
      }
      if (op === "edit") {
        const input = stringField(object, ["input", "patch"]);
        if (input)
          for (const item of patchPaths(input)) add(pathTarget(item, false));
      }
    }
  } else if (typeof decoded === "string") {
    // Freeform 仅接受真正的补丁格式；未完成的 JSON 不从字符串内容补救授权。
    if (op === "edit" && /^(?:\*\*\* Begin Patch\r?\n|--- )/.test(decoded)) {
      for (const item of patchPaths(decoded)) add(pathTarget(item, false));
    } else if (
      op === "bash" &&
      !/^[\s]*[\[{]/.test(decoded) &&
      decoded.trim()
    ) {
      add({ kind: "command", label: decoded, command: decoded });
    }
  }
  return description;
}
