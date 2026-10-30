import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { IndexHtmlTransformContext, Plugin } from "vite";
import { pdfAssetsPlugin } from "./pdf-assets-plugin";

/**
 * 为开发服务器开放 React Refresh 与本机 HMR，生产 HTML 保留严格内容安全策略。
 * @param html [in] Vite 读取的渲染器 HTML。
 * @param context [in] HTML 转换上下文，server 仅在开发模式存在。
 * @returns 含对应运行模式内容安全策略的 HTML 字符串。
 */
function transformDevelopmentCsp(
  html: string,
  context: IndexHtmlTransformContext,
): string {
  if (!context.server) return html;
  // 仅开发模式需要内联 Refresh 引导和本机 WebSocket；不开放远程主机或 unsafe-eval。
  return html
    .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
    .replace("script-src 'self' 'wasm-unsafe-eval';", "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline';")
    .replace("connect-src 'self';", "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*;")
    .replace(
      "connect-src 'none';",
      "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*;",
    );
}

const developmentCsp: Plugin = {
  name: "omp-development-csp",
  transformIndexHtml: {
    order: "pre",
    handler: transformDevelopmentCsp,
  },
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "project-worker": resolve("src/main/project-worker.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
          chunkFileNames: "[name]-[hash].js",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          "comment-overlay": resolve("src/preload/comment-overlay.ts"),
          "pdf-viewer": resolve("src/preload/pdf-viewer.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    base: "./",
    plugins: [react(), developmentCsp, pdfAssetsPlugin()],
    server: {
      host: "127.0.0.1",
    },
    build: {
      outDir: resolve("out/renderer"),
      // KaTeX 字体与所有渲染依赖均随构建落盘，不依赖 CDN 或联网下载。
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          "comment-overlay": resolve("src/renderer/comment-overlay.html"),
          "pdf-viewer": resolve("src/renderer/pdf-viewer.html"),
        },
      },
    },
  },
});
