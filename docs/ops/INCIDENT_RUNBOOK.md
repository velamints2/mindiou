# MindIOU 故障排查 Runbook

原则：先看 requestId，再按层定位（Nginx → Node → 模型供应商 → 存储）。
所有 API 错误响应带 `requestId`（响应头 `x-request-id` 与 JSON 体同值），
服务端日志 `journalctl -u mindiou` 为单行 JSON，可按 requestId grep。

## 1. API 5xx

```bash
journalctl -u mindiou --since "-30m" | grep '"level":"error"'
journalctl -u mindiou | grep <requestId>
```

- `unhandled_request_error`：未捕获异常，日志含截断的错误消息（≤300 字符）；客户端只见 `Internal server error`。
- 大量 5xx 且伴 `http_request` status=502/504：模型供应商超时/不可达，转第 3 节。
- 进程反复重启：`journalctl -u mindiou -n 100` 找启动期 `[env] 错误`（env-validation 拒绝启动，会指明变量）。

## 2. API 4xx 语义

| 状态 | 含义 | 处理 |
| --- | --- | --- |
| 400 | 请求体非合法 JSON / 参数校验失败 | 客户端问题；消息已脱敏可直接展示 |
| 401 | 未登录或 Bearer 无效 | 引导重新登录；设备侧检查 token |
| 403 | 已登录但非资源属主 | 检查账号/草稿归属 |
| 404 | 资源不存在（含 requestId） | 检查 ID 来源；警惕枚举扫描（配合 Nginx 限流日志） |
| 405 | 路径存在但方法不允许（或 GET 落到非 GET 路由段） | 检查客户端方法 |
| 413 | 请求体 >8MB | 引导压缩/分段；音频控制在约 3 分钟内 |
| 429 | Nginx 限流（general 30r/m，AI 6r/m/IP） | 客户端退避；确认是否遭遇滥用 |

## 3. 模型连接问题

症状：报告生成返回 fallback / `curated_demo_fallback`；转写返回超时错误。

```bash
# 1. 确认配置（不打印值，只看是否设置与 URL）
sudo systemctl cat mindiou | grep EnvironmentFile
sudo grep -c 'AI_API_KEY=.' /etc/mindiou.env   # 输出 1 即已设置（不看值）
# 2. readiness 看依赖自检
curl -s http://127.0.0.1:8794/readyz | jq .checks.config
# 3. 从服务器直连供应商（耗时与可达性）
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' https://api.deepseek.com  # 按实际 AI_BASE_URL
```

判定：
- 直连供应商失败 → 网络/供应商故障；演示可临时 `MVP1_DEMO_FALLBACK=1`（需重启，且响应会明确标注降级）；
- 直连成功但应用超时 → 检查 `OPENAI_CHAT_TIMEOUT_MS`（默认 30s）是否过短，或供应商变慢；
- STT 报 `timed out after ...` → `STT_TIMEOUT_MS`（默认 30s）生效的表现，查 STT 供应商。

## 4. 存储问题

- `readyz` 返回 503 且 `checks.authStore.ok=false`：SQLite 不可读。检查 `/var/lib/mindiou` 权限（mindiou:mindiou）与磁盘（`df -h`）。
- JSON 存储写入失败：systemd `ProtectSystem=strict` 仅放行 `ReadWritePaths=/var/lib/mindiou`；若 `*_STORE_PATH` 指到别处会 EROFS/EPERM，改回 `/var/lib/mindiou/` 下。
- 磁盘满：journald 上限已由 `journald-mindiou-limits.conf` 约束（500M/14 天）；其余按 `du -sh /var/lib/mindiou /var/www/mindiou` 排查。

## 5. 证书与公网入口

- 证书失效（IP 证书仅约 6 天有效期，续期 timer 每日两检）：
  ```bash
  systemctl status mindiou-ip-cert-renew.timer
  sudo /opt/certbot-ip-venv/bin/certbot renew --cert-name <server-ip> --force-renewal
  sudo nginx -t && sudo systemctl reload nginx
  ```
- 短期无法续期：启用 quick tunnel 应急（见 DEPLOYMENT_RUNBOOK 第 8 节），恢复后停用。

## 6. 疑似滥用/攻击

- Nginx access log 按 IP 统计 429 频次；AI 端点 6r/m 是成本保险丝。
- 发现枚举报告 ID 行为：ID 为 randomUUID，风险低；仍可在 Nginx 加 deny。
- 怀疑密钥泄露：立即轮换 `/etc/mindiou.env` 中对应值并重启；审计 `git log -p` 与日志确认未外泄（本仓库历史扫描零命中，见 SECURITY_REVIEW）。

## 7. 上报模板

报障时提供：`x-request-id`、时间窗、端点、状态码、`readyz` 输出、相关 `journalctl` 摘录（**先脱敏：删除任何密钥/Cookie/Authorization/对话原文**）。
