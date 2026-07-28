import { defineConfig } from "vitest/config";

// 根目录测试只覆盖后端与共享逻辑（node 环境）。
// web/ 下的前端测试使用 happy-dom，由 web/vitest.config.ts 单独运行：
//   cd web && npm test
export default defineConfig({
  test: {
    exclude: ["node_modules/**", "dist/**", "web/**", "platforms/**"]
  }
});
