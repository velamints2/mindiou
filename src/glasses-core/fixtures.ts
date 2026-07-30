/**
 * 演示数据，非真实用户数据。
 * Demo fixtures for the glasses core: one debt, one root gap, three Feynman
 * cards with all four layers, one source, and a simulated network error.
 */
import { createInitialState } from "./store";
import type { DebtCard, QueueState } from "./types";

export const DEMO_FIXTURE_MARKER = "DEMO_FIXTURE";

export const DEMO_REPORT_ID = "demo-report-001";

export interface DemoGap {
  id: string;
  title: string;
  masteryCriteria: string;
  demoSource: typeof DEMO_FIXTURE_MARKER;
}

export interface DemoDebt {
  id: string;
  reportId: string;
  gapId: string;
  title: string;
  demoSource: typeof DEMO_FIXTURE_MARKER;
}

export interface DemoSource {
  id: string;
  title: string;
  demoSource: typeof DEMO_FIXTURE_MARKER;
}

export const DEMO_GAP: DemoGap = {
  id: "demo-gap-001",
  title: "把猜测当验证：缺少结构化的事故排查路径",
  masteryCriteria: "能按“观察指标 → 提出假设 → 单变量验证 → 得出结论”的顺序，口述复现一次完整排查过程",
  demoSource: DEMO_FIXTURE_MARKER
};

export const DEMO_DEBT: DemoDebt = {
  id: "demo-debt-001",
  reportId: DEMO_REPORT_ID,
  gapId: DEMO_GAP.id,
  title: "AI 代劳了事故定位过程，用户跳过了假设验证训练",
  demoSource: DEMO_FIXTURE_MARKER
};

export const DEMO_SOURCE: DemoSource = {
  id: "demo-source-001",
  title: "《Demo 事故复盘：API 延迟告警 22 分钟后复发始末》",
  demoSource: DEMO_FIXTURE_MARKER
};

export const DEMO_CARDS: DebtCard[] = [
  {
    id: "demo-card-001",
    reportId: DEMO_REPORT_ID,
    gapId: DEMO_GAP.id,
    title: "凌晨告警：API P99 延迟从 80ms 涨到 2.4s。在动手改任何东西之前，第一步应该做什么？",
    whyItMatters:
      "AI 在对话里直接给出了“重启 + 加索引”的方案，你跳过了定位环节。下次没有 AI 在场时，第一时间的观察动作决定了排查效率。",
    evidence:
      "来源证据：事故复盘中，值班同学直接重启服务，指标暂时回落，22 分钟后告警复发——慢查询仍在堆积，症状被掩盖而非解决。（DEMO_FIXTURE）",
    referenceAnswer:
      "先观察再动手：打开监控看是哪个接口、哪段依赖（应用 / 数据库 / 网络）从哪个时间点开始变慢，形成一个可检验的假设（例如“某条慢查询在 02:10 后出现”），再决定验证手段。重启只能掩盖症状。",
    sourceRef: DEMO_SOURCE.id
  },
  {
    id: "demo-card-002",
    reportId: DEMO_REPORT_ID,
    gapId: DEMO_GAP.id,
    title: "为什么事故排查时要“一次只改一个变量”？",
    whyItMatters:
      "AI 一次性给了三条修改建议并同时生效，你无法知道是哪一条起了作用。这破坏了验证逻辑，也让回滚变得困难。",
    evidence:
      "来源证据：同事同时上线了“加索引”和“调大连接池”两个变更，延迟下降了，但三天后写入出现新问题，无法归因到具体哪一项变更。（DEMO_FIXTURE）",
    referenceAnswer:
      "一次只改一个变量，改动前后对比同一指标。这样每个变化都能建立“动作 → 结果”的因果关系；出问题时也能精确回滚。多个变量同时变，等于放弃了验证。",
    sourceRef: DEMO_SOURCE.id
  },
  {
    id: "demo-card-003",
    reportId: DEMO_REPORT_ID,
    gapId: DEMO_GAP.id,
    title: "如何用一句话向新人解释：为什么“告警和部署同时发生”不等于“部署导致告警”？",
    whyItMatters:
      "把相关当因果是认知外包的重灾区：AI 给出时间相关性后你直接接受了结论。能讲清这个区别，才说明真正内化了验证思维。",
    evidence:
      "来源证据：复盘中曾把一次告警归罪于当晚部署，事后发现是运营商网络抖动——两件事只是时间相邻，回滚部署毫无效果。（DEMO_FIXTURE）",
    referenceAnswer:
      "相关不等于因果：时间相邻只提供一个假设，还需要机制解释（部署改动了哪条链路）和排除性验证（回滚后指标是否恢复、未部署地区是否也告警）。讲解时可以用“公鸡打鸣与太阳升起”作类比。",
    sourceRef: DEMO_SOURCE.id
  }
];

/** Simulated network failure for demos and tests; never a real network call. */
export function makeDemoError(): Error {
  const error = new Error("DEMO 模拟网络错误：同步请求超时（非真实网络行为）");
  error.name = "DemoNetworkError";
  return error;
}

/** Build a fresh queue from the demo cards. */
export function createDemoQueue(): QueueState {
  return createInitialState(DEMO_CARDS);
}
