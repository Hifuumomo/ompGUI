import { execFile, spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import type {
  FileAction,
  FileOpener,
  FileOpenerId,
} from "../shared/file-actions";
import type { ProjectEntry } from "../shared/project-browser";

const LABELS: Record<FileOpenerId, string> = {
  vscode: "VS Code",
  visualstudio: "Visual Studio",
  github: "GitHub Desktop",
  default: "默认程序",
  explorer: "文件资源管理器",
  terminal: "终端",
  gitbash: "Git Bash",
  wsl: "WSL",
};

type OpenerPaths = Partial<Record<FileOpenerId, string>>;

export interface FileActionHost {
  /** 用系统关联程序打开；返回非空字符串表示失败原因。 */
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
  openExternal(url: string): Promise<void>;
  /** 写入系统剪贴板，不依赖渲染进程的 Web Clipboard 权限。 */
  writeClipboard(text: string): void;
  /** 复用项目文件读取器的 UTF-8、二进制与大小校验。 */
  readTextFile(path: string): Promise<string>;
  /** 弹出另存为对话框；取消返回 undefined。 */
  chooseSavePath(defaultName: string): Promise<string | undefined>;
}

/** lstat 不跟随重解析点：WindowsApps 下的应用执行别名（如 wt.exe）也视为存在。 */
const present = (path: string) =>
  lstatSync(path, { throwIfNoEntry: false }) !== undefined;

/**
 * 查找本机程序的绝对路径，只返回实际存在的条目。
 * @param env [in] 进程环境变量，提供安装目录与 PATH。
 * @returns 程序 id 到可执行文件路径；默认程序与资源管理器无需路径。
 */
async function locateOpeners(env: NodeJS.ProcessEnv): Promise<OpenerPaths> {
  const found: OpenerPaths = {};
  if (process.platform !== "win32") return found;
  const pick = (id: FileOpenerId, paths: readonly (string | undefined)[]) => {
    const path = paths.find((candidate) => candidate && present(candidate));
    if (path) found[id] = path;
  };
  const local = env.LOCALAPPDATA;
  const programs = env.ProgramFiles;
  // PATH 中 bin\code.cmd 的上一层目录即 Code.exe 所在位置，覆盖自定义安装位置。
  const pathCode = (env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => entry && present(join(entry, "code.cmd")))
    .map((entry) => resolve(entry, "..", "Code.exe"));
  pick("vscode", [
    local && join(local, "Programs", "Microsoft VS Code", "Code.exe"),
    programs && join(programs, "Microsoft VS Code", "Code.exe"),
    ...pathCode,
  ]);
  const programsX86 = env["ProgramFiles(x86)"];
  const vswhere =
    programsX86 &&
    join(programsX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (vswhere && present(vswhere)) {
    const devenv = await new Promise<string>((done) =>
      execFile(
        vswhere,
        [
          "-latest",
          "-prerelease",
          "-property",
          "productPath",
          "-format",
          "value",
        ],
        { windowsHide: true, timeout: 10_000 },
        (error, stdout) => done(error ? "" : stdout.trim().split(/\r?\n/)[0]),
      ),
    );
    pick("visualstudio", [devenv]);
  }
  pick("github", [local && join(local, "GitHubDesktop", "GitHubDesktop.exe")]);
  pick("terminal", [
    local && join(local, "Microsoft", "WindowsApps", "wt.exe"),
  ]);
  pick("gitbash", [
    programs && join(programs, "Git", "git-bash.exe"),
    env.ProgramW6432 && join(env.ProgramW6432, "Git", "git-bash.exe"),
  ]);
  pick("wsl", [env.SystemRoot && join(env.SystemRoot, "System32", "wsl.exe")]);
  return found;
}

/** 以独立进程启动程序，不经过 shell；进程创建失败时拒绝。 */
function launch(file: string, args: readonly string[], cwd: string) {
  return new Promise<void>((done, fail) => {
    const child = spawn(file, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.once("error", fail);
    child.once("spawn", () => {
      child.unref();
      done();
    });
  });
}

/**
 * 会话文件右键菜单的主进程操作。
 * @param host [in] Electron shell 与对话框能力。
 * @param env [in] 用于查找本机程序的环境变量。
 * @returns 列出可用程序与对已核实路径执行操作的接口。
 */
export function createFileActions(
  host: FileActionHost,
  env: NodeJS.ProcessEnv = process.env,
) {
  let located: Promise<OpenerPaths> | undefined;

  async function openWith(id: FileOpenerId, entry: ProjectEntry) {
    const directory =
      entry.kind === "directory" ? entry.path : dirname(entry.path);
    if (id === "default" || id === "explorer") {
      const failure = await host.openPath(
        id === "explorer" ? directory : entry.path,
      );
      if (failure) throw new Error(failure);
      return;
    }
    const file = (await (located ??= locateOpeners(env)))[id];
    if (!file) throw new Error(`未找到 ${LABELS[id]}`);
    switch (id) {
      case "github":
        return host.openExternal(
          `x-github-client://openLocalRepo/${encodeURIComponent(directory)}`,
        );
      case "vscode":
        return launch(file, [entry.path], directory);
      case "visualstudio":
        return launch(
          file,
          entry.kind === "directory" ? [entry.path] : ["/Edit", entry.path],
          directory,
        );
      case "terminal":
        return launch(file, ["-d", directory], directory);
      case "gitbash":
        return launch(file, [`--cd=${directory}`], directory);
      case "wsl":
        return launch(file, ["--cd", directory], directory);
    }
  }

  return {
    /** 「打开方式」列表：本机已安装程序加上默认程序与资源管理器。 */
    async listOpeners(): Promise<FileOpener[]> {
      const found = await (located ??= locateOpeners(env));
      return (Object.keys(LABELS) as FileOpenerId[])
        .filter((id) => id === "default" || id === "explorer" || found[id])
        .map((id) => ({ id, label: LABELS[id] }));
    },
    async run(action: FileAction, entry: ProjectEntry): Promise<void> {
      switch (action.type) {
        case "copy-path":
          host.writeClipboard(entry.path);
          return;
        case "copy-content":
          if (entry.kind !== "file") throw new Error("只能复制普通文件内容");
          host.writeClipboard(await host.readTextFile(entry.path));
          return;
        case "open":
          return openWith("default", entry);
        case "reveal":
          host.showItemInFolder(entry.path);
          return;
        case "open-with":
          if (!Object.hasOwn(LABELS, action.opener))
            throw new Error("不支持的打开方式");
          return openWith(action.opener, entry);
        case "save-as": {
          if (entry.kind !== "file") throw new Error("只能另存普通文件");
          const target = await host.chooseSavePath(entry.name);
          if (target && resolve(target) !== resolve(entry.path))
            await copyFile(entry.path, target);
          return;
        }
        default:
          throw new Error("不支持的文件操作");
      }
    },
  };
}
