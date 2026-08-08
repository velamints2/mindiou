function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function ensureLearnerFacingLanguage(result, input) {
  if (input?.locale === "en") return result;
  const answer = clean(input?.answer);
  const learnerFacing = clean(`${result?.feedback || ""} ${result?.teaching || ""} ${result?.nextQuestion || ""}`);
  const learnerUsedChinese = /[\u3400-\u9fff]/.test(answer);
  const responseUsedChinese = /[\u3400-\u9fff]/.test(learnerFacing);
  if (!learnerUsedChinese || responseUsedChinese) return result;

  const status = clean(result?.status);
  const feedback = status === "provisionally_cleared"
    ? "你已经说明了主要验证链，但还需要用重复负载确认结果。"
    : status === "needs_verification"
      ? "回答覆盖了关键证据，仍需核对来源并用真实负载验证。"
      : "你已经提出了一部分判断，还需要补充基线、反证和复现结果。";
  return {
    ...result,
    feedback,
    teaching: "完整验收应对比修复前后指标，复现原始负载，并检查问题是否再次出现。",
    nextQuestion: "哪一项反证会说明这次修复仍不完整？"
  };
}

export function createDemoResearchFallback(request, error) {
  const topic = clean(request?.targetDebt || request?.originalQuestion);
  // 也检查原始材料内容，因为 fallback 报告的卡片 target 可能过于泛化
  const evidence = request?.practiceEvidence || {};
  const evidenceText = [
    ...(evidence.aiCompleted || []),
    ...(evidence.userContributed || []),
    ...(evidence.facts || []),
    ...(evidence.decisions || []),
    ...(evidence.tradeoffs || [])
  ].map(item => typeof item === "string" ? item : (item?.item || item?.gap || "")).join(" ");
  const searchText = `${topic} ${evidenceText}`;
  const serverIncident = /i\/o wait|d-state|nginx|systemd|服务器|负载|磁盘/i.test(searchText);
  const pageCache = /page cache|页缓存/i.test(searchText);
  const verification = /验证|验收|工具链|完整性/i.test(searchText);
  const rootCause = /根因|症状|缓解|restart|重启/i.test(searchText);

  // 仅当主题与服务器诊断演示样本强相关时才使用特定 fallback。
  // "验证"/"根因"等词在非服务器主题中也会出现（如"我没验证"），
  // 不能单独触发特定 fallback，必须叠加服务器上下文。
  if (!serverIncident && !pageCache) {
    return createGenericDemoFallback(request, error);
  }

  const commonSources = [
    {
      id: "source-kernel-proc",
      url: "https://docs.kernel.org/filesystems/proc.html",
      title: "Linux kernel documentation: the /proc filesystem",
      claim: "The kernel exposes process state, memory, and system activity through /proc for diagnosis and verification."
    },
    {
      id: "source-kernel-psi",
      url: "https://docs.kernel.org/accounting/psi.html",
      title: "Linux kernel documentation: PSI",
      claim: "Pressure Stall Information quantifies time lost to CPU, memory, and I/O resource contention."
    },
    {
      id: "source-systemd-resource",
      url: "https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html",
      title: "systemd.resource-control",
      claim: "systemd units can be inspected and constrained through cgroup-backed resource controls."
    }
  ];

  if (pageCache) {
    return {
      researchMode: "curated_demo_fallback",
      rewrittenQuestion: "Page cache 为什么会让 used 很高，却不一定代表内存泄漏？",
      summary: "Curated Linux memory scaffold for the public demo report; it is not live web research.",
      sources: commonSources,
      scaffold: [
        {
          id: "point-cache-role",
          point: "Linux uses otherwise idle memory as page cache to reduce storage reads, and can reclaim that cache when applications need memory.",
          whyItMatters: "High used memory is not sufficient evidence of a leak.",
          sourceIds: ["source-kernel-proc"]
        },
        {
          id: "point-available",
          point: "Available memory, reclaimability, swap activity, and memory pressure are more useful than the used number alone.",
          whyItMatters: "A diagnosis should distinguish useful cache from unreclaimable growth.",
          sourceIds: ["source-kernel-proc", "source-kernel-psi"]
        },
        {
          id: "point-verify-memory",
          point: "Verify a suspected leak by observing process RSS, cgroup memory, reclaim behavior, swap, and pressure across repeated workloads.",
          whyItMatters: "A time series and repeatable workload can falsify a leak hypothesis.",
          sourceIds: ["source-kernel-proc", "source-kernel-psi", "source-systemd-resource"]
        }
      ]
    };
  }

  if (verification) {
    return {
      researchMode: "curated_demo_fallback",
      rewrittenQuestion: "AI 修复服务器后，哪些证据能证明问题真的解决？",
      summary: "Curated verification scaffold for the public demo report; it is not live web research.",
      sources: commonSources,
      scaffold: [
        {
          id: "point-baseline",
          point: "Define the original failure signal and capture a before-change baseline before judging a repair.",
          whyItMatters: "A successful command or restart does not prove the user-visible failure disappeared.",
          sourceIds: ["source-kernel-proc", "source-kernel-psi"]
        },
        {
          id: "point-cross-layer",
          point: "Check service status, process state, logs, resource pressure, I/O latency, and the user request path together.",
          whyItMatters: "Cross-layer evidence prevents one healthy metric from hiding another failing dependency.",
          sourceIds: ["source-kernel-proc", "source-kernel-psi", "source-systemd-resource"]
        },
        {
          id: "point-repeat",
          point: "Repeat the triggering workload and observe the system long enough to test recurrence and side effects.",
          whyItMatters: "A repair is more credible when the original failure cannot be reproduced under comparable load.",
          sourceIds: ["source-kernel-psi", "source-systemd-resource"]
        }
      ]
    };
  }

  if (rootCause) {
    return {
      researchMode: "curated_demo_fallback",
      rewrittenQuestion: "如何区分症状暂时缓解和真正的根因修复？",
      summary: "Curated root-cause verification scaffold for the public demo report; it is not live web research.",
      sources: commonSources,
      scaffold: [
        {
          id: "point-symptom",
          point: "A restart can clear queues, reset connections, or replace a blocked process without removing the condition that caused the failure.",
          whyItMatters: "Temporary recovery is evidence of symptom relief, not a complete causal explanation.",
          sourceIds: ["source-kernel-proc", "source-systemd-resource"]
        },
        {
          id: "point-causal-change",
          point: "A root-cause repair changes the failing dependency or condition and predicts which metrics and logs should improve.",
          whyItMatters: "The prediction makes the repair falsifiable rather than narrative-only.",
          sourceIds: ["source-kernel-proc", "source-kernel-psi"]
        },
        {
          id: "point-regression",
          point: "Re-run the original workload, monitor recurrence, and check adjacent failure modes after the change.",
          whyItMatters: "Regression evidence tests both completeness and unintended consequences.",
          sourceIds: ["source-kernel-psi", "source-systemd-resource"]
        }
      ]
    };
  }

  return {
    researchMode: "curated_demo_fallback",
    rewrittenQuestion: "D 状态和高 I/O wait 说明什么？为什么重启 Nginx 不等于修复根因？",
    summary: "Curated incident-response scaffold used because live external research was unavailable. It is limited to the public server-diagnostics demo debt.",
    sources: commonSources,
    scaffold: [
      {
        id: "point-state",
        point: "A D-state process is waiting in uninterruptible sleep, commonly while the kernel waits for an I/O operation; it is a symptom, not a root-cause diagnosis.",
        whyItMatters: "Treating the process name as the cause can lead to restarting the wrong service.",
        sourceIds: ["source-kernel-proc"]
      },
      {
        id: "point-wait",
        point: "High I/O wait means CPUs are idle while work is blocked on I/O, but the metric alone does not identify whether storage, networking, a filesystem, or another dependency is responsible.",
        whyItMatters: "A useful diagnosis must correlate the metric with blocked processes, device latency, logs, and the time of the incident.",
        sourceIds: ["source-kernel-proc"]
      },
      {
        id: "point-boundary",
        point: "Nginx and systemd may reveal or contain the problem without causing it: systemd supervises units, while Nginx can be blocked by upstreams, logging, or filesystem activity.",
        whyItMatters: "A restart can clear symptoms temporarily without proving the repair is complete.",
        sourceIds: ["source-systemd-resource", "source-kernel-psi"]
      },
      {
        id: "point-verification",
        point: "Verify the repair with process state, per-unit resource usage, I/O latency or pressure, service and kernel logs, and a repeated workload after the change.",
        whyItMatters: "The debt is cleared only when the learner can explain both the causal hypothesis and the evidence that could falsify it.",
        sourceIds: ["source-kernel-proc", "source-systemd-resource", "source-kernel-psi"]
      }
    ]
  };
}

