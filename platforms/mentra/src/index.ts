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

const parsedPort = Number(process.env.PORT || 7010);
const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : 7010;

const server = new MindIouMentraServer({
  config: {
    packageName: required("MENTRA_PACKAGE_NAME"),
    apiKey: required("MENTRA_API_KEY"),
    port
  },
  backend: createBackendClient({
    baseUrl: required("MINDIOU_API_BASE"),
    token: String(process.env.LEARNING_API_TOKEN || "").trim() || undefined
  })
});

// 单条会话的异步异常不应拖垮整个 TPA；日志不含语音内容与密钥。
process.on("unhandledRejection", reason => {
  console.error("[mindiou-mentra] unhandledRejection:", reason instanceof Error ? reason.message : String(reason));
});
process.on("uncaughtException", error => {
  console.error("[mindiou-mentra] uncaughtException:", error.message);
  process.exit(1);
});

server.start().then(() => {
  console.error(`[mindiou-mentra] listening on :${port}, webhook POST /webhook, health GET /health`);
}).catch(error => {
  console.error("[mindiou-mentra] 启动失败", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
