export interface SeanceCommandArgs {
  source?: string;
  model?: string;
}

/** 解析原生 /seance 的单源与一次性模型参数；保留 Windows 路径中的反斜杠。 */
export function parseSeanceCommand(args: string): SeanceCommandArgs {
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  let started = false;
  for (const character of args.trim()) {
    if (quote) {
      if (character === quote) quote = "";
      else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) tokens.push(token);
      token = "";
      started = false;
    } else {
      token += character;
      started = true;
    }
  }
  if (quote) throw new Error("/seance 参数引号未闭合。");
  if (started) tokens.push(token);
  const result: SeanceCommandArgs = {};
  for (let index = 0; index < tokens.length; index++) {
    const value = tokens[index];
    if (value === "--model" || value.startsWith("--model=")) {
      if (result.model !== undefined) throw new Error("--model 只能指定一次。");
      const model = value === "--model" ? tokens[++index] : value.slice(8);
      if (!model || model.startsWith("--")) throw new Error("--model 后需要模型 selector。");
      result.model = model;
    } else {
      if (!value || value.startsWith("-") || result.source !== undefined)
        throw new Error("用法：/seance [会话 ID 或路径] [--model selector]");
      result.source = value;
    }
  }
  return result;
}
