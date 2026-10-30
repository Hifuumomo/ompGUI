import type { PlanAction, PlanIdentity, PlanFeedbackImage } from "../shared/native-plan";

/** 严格白名单防止渲染进程伪造内部 savePath 或扩展请求字段。 */
export function parsePlanAction(input: unknown): PlanAction {
  function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("无效计划请求");
    return value as Record<string, unknown>;
  }
  function string(value: unknown, max = 4096): string {
    if (typeof value !== "string" || !value.length || value.length > max || value.includes("\0")) throw new Error("无效计划请求字段");
    return value;
  }
  function exact(value: Record<string, unknown>, keys: string[]): void {
    if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error("计划请求包含未授权字段");
  }
  const action = record(input);
  const op = string(action.op);
  if (op === "status") { exact(action, ["op"]); return { op }; }
  const identityValue = record(action.identity);
  exact(identityValue, ["sessionId", "sessionFile", "epoch"]);
  const identity: PlanIdentity = {
    sessionId: string(identityValue.sessionId), sessionFile: string(identityValue.sessionFile, 32768), epoch: string(identityValue.epoch),
  };
  if (op === "enter" || op === "pause" || op === "leave") {
    exact(action, ["op", "identity"]); return { op, identity };
  }
  if (op === "cancel") {
    exact(action, ["op", "identity", "operationId"]);
    return { op, identity, operationId: string(action.operationId) };
  }
  if (op === "saveDocument") {
    exact(action, ["op", "identity", "path", "revision", "content"]);
    if (typeof action.content !== "string" || Buffer.byteLength(action.content, "utf8") > 1024 * 1024) throw new Error("计划正文超过 1MiB 或格式无效");
    return { op, identity, path: string(action.path, 32768), revision: string(action.revision), content: action.content };
  }
  if (op !== "decide") throw new Error("未知计划操作");
  exact(action, ["op", "identity", "reviewId", "revision", "choice", "executionModel", "feedback", "feedbackImages"]);
  const choice = string(action.choice);
  if (!["execute", "compact", "keep", "refine", "save"].includes(choice)) throw new Error("未知计划处置");
  let executionModel;
  if (action.executionModel !== undefined) {
    const model = record(action.executionModel);
    exact(model, ["provider", "modelId", "thinkingLevel"]);
    executionModel = { provider: string(model.provider), modelId: string(model.modelId),
      ...(model.thinkingLevel === undefined ? {} : { thinkingLevel: string(model.thinkingLevel) }) };
  }
  if (action.feedback !== undefined && (typeof action.feedback !== "string" || Buffer.byteLength(action.feedback, "utf8") > 1024 * 1024)) throw new Error("计划反馈过长或格式无效");
  let feedbackImages: PlanFeedbackImage[] | undefined;
  if (action.feedbackImages !== undefined) {
    if (choice !== "refine" || !Array.isArray(action.feedbackImages)) throw new Error("无效计划反馈图片");
    feedbackImages = action.feedbackImages.map((value) => {
      const image = record(value);
      exact(image, ["type", "data", "mimeType"]);
      const data = string(image.data, 24 * 1024 * 1024);
      const mimeType = string(image.mimeType, 128);
      if (image.type !== "image" || !/^image\/[a-z0-9.+-]+$/i.test(mimeType) || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error("无效计划反馈图片");
      return { type: "image", data, mimeType };
    });
  }
  return { op, identity, reviewId: string(action.reviewId), revision: string(action.revision),
    choice: choice as "execute" | "compact" | "keep" | "refine" | "save", executionModel,
    ...(action.feedback === undefined ? {} : { feedback: action.feedback as string }),
    ...(feedbackImages === undefined ? {} : { feedbackImages }) };
}
