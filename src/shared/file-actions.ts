/** 会话文件右键菜单「打开方式」可选的本机程序。 */
export type FileOpenerId =
  | "vscode"
  | "visualstudio"
  | "github"
  | "default"
  | "explorer"
  | "terminal"
  | "gitbash"
  | "wsl";

export interface FileOpener {
  readonly id: FileOpenerId;
  readonly label: string;
}

/** 经主进程核实目标后执行的文件操作，包括系统剪贴板复制。 */
export type FileAction =
  | { readonly type: "open" }
  | { readonly type: "reveal" }
  | { readonly type: "copy-path" }
  | { readonly type: "copy-content" }
  | { readonly type: "save-as" }
  | { readonly type: "open-with"; readonly opener: FileOpenerId };
