import { useEffect, useState } from "react";
import type {
  ProjectChanges,
  ProjectReview,
} from "../../shared/project-browser";

type ChangeState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: string }
  | {
      readonly status: "ready";
      readonly value: ProjectChanges;
      readonly refreshing?: boolean;
      readonly error?: string;
    };

/** 刷新期间保留目录树与选中项，同时明确显示刷新进度和错误。 */
export function useProjectChanges(
  browser: ProjectReview,
  cwd: string,
  revision: number,
) {
  const [state, setState] = useState<ChangeState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    setState((old) =>
      old.status === "ready"
        ? { ...old, refreshing: true, error: undefined }
        : { status: "loading" },
    );
    void browser.listProjectChanges(cwd).then(
      (value) => {
        if (active) setState({ status: "ready", value });
      },
      (reason: unknown) => {
        if (!active) return;
        const error = reason instanceof Error ? reason.message : String(reason);
        setState((old) =>
          old.status === "ready"
            ? { ...old, refreshing: false, error }
            : { status: "error", error },
        );
      },
    );
    return () => {
      active = false;
    };
  }, [browser, cwd, revision]);
  return state;
}
