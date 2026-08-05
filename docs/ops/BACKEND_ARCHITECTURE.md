# MindIOU 后端架构（2026-07-30 核验版）

本文基于 `refactor/backend-ops-boundaries` 分支代码核验编写。标记：已验证 / 推断 / 待确认。

## 1. 分层视图

```mermaid
flowchart TD
    subgraph Clients["客户端"]
        Browser["浏览器 SPA /mvp0 report /mvp1 /training"]
        Rokid["Rokid AIUI 眼镜"]
        G2["Even G2（Even Hub 插件）"]
        Mentra["MentraOS 眼镜（经 TPA）"]
    end

    subgraph Edge["边缘层（生产，已验证 deploy/）"]
        Nginx["Nginx 443 TLS（IP 短证书）<br/>/mindiou/ 静态 · /mindiou-api/ 反代<br/>限流 general 30r/m · ai 6r/m"]
        Tunnel["cloudflared Quick Tunnel（仅应急 fallback）"]
    end

    subgraph API["API 层：server.js（Node 原生 http，单文件 2372 行）"]
        Auth["认证：账户 Cookie（SQLite）/ 早期访问 HMAC Cookie / Bearer token / 设备 token"]
        Routes["路由：/api/auth/* /api/mvp0/* /api/mvp1/* /api/training/* /api/learn/* /api/spiral/* /api/rokid/* /api/g2/* /health*"]
        Infra["基础设施（本任务新增）：env 启动验证 · /healthz /readyz · request ID · 结构化请求日志 · 400/413 错误"]
    end

    subgraph Domain["领域层（本任务不改动）"]
        MVP0["mvp0-*：时间线 → 七段报告 → 费曼卡片"]
        MVP1["mvp1-*：清偿会话 · 检索 · 答案分析"]
        Training["training/mastery/review：欠条 · 掌握度 · 复训调度"]
        Spiral["spiral-store：事件采集 · 候选 · 复习"]
    end

    subgraph Providers["模型供应商（生产实际：文本 DeepSeek；RESEARCH/STT 未配置）"]
        Chat["{AI_BASE_URL}/chat/completions（30s 超时）"]
        Research["{RESEARCH_BASE_URL}/responses web_search（45s）"]
        STT["{STT_BASE_URL}/audio/transcriptions（本任务新增超时）"]
    end

    subgraph Data["数据存储（已验证）"]
        SQLite["auth-store.sqlite（WAL）：users/sessions/device_tokens"]
        JSONF["JSON 文件：spiral / mvp0 / mvp1 / training store（生产 /var/lib/mindiou/）"]
        Mem["进程内存：eventLog 200 条 · 吊销签名表（重启丢失）"]
    end

    subgraph Obs["日志与监控"]
        Journal["stdout/console → journald（SystemMaxUse=500M）"]
        GHA["GitHub Actions：nightly 质量门禁 · 每 6h 公网健康探测"]
    end

    Browser --> Nginx --> API
    Rokid --> Nginx
    G2 --> Nginx
    Mentra -.->|"TPA :7010（生产部署待确认）"| API
    Tunnel -.-> Nginx
    API --> Domain
    Domain --> Providers
    API --> Data
    API --> Journal
```

## 2. 各层职责

| 层 | 职责 | 明确不做 |
|---|---|---|
| 客户端 | 渲染、输入、设备交互约束 | 不持有密钥；不做评分 |
| Nginx | TLS 终止、静态服务、按路由反代、限流、请求体上限、公网屏蔽清单 | 不做业务鉴权（仅 3 个硬屏蔽路由） |
| server.js | 路由、认证授权、请求解析、调用领域逻辑、调用模型、持久化 | 不直接含领域算法（在独立模块） |
| 领域模块 | 报告生成、清偿会话、训练调度、卡片质量 | 不做 HTTP、不读环境变量（由 server.js 注入） |
| 模型供应商 | 文本生成 / 联网检索 / 语音转写 | 不做持久化 |
| 存储 | SQLite（认证）+ JSON 文件（业务）+ 内存（瞬态） | 无备份、无迁移工具（债务） |

## 3. 当前混乱点（核验事实，按严重度排序）

1. **API 层单文件巨石**：`server.js` 2372 行，路由、认证、模型客户端、fallback 逻辑、WAV 编码混在一起。可维护性差，但本次只做低风险整理，分阶段重构计划见 BACKEND_DEBT_BACKLOG。
2. **配置无启动验证**（本任务修复前）：密钥缺失/弱密钥只在请求时才暴露（如早期访问登录返回 503）。本任务新增 `env-validation.js` 启动校验。
3. **端口事实不明**：代码默认 8793，Nginx 反代 8794，依赖仓库外的 `/etc/mindiou.env` 桥接——新人无法在仓库内确定生产端口（已在文档标注推断）。
4. **死配置**：Nginx 反代 `/api/admin/*`，但 `admin-backend-patch.js` 未挂载（根目录与 web/ 各有一份重复补丁文件）。
5. **两套会话并存**：账户体系 `session` Cookie（SQLite）与早期访问 `mindiou_session` HMAC Cookie（内存吊销表）并行，`requireAuth` 做了兼容回退。属过渡态，已记录。
6. **健康检查单薄**：只有一个 `/health`，无 liveness/readiness 区分；`?live=1` 是唯一的依赖探活且会真实出站。本任务新增分层端点。
7. **可观察性缺失**（本任务修复前）：无 request ID、无结构化日志、无请求耗时；错误只有 `console.warn`；500 直接回显 `error.message`。本任务新增低风险基础设施。
8. **训练路由匿名可写**：`/api/training/*` 用 `getOptionalUser`，匿名请求落到 `demo-user` 命名空间（已验证为有意的演示设计，但公网上任何人可写 demo-user 数据）。记录为风险而非缺陷。
9. **JSON 文件存储**：四份业务数据为单文件 JSON，无锁、无备份、无原子写保证（`training-store` 等自实现 save）。演示规模可用，规模化是债务。
10. **模型调用无护栏**：无并发限制、无重试策略、无幂等键；重复 POST 报告生成会重复计费（Nginx ai 档 6r/m 是唯一防线）。STT 调用本任务修复前无超时。

## 4. 边界原则（本任务遵守）

- 客户端密钥为零：所有供应商密钥只在 server.js 进程内（`/etc/mindiou.env`），前端包不含任何密钥（`production-health.yml` 有 localhost 检查，无密钥检查——记入债务）。
- 旧 API 路径与字段不变；新增仅为可选字段与新路径（`/healthz`、`/readyz`）。
- 领域逻辑（mvp0/mvp1/training/mastery/review/spiral）不在本任务修改范围。
