/**
 * MindIOU Mentra TPA 入口。
 * 所需环境变量见 .env.example。
 */
import { createBackendClient } from "./backendClient.js";
import { MindIouMentraServer } from "./app.js";

function required(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    console.error(`[mindiou-mentra] 缺少环境变量 ${name}`);
    process.exit(1);
  }
  return value;
}

const server = new MindIouMentraServer({
  config: {
    packageName: required("MENTRA_PACKAGE_NAME"),
    apiKey: required("MENTRA_API_KEY"),
    port: Number(process.env.PORT || 7010)
  },
  backend: createBackendClient({
    baseUrl: required("MINDIOU_API_BASE"),
    token: String(process.env.LEARNING_API_TOKEN || "").trim() || undefined
  })
});

server.start().catch(error => {
  console.error("[mindiou-mentra] 启动失败", error);
  process.exit(1);
});
