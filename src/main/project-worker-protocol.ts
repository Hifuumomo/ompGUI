import type {
  ProjectDiff,
  ProjectDiffRequest,
} from "../shared/project-browser";

export type ProjectJob =
  | { readonly type: "source"; readonly path: string }
  | { readonly type: "diff"; readonly request: ProjectDiffRequest }
  | { readonly type: "mention"; readonly cwd: string; readonly query: string };
export type ProjectWork = ProjectJob & { readonly id: number };
export type ProjectReply =
  | { readonly id: number; readonly value: string | ProjectDiff | string[] }
  | { readonly id: number; readonly error: string };
