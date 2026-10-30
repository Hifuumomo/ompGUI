import type { DesktopBridge } from "../../shared/protocol";

/** 非计划用例仍提供真实的 off 状态契约；任何意外写操作明确失败。 */
export const offPlanBridge: Pick<DesktopBridge, "plan" | "setPlanDirty" | "onPlanCloseRequest" | "respondPlanClose" | "listSessionEngines" | "startSessionEngine" | "stopSessionEngine"> = {
  async listSessionEngines() { return []; },
  async startSessionEngine() { throw new Error("此用例不允许开启会话进程"); },
  async stopSessionEngine() { throw new Error("此用例不允许关闭会话进程"); },
  async plan(action) {
    if (action.op !== "status") throw new Error(`非计划用例不允许计划写操作：${action.op}`);
    return { identity: { sessionId: "test", sessionFile: "C:/test/session.jsonl", epoch: "test-epoch" }, phase: "off", busy: false };
  },
  setPlanDirty() {},
  onPlanCloseRequest() { return () => {}; },
  respondPlanClose() {},
};
