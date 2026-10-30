import { useEffect, useState } from "react";

type Resource<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "error"; readonly error: string };

/** 路径或刷新版本变化后丢弃过期结果，不让旧文件覆盖当前选择。 */
export function useProjectResource<T>(
  read: (path: string) => Promise<T>,
  path: string,
  revision: number,
): Resource<T> {
  const [result, setResult] = useState<{
    readonly path: string;
    readonly revision: number;
    readonly resource: Resource<T>;
  }>();
  useEffect(() => {
    let active = true;
    const publish = (resource: Resource<T>) => {
      if (active) setResult({ path, revision, resource });
    };
    void read(path).then(
      (value) => publish({ status: "ready", value }),
      (error: unknown) =>
        publish({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      active = false;
    };
  }, [read, path, revision]);
  if (result?.path !== path || result.revision !== revision)
    return { status: "loading" };
  return result.resource;
}
