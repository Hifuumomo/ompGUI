import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import type { Plugin } from "vite";

/** 资源表在启动时枚举；开发请求不能借路径穿越读取 node_modules。 */
export function pdfAssetsPlugin(): Plugin {
  const root = resolve("node_modules/pdfjs-dist");
  const files = new Map<string, string>();
  function visit(directory: string): void {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(name);
      else files.set(`pdf-assets/${name}`, resolve(root, name));
    }
  }
  for (const directory of ["cmaps", "standard_fonts", "wasm", "web/images"]) visit(directory);
  files.set("pdf-assets/LICENSE", resolve(root, "LICENSE"));
  const mime: Record<string, string> = { wasm: "application/wasm", png: "image/png", svg: "image/svg+xml", gif: "image/gif", bcmap: "application/octet-stream", ttf: "font/ttf", pfb: "application/octet-stream" };
  return {
    name: "omp-pdf-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const key = (request.url ?? "").split("?")[0]!.replace(/^\//, "");
        const path = files.get(key);
        if (!path) { next(); return; }
        response.setHeader("Content-Type", mime[path.split(".").pop()!] ?? "application/octet-stream");
        response.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const [fileName, path] of files) {
        if (relative(root, path).split(sep).includes("..")) throw new Error("Invalid PDF asset");
        this.emitFile({ type: "asset", fileName, source: readFileSync(path) });
      }
    },
  };
}
