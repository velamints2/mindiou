// @ts-nocheck
import { describe, expect, it } from "vitest";
import { prepareArtifactForReport } from "../mvp0-artifact-preprocess.js";

function jsonl(entries: unknown[]) {
  return entries.map(entry => JSON.stringify(entry)).join("\n");
}

function message(role: string, text: string) {
  return {
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: "input_text", text }]
    }
  };
}

function toolCall(name: string, args: string) {
  return {
    type: "response_item",
    payload: {
      type: "function_call",
      name,
      arguments: args
    }
  };
}

function toolOutput(output: string) {
  return {
    type: "response_item",
    payload: {
      type: "function_call_output",
      output
    }
  };
}

describe("prepareArtifactForReport", () => {
  it("leaves normal text as plain truncated input", () => {
    const prepared = prepareArtifactForReport("AI wrote a React app.", "chatgpt", { maxText: 30000 });

    expect(prepared.text).toBe("AI wrote a React app.");
    expect(prepared.metadata.didCompress).toBe(false);
    expect(prepared.metadata.strategy).toBe("plain-truncate");
  });

  it("compresses rollout JSONL and removes instruction/tool-schema noise", () => {
    const raw = jsonl([
      {
        type: "session_meta",
        payload: {
          id: "session-1",
          cwd: "/workspace",
          base_instructions: { text: "You are Codex. <skills_instructions> dynamic_tools MEMORY_SUMMARY" }
        }
      },
      message("user", "帮我验证 API 24 路线，如果不行就研究 API 26 VM 路线。"),
      message("assistant", "我会检查 API 24 编译错误并确认是否需要切到 API 26。"),
      {
        type: "response_item",
        payload: {
          type: "reasoning",
          encrypted_content: "secret reasoning that should never reach the report prompt"
        }
      },
      toolCall("exec_command", "rg -n compileSdkVersion build-profile.json5"),
      toolOutput("Permission verification failed: MANAGE_BLUETOOTH is unavailable on API 24."),
      message("assistant", "结论：API 24 路线被权限能力阻塞，API 26 VM 路线更适合完成最小验收。"),
      toolCall("apply_patch", "*** Begin Patch\n*** Update File: module.json5\n+ ohos.permission.INTERNET\n*** End Patch"),
      toolOutput("BUILD SUCCESSFUL in 2s\nInstall successfully\nstart ability successfully"),
      message("assistant", "最终结果：Phone Deck 已切到 API 26，HAP 构建、hdc 安装和 aa start 启动都已通过。")
    ]);

    const prepared = prepareArtifactForReport(raw, "codex", { maxText: 30000 });

    expect(prepared.metadata.didCompress).toBe(true);
    expect(prepared.metadata.strategy).toBe("rollout-jsonl-structured");
    expect(prepared.text).toContain("Structured Compression");
    expect(prepared.text).toContain("Final Outcomes And Late Assistant Summaries");
    expect(prepared.text).toContain("Phone Deck 已切到 API 26");
    expect(prepared.text).toContain("Install successfully");
    expect(prepared.text).toContain("MANAGE_BLUETOOTH");
    expect(prepared.text).not.toContain("encrypted_content");
    expect(prepared.text).not.toContain("dynamic_tools");
    expect(prepared.text).not.toContain("MEMORY_SUMMARY");
  });

  it("preserves late outcomes when early rollout content is larger than the budget", () => {
    const earlyNoise = "早期 API 24 调查内容。".repeat(3000);
    const raw = jsonl([
      { type: "session_meta", payload: { id: "session-2", cwd: "/workspace" } },
      message("user", "先看 API 24。"),
      message("assistant", earlyNoise),
      toolCall("exec_command", "rg -n compileSdkVersion build-profile.json5"),
      toolOutput("Permission verification failed: API 24 permission gate."),
      message("user", "继续切 API 26 VM 验证。"),
      message("assistant", "最终结果：API 26 VM 已经通过 HAP build、hdc install、aa start，剩余边界是真机验证不是 VM 验证。")
    ]);

    const prepared = prepareArtifactForReport(raw, "codex", { maxText: 3000 });

    expect(prepared.text.length).toBeLessThanOrEqual(3000);
    expect(prepared.text).toContain("API 26 VM 已经通过");
    expect(prepared.text).toContain("真机验证不是 VM 验证");
  });
});
