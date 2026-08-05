import { defineConfig } from "vite";

// 面向用户的 Web 端构建配置。
// 公网部署：base 设为 /mindiou/，Nginx 反代 /mindiou-api/* -> server.js
// 本地开发：默认同源，可用 ?api=http://host:8793 指定后端
export default defineConfig({
  base: "/mindiou/",
  root: ".",
  build: {
    outDir: "dist",
    assetsDir: ".",
    emptyOutDir: true
  },
  server: {
    host: "0.0.0.0",
    port: 5180,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:8793",
      "/health": "http://localhost:8793"
    }
  },
  preview: {
    host: "0.0.0.0",
    port: 4180,
    allowedHosts: true
  }
});