export function createDemoAnswerFallback(input) {
  const answer = clean(input?.answer).toLowerCase();
  const signals = [
    /d[-\s]*state|d\s*状态|uninterruptible|不可中断|阻塞/.test(answer),
    /i\/o|io\s*wait|iowait|等待.*(磁盘|存储|输入输出)|磁盘|存储/.test(answer),
    /不是.*根因|症状|不一定.*nginx|restart|重启.*(不|未必)|暂时.*缓解|没有.*解决.*根因|减少.*而不是.*解决/.test(answer),
    /日志|latency|延迟|iostat|pressure|proc|监控|指标|验证|systemd|dmesg|负载/.test(answer)
  ];
  const coverage = signals.filter(Boolean).length / signals.length;
  const missing = [
    !signals[0] && "Explain what D-state means.",
    !signals[1] && "Connect I/O wait to blocked work without assuming one specific device is at fault.",
    !signals[2] && "Separate the visible service from the underlying cause.",
    !signals[3] && "Name evidence you would collect to verify the diagnosis and repair."
  ].filter(Boolean);
  const english = input?.locale === "en";
  return {
    status: coverage >= 0.75 ? "needs_verification" : "needs_practice",
    coverage,
    demonstrated: signals.map((present, index) => present ? [
      "Recognizes the blocked process state.",
      "Connects I/O wait with blocked work.",
      "Distinguishes symptom from root cause.",
      "Proposes observable verification evidence."
    ][index] : "").filter(Boolean),
    missing,
    misconceptions: [],
    evidence: ["Demo fallback checked the answer for four required explanation boundaries; live AI evaluation was unavailable."],
    materialSourceIds: ["source-kernel-proc", "source-systemd-resource", "source-kernel-psi"],
    feedback: english
      ? (coverage >= 0.75 ? "You covered the main diagnostic chain. Live AI evaluation was unavailable, so the conclusion still needs verification." : "Your answer was saved. Connect the process state, I/O wait, root cause, and verification evidence more explicitly.")
      : (coverage >= 0.75 ? "你已经覆盖了主要诊断链。当前缺少实时 AI 评价，因此仍需查证。" : "回答已记录。请补充进程状态、I/O wait、根因和验证证据之间的关系。"),
    teaching: english ? "D-state and I/O wait are symptoms. A complete explanation needs a causal hypothesis, supporting evidence, and evidence that could falsify it." : "D 状态和 I/O wait 都是现象。完整解释需要提出原因、支持证据，以及能推翻该判断的结果。",
    nextQuestion: english ? "What evidence would distinguish a storage bottleneck, an Nginx problem, and an upstream service failure?" : "哪些证据可以区分存储瓶颈、Nginx 问题和上游服务故障？",
    recommendation: "continue"
  };
}

