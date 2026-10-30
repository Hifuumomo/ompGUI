/** 比较项目路径，统一分隔符、尾部斜杠以及 Windows 盘符路径的大小写。 */
export function sameProjectPath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const path = value.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[a-z]:/i.test(path) ? path.toLowerCase() : path;
  };
  return normalize(left) === normalize(right);
}

/** 编码引用的字面路径，保留百分号、井号和问号作为文件名，而非 URL 转义或片段。 */
export function messageFileHref(path: string): string {
  return encodeURI(path.replace(/\\/g, "/")).replace(/[?#]/g, encodeURIComponent);
}

/** 将消息链接解码为本地路径；不接受网页、远程文件主机、脚本或设备路径。 */
export function messageFilePath(href: string): string | undefined {
  try {
    let value = href;
    if (/^file:/i.test(value)) {
      const url = new URL(value);
      if (url.hostname && url.hostname !== "localhost") return undefined;
      value = url.pathname;
      if (/^\/[a-z]:\//i.test(value)) value = value.slice(1);
    } else {
      value = value.split(/[?#]/, 1)[0];
    }
    const path = decodeURIComponent(value).replace(/\\/g, "/");
    if (
      !path ||
      /[\u0000-\u001f\u007f]/.test(path) ||
      path.startsWith("//") ||
      (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:\//i.test(path))
    )
      return undefined;
    return path;
  } catch {
    return undefined;
  }
}
