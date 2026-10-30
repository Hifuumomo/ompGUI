import type { SlashCommand } from "./protocol";

// 使用 omp Unicode 预设的类型图标，不依赖 Nerd Font。
const icons: Record<string, string> = {
  model: "⬢",
  plus: "✚",
  history: "🕘",
  branch: "⑂",
  tree: "🌳",
  rewind: "↶",
  eraser: "🧹",
  action: "❯",
  prompt: "✎",
  extension: "🧩",
  skill: "✦",
  mcp: "🔌",
  settings: "🎛",
  gear: "⚙",
  plan: "🗺",
  goal: "🎯",
  search: "🔍",
  compress: "🗜",
  export: "📤",
  memory: "🧠",
  question: "❓",
  agents: "👥",
  stats: "📊",
  context: "◫",
  pencil: "✏",
  jobs: "⏳",
  vibrate: "〰",
  ghost: "♧",
};
const builtin: Record<string, string> = {
  model: "model",
  models: "model",
  new: "plus",
  resume: "history",
  fork: "branch",
  branch: "branch",
  rewind: "rewind",
  tree: "tree",
  clear: "eraser",
  btw: "prompt",
  settings: "settings",
  setup: "gear",
  plan: "plan",
  goal: "goal",
  compact: "compress",
  export: "export",
  memory: "memory",
  help: "question",
  agents: "agents",
  stats: "stats",
  context: "context",
  rename: "pencil",
  jobs: "jobs",
  shake: "vibrate",
  seance: "ghost",
};

/** 原生图标优先，已知命令与来源回退，未知命令仍显示动作图标。 */
export function commandIcon(command: SlashCommand): string {
  if (command.icon && Object.hasOwn(icons, command.icon))
    return icons[command.icon];
  if (Object.hasOwn(builtin, command.name)) return icons[builtin[command.name]];
  const source = command.source?.toLowerCase() ?? "";
  const kind = ["skill", "mcp", "prompt", "extension"].find((value) =>
    source.includes(value),
  );
  return icons[kind ?? "action"];
}
