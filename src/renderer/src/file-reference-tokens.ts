export interface FileReferenceToken {
  readonly start: number; // 原始正文中 @ 标记的位置。
  readonly end: number; // 原始正文中引用结束后的下标，包含闭合引号。
  readonly path: string; // 去掉 @、外层引号和正文尾标点后的文件路径。
}

interface FileMentionToken extends FileReferenceToken {
  readonly queryStart: number; // 可输入路径的起点，不包含 @ 或外层引号。
  readonly queryEnd: number; // 可输入路径的终点，不包含闭合引号。
  readonly complete: boolean; // 非空裸路径或已闭合的非空引号路径。
}

/** 扫描补全与正文共同使用的原生引用边界，保留未闭合查询供编辑器使用。[in] text：未经改写的完整正文。返回值：引用范围、路径、查询边界及闭合状态。 */
export function fileMentionTokens(text: string): readonly FileMentionToken[] {
  const tokens: FileMentionToken[] = [];
  const pattern = /(^|[\s([{<"'`])@(?:"([^"\n]*)("|(?=\n|$))|'([^'\n]*)('|(?=\n|$))|([^\s@]*))/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1].length;
    const quoted = match[2] !== undefined || match[4] !== undefined;
    const closed = Boolean(match[3] || match[5]);
    // 原生裸引用会裁剪正文尾标点；引号内的空白与标点必须原样保留。
    const tail = quoted ? "" : (match[6].match(/[)\]}>.,;:!?"'`]+$/)?.[0] ?? "");
    const end = match.index + match[0].length - tail.length;
    const queryStart = start + (quoted ? 2 : 1);
    const queryEnd = closed ? end - 1 : end;
    const path = text.slice(queryStart, queryEnd);
    tokens.push({ start, end, path, queryStart, queryEnd, complete: Boolean(path) && (!quoted || closed) });
  }
  return tokens;
}

/** 提取可渲染为链接的完整引用，邮箱、空路径和未闭合引号不生成链接。[in] text：未经改写的完整正文。返回值：保留原始起止下标的完整文件引用。 */
export function parseFileReferences(text: string): readonly FileReferenceToken[] {
  const references: FileReferenceToken[] = [];
  for (const token of fileMentionTokens(text)) {
    if (token.complete) references.push({ start: token.start, end: token.end, path: token.path });
  }
  return references;
}
