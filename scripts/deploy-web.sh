#!/usr/bin/env bash
# 部署 web/ SPA 前端到 MindIOU 演示服务器。
#
# 流程：本地构建两套前端 → 上传 → 备份旧目录 → 清空 → 部署 → 验证。
# web/dist 作为 /mindiou/ 主 SPA；根 dist 中的旧 Learn Coach 主界面
# 改名为 legacy.html，并保留 report/desktop/mvp1/training 等全部旧入口。
#
# 用法:
#   bash scripts/deploy-web.sh                  # 默认部署到 demo.mindiou.top 源站
#   MINDIOU_SSH_HOST=1.2.3.4 bash scripts/deploy-web.sh
#
# 环境变量:
#   MINDIOU_SSH_HOST    目标服务器地址（默认 156.225.23.88）
#   MINDIOU_SSH_USER    SSH 用户（默认 root）
#   MINDIOU_WEB_DIR     服务器静态目录（默认 /var/www/mindiou）
#   MINDIOU_PUBLIC_ORIGIN 公网验收 origin（默认 http://demo.mindiou.top）
#
# 前置条件:
#   - 本地 web/ 已安装依赖（npm ci）
#   - SSH 已配置免密登录（ssh-agent 或 ~/.ssh/id_rsa）
set -euo pipefail

SSH_HOST="${MINDIOU_SSH_HOST:-156.225.23.88}"
SSH_USER="${MINDIOU_SSH_USER:-root}"
WEB_DIR="${MINDIOU_WEB_DIR:-/var/www/mindiou}"
PUBLIC_ORIGIN="${MINDIOU_PUBLIC_ORIGIN:-http://demo.mindiou.top}"
SSH_TARGET="${SSH_USER}@${SSH_HOST}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_SRC_DIR="${REPO_ROOT}/web"
TMP_DIR="$(mktemp -d)"
TMP_TAR="${TMP_DIR}/mindiou-frontends.tar.gz"
REMOTE_TAR="/tmp/mindiou-frontends.tar.gz"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_DIR="${WEB_DIR}-backup-${TIMESTAMP}"

echo "==> 目标: ${SSH_TARGET}"
echo "    静态目录: ${WEB_DIR}"
echo "    旧前端产物: ${REPO_ROOT}/dist"

# ─── 1. 本地构建 ───
echo "==> [1/6] 本地构建 SPA 和旧前端"
cd "${WEB_SRC_DIR}"
echo "    类型检查..."
npm run check
echo "    单元测试..."
npm test
echo "    构建..."
npm run build
cd "${REPO_ROOT}"
echo "    构建旧前端入口..."
npm run check
npm test
npm run build
echo "    打包两套构建产物..."
mkdir -p "${TMP_DIR}/spa" "${TMP_DIR}/legacy"
cp -R "${WEB_SRC_DIR}/dist/." "${TMP_DIR}/spa/"
cp -R "${REPO_ROOT}/dist/." "${TMP_DIR}/legacy/"
tar -czf "${TMP_TAR}" -C "${TMP_DIR}" spa legacy
trap 'rm -rf "${TMP_DIR}"' EXIT

# ─── 2. 上传 ───
echo "==> [2/6] 上传构建包到 ${SSH_TARGET}"
scp -o StrictHostKeyChecking=no "${TMP_TAR}" "${SSH_TARGET}:${REMOTE_TAR}"

# ─── 3. 远程部署 ───
echo "==> [3/6] 远程部署（备份 → 清空 → 恢复全部旧入口 → 覆盖主 SPA）"
ssh -o StrictHostKeyChecking=no "${SSH_TARGET}" "set -euo pipefail

echo '    创建回滚备份（清空之前的快照）...'
cp -a '${WEB_DIR}' '${BACKUP_DIR}'

