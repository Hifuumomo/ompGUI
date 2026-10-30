import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PlanSnapshot } from "../../shared/native-plan";
import { offPlanBridge } from "./plan-test-fixture";
import { container, render } from "./transcript-test-harness";
import { usePlan } from "./usePlan";

afterEach(() => vi.unstubAllGlobals());

it("切换会话后迟到的计划查询不能覆盖当前计划", async () => {
  const replies: Array<(snapshot: PlanSnapshot) => void> = [];
  vi.stubGlobal("desktop", {
    ...offPlanBridge,
    plan: () => new Promise<PlanSnapshot>((resolve) => replies.push(resolve)),
    onFrame: () => () => {},
  });
  function Panel({ sessionId }: { sessionId: string }) {
    const plan = usePlan({ connected: true, sessionId, sessionFile: `${sessionId}.jsonl`, blocked: false,
      onOpen() {}, onTransition: async () => {}, onError: (error) => { throw error; }, onNotice() {} });
    return <output>{plan.snapshot?.identity.sessionId}</output>;
  }
  await render(<Panel sessionId="A" />);
  await render(<Panel sessionId="B" />);
  await act(async () => replies[1]({ identity: { sessionId: "B", sessionFile: "B.jsonl", epoch: "B" }, phase: "off", busy: false }));
  expect(container.querySelector("output")?.textContent).toBe("B");
  await act(async () => replies[0]({ identity: { sessionId: "A", sessionFile: "A.jsonl", epoch: "A" }, phase: "off", busy: false }));
  expect(container.querySelector("output")?.textContent).toBe("B");
});
