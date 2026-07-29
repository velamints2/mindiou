#!/usr/bin/env bash
# 部署 web/ SPA 前端到老服务器 (114.67.169.78)。
#
# 流程：本地构建 → 上传 → 备份旧目录 → 清空 → 部署 → 修链接 → 验证。
# 同时把 /opt/mindiou/current/dist/ 里的 mvp1.html、training.html 及其
# 构建产物同步到 /var/www/mindiou/，保证 SPA + mvp1 + training 三入口共存。
#
# 用法:
#   bash scripts/deploy-web.sh                  # 默认部署到 114.67.169.78
#   MINDIOU_SSH_HOST=1.2.3.4 bash scripts/deploy-web.sh
#
# 环境变量:
#   MINDIOU_SSH_HOST    目标服务器地址（默认 114.67.169.78）
#   MINDIOU_SSH_USER    SSH 用户（默认 root）
#   MINDIOU_WEB_DIR     服务器静态目录（默认 /var/www/mindiou）
#   MINDIOU_DIST_DIR    服务器构建产物目录（默认 /opt/mindiou/current/dist）
#
# 前置条件:
#   - 本地 web/ 已安装依赖（npm ci）
#   - SSH 已配置免密登录（ssh-agent 或 ~/.ssh/id_rsa）
#   - 服务器上 MINDIOU_DIST_DIR 存在且包含 mvp1.html、training.html 及其 JS/CSS
set -euo pipefail

SSH_HOST="${MINDIOU_SSH_HOST:-114.67.169.78}"
SSH_USER="${MINDIOU_SSH_USER:-root}"
WEB_DIR="${MINDIOU_WEB_DIR:-/var/www/mindiou}"
DIST_DIR="${MINDIOU_DIST_DIR:-/opt/mindiou/current/dist}"
SSH_TARGET="${SSH_USER}@${SSH_HOST}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_SRC_DIR="${REPO_ROOT}/web"
TMP_TAR="/tmp/mindiou-web-spa-$$.tar.gz"
REMOTE_TAR="/tmp/mindiou-web-spa.tar.gz"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_DIR="${WEB_DIR}-backup-${TIMESTAMP}"

echo "==> 目标: ${SSH_TARGET}"
echo "    静态目录: ${WEB_DIR}"
echo "    构建产物: ${DIST_DIR}"

# ─── 1. 本地构建 ───
echo "==> [1/6] 本地构建 web/ SPA"
cd "${WEB_SRC_DIR}"
echo "    类型检查..."
npm run check
echo "    单元测试..."
npm test
echo "    构建..."
npm run build
echo "    打包..."
tar -czf "${TMP_TAR}" -C dist .
trap 'rm -f "${TMP_TAR}"' EXIT

# ─── 2. 上传 ───
echo "==> [2/6] 上传构建包到 ${SSH_TARGET}"
scp -o StrictHostKeyChecking=no "${TMP_TAR}" "${SSH_TARGET}:${REMOTE_TAR}"

# ─── 3. 远程部署 ───
# mvp1/training 的 JS/CSS 文件名带构建 hash，用通配符动态匹配，避免硬编码。
echo "==> [3/6] 远程部署（备份 → 清空 → 解压 → 同步 mvp1/training → 修链接）"
ssh -o StrictHostKeyChecking=no "${SSH_TARGET}" "set -euo pipefail

echo '    创建回滚备份（清空之前的快照）...'
cp -a '${WEB_DIR}' '${BACKUP_DIR}'

echo '    清空旧静态目录...'
rm -rf '${WEB_DIR}'/*
echo '    解压新 SPA...'
tar -xzf '${REMOTE_TAR}' -C '${WEB_DIR}/'
find '${WEB_DIR}/' -name '._*' -delete

echo '    复制 mvp1.html 及其构建产物（通配符匹配 hash 文件名）...'
cp '${DIST_DIR}/mvp1.html' '${WEB_DIR}/' 2>/dev/null || echo '    警告: mvp1.html 缺失'
for f in mvp1-*.js mvp1-*.css report-styles-*.css modulepreload-polyfill-*.js; do
  cp '${DIST_DIR}/'\$f '${WEB_DIR}/' 2>/dev/null || true
done

echo '    复制 training.html 及其构建产物（通配符匹配 hash 文件名）...'
cp '${DIST_DIR}/training.html' '${WEB_DIR}/' 2>/dev/null || echo '    警告: training.html 缺失'
for f in training-*.js training-*.css; do
  cp '${DIST_DIR}/'\$f '${WEB_DIR}/' 2>/dev/null || true
done

echo '    修复 training.html 链接为相对路径...'
sed -i 's|href=\"/mvp1.html\"|href=\"./mvp1.html\"|g; s|href=\"/training.html|href=\"./training.html|g; s|src=\"/src/|src=\"./src/|g; s|href=\"/src/|href=\"./src/|g' '${WEB_DIR}/training.html'

echo '    修复 mvp1.html 资源路径为相对路径（如有绝对路径）...'
sed -i 's|src=\"/|src=\"./|g; s|href=\"/|href=\"./|g' '${WEB_DIR}/mvp1.html' 2>/dev/null || true

echo '    设置权限...'
chown -R mindiou:mindiou '${WEB_DIR}/'

rm -f '${REMOTE_TAR}'
echo '    远程部署完成'
"

# ─── 4. 验证静态资源 ───
echo "==> [4/6] 验证静态资源 HTTP 状态"
verify_url() {
  local path="$1"
  local expected="${2:-200}"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -k "https://${SSH_HOST}${path}" 2>/dev/null || echo "000")
  if [ "${code}" = "${expected}" ]; then
    echo "    OK ${path} -> ${code}"
  else
    echo "    FAIL ${path} -> ${code} (期望 ${expected})"
    return 1
  fi
}

verify_url "/mindiou/index.html"
verify_url "/mindiou/mvp1.html"
verify_url "/mindiou/training.html"

# ─── 5. 验证 SPA 包含 training 路由 ───
echo "==> [5/6] 验证 SPA 包含 training 路由"
SPA_JS=$(curl -s -k "https://${SSH_HOST}/mindiou/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)
if [ -z "${SPA_JS}" ]; then
  echo "    FAIL 无法从 index.html 解析 SPA JS 文件名"
  exit 1
fi
TRAINING_COUNT=$(curl -s -k "https://${SSH_HOST}/mindiou/${SPA_JS}" | grep -c 'training' || true)
if [ "${TRAINING_COUNT}" -gt 0 ]; then
  echo "    OK ${SPA_JS} 包含 training 路由 (${TRAINING_COUNT} 处)"
else
  echo "    FAIL ${SPA_JS} 不包含 training 路由"
  exit 1
fi

# ─── 6. 验证后端 API ───
echo "==> [6/6] 验证训练系统后端 API"
verify_url "/mindiou-api/health"
verify_url "/mindiou-api/api/training/today"
verify_url "/mindiou-api/api/training/debts"

echo ""
echo "========================================"
echo "部署完成"
echo "========================================"
echo "访问地址:"
echo "  SPA:       https://${SSH_HOST}/mindiou/"
echo "  MVP-1:     https://${SSH_HOST}/mindiou/mvp1.html"
echo "  训练系统:  https://${SSH_HOST}/mindiou/training.html"
echo "  SPA 训练:  https://${SSH_HOST}/mindiou/#/training"
echo ""
echo "回滚方法: ssh ${SSH_TARGET} 'rm -rf ${WEB_DIR} && cp -a ${BACKUP_DIR} ${WEB_DIR}'"
echo "备份目录: ${BACKUP_DIR}"
