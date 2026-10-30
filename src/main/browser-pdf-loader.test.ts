// @vitest-environment node
import { EventEmitter } from "node:events";
import type { Session } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("electron", () => ({ net: { request: fake.request } }));
import { loadBrowserPdf } from "./browser-pdf-loader";
let request: EventEmitter & { abort: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; followRedirect: ReturnType<typeof vi.fn> };
const browserSession = {} as Session;
beforeEach(() => {
  request = Object.assign(new EventEmitter(), { abort: vi.fn(), end: vi.fn(), followRedirect: vi.fn() });
  fake.request.mockReturnValue(request);
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function response(headers: Record<string, string> = { "content-type": "application/pdf" }, statusCode = 200) {
  const incoming = Object.assign(new EventEmitter(), { headers, statusCode });
  request.emit("response", incoming);
  return incoming;
}
it("保留 session 凭据和代理归属，逐跳授权后返回实际最终 URL", async () => {
  const result = loadBrowserPdf(browserSession, "https://a.test/document", new AbortController().signal);
  expect(fake.request).toHaveBeenCalledWith({ session: browserSession, url: "https://a.test/document", method: "GET", credentials: "include", redirect: "manual" });
  request.emit("redirect", 302, "GET", "https://b.test/final.pdf");
  expect(request.followRedirect).toHaveBeenCalledTimes(1);
  const incoming = response({ "content-type": "application/octet-stream" });
  incoming.emit("data", Buffer.from("%PDF-1.7\nbody")); incoming.emit("end");
  const actual = await result;
  expect(actual.url).toBe("https://b.test/final.pdf");
  expect(Buffer.from(actual.bytes).toString()).toBe("%PDF-1.7\nbody");
});
it("跨进程传输只暴露授权 PDF 字节，不携带 Buffer 池中的额外内存", async () => {
  const result = loadBrowserPdf(browserSession, "https://a.test/document", new AbortController().signal);
  const incoming = response();
  incoming.emit("data", Buffer.from("%PDF-1.7\n"));
  incoming.emit("data", Buffer.from("authorized bytes"));
  incoming.emit("end");
  const sent = structuredClone((await result).bytes);
  expect(Buffer.from(sent.buffer).toString()).toBe("%PDF-1.7\nauthorized bytes");
});
it.each(["file:///secret.pdf", "https://user:password@a.test/x", "javascript:alert(1)"])("非法初始地址在创建请求前拒绝 %s", target => {
  expect(() => loadBrowserPdf(browserSession, target, new AbortController().signal)).toThrow();
  expect(fake.request).not.toHaveBeenCalled();
});
it("非法重定向不能发送，十跳后也停止", async () => {
  const result = loadBrowserPdf(browserSession, "https://a.test/", new AbortController().signal);
  const rejected = expect(result).rejects.toThrow("HTTP/HTTPS");
  request.emit("redirect", 302, "GET", "file:///secret");
  await rejected; expect(request.followRedirect).not.toHaveBeenCalled(); expect(request.abort).toHaveBeenCalled();
});
it("超过十跳停止跟随", async () => {
  const result = loadBrowserPdf(browserSession, "https://a.test/", new AbortController().signal);
  const rejected = expect(result).rejects.toThrow("重定向");
  for (let index = 0; index < 11; index++) request.emit("redirect", 302, "GET", `https://a.test/${index}`);
  await rejected; expect(request.followRedirect).toHaveBeenCalledTimes(10);
});
it.each([
  [{ "content-type": "text/html" }, 200],
  [{ "content-type": "application/pdf", "content-disposition": "attachment; filename=x.pdf" }, 200],
  [{ "content-type": "application/pdf", "content-length": String(128 * 1024 * 1024 + 1) }, 200],
  [{ "content-type": "application/pdf" }, 403],
] as const)("拒绝错误状态、附件、伪类型及超限头部 %#", async (headers, status) => {
  const result = loadBrowserPdf(browserSession, "https://a.test/", new AbortController().signal);
  const rejected = expect(result).rejects.toThrow(); response(headers, status); await rejected; expect(request.abort).toHaveBeenCalled();
});
it.each(["<html>login</html>", ""])("拒绝缺少签名和空响应 %#", async body => {
  const result = loadBrowserPdf(browserSession, "https://a.test/", new AbortController().signal);
  const rejected = expect(result).rejects.toThrow(); const incoming = response();
  if (body) incoming.emit("data", Buffer.from(body)); incoming.emit("end"); await rejected;
});
it("累计流大小独立受限，不依赖 Content-Length", async () => {
  const result = loadBrowserPdf(browserSession, "https://a.test/", new AbortController().signal);
  const rejected = expect(result).rejects.toThrow("128 MiB"); const incoming = response();
  const chunk = Buffer.alloc(1024 * 1024);
  for (let index = 0; index < 129; index++) incoming.emit("data", chunk);
  await rejected; expect(request.abort).toHaveBeenCalled();
});
it("流中断及声明长度不完整不会发布字节", async () => {
  const result = loadBrowserPdf(browserSession, "https://a.test/", new AbortController().signal);
  const rejected = expect(result).rejects.toThrow("中断"); response().emit("aborted"); await rejected;
});
it("取消后迟到完整响应也不能成功", async () => {
  const abort = new AbortController(); const result = loadBrowserPdf(browserSession, "https://a.test/", abort.signal);
  const rejected = expect(result).rejects.toThrow("取消"); const incoming = response(); abort.abort();
  incoming.emit("data", Buffer.from("%PDF-1.7")); incoming.emit("end"); await rejected;
});
it("无新数据 30 秒中止；收到数据会重置空闲计时", async () => {
  vi.useFakeTimers();
  const result = loadBrowserPdf(browserSession, "https://a.test/", new AbortController().signal);
  const rejected = expect(result).rejects.toThrow("30 秒"); const incoming = response();
  await vi.advanceTimersByTimeAsync(29_000); incoming.emit("data", Buffer.from("%PDF-"));
  await vi.advanceTimersByTimeAsync(29_000); expect(request.abort).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000); await rejected;
});
it("认证失败不索取凭据，取消前已中止的信号不创建请求", async () => {
  const abort = new AbortController(); abort.abort();
  await expect(loadBrowserPdf(browserSession, "https://a.test/", abort.signal)).rejects.toThrow("取消");
  expect(fake.request).not.toHaveBeenCalled();
  const result = loadBrowserPdf(browserSession, "https://a.test/", new AbortController().signal);
  const rejected = expect(result).rejects.toThrow("身份认证");
  const callback = vi.fn(); request.emit("login", {}, callback); await rejected;
  expect(callback).toHaveBeenCalledWith();
});
it("声明长度不完整的响应不能发布", async () => {
  const result = loadBrowserPdf(browserSession, "https://a.test/", new AbortController().signal);
  const rejected = expect(result).rejects.toThrow("不完整");
  const incoming = response({ "content-type": "application/pdf", "content-length": "100" });
  incoming.emit("data", Buffer.from("%PDF-1.7")); incoming.emit("end"); await rejected;
});
