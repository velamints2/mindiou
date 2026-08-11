#!/usr/bin/env bash
set -euo pipefail

# One-line installer for the public MindIOU remote MCP.
# It writes a project-local .trae/mcp.json and never sends the token to MindIOU.

token="${1:-}"
if [ -z "$token" ]; then
  echo "用法：mindiou-mcp-install.sh <项目 Hook Token>" >&2
  exit 2
fi

if ! printf '%s' "$token" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  echo "Token 格式不正确：应为 64 位十六进制项目 Hook Token。" >&2
  exit 2
fi

config_dir=".trae"
config_file="$config_dir/mcp.json"
mkdir -p "$config_dir"
umask 077

if command -v node >/dev/null 2>&1; then
  node - "$token" "$config_file" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const token = process.argv[2];
const configFile = process.argv[3];
let config = {};

if (fs.existsSync(configFile)) {
  const backup = `${configFile}.backup-${Date.now()}`;
  fs.copyFileSync(configFile, backup);
  try {
    config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch {
    console.error(`已有配置不是有效 JSON，原文件已备份到 ${backup}`);
    process.exit(1);
  }
}

if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
  config.mcpServers = {};
}

config.mcpServers.mindiou = {
  url: 'https://demo.mindiou.top/mindiou-mcp',
  headers: { Authorization: `Bearer ${token}` }
};

const temporary = `${configFile}.tmp-${process.pid}`;
fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, configFile);
console.log(`已配置 mindiou MCP：${path.resolve(configFile)}`);
NODE
else
  if [ -e "$config_file" ]; then
    echo "检测到已有 .trae/mcp.json，但本机没有 Node.js，无法安全合并配置。请在 TRAE 的 MCP 设置中手动导入 JSON。" >&2
    exit 1
  fi
  printf '{\n  "mcpServers": {\n    "mindiou": {\n      "url": "https://demo.mindiou.top/mindiou-mcp",\n      "headers": {\n        "Authorization": "Bearer %s"\n      }\n    }\n  }\n}\n' "$token" > "$config_file"
  chmod 600 "$config_file"
  echo "已配置 mindiou MCP：$(pwd)/$config_file"
fi

echo "下一步：在 TRAE 的 MCP 设置中开启项目 .trae/mcp.json 导入，然后重新加载 MCP。"
