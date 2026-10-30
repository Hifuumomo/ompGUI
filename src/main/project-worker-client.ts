import type { Worker } from "node:worker_threads";
import type {
  ProjectDiff,
  ProjectDiffRequest,
} from "../shared/project-browser";
import type { ProjectJob, ProjectReply } from "./project-worker-protocol";

type WorkerPort = Pick<Worker, "on" | "postMessage" | "terminate">;
interface Pending {
  readonly resolve: (value: string | ProjectDiff | string[]) => void;
  readonly reject: (error: Error) => void;
}

/** 单个常驻工作线程共享缓存，不为每次点击创建线程或复制一份缓存。 */
export class ProjectWorkerClient {
  private worker: WorkerPort | undefined;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  constructor(private readonly spawn: () => WorkerPort) {}
  private fail(error: Error) {
    for (const task of this.pending.values()) task.reject(error);
    this.pending.clear();
  }
  private start() {
    const instance = this.spawn();
    instance.on("message", (reply: ProjectReply) => {
      const task = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      if ("error" in reply) task?.reject(new Error(reply.error));
      else task?.resolve(reply.value);
    });
    instance.on("error", (error) => this.fail(error));
    instance.on("exit", (code) => {
      if (this.worker !== instance) return;
      this.worker = undefined;
      this.fail(new Error(`代码读取线程已退出（${code}）`));
    });
    this.worker = instance;
    return instance;
  }
  /**
   * 将文件读取、差异或文件名搜索交给现有独立线程。
   * 参数：[in] job 包含具体操作与已校验参数的任务。
   * 返回值：该任务的真实结果；线程及文件系统错误拒绝。
   */
  private request(job: ProjectJob): Promise<string | ProjectDiff | string[]> {
    return new Promise((resolve, reject) => {
      const instance = this.worker ?? this.start();
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      try {
        instance.postMessage({ ...job, id });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  close() {
    const instance = this.worker;
    this.worker = undefined;
    this.fail(new Error("代码读取服务已关闭"));
    return instance?.terminate();
  }
  source(path: string) {
    return this.request({ type: "source", path }) as Promise<string>;
  }
  diff(input: ProjectDiffRequest) {
    return this.request({
      type: "diff",
      request: input,
    }) as Promise<ProjectDiff>;
  }
  /**
   * 在独立线程中搜索工作目录文件，不依赖引擎连接或会话。
   * 参数：[in] cwd 绝对工作目录；[in] query 文件名或相对路径查询。
   * 返回值：最多三十条正斜线相对文件路径。
   */
  searchMentionFiles(cwd: string, query: string): Promise<string[]> {
    return this.request({ type: "mention", cwd, query }) as Promise<string[]>;
  }
}
