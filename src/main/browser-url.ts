/** 所有浏览器入口和逐跳网络重定向共用同一白名单。 */
export function browserURL(input: unknown): string {
  try {
    if (typeof input !== "string") throw new Error();
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new Error("仅允许不含凭据的 HTTP/HTTPS 外链");
  }
}