echo '    清空旧静态目录...'
rm -rf '${WEB_DIR}'/*
STAGE_DIR=\$(mktemp -d /tmp/mindiou-frontends.XXXXXX)
tar -xzf '${REMOTE_TAR}' -C \"\$STAGE_DIR\"
echo '    恢复旧前端的全部页面和资源...'
cp -a \"\$STAGE_DIR/legacy/.\" '${WEB_DIR}/'
mv '${WEB_DIR}/index.html' '${WEB_DIR}/legacy.html'
echo '    部署新 SPA 主入口...'
cp -a \"\$STAGE_DIR/spa/.\" '${WEB_DIR}/'
find '${WEB_DIR}/' -name '._*' -delete
rm -rf \"\$STAGE_DIR\"

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
  code=$(curl --max-time 15 -s -o /dev/null -w '%{http_code}' -k "${PUBLIC_ORIGIN}${path}" 2>/dev/null || echo "000")
  if [ "${code}" = "${expected}" ]; then
    echo "    OK ${path} -> ${code}"
  else
    echo "    FAIL ${path} -> ${code} (期望 ${expected})"
    return 1
  fi
}

verify_url "/mindiou/index.html"
verify_url "/mindiou/legacy.html"
verify_url "/mindiou/report.html"
verify_url "/mindiou/desktop.html"
verify_url "/mindiou/mvp1.html"
verify_url "/mindiou/training.html"
verify_url "/genesis" 302

# ─── 5. 验证 SPA 包含 training 路由 ───
echo "==> [5/6] 验证 SPA 包含 training 路由"
SPA_JS=$(curl --max-time 15 -s -k "${PUBLIC_ORIGIN}/mindiou/index.html" | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)
if [ -z "${SPA_JS}" ]; then
  echo "    FAIL 无法从 index.html 解析 SPA JS 文件名"
  exit 1
fi
TRAINING_COUNT=$(curl --max-time 15 -s -k "${PUBLIC_ORIGIN}/mindiou/${SPA_JS}" | grep -c 'training' || true)
if [ "${TRAINING_COUNT}" -gt 0 ]; then
  echo "    OK ${SPA_JS} 包含 training 路由 (${TRAINING_COUNT} 处)"
else
  echo "    FAIL ${SPA_JS} 不包含 training 路由"
  exit 1
fi
GENESIS_COUNT=$(curl --max-time 15 -s -k "${PUBLIC_ORIGIN}/mindiou/${SPA_JS}" | grep -c 'Permanent archive' || true)
if [ "${GENESIS_COUNT}" -gt 0 ]; then
  echo "    OK ${SPA_JS} 包含 Genesis 永久档案"
else
  echo "    FAIL ${SPA_JS} 不包含 Genesis 永久档案"
  exit 1
fi

# ─── 6. 验证后端 API ───
echo "==> [6/6] 验证训练系统后端 API"
verify_url "/mindiou-api/health"
verify_url "/mindiou-api/api/training/today"
verify_url "/mindiou-api/api/training/debts"
verify_url "/mindiou-api/api/genesis"

echo ""
echo "========================================"
echo "部署完成"
echo "========================================"
echo "访问地址:"
echo "  SPA:       ${PUBLIC_ORIGIN}/mindiou/"
echo "  旧主界面: https://${SSH_HOST}/mindiou/legacy.html"
echo "  旧报告页: https://${SSH_HOST}/mindiou/report.html"
echo "  桌面界面: https://${SSH_HOST}/mindiou/desktop.html"
echo "  MVP-1:     https://${SSH_HOST}/mindiou/mvp1.html"
echo "  训练系统:  https://${SSH_HOST}/mindiou/training.html"
echo "  SPA 训练:  https://${SSH_HOST}/mindiou/#/training"
echo ""
echo "回滚方法: ssh ${SSH_TARGET} 'rm -rf ${WEB_DIR} && cp -a ${BACKUP_DIR} ${WEB_DIR}'"
echo "备份目录: ${BACKUP_DIR}"
