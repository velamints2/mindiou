/**
 * 用真实协作材料走一遍 MVP-0 报告生成管线（时间线 → 标注困惑 → 七段报告）。
 * 目的：为演示账号生成真实报告（非策展文案），验证报告管线输出质量。
 *
 * 用法:
 *   node scripts/generate-demo-reports.mjs
 *   DEMO_API_BASE=http://127.0.0.1:8794 node scripts/generate-demo-reports.mjs
 *
 * 环境变量:
 *   DEMO_API_BASE   API 根地址（默认 https://demo.mindiou.top/mindiou-api）
 *   DEMO_USERNAME   演示账号邮箱（默认 demo@mindiou.app）
 *   DEMO_PASSWORD   演示账号密码（必填）
 *
 * 幂等说明: 每次运行都会生成新的 draft 与 report，不覆盖已有报告。
 * 如需重新生成，请先在数据库中删除旧报告。
 */

const BASE = (process.env.DEMO_API_BASE || "https://demo.mindiou.top/mindiou-api").replace(/\/$/, "");
const EMAIL = process.env.DEMO_USERNAME || "demo@mindiou.app";
const PASSWORD = process.env.DEMO_PASSWORD || "";

if (!PASSWORD) {
  console.error("错误: DEMO_PASSWORD 环境变量未设置");
  process.exit(1);
}

// ── 材料 1：真实工作记录 —— MindIOU 演示环境部署排障（本项目 2026-08-07 实际工作）──
const MATERIAL_NGINX = `【背景】我负责把 MindIOU 演示环境部署到云服务器（Ubuntu 22.04，1C2G），让评委能通过 https://demo.mindiou.top 访问。以下是我和 AI 编程助手这一下午的完整协作记录。

【我】：服务器上 Node 服务已经跑在 127.0.0.1:8794，现在需要配 Nginx 反向代理，要求 /mindiou/ 走静态文件、/mindiou-api/ 走 Node 接口。帮我写配置。

【AI】：给出完整 Nginx server 块：listen 443 ssl，/mindiou/ alias 到 /var/www/mindiou/ 并 try_files 回退 index.html；/mindiou-api/ proxy_pass 到 http://127.0.0.1:8794/，带 proxy_set_header Host/X-Forwarded-For/X-Real-IP，client_max_body_size 2m。还顺手写了 certbot 申请证书的命令。

【我】：配置了，但访问 /mindiou-api/health 一直 502。怎么回事？

【AI】：502 一般是上游不可达。排查步骤：1) ss -tlnp 确认 8794 在监听；2) curl http://127.0.0.1:8794/health 本机直连；3) 看 nginx error.log。结果是我 proxy_pass 写成了 http://127.0.0.1:8794（少了尾斜杠），导致 /mindiou-api/health 被代理成 /mindiou-api/health 而不是 /health，后端 404 被我看成了 502。AI 解释了 proxy_pass 带不带 URI 的替换规则：proxy_pass 后有 URI（哪怕只是 /）时，匹配 location 的部分会被替换；没有 URI 时原始路径原样转发。

【我】：懂了……大概。改了之后健康检查通了。但登录接口报 400，说 Cookie 有问题。

【AI】：因为站点是 https 但后端发的会话 Cookie 没带 Secure 标记会有警告，另外 SameSite 和 Domain 也要考虑。它直接在 server.js 里加了 MINDIOU_COOKIE_SECURE=1 环境变量判断，生产环境给 Set-Cookie 加 Secure; HttpOnly; SameSite=Lax。

【我】：好，测试通过。另外帮我写个 systemd unit，要求开机自启、崩了自动重启。

【AI】：写了 mindiou.service：Type=simple，User=mindiou，EnvironmentFile=/etc/mindiou.env，Restart=always，RestartSec=5，还加了一堆安全加固：NoNewPrivileges、PrivateTmp、ProtectSystem=strict、ReadWritePaths=/var/lib/mindiou、MemoryMax=512M。

【我】：这个 ProtectSystem=strict 是什么意思？为什么数据目录还要单独 ReadWritePaths？

【AI】：ProtectSystem=strict 把整个文件系统挂成只读，/var/lib/mindiou 通过 ReadWritePaths 单独放开写权限，SQLite 数据库才能写。这是最小权限原则。

【我】：行。systemctl enable --now 之后服务起来了。最后帮我把部署脚本化，下次一键部署前端。

【AI】：写了 deploy-web.sh：本地构建两套前端 → tar 打包 → scp 上传 → 服务器端备份旧目录（带时间戳）→ 清空 → 解压恢复 → chown → curl 验证 8 个 URL 的 HTTP 状态码，最后打印回滚命令。

【我】：测试一遍，全部 OK。今天收工。

（复盘时我才意识到：proxy_pass 的 URI 替换规则我其实没真正搞懂，是照着改的；ProtectSystem=strict 和 ReadWritePaths 的组合也只是大概明白；Cookie 的 SameSite=Lax 和 Secure 具体防什么攻击我说不上来；systemd 的 MemoryMax 超了会发生什么我也没验证过。当时都急着让服务跑起来。）`;

