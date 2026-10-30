import { net, type Session } from "electron";
import { browserURL } from "./browser-url";

const maxBytes = 128 * 1024 * 1024;
const idleMilliseconds = 30_000;

/** 使用当前 Chromium session 的代理、认证和 cookie；每跳先授权再继续。 */
export function loadBrowserPdf(browserSession: Session, source: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; url: string }> {
  const initialURL = browserURL(source);
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("PDF 加载已取消")); return; }
    const request = net.request({ session: browserSession, url: initialURL, method: "GET", credentials: "include", redirect: "manual" });
    let finalURL = initialURL;
    let redirects = 0;
    let complete = false;
    let timer: ReturnType<typeof setTimeout>;
    const chunks: Buffer[] = [];
    let length = 0;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const fail = (error: unknown) => {
      if (complete) return;
      complete = true;
      cleanup();
      chunks.length = 0;
      reject(error instanceof Error ? error : new Error(String(error)));
      request.abort();
    };
    const abort = () => fail(new Error("PDF 加载已取消"));
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => fail(new Error("PDF 加载超时（30 秒未收到数据）")), idleMilliseconds); };
    signal.addEventListener("abort", abort, { once: true });
    request.on("redirect", (_status, _method, target) => {
      try {
        if (complete) return;
        const approved = browserURL(target);
        if (++redirects > 10) throw new Error("PDF 重定向次数过多");
        finalURL = approved;
        touch();
        request.followRedirect();
      } catch (error) { fail(error); }
    });
    request.on("login", (_auth, callback) => { callback(); fail(new Error("PDF 需要未提供的身份认证")); });
    request.on("error", fail);
    request.on("abort", () => { if (!complete) fail(new Error("PDF 请求已中止")); });
    request.on("response", response => {
      if (complete) return;
      const header = (name: string) => {
        const value = response.headers[name];
        return Array.isArray(value) ? value.join(",") : value ?? "";
      };
      const type = header("content-type").split(";", 1)[0].trim().toLowerCase();
      const size = header("content-length");
      if (response.statusCode < 200 || response.statusCode >= 300) { fail(new Error(`PDF 请求失败（HTTP ${response.statusCode}）`)); return; }
      if (/\battachment\b/i.test(header("content-disposition"))) { fail(new Error("PDF 响应为下载附件")); return; }
      if (!["application/pdf", "application/octet-stream", "binary/octet-stream"].includes(type)) { fail(new Error("响应不是 PDF 文档")); return; }
      if (size && (!/^\d+$/.test(size) || !Number.isSafeInteger(Number(size)) || Number(size) > maxBytes)) { fail(new Error("PDF 超过 128 MiB 限制")); return; }
      response.on("data", (chunk: Buffer) => {
        if (complete) return;
        length += chunk.length;
        if (length > maxBytes) { fail(new Error("PDF 超过 128 MiB 限制")); return; }
        chunks.push(chunk);
        touch();
      });
      response.on("error", fail);
      response.on("aborted", () => fail(new Error("PDF 响应中断")));
      response.on("end", () => {
        if (complete) return;
        if (!length || (size && length !== Number(size))) { fail(new Error("PDF 文档为空或响应不完整")); return; }
        // IPC 会保留 TypedArray 的整个 backing buffer，不能发送含其他分配的 Buffer 池。
        const bytes = Buffer.allocUnsafeSlow(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) { fail(new Error("响应缺少 PDF 文件签名")); return; }
        complete = true;
        cleanup();
        chunks.length = 0;
        resolve({ bytes, url: finalURL });
      });
    });
    touch();
    try { request.end(); } catch (error) { fail(error); }
  });
}
