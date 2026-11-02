// @vitest-environment node
import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { prepareDevArguments } = require("../../scripts/dev.cjs") as {
  prepareDevArguments(argv: string[], environment: NodeJS.ProcessEnv): string[];
};

it("无开关时清除继承的诊断环境，参数、次序与输入数组保持不变", () => {
  const args = ["--debug", "main", "--host", "127.0.0.1", "--", "--custom"];
  const environment = { OMPGUI_PERF: "1", OTHER: "keep" };
  expect(prepareDevArguments(args, environment)).toEqual(args);
  expect(args).toEqual(["--debug", "main", "--host", "127.0.0.1", "--", "--custom"]);
  expect(environment).toEqual({ OTHER: "keep" });
});

it("只消费精确的 --perf 并启用诊断，其余 electron-vite 参数原样传递", () => {
  const environment: NodeJS.ProcessEnv = { OMPGUI_PERF: "0" };
  expect(prepareDevArguments(["--debug", "--perf", "--filter", "main", "--perf", "--performance"], environment))
    .toEqual(["--debug", "--filter", "main", "--performance"]);
  expect(environment.OMPGUI_PERF).toBe("1");
});

it("分隔符之后的 --perf 只传给 Electron，不被启动器消费或用于开启诊断", () => {
  const environment: NodeJS.ProcessEnv = { OMPGUI_PERF: "1" };
  expect(prepareDevArguments(["--", "--perf"], environment)).toEqual(["--", "--perf"]);
  expect(environment.OMPGUI_PERF).toBeUndefined();
  expect(prepareDevArguments(["--perf", "--", "--perf"], environment)).toEqual(["--", "--perf"]);
  expect(environment.OMPGUI_PERF).toBe("1");
});
