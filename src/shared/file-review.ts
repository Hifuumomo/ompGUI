import { describeToolCall } from "./tool-presentation";

export type FileReviewEvidence =
  | { kind: "write"; content: string }
  | {
      kind: "replacements";
      changes: Array<{ before: string; after: string; nativeDiff?: string }>;
    }
  | { kind: "diff"; content: string };

/**
 * 解码完整原生参数，保留 freeform 补丁；残缺 JSON 不补救为参数对象。
 * 参数：[in] value 记录的原始参数。返回值：解码后的参数或原始字符串。
 */
function decodeArgs(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/**
 * 获取非数组参数对象，不递归搜索正文或其他文件的字段。
 * 参数：[in] value 已解码的值。返回值：参数对象或 undefined。
 */
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * 判断记录字符串是否可无损作为 UTF-8 文本显示，与当前文件预览的控制字符边界一致。
 * 参数：[in] value 原生文本字符串。返回值：非二进制且无孤立 UTF-16 代理项时 true。
 */
function isText(value: string): boolean {
  return !/[\u0000-\u0008\u000b\u000e-\u001f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    value,
  );
}

/**
 * 读取统一补丁的真实文件头，与现有工具目标识别保持相同的路径语义。
 * 参数：[in] header 不含 ---/+++ 前缀的文件头。返回值：文件路径或 undefined。
 */
function diffPath(header: string): string | undefined {
  let path = header.split("\t")[0];
  if (path.startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(path);
      if (typeof decoded !== "string") return undefined;
      path = decoded;
    } catch {
      return undefined;
    }
  }
  return path.replace(/^[ab]\//, "");
}

/**
 * 按文件头与 hunk 计数消费真实 unified diff，仅返回所选文件的完整段落。
 * 参数：[in] input 完整补丁；[in] path 已由原生调用授权的文件路径。
 * 返回值：所选文件的原始补丁文本，或格式残缺/来源不匹配时 undefined。
 */
function selectedDiff(input: string, path: string): string | undefined {
  const lines = input.split("\n");
  const selected: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].replace(/\r$/, "");
    if (line === "" && index === lines.length - 1) break;
    // Git 元信息只在文件段落外消费，不把 hunk 正文的伪文件头当新文件。
    if (
      /^(?:diff --git |index |new file mode |deleted file mode |old mode |new mode |similarity index |rename from |rename to )/.test(
        line,
      )
    ) {
      index += 1;
      continue;
    }
    if (!line.startsWith("--- ")) return undefined;
    const start = index;
    const next = lines[index + 1]?.replace(/\r$/, "");
    if (!next?.startsWith("+++ ")) return undefined;
    const before = diffPath(line.slice(4));
    const after = diffPath(next.slice(4));
    if (!before || !after) return undefined;
    const matches = before === path || after === path;
    // 重命名跨文件的补丁不能冒充同一个文件的历史修改。
    if (matches && ![path, "/dev/null"].includes(before)) return undefined;
    if (matches && ![path, "/dev/null"].includes(after)) return undefined;
    index += 2;
    let hunks = 0;
    while (index < lines.length) {
      const heading = lines[index].replace(/\r$/, "");
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(
        heading,
      );
      if (!hunk) break;
      let oldRemaining = Number(hunk[2] ?? 1);
      let newRemaining = Number(hunk[4] ?? 1);
      if (
        !Number.isSafeInteger(oldRemaining) ||
        !Number.isSafeInteger(newRemaining)
      )
        return undefined;
      if (oldRemaining === 0 && newRemaining === 0) return undefined;
      const oldStart = Number(hunk[1]);
      const newStart = Number(hunk[3]);
      if (
        !Number.isSafeInteger(oldStart) ||
        !Number.isSafeInteger(newStart) ||
        (oldStart === 0 && oldRemaining !== 0) ||
        (newStart === 0 && newRemaining !== 0)
      )
        return undefined;
      index += 1;
      hunks += 1;
      // 计数保证删除/新增行中的 ---/+++ 字样仍然属于当前文件。
      while (oldRemaining > 0 || newRemaining > 0) {
        const body = lines[index];
        if (body === undefined) return undefined;
        if (body.startsWith("-")) oldRemaining -= 1;
        else if (body.startsWith("+")) newRemaining -= 1;
        else if (body.startsWith(" ")) {
          oldRemaining -= 1;
          newRemaining -= 1;
        } else return undefined;
        if (oldRemaining < 0 || newRemaining < 0) return undefined;
        index += 1;
        // 缺末尾换行标记仅能紧随真实正文行，每行最多一个。
        if (lines[index]?.replace(/\r$/, "") === "\\ No newline at end of file")
          index += 1;
      }
    }
    if (!hunks) return undefined;
    if (matches)
      selected.push(
        lines.slice(start, index).join("\n") +
          (index < lines.length ? "\n" : ""),
      );
  }
  if (!selected.length) return undefined;
  return selected.join("");
}

