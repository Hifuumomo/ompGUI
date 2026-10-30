import { describe, expect, it } from "vitest";
import { parsePlanAction } from "./plan-action";

const identity = { sessionId: "session", sessionFile: "C:/tmp/session.jsonl", epoch: "epoch" };
const decision = { op: "decide", identity, reviewId: "review", revision: "hash", choice: "save" };

describe("trusted plan IPC input", () => {
  it("preserves exact native identities and empty edit buffers", () => {
    expect(parsePlanAction({ op: "status" })).toEqual({ op: "status" });
    expect(parsePlanAction({ op: "saveDocument", identity, path: "local://PLAN.md", revision: "hash", content: "" })).toEqual({
      op: "saveDocument", identity, path: "local://PLAN.md", revision: "hash", content: "",
    });
  });
  it("never accepts renderer destination paths or extension correlation IDs", () => {
    expect(() => parsePlanAction({ ...decision, savePath: "C:/victim.md" })).toThrow("未授权");
    expect(() => parsePlanAction({ ...decision, requestId: "fake" })).toThrow("未授权");
    expect(() => parsePlanAction({ op: "review", identity })).toThrow();
  });
  it("requires complete identity and validates nested model fields", () => {
    expect(() => parsePlanAction({ ...decision, identity: { ...identity, epoch: "" } })).toThrow();
    expect(() => parsePlanAction({ ...decision, executionModel: { provider: "p", modelId: "m", token: "secret" } })).toThrow();
    expect(parsePlanAction({ ...decision, choice: "keep", executionModel: { provider: "p", modelId: "m", thinkingLevel: "high" } })).toMatchObject({
      choice: "keep", executionModel: { provider: "p", modelId: "m", thinkingLevel: "high" },
    });
  });
  it("bounds UTF-8 bytes rather than UTF-16 length without truncating", () => {
    const request = { op: "saveDocument", identity, path: "local://PLAN.md", revision: "hash" };
    expect(parsePlanAction({ ...request, content: "x".repeat(1024 * 1024) })).toHaveProperty("content");
    expect(() => parsePlanAction({ ...request, content: "中".repeat(350000) })).toThrow("1MiB");
  });
  it("keeps cancellation separate from queued decision fields", () => {
    expect(parsePlanAction({ op: "cancel", identity, operationId: "operation" })).toEqual({ op: "cancel", identity, operationId: "operation" });
    expect(() => parsePlanAction({ op: "cancel", identity, operationId: "operation", choice: "keep" })).toThrow();
  });
  it("仅完善处置接受普通图片，拒绝无效或额外图片字段", () => {
    const image = { type: "image", data: "aW1hZ2U=", mimeType: "image/png" };
    const refine = { ...decision, choice: "refine", feedback: "", feedbackImages: [image] };
    expect(parsePlanAction(refine)).toMatchObject({ feedback: "", feedbackImages: [image] });
    for (const feedbackImages of [[{ ...image, type: "text" }], [{ ...image, data: "not base64" }], [{ ...image, mimeType: "text/html" }], [{ ...image, path: "C:/private.png" }], {}]) {
      expect(() => parsePlanAction({ ...refine, feedbackImages })).toThrow();
    }
    expect(() => parsePlanAction({ ...refine, choice: "keep" })).toThrow();
  });
});
