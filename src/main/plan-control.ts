import { connect } from "node:net";
import { lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { PlanAction, PlanSnapshot } from "../shared/native-plan";

export interface PlanControl { endpoint: string; token: string }
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** 仅接受原生主机生成的本机私有取消端点，不接受 TCP 地址或任意管道。 */
export function readPlanControl(value: unknown): PlanControl {
  if (!value || typeof value !== "object" || !("endpoint" in value) || !("token" in value) ||
      typeof value.endpoint !== "string" || typeof value.token !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.token)) throw new Error("原生计划取消凭据无效");
  const endpoint = value.endpoint;
  const valid = process.platform === "win32"
    ? endpoint.startsWith("\\\\.\\pipe\\ompgui-plan-") &&
      new RegExp(`^${UUID}$`, "i").test(endpoint.slice("\\\\.\\pipe\\ompgui-plan-".length))
    : basename(endpoint) === "control.sock" && dirname(dirname(endpoint)) === tmpdir() &&
      /^ompgui-plan-[a-zA-Z0-9]+$/.test(basename(dirname(endpoint))) &&
      endpoint === join(tmpdir(), basename(dirname(endpoint)), "control.sock");
  if (!valid) throw new Error("原生计划取消端点不是受信本机地址");
  return { endpoint, token: value.token };
}

/** Unix 连接前核对私有目录与 socket，拒绝符号链接和其他用户的端点。 */
async function validateOwner(endpoint: string): Promise<void> {
  if (process.platform === "win32") return;
  const [directory, socket] = await Promise.all([lstat(dirname(endpoint)), lstat(endpoint)]);
  const uid = process.getuid?.();
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0 ||
      !socket.isSocket() || socket.isSymbolicLink() || uid === undefined ||
      directory.uid !== uid || socket.uid !== uid) throw new Error("原生计划取消端点所有权无效");
}

/** 独立于原生命令队列发送一次有界 JSONL 取消请求；失败不会回退至 slash。 */
export async function cancelPlanOperation(
  control: PlanControl,
  action: Extract<PlanAction, { op: "cancel" }>,
  signal: AbortSignal,
): Promise<PlanSnapshot> {
  readPlanControl(control);
  const request = Buffer.from(`${JSON.stringify({ token: control.token, action })}\n`);
  if (request.length > 8192) throw new Error("计划取消请求过大");
  await validateOwner(control.endpoint);
  if (signal.aborted) throw new Error("omp 连接已结束");
  return await new Promise<PlanSnapshot>((resolve, reject) => {
    const socket = connect(control.endpoint);
    const parts: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, snapshot?: PlanSnapshot) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error);
      else resolve(snapshot!);
    };
    const abort = () => finish(new Error("omp 连接已结束"));
    const timer = setTimeout(() => finish(new Error("原生计划取消操作超时")), 5000);
    signal.addEventListener("abort", abort, { once: true });
    socket.once("connect", () => socket.write(request));
    socket.on("error", () => finish(new Error("无法连接原生计划取消端点")));
    socket.once("end", () => finish(new Error("原生计划取消响应不完整")));
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      // 计划正文最多 1MiB；JSON 转义可使回复扩大六倍。
      if (bytes > 8 * 1024 * 1024) return finish(new Error("原生计划取消响应过大"));
      parts.push(chunk);
      if (!chunk.includes(10)) return;
      try {
        const buffer = Buffer.concat(parts, bytes);
        const newline = buffer.indexOf(10);
        if (newline !== buffer.length - 1) throw new Error("原生计划取消响应格式无效");
        const reply = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
        if (reply.ok !== true) throw new Error(typeof reply.error === "string" ? reply.error : "原生计划取消失败");
        const snapshot = reply.data as PlanSnapshot;
        const operation = snapshot?.operation;
        if (!snapshot?.identity || operation?.id !== action.operationId ||
            operation.origin?.sessionId !== action.identity.sessionId ||
            operation.origin?.sessionFile !== action.identity.sessionFile ||
            operation.origin?.epoch !== action.identity.epoch) throw new Error("原生计划取消响应身份不匹配");
        finish(undefined, snapshot);
      } catch (error) {
        finish(error instanceof Error ? error : new Error("原生计划取消响应无效"));
      }
    });
  });
}
