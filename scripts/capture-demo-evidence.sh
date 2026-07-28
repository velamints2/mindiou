#!/usr/bin/env bash
# 捕获演示模式（SPIRAL_DISABLE_AI=1 + MVP1_DEMO_FALLBACK=1）端到端清偿链路证据。
# 用法: bash scripts/capture-demo-evidence.sh [输出目录]
# 输出: 指定目录下的 demo-evidence.json 与各步骤 *.json
set -euo pipefail

OUT_DIR="${1:-tmp/demo-evidence}"
mkdir -p "$OUT_DIR"

PORT=8795
BASE="http://127.0.0.1:${PORT}"
COOKIE_JAR="${OUT_DIR}/cookies.txt"
STORE_DIR="${OUT_DIR}/stores"
mkdir -p "$STORE_DIR"

# 清理旧数据
rm -f "${STORE_DIR}/"*.json "${STORE_DIR}/"*.sqlite* 2>/dev/null || true
rm -f "$COOKIE_JAR" 2>/dev/null || true

echo "==> 启动演示模式服务器 (SPIRAL_DISABLE_AI=1, MVP1_DEMO_FALLBACK=1)"
PORT=$PORT \
MVP0_STORE_PATH="${STORE_DIR}/mvp0.json" \
MVP1_STORE_PATH="${STORE_DIR}/mvp1.json" \
AUTH_STORE_PATH="${STORE_DIR}/auth.sqlite" \
SPIRAL_DISABLE_AI=1 \
MVP1_DEMO_FALLBACK=1 \
LEARNING_API_TOKEN= \
STT_API_KEY= \
node server.js > "${OUT_DIR}/server.log" 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

# 等待健康检查
for i in $(seq 1 40); do
  if curl -sf "${BASE}/health" > /dev/null 2>&1; then break; fi
  sleep 0.25
done
echo "==> 服务器就绪 (PID ${SERVER_PID})"

# 演示样本文本（与 web/src/pages.ts DEMO_SAMPLE_TEXT 一致）
DEMO_TEXT='用户：线上服务器突然响应变慢，top 看到 load average 飙到 40+，很多进程卡在 D 状态。
iostat 显示 %iowait 超过 60%。我让 AI 帮我排查。

AI：根据你描述的症状（高 load、D 状态进程、高 iowait），这通常是磁盘 I/O 瓶颈。
建议检查：
1. dmesg 是否有磁盘错误
2. iotop 找出 I/O 最大的进程
3. 检查是否有大量 swap 导致 thrashing

用户：dmesg 没有磁盘错误。iotop 显示 nginx worker 进程在大量写日志。
我直接重启了 nginx，负载暂时降下来了。

AI：重启 nginx 只是缓解了症状。根因可能是：
1. 日志写入没有异步化
2. 磁盘本身性能不足
3. 日志级别设置过低导致写入量过大
建议长期修复：启用日志缓冲、升级磁盘、或将日志写入远程日志服务。

用户：好的，我先把日志级别调高，重启后负载正常了。
但我不确定根因是否真的修复了，因为只是减少了写入量而不是解决了 I/O 瓶颈。'

echo "==> 步骤1: 注册演示账户"
STEP1="${OUT_DIR}/01-register.json"
curl -sf -X POST "${BASE}/api/auth/register" \
  -H 'content-type: application/json' \
  -d '{"email":"demo@evidence.local","password":"evidence-demo-1"}' \
  -c "$COOKIE_JAR" \
  -o "$STEP1"
echo "    -> $(jq -c '{ok, user: .user.email}' "$STEP1" 2>/dev/null || cat "$STEP1")"

echo "==> 步骤2: 生成协作时间线"
STEP2="${OUT_DIR}/02-timeline.json"
curl -sf -X POST "${BASE}/api/mvp0/timelines" \
  -H 'content-type: application/json' \
  -b "$COOKIE_JAR" \
  --data-binary "$(jq -n --arg t "$DEMO_TEXT" '{artifactText: $t, artifactType: "对话记录"}')" \
  -o "$STEP2"
DRAFT_ID=$(jq -r '.draft.id' "$STEP2")
FALLBACK=$(jq -r '.fallback // false' "$STEP2")
echo "    -> draftId=${DRAFT_ID}, fallback=${FALLBACK}"

echo "==> 步骤3: 生成认知债务报告"
STEP3="${OUT_DIR}/03-report.json"
curl -sf -X POST "${BASE}/api/mvp0/report" \
  -H 'content-type: application/json' \
  -b "$COOKIE_JAR" \
  -d "{\"draftId\":\"${DRAFT_ID}\"}" \
  -o "$STEP3"
REPORT_ID=$(jq -r '.report.id' "$STEP3")
CARD_ID=$(jq -r '.report.sections.feynmanCards[0].id' "$STEP3")
CARD_TARGET=$(jq -r '.report.sections.feynmanCards[0].target' "$STEP3")
GAPS=$(jq -r '.report.sections.dangerousGaps | length' "$STEP3")
echo "    -> reportId=${REPORT_ID}, cardId=${CARD_ID}, target=\"${CARD_TARGET}\", gaps=${GAPS}"

echo "==> 步骤4: 启动清偿会话（MVP-1）"
STEP4="${OUT_DIR}/04-session-start.json"
curl -sf -X POST "${BASE}/api/mvp1/sessions" \
  -H 'content-type: application/json' \
  -b "$COOKIE_JAR" \
  -d "{\"reportId\":\"${REPORT_ID}\",\"cardId\":\"${CARD_ID}\"}" \
  -o "$STEP4"