// ── 材料 2：真实工作记录 —— 间隔重复复训调度器实现（本项目训练系统实际工作）──
const MATERIAL_TRAINING = `【背景】MindIOU 的认知清偿模块需要一个"今日复训"功能：按遗忘曲线把到期的认知欠条推给用户重新作答。这是我和 AI 助手实现这个调度器的协作记录。

【我】：现在清偿完的欠条就躺在数据库里没人管了。我要一个艾宾浩斯遗忘曲线的复训调度：清偿后按 1 天、3 天、7 天、15 天、30 天的间隔提醒复习，每次复训答对就晋级到下一个间隔，答错就退回最短的间隔。数据存在 SQLite（better-sqlite3，WAL 模式）。

【AI】：设计了 mastery_profiles 表：cognitive_debt_id 主键，current_stage（initial_compensation / delayed_recall / misconception_check / scenario_transfer / error_detection / real_work_validation 六个阶段），overall_mastery 0-100 分，attempt_count，next_review_at。调度逻辑：答对时 stage 前进一档，next_review_at = now + 阶段对应间隔；答错时 stage 退回 delayed_recall，间隔重置为 1 天。给了完整建表 SQL 和 scheduleNextReview 函数。

【我】：六个阶段和五个间隔是怎么对应的？1/3/7/15/30 天分别落在哪个阶段？

【AI】：initial_compensation 是清偿当场，不入调度；delayed_recall 对 1 天，misconception_check 对 3 天，scenario_transfer 对 7 天，error_detection 对 15 天，real_work_validation 对 30 天。全部通过就是 stable_mastery。

【我】：好。那"今日复训"接口怎么查？

【AI】：SELECT * FROM mastery_profiles WHERE next_review_at <= now ORDER BY next_review_at ASC，再 join 认知欠条表拿出欠条原文。还考虑了用户时区，用 ISO 字符串比较。

【我】：时区怎么处理？

【AI】：统一存 UTC ISO8601 字符串，比较也用 UTC，前端展示时再转本地时区。这样字符串比较就是时间比较。

【我】：行，直接按这个实现。写完了吗？

【AI】：实现完成，还写了单元测试：答对晋级、答错降级、到期查询、跨时区边界（review 时间恰好等于 now 的边界值）。测试全过。

【我】：等等，如果一个用户攒了 50 条到期欠条，一次全推给他会不会太多了？

【AI】：加个每日上限，默认 20 条，按 next_review_at 最旧的优先，剩下的标成"已顺延"明天再推。顺手把上限做成了环境变量 DAILY_REVIEW_LIMIT。

【我】：可以。上线吧。

（现在回想，有几个地方我其实是糊的：艾宾浩斯曲线的 1/3/7/15/30 天间隔到底适不适合"程序知识"这种需要理解的东西，我没有质疑过；答错直接退回 1 天这个惩罚是不是太重，我也没有依据；UTC 字符串比较在存进去的数据格式不一致时（有的带毫秒有的不带）会不会出问题，我没验证；DAILY_REVIEW_LIMIT 顺延逻辑和 next_review_at 的相互作用——顺延会不会反而让欠条永远排不上——我也没想明白就过了。）`;

async function api(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(300_000)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
}

