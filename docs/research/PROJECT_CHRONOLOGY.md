# MindIOU 项目编年史（研究历程）

> 用途：开题/答辩的"研究过程记录"；证据文件均可在仓库或 codex_recovery 定位。
> 编制：2026-10-13 · 依据 TASK_SUMMARY ×14、对话存档 ×6、git log、研究文档。

## 概念期（2026-08-03 之前）

| 日期 | 事件 | 证据 |
|-----|------|------|
| ~2026-08-03 前 | 认知欠条（Cognitive Debt）概念在对话中成形：把"AI 代劳但用户未理解"记为可清算的账 | renzhi_0803/0805/0809.txt |
| 同期 | Even G2 眼镜端起点：设备能力摸底与第一版客户端方向 | even_g2_0625/0626.txt |

## 系统一期：清偿与档案（2026-08-03 ~ 08-06）

| 日期 | 事件 | 证据 |
|-----|------|------|
| 08-03 | 创始档案/Genesis 页 + SQLite WAL 持久化 | TASK_SUMMARY_08-03 ×2 |
| 08-04 | AI 协作评估 v1（六维画像前身）+ 移动端导航 | TASK_SUMMARY_08-04 ×3 |
| 08-05 | 项目记忆系统（pm_* 表族前身） | TASK_SUMMARY_08-05 |
| 08-06 | MBAI 统计（掌握度聚合口径） | TASK_SUMMARY_08-06 |

## 循环期：从评估到闭环（2026-08-08 ~ 08-13）

| 日期 | 事件 | 证据 |
|-----|------|------|
| 08-08 | 前端工作区重构 + 项目记忆主流程 | TASK_SUMMARY_08-08 ×2 |
| 08-12 | 认知循环 MVP：AI 活动导入→协作画像→AI 使用欠条→认知简报→行为实验闭环（PRD v0.1 §19.1） | TASK_SUMMARY_08-12 + cross_0812.txt |
| 08-12 | Fluency Loop 预告页（视频消化构想在 pitch 中首次出现）+ G2 英语闭环 | TASK_SUMMARY_08-12 ×2 |
| 08-13 | G2 英语闭环 0.9 → mastery 版（眼镜端清偿成型） | TASK_SUMMARY_08-13 ×2 |
| 08-13 | 前沿研究 66KB（同类产品扫描 + 学习科学文献按主题整理） | AI_LEARNING_LOOP_FRONTIER_RESEARCH_2026-08-13.md |

## 静默期与眼镜生产化（2026-08 中 ~ 10 初）

| 日期 | 事件 | 证据 |
|-----|------|------|
| 09-10 月 | G2 客户端持续迭代（发布包 113KB）、MCP 远程接入三源 AI 工具、训练引擎 E0-E5 阶梯、评估降级声明（rule_fallback/missing_evidence） | git log、release/*.ehpk、server.js |
| 10-12 | 跨机进度采集 + 眼镜端项目进度查看 | session_f4fcf51e（pm_agent_sessions） |

## 科研化期（2026-10-13，本日志所在）

| 轮 | 事件 | 证据 |
|---|------|------|
| R1 | 文献库 31 条（三层全部核实）+ 研究纲领（RQ1-4/E0-E5 操作化）+ 资料索引 + EXP-1 底稿导出 | REFERENCES.bib、RESEARCH_PROGRAM.md、INDEX.md |
| R2 | EXP-2 预注册 v1.0（先于采集）；误判"208 条重复=去重 bug"（后被 R4 证伪） | EXP-2-PREREG.md |
| R3 | EXP-2 装置全链落地并演练（assign/debts/read-log/盲测/channel 过滤，演练数据清除） | server.js exp2 路由、web/src/exp2.ts |
| R4 | 实测证伪 R2 假设（183=69 用户跨用户语料，单用户零重复）；发现 legacy 候选 15/22 模板化 → RQ2 分层协议 | EXP1 底稿 correction 字段 |
| R5 | 开题报告材料包（八节 + 24 引用完整性验证 + 3 docx） | PROPOSAL_DRAFT.md |
| R6 | EXP-1 首批初标（30 gap）+ 科研驱动修复 B 站导入幂等 | EXP1-annotation-round1.md |
| R7 | EXP-1 复核台上线（web /exp1，A/B 分层渲染） | web/src/exp1.ts |
| R8 | 模板 gap 材料审计：仅 4/15 有原始材料锚（27% 有效率）+ 欠条池监控（2/40） | scripts/exp1-template-audit.js |
| R9 | EXP-1 分析管道（五层分组就绪）+ 本编年史 | scripts/exp1-analyze.js |

## 方法论特征（编年史视角的总结）

1. **假设-证伪循环**：R2 的错误结论被 R4 实测推翻并留痕（DECISIONS.md 更正条目）——
   研究过程本身可审计。
2. **科研驱动工程**：EXP-1 标注直接暴露并修复了导入幂等缺陷；审计工具的三次粒度
   修正（整串→分层→术语锚）都是数据驱动。
3. **预注册纪律**：EXP-2 规则先于数据采集封存，装置演练数据主动清除。