SESSION_ID=$(jq -r '.session.id' "$STEP4")
RESEARCH_MODE=$(jq -r '.session.researchMode' "$STEP4")
QUESTION=$(jq -r '.session.clearanceQuestion' "$STEP4")
echo "    -> sessionId=${SESSION_ID}, researchMode=${RESEARCH_MODE}"
echo "    -> question: ${QUESTION}"

echo "==> 步骤5: 提交第一次回答（部分正确）"
ANSWER='D 状态表示进程在等待不可中断的 I/O，高 iowait 说明 CPU 在等磁盘。重启 nginx 只是暂时清掉了写日志的进程，但没有解决磁盘 I/O 瓶颈这个根因。'
STEP5="${OUT_DIR}/05-answer-1.json"
curl -sf -X POST "${BASE}/api/mvp1/sessions/${SESSION_ID}/answers" \
  -H 'content-type: application/json' \
  -b "$COOKIE_JAR" \
  -d "$(jq -n --arg a "$ANSWER" '{answer: $a}')" \
  -o "$STEP5"
STATUS1=$(jq -r '.attempt.analysis.status' "$STEP5")
COVERAGE1=$(jq -r '.attempt.analysis.coverage' "$STEP5")
echo "    -> status=${STATUS1}, coverage=${COVERAGE1}"

echo "==> 步骤6: 提交第二次回答（补充验证证据）"
ANSWER2='除了 D 状态和 iowait，还需要用 iostat 看 await 和 svctm，用 dmesg 排查磁盘错误，用 systemd-cgtop 看每个 unit 的资源占用。验证修复时应该重新跑原来的负载，观察指标是否恢复正常，并检查是否有新的副作用。'
STEP6="${OUT_DIR}/06-answer-2.json"
curl -sf -X POST "${BASE}/api/mvp1/sessions/${SESSION_ID}/answers" \
  -H 'content-type: application/json' \
  -b "$COOKIE_JAR" \
  -d "$(jq -n --arg a "$ANSWER2" '{answer: $a}')" \
  -o "$STEP6"
STATUS2=$(jq -r '.attempt.analysis.status' "$STEP6")
COVERAGE2=$(jq -r '.attempt.analysis.coverage' "$STEP6")
RECOMMEND=$(jq -r '.attempt.analysis.recommendation' "$STEP6")
echo "    -> status=${STATUS2}, coverage=${COVERAGE2}, recommendation=${RECOMMEND}"

echo "==> 步骤7: 结束会话，获取谨慎结论"
STEP7="${OUT_DIR}/07-session-end.json"
curl -sf -X POST "${BASE}/api/mvp1/sessions/${SESSION_ID}/end" \
  -H 'content-type: application/json' \
  -b "$COOKIE_JAR" \
  -d '{}' \
  -o "$STEP7"
FINAL_STATUS=$(jq -r '.result.status' "$STEP7")
SOURCE_REVIEW=$(jq -r '.result.sourceReviewRequired' "$STEP7")
NEXT_REC=$(jq -r '.result.nextRecommendation' "$STEP7")
echo "    -> finalStatus=${FINAL_STATUS}, sourceReviewRequired=${SOURCE_REVIEW}"
echo "    -> nextRecommendation: ${NEXT_REC}"

echo "==> 步骤8: 收集服务器日志"
cp "${OUT_DIR}/server.log" "${OUT_DIR}/08-server.log"

echo "==> 步骤9: 生成汇总证据"
jq -n \
  --arg capturedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg mode "SPIRAL_DISABLE_AI=1 + MVP1_DEMO_FALLBACK=1" \
  --argjson register "$(cat "$STEP1")" \
  --argjson timeline "$(cat "$STEP2")" \
  --argjson report "$(cat "$STEP3")" \
  --argjson sessionStart "$(cat "$STEP4")" \
  --argjson answer1 "$(cat "$STEP5")" \
  --argjson answer2 "$(cat "$STEP6")" \
  --argjson sessionEnd "$(cat "$STEP7")" \
  '{
    capturedAt: $capturedAt,
    demoMode: $mode,
    summary: {
      draftId: $timeline.draft.id,
      reportId: $report.report.id,
      cardId: $report.report.sections.feynmanCards[0].id,
      cardTarget: $report.report.sections.feynmanCards[0].target,
      gapCount: ($report.report.sections.dangerousGaps | length),
      sessionId: $sessionStart.session.id,
      researchMode: $sessionStart.session.researchMode,
      clearanceQuestion: $sessionStart.session.clearanceQuestion,
      attempt1Status: $answer1.attempt.analysis.status,
      attempt1Coverage: $answer1.attempt.analysis.coverage,
      attempt2Status: $answer2.attempt.analysis.status,
      attempt2Coverage: $answer2.attempt.analysis.coverage,
      attempt2Recommendation: $answer2.attempt.analysis.recommendation,
      finalStatus: $sessionEnd.result.status,
      sourceReviewRequired: $sessionEnd.result.sourceReviewRequired,
      nextRecommendation: $sessionEnd.result.nextRecommendation
    },
    steps: {
      register: $register,
      timeline: $timeline,
      report: $report,
      sessionStart: $sessionStart,
      answer1: $answer1,
      answer2: $answer2,
      sessionEnd: $sessionEnd
    }
  }' > "${OUT_DIR}/demo-evidence.json"

echo ""
echo "========================================"
echo "演示模式端到端清偿链路证据已捕获"
echo "========================================"
jq -c '.' "${OUT_DIR}/demo-evidence.json" | jq '.summary'
echo ""
echo "证据目录: ${OUT_DIR}/"
echo "汇总文件: ${OUT_DIR}/demo-evidence.json"