/**
 * 提取所选显式原生文件的写入或修改证据，不读取磁盘、不推断工具成功或历史全文。
 * 参数：[in] toolName 原生工具名；[in] args 完整原生参数或 freeform 补丁；
 * [in] result 原生结果（不作为写入正文）；[in] path 用户选择的原生目标路径。
 * 返回值：可靠的本次内容/修改证据，或 unsupported、残缺、来源不匹配时 undefined。
 */
export function getFileReviewEvidence(
  toolName: string,
  args: unknown,
  result: unknown,
  path: string,
): FileReviewEvidence | undefined {
  const description = describeToolCall(toolName, args);
  const targets = description.targets.filter(
    (target) => target.kind === "file",
  );
  if (!targets.some((target) => target.path === path)) return undefined;
  const decoded = decodeArgs(args);
  const object = record(decoded);
  if (description.verb === "写入") {
    if (targets.length !== 1 || typeof object?.content !== "string")
      return undefined;
    if (!isText(object.content)) return undefined;
    return { kind: "write", content: object.content };
  }
  if (description.verb !== "编辑") return undefined;
  const patch =
    typeof decoded === "string"
      ? decoded
      : typeof object?.input === "string"
        ? object.input
        : typeof object?.patch === "string"
          ? object.patch
          : undefined;
  if (patch !== undefined) {
    if (!isText(patch)) return undefined;
    const content = selectedDiff(patch, path);
    if (content !== undefined) return { kind: "diff", content };
    if (patch.startsWith("--- ") || patch.startsWith("diff --git "))
      return undefined;
    if (
      !/^\*\*\* Begin Patch\r?\n/.test(patch) ||
      !/\r?\n\*\*\* End Patch\r?\n?$/.test(patch)
    )
      return undefined;
  }
  const nativeResult = record(result);
  if (nativeResult?.role !== undefined && nativeResult.role !== "toolResult")
    return undefined;
  if (
    nativeResult?.toolName !== undefined &&
    nativeResult.toolName !== toolName
  )
    return undefined;
  const details = record(nativeResult?.details);
  if (!details || details.snapshotsPruned === true) return undefined;
  if (
    details.perFileResults !== undefined &&
    !Array.isArray(details.perFileResults)
  )
    return undefined;
  // 多文件结果只消费匹配的文件项，绝不借用顶层拼接 diff 或相邻文件快照。
  const entries = Array.isArray(details.perFileResults)
    ? details.perFileResults
    : [details];
  // 同一原生调用仅一个显式文件、仅一个顶层 update 时，参数与结果按操作关联。
  // 不解析 cwd、不做后缀匹配，也不把该关联用于磁盘读取；多文件始终必须匹配显式路径。
  const singleOperation =
    targets.length === 1 &&
    details.perFileResults === undefined &&
    !/^(?:[a-z]:[\\/]|[\\/]|~)/i.test(path);
  const changes: Array<{ before: string; after: string; nativeDiff?: string }> =
    [];
  for (const entry of entries) {
    const file = record(entry);
    if (!file || typeof file.path !== "string") continue;
    let sourcePath = file.path;
    let selectedPath = path;
    // 绝对 Windows 路径的两种斜杠写法等价；不推测相对路径的工作目录。
    if (
      /^[a-z]:[\\/]/i.test(sourcePath) &&
      /^[a-z]:[\\/]/i.test(selectedPath)
    ) {
      sourcePath = sourcePath.replace(/\\/g, "/");
      selectedPath = selectedPath.replace(/\\/g, "/");
    }
    const resolvedSingleOperation =
      singleOperation && /^(?:[a-z]:[\\/]|\/)/i.test(sourcePath);
    if (sourcePath !== selectedPath && !resolvedSingleOperation) continue;
    if (
      changes.length ||
      file.op !== "update" ||
      file.snapshotsPruned === true ||
      typeof file.oldText !== "string" ||
      typeof file.newText !== "string"
    )
      return undefined;
    if (!isText(file.oldText) || !isText(file.newText)) return undefined;
    // 仅保留已绑定当前文件操作的原生行号 diff，不使用多文件顶层拼接摘要。
    const change: { before: string; after: string; nativeDiff?: string } = {
      before: file.oldText,
      after: file.newText,
    };
    if (
      typeof file.diff === "string" &&
      /(?:^|\r?\n)[-+ ]\d+\|/.test(file.diff) &&
      isText(file.diff)
    ) {
      let nativeLines = true;
      // 仅认已查证的原生行号管道格式；状态摘要或 JSON 不能抢占真实前后快照。
      for (const line of file.diff.split(/\r?\n/)) {
        if (line !== "" && !/^[-+ ]\d+\|/.test(line)) {
          nativeLines = false;
          break;
        }
      }
      if (nativeLines) change.nativeDiff = file.diff;
    }
    changes.push(change);
  }
  if (changes.length) return { kind: "replacements", changes };
  return undefined;
}
