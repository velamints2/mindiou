#!/usr/bin/env bash
# 将构建产物同步到生产 Nginx 目录。
# 用法：在生产服务器上执行 ./deploy/sync-web.sh
# 前置：已在项目根目录执行 npm run build 和 cd web && npm run build
set -euo pipefail

WEB_ROOT="/var/www/mindiou"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 同步目标: $WEB_ROOT"
sudo mkdir -p "$WEB_ROOT"

# 1. 旧 MVP-0/MVP-1 产物（dist/）— 包含 mvp1.html、report 相关资源
echo "==> 同步 dist/ (MVP-0/MVP-1)..."
sudo rsync -av --delete \
  --exclude='.gitignore' \
  "$PROJECT_ROOT/dist/" "$WEB_ROOT/"

# 2. 新面向用户 SPA（web/dist/）— 覆盖 index.html 作为主入口
echo "==> 同步 web/dist/ (新 SPA)..."
sudo rsync -av \
  "$PROJECT_ROOT/web/dist/" "$WEB_ROOT/"

# 3. 确认关键文件存在
echo "==> 验证关键文件..."
for f in index.html mvp1.html; do
  if [ ! -f "$WEB_ROOT/$f" ]; then
    echo "ERROR: $WEB_ROOT/$f 不存在" >&2
    exit 1
  fi
done

echo "==> 同步完成"
echo "    /mindiou/        → $WEB_ROOT/index.html (新 SPA)"
echo "    /mindiou/mvp1/   → $WEB_ROOT/mvp1.html (MVP-1 清偿页)"
echo "    健康检查: curl -sk https://localhost/mindiou/ | head -1"
