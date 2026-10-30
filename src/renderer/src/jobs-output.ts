// CSI（颜色、光标）与 OSC（标题、超链接）终端控制序列。
export const ANSI_PATTERN =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// 原生 /jobs 任务头：[id] 类型 (状态) — 时长[ 代理 id]；时长只有 s/m/h/d 单位。
const JOB_HEADER = /^\[([^\]\s]+)\] (\S+) \(([^)]+)\) — (\d+[smhd])(?: (\S+))?$/;
// 原生树前缀：RA()/C7() 生成的空白与制表线。
const TREE_PREFIX = /^[\s│├└─┬┌╰╭┃┣┗━]*/;
// 节点行（任务头、子代理分组）才带分支符；命令续行只有空白与竖线。
const TREE_BRANCH = /[├└╰┣┗]/;

export interface JobEntry {
  kind: "job";
  id: string; // 原生任务 id，如 bg_1。
  type: string; // bash、task、debug 等。
  status: string; // running、completed 等原生状态。
  duration: string;
  agent?: string; // 任务所属子代理 id。
  depth: number; // 树前缀宽度（字符）。
  command: string; // label 或 full 模式下的完整命令。
}

export interface AgentEntry {
  kind: "agent";
  id: string;
  depth: number;
}

export interface JobsReport {
  running?: number; // 原生 Running 计数。
  entries: (JobEntry | AgentEntry)[];
  message?: string; // 无任务列表时的原生纯文本（如无任务、kill 结果）。
}

/** 去掉多行命令共有的树前缀，保留命令自身的相对缩进。[in] lines：续行。返回值：命令文本。 */
function commandText(lines: string[]): string {
  const width = Math.min(
    ...lines
      .filter((line) => line.trim())
      .map((line) => TREE_PREFIX.exec(line)![0].length),
  );
  return lines
    .map((line) => line.slice(Number.isFinite(width) ? width : 0))
    .join("\n")
    .trimEnd();
}

/** 把原生 /jobs 输出解析为任务条目。[in] output：原生 command_output 文本。返回值：任务报告。 */
export function parseJobsOutput(output: string): JobsReport {
  const lines = output.replace(ANSI_PATTERN, "").replace(/\r\n/g, "\n").trim().split("\n");
  const open = lines.findIndex((line) => /^`{3,}text$/.test(line));
  if (open < 0) return { entries: [], message: lines.join("\n") };
  // 原生 wD() 按正文最长反引号串加长围栏，收尾围栏与开头一致。
  const fence = lines[open].slice(0, -"text".length);
  const close = lines.indexOf(fence, open + 1);
  const running = /^Running: (\d+)$/m.exec(lines.slice(0, open).join("\n"));
  const entries: JobsReport["entries"] = [];
  let current: JobEntry | undefined;
  let continuation: string[] = [];
  for (const line of lines.slice(open + 1, close < 0 ? undefined : close)) {
    const prefix = TREE_PREFIX.exec(line)![0];
    if (prefix && !TREE_BRANCH.test(prefix)) {
      if (current) continuation.push(line);
      continue;
    }
    if (current) current.command = commandText(continuation);
    continuation = [];
    const node = line.slice(prefix.length);
    const match = JOB_HEADER.exec(node);
    current = match
      ? {
          kind: "job",
          id: match[1],
          type: match[2],
          status: match[3],
          duration: match[4],
          ...(match[5] ? { agent: match[5] } : {}),
          depth: prefix.length,
          command: "",
        }
      : undefined;
    entries.push(current ?? { kind: "agent", id: node, depth: prefix.length });
  }
  if (current) current.command = commandText(continuation);
  return {
    ...(running ? { running: Number(running[1]) } : {}),
    entries,
  };
}