// 通用 fallback：当欠条主题不属于服务器诊断演示样本时使用。
// 使用实际卡片的 prompt 作为清偿问题，提供与欠条相关的最小 scaffold。
function createGenericDemoFallback(request, error) {
  const targetDebt = clean(request?.targetDebt || request?.originalQuestion || "认知欠条");
  const originalQuestion = clean(request?.originalQuestion || targetDebt);
  const dangerousGap = request?.dangerousGap;
  const english = request?.locale === "en";

  return {
    researchMode: "curated_demo_fallback",
    rewrittenQuestion: originalQuestion || targetDebt,
    summary: english
      ? "Curated fallback for a debt outside the server-diagnostics demo set; research is not live."
      : "策展备用材料：该欠条不属于服务器诊断演示样本，研究非实时检索。",
    sources: [{
      id: "source-curated-fallback",
      url: "https://en.wikipedia.org/wiki/Feynman_technique",
      title: "Feynman technique — Wikipedia",
      claim: english
        ? "The Feynman technique tests understanding by asking the learner to explain a concept in simple terms and identify gaps."
        : "费曼学习法通过让学习者用简单语言解释概念来检验理解，并识别知识盲区。"
    }],
    scaffold: [
      {
        id: "point-core-concept",
        point: dangerousGap?.gap || targetDebt,
        whyItMatters: dangerousGap?.whyDangerous || (english
          ? "This gap was identified because the learner outsourced this understanding to AI."
          : "这笔欠条被识别是因为学习者将此理解环节交给了 AI 代劳。"),
        sourceIds: ["source-curated-fallback"]
      },
      {
        id: "point-verification",
        point: english
          ? "A complete explanation should cover the mechanism, its boundary conditions, and how to verify it."
          : "完整解释应覆盖机制原理、边界条件以及如何验证。",
        whyItMatters: english
          ? "Naming the mechanism alone does not prove understanding; boundaries and verification matter."
          : "仅说出机制名称不足以证明理解，边界条件和验证方法同样重要。",
        sourceIds: ["source-curated-fallback"]
      }
    ]
  };
}
