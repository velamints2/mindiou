# MindIOU 科研资料索引

> 科研申报/开题/写论文时从这里出发。每条注明"是什么 + 什么场景用"。
> 更新：2026-10-13

## 1. 研究文档（docs/research/）

| [RESEARCH-PORTFOLIO-SUMMARY.md](RESEARCH-PORTFOLIO-SUMMARY.md) | **答辩一页纸总览**：RQ→装置→治理→文档地图→阻塞声明 |

| 文件 | 内容 | 用途 |
|-----|------|-----|
| RESEARCH_PROGRAM.md | 研究纲领：RQ1-4、认知债务构念操作化（E0-E5）、实验设计 EXP-1/2/3 | 开题/申报主文档 |
| REFERENCES.bib | 31 条参考文献（A 产业政策 19 / B AI 协作证据 5 / C 学习科学经典 8），全部核实 | 论文/开题引用 |
| PROPOSAL_DRAFT.md | 开题报告八节版（背景/综述/RQ/方法/创新/可行性/进度/引用）+ 同名 docx | 直接提交学校 |
| PROJECT_CHRONOLOGY.md | 项目编年史：概念期→系统期→循环期→科研化期 R1-R9，每条带证据文件 | 答辩"研究过程"页 |
| EXP-2-PREREG.md | 眼镜清偿 A/B 预注册 v1.0（先于采集封存） | 因果实验治理 |
| EXP1-annotation-round1.md | 首批初标稿（30 gap + 方法学修正 + 已知答案对照组） | EXP-1 标注记录 |
| EXP1-template-audit.json | 模板 gap 材料审计结果（4/15 有锚） | RQ2 生成器质量证据 |
| EXP1-analysis-latest.json | 分析管道最新输出（五层分组） | EXP-1 结果快照 |
| AI_LEARNING_LOOP_FRONTIER_RESEARCH_2026-08-13.md | 66KB 前沿实践研究：同类产品扫描、学习科学论文按主题组织、G2 Loop 事实审计、提示词模板 | 相关工作章节 + 产品迭代依据 |
| AI_COLLABORATION_EVALUATION_EVIDENCE.md | AI 协作能力评估的外部研究依据（NBER/CHI/METR，每条带证据边界声明） | 评估设计的文献辩护 |

| [RQ1-VALIDITY-PLAN.md](RQ1-VALIDITY-PLAN.md) | RQ1 构念效度量化方案：三维度八指标+判定标准（v0.1） |
| [RQ1-structure-latest.json](RQ1-structure-latest.json) | S1/S2 结构效度实测快照（n=9 描述性基线，零方差待积累） |
| [RQ4-DIGEST-QUALITY.md](RQ4-DIGEST-QUALITY.md) | RQ4 视频消化通道质量中期报告（管道实测+四指标框架） |

## 2. 策划与产品文档

| 材料 | 位置 | 用途 |
|-----|------|-----|
| 白皮书（调研增强版，19 章含参考文献） | ~/Desktop/codex_recovery/MindIOU_认知欠条_完整版白皮书_调研增强版.docx | 背景与动机章节底稿 |
| 策划案 ×2（完全版 + 早期版） | 同目录 *.docx | 概念演化证据 |
| PRD《认知循环与AI协作能力》v0.1 | cross_0812.txt 内引用 + TASK_SUMMARY_2026-08-12_COGNITIVE_LOOP_MVP.md | 需求-实现对照 |
| TASK_SUMMARY_*.md ×14 | 项目根目录 | 开发过程证据链（每份=一次功能切片的完整记录） |
| docs/competition/ | mcp-judge-guide / technical-documentation / user-guide | 竞赛材料（可改写为科研系统说明） |

## 3. 系统与数据（论文的"实验装置"）

| 组件 | 位置 | 科研角色 |
|-----|------|---------|
| 欠条存储 | tmp/mindiou.sqlite（training 状态，208 条历史欠条） | EXP-1 标注底稿 |
| 会话捕获 | pm_agent_sessions + MCP 8795（dsh/claude/codex 三源） | RQ2 数据源 |
| 证据等级引擎 | training-store.js（E0-E5 阶梯 + 六维 mastery） | 构念操作化实现 |
| 眼镜端清偿 | platforms/mentra（quiz/语音/手势）+ release/*.ehpk | EXP-2 实验干预 |
| 视频消化 | bilibili-digest.js + web /digest 页（2026-10-13） | RQ4 实验装置 |
| 评估降级声明 | server 内 rule_fallback / missing_evidence 标记 | 效度威胁 1 的缓解证据 |

## 4. 原始对话存档（概念演化史）

~/Desktop/codex_recovery/：renzhi_0803/0805/0809（认知欠条概念期）、
cross_0812（Loop/视频消化/三 Loop 架构提出）、even_g2_0625/0626（眼镜端起点）。
科研用途：设计决策的溯源材料（什么问题逼出了什么设计）。

## 5. 操作指南
| [QUICKSTART-SUBJECT.md](QUICKSTART-SUBJECT.md) | 被试六项动作逐步点击路径（复核/accept/SESSDATA/推池/眼镜/VPS） |

## 6. 操作复盘
| [OPS-REVIEW-R11-24.md](OPS-REVIEW-R11-24.md) | Round 11-24 研究操作复盘：交付清单+数据事实修正 5 条+状态快照 |

## 7. 待补

- [ ] EXP-2-PREREG.md（眼镜清偿 A/B 的预注册）
- [ ] 开题/申报合成材料包
- [ ] SESSDATA 解锁后的字幕模式数据（EXP-3 前置）
