import { expect, it } from "vitest";
import type { PlanChoice, PlanSnapshot } from "../../shared/native-plan";
import { planNotice } from "./usePlan";

const identity = { sessionId: "source", sessionFile: "source.jsonl", epoch: "source-epoch" };
const choices: PlanChoice[] = ["compact", "keep", "execute", "refine", "save"];

it("所有处置终态通知区分成功、失败和取消，并携带执行模型或保存路径", () => {
  for (const choice of choices) {
    const operation: NonNullable<PlanSnapshot["operation"]> = { id: choice, choice, origin: identity, status: "completed", savedPath: "C:/计划/登录方案.md" };
    const completed = planNotice(operation, "Sonnet", "off")!;
    expect(completed.level).toBe(choice === "refine" ? "info" : "success");
    if (["compact", "keep", "execute"].includes(choice)) expect(completed.detail).toContain("Sonnet");
    if (choice === "save") expect(completed.title).toContain(operation.savedPath);
    const failure = planNotice({ ...operation, status: "failed", error: "EACCES: 目标目录只读" }, "Sonnet", "review")!;
    expect(failure.level).toBe("error");
    expect(failure.title).toContain("EACCES: 目标目录只读");
    const cancelled = planNotice({ ...operation, status: "cancelled" }, "Sonnet", "review")!;
    expect(cancelled.level).toBe("warning");
    expect(cancelled.title).toContain("仍可审阅");
  }
});

it("压缩退出后取消不得误报计划仍可审阅，其他已退出取消也不误报", () => {
  const operation: NonNullable<PlanSnapshot["operation"]> = { id: "cancel", choice: "compact", origin: identity, status: "cancelled" };
  const compact = planNotice(operation, "Sonnet", "off")!;
  expect(compact.title).toContain("尚未开始执行");
  expect(compact.detail).toContain("发送一条消息以继续");
  const stopped = planNotice({ ...operation, choice: "execute" }, "Sonnet", "off")!;
  expect(stopped.title).not.toContain("仍可审阅");
  expect(stopped.detail).toContain("已退出");
  expect(planNotice({ ...operation, choice: "refine" }, "Sonnet", "planning")?.detail).toContain("计划模式继续");
});

it("处置尚在运行时不提前宣告结果，失败按完善、保存和执行分类", () => {
  const operation: NonNullable<PlanSnapshot["operation"]> = { id: "running", choice: "compact", origin: identity, status: "running" };
  expect(planNotice(operation, "Sonnet", "applying")).toBeUndefined();
  const failed = { ...operation, status: "failed" as const, error: "断线" };
  expect(planNotice({ ...failed, choice: "refine" }, "Sonnet", "off")?.title).toContain("完善计划失败");
  expect(planNotice({ ...failed, choice: "save" }, "Sonnet", "review")?.title).toContain("保存计划失败");
  expect(planNotice(failed, "Sonnet", "review")?.title).toContain("执行计划失败");
});
