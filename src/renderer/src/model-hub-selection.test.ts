import { expect, it } from "vitest";
import { modelHubSelection } from "./model-hub-selection";
import type { NativeModelSnapshot } from "../../shared/native-model";
import { hubSnapshot } from "./model-hub-test-fixture";

const previous = {
  model: { provider: "test", id: "original", name: "Original" },
};
const current = { model: { provider: "test", id: "changed", name: "Changed" } };
const snapshot: NativeModelSnapshot = {
  ...hubSnapshot,
  roles: [
    { ...hubSnapshot.roles[0], role: "smol", resolvedSelector: "test/task" },
  ],
};
const base = { previous, current, snapshot, connected: false };
it("非默认角色配置不成为恢复会话时的主模型选择", () => {
  expect(
    modelHubSelection({
      ...base,
      action: {
        op: "assign",
        role: "smol",
        selector: "test/task",
        scope: "global",
      },
    }),
  ).toEqual({});
});
it("default清除与变更会保存真正切换后的模型，遮盖配置不覆盖恢复模型", () => {
  expect(
    modelHubSelection({
      ...base,
      action: { op: "clear", role: "default", scope: "project" },
    }).session?.modelId,
  ).toBe("changed");
  expect(
    modelHubSelection({
      ...base,
      current: previous,
      action: {
        op: "assign",
        role: "default",
        selector: "test/hidden",
        scope: "global",
      },
    }),
  ).toEqual({});
});
it("未连接task选择独立传递，已连接task操作不产生主模型选择", () => {
  const action = { op: "applyRole", role: "smol", target: "task" } as const;
  expect(modelHubSelection({ ...base, action })).toEqual({ task: "test/task" });
  expect(modelHubSelection({ ...base, connected: true, action })).toEqual({});
});