function pickConfusions(steps, confusions) {
  // 把人工困惑挂到时间线步骤上：优先选 AI 主导步骤
  const aiSteps = steps.filter(s => (s.actor || s.owner || "").toString().toLowerCase() !== "user");
  const pool = aiSteps.length ? aiSteps : steps;
  return confusions.map((text, i) => ({
    stepId: pool[Math.min(i, pool.length - 1)].id,
    text
  }));
}

async function runOne(name, artifactText, confusionTexts, cookie) {
  console.log(`\n=== [${name}] 1/3 生成协作时间线（真实模型调用）…`);
  const t0 = Date.now();
  const tl = await api("/api/mvp0/timelines", {
    method: "POST",
    body: { artifactText, locale: "zh-CN" },
    cookie
  });
  console.log(`    status=${tl.status} 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s fallback=${tl.json.fallback}`);
  if (!tl.json.ok) throw new Error(`timeline 失败: ${JSON.stringify(tl.json).slice(0, 300)}`);
  const draft = tl.json.draft;
  const steps = draft.timeline.steps;
  console.log(`    draft=${draft.id} steps=${steps.length}`);

  console.log(`=== [${name}] 2/3 标注 ${confusionTexts.length} 条困惑…`);
  const confusions = pickConfusions(steps, confusionTexts);
  const patch = await api(`/api/mvp0/drafts/${encodeURIComponent(draft.id)}`, {
    method: "PATCH", body: { confusions }, cookie
  });
  if (!patch.json.ok) throw new Error(`confusions 失败: ${JSON.stringify(patch.json).slice(0, 300)}`);

  console.log(`=== [${name}] 3/3 生成七段报告（模型 + 有界检索，耗时较长）…`);
  const t1 = Date.now();
  const rep = await api("/api/mvp0/report", {
    method: "POST", body: { draftId: draft.id }, cookie
  });
  console.log(`    status=${rep.status} 耗时=${((Date.now() - t1) / 1000).toFixed(1)}s`);
  if (!rep.json.ok) throw new Error(`report 失败: ${JSON.stringify(rep.json).slice(0, 500)}`);
  const report = rep.json.report || rep.json;
  const s = report.sections || {};
  console.log(`    report=${report.id}`);
  console.log(`    aiCompleted=${s.aiCompleted?.length} userContributed=${s.userContributed?.length} outsourced=${s.cognitiveProcessesOutsourced?.length}`);
  console.log(`    gaps=${s.dangerousGaps?.length} cards=${s.feynmanCards?.length}`);
  console.log(`    facts=${s.cognitiveStructure?.facts?.length} hypotheses=${s.cognitiveStructure?.hypotheses?.length} questions=${s.cognitiveStructure?.questions?.length} decisions=${s.cognitiveStructure?.decisions?.length} tradeoffs=${s.cognitiveStructure?.tradeoffs?.length}`);
  return report;
}

// 1. 登录
const login = await api("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
if (!login.json.ok) throw new Error(`登录失败: ${JSON.stringify(login.json)}`);
const cookie = (login.setCookie || "").split(";")[0];
console.log(`登录成功: ${login.json.user?.email}`);

// 2. 两份真实材料走完整管线（ONLY=1|2 可只跑其中一份，用于限量重试）
const ONLY = process.env.ONLY || "";
let r1 = null;
let r2 = null;
if (ONLY !== "2") {
  r1 = await runOne("Nginx 部署排障", MATERIAL_NGINX, [
    "proxy_pass 结尾斜杠的路径替换规则我当时没搞懂，是照着改的",
    "ProtectSystem=strict 下为什么还要 ReadWritePaths 我只是大概明白"
  ], cookie);
}
if (ONLY !== "1") {
  r2 = await runOne("复训调度器", MATERIAL_TRAINING, [
    "艾宾浩斯 1/3/7/15 天间隔适不适合程序知识，我没有质疑过",
    "顺延逻辑和 next_review_at 相互作用会不会让欠条永远排不上，我没验证"
  ], cookie);
}

console.log("\n========================================");
console.log("完成。报告 ID:");
if (r1) console.log(`  1. ${r1.id}`);
if (r2) console.log(`  2. ${r2.id}`);
