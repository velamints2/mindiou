/**
 * MindIOU MCP Server（stdio 传输）。
 *
 * 让 TRAE / Claude Code / Cursor 等 Agent 能够：
 * 读取用户的学习上下文、获得代劳程度建议、记录决策与欠条、提交学习证据。
 *
 * 配置（在 TRAE MCP 设置中手动添加，密钥不进 Git）：
 *   命令: node
 *   参数: <repo>/evenhub-g2-learning/mcp/server.mjs
 *   环境变量:
 *     MINDIOU_BASE_URL   后端地址，默认 http://127.0.0.1:8793
 *     MINDIOU_HOOK_TOKEN 项目级 hook token（必需）
 *     MINDIOU_PROJECT_ID 项目 ID（可选，默认使用 token 绑定的项目）
 *
 * 日志只写 stderr；stdout 严格用于 MCP 协议帧。
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBackendClient } from "./backend-client.mjs";
import { startProjectChangeCapture } from "./change-capture.mjs";
import { createMindiouMcpServer } from "./server-factory.mjs";

const client = createBackendClient();
const capture = startProjectChangeCapture({
  workspace: process.env.MINDIOU_CAPTURE_MODE === "watch" ? process.env.MINDIOU_CAPTURE_WORKSPACE : "",
  onBatch: async (events, status) => {
    const result = status.sessionId
      ? await client.appendSessionEvents(status.sessionId, events)
      : await client.postEvents(events, {
        sessionId: `mcp-watch-${Date.now()}`,
        externalSessionId: `mcp-watch-${Date.now()}`,
        sourceFingerprint: `mcp-watch:${client.projectId}`,
        title: "工作区代码变更捕捉"
      });
    return result;
  }
});
const { server } = createMindiouMcpServer(client, { captureState: capture });

process.on("unhandledRejection", (error) => {
  console.error(`[mindiou-mcp] unhandledRejection: ${error?.message || error}`);
});

await server.connect(new StdioServerTransport());
console.error(`[mindiou-mcp] connected, backend=${client.baseUrl}`);
if (capture.getStatus().enabled) console.error(`[mindiou-mcp] change capture watching ${capture.getStatus().workspace}`);
