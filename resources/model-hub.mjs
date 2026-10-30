import { modelHubSnapshot } from "./model-hub-data.mjs";
import { applyModelHubAction } from "./model-hub-actions.mjs";

/** All model operations use omp's live registry and Settings; failures return through the request id. */
export function registerModelHub(api, reply, loadModules) {
  api.registerCommand("ompgui-model", {
    description: "桌面端原生模型中心",
    async handler(args, ctx) {
      let request;
      try {
        request = JSON.parse(args);
        if (typeof request.requestId !== "string")
          throw new Error("缺少模型请求标识");
        if (ctx.agent.kind !== "main") throw new Error("模型中心仅支持主会话");
        const action = request;
        if (!action || typeof action.op !== "string")
          throw new Error("缺少模型操作");
        const modules = await loadModules();
        const host = { api, ctx, modules };
        const readOnly = ["list", "search"].includes(action.op);
        if (!readOnly && !ctx.isIdle())
          throw new Error("请等待会话空闲后修改模型配置");
        const notice = readOnly
          ? undefined
          : await applyModelHubAction(host, action);
        const data = modelHubSnapshot(host, {
          query: action.op === "search" ? action.query : "",
          notice,
        });
        reply(ctx, request.requestId, { ok: true, data });
      } catch (error) {
        reply(ctx, request?.requestId, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}
