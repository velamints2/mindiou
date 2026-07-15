function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function createDemoResearchFallback(request, error) {
  const topic = clean(request?.targetDebt || request?.originalQuestion);
  const serverIncident = /i\/o wait|d-state|nginx|systemd/i.test(topic);

  if (!serverIncident) {
    throw error instanceof Error ? error : new Error("External research is unavailable");
  }

  return {
    researchMode: "curated_demo_fallback",
    rewrittenQuestion: "D 状态和高 I/O wait 说明什么？为什么重启 Nginx 不等于修复根因？",
    summary: "Curated incident-response scaffold used because live external research was unavailable. It is limited to the public server-diagnostics demo debt.",
    sources: [
      {
        id: "source-kernel-proc",
        url: "https://docs.kernel.org/filesystems/proc.html",
        title: "Linux kernel documentation: the /proc filesystem",
        claim: "The kernel exposes process state and system activity through /proc, including the process state code used to identify uninterruptible sleep."
      },
      {
        id: "source-systemd-resource",
        url: "https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html",
        title: "systemd.resource-control",
        claim: "systemd units can be inspected and constrained through cgroup-backed resource controls."
      },
      {
        id: "source-kernel-cgroup",
        url: "https://docs.kernel.org/admin-guide/cgroup-v2.html",
        title: "Linux kernel documentation: Control Group v2",
        claim: "Cgroup v2 exposes resource accounting and control for groups of processes."
      }
    ],
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
        sourceIds: ["source-systemd-resource", "source-kernel-cgroup"]
      },
      {
        id: "point-verification",
        point: "Verify the repair with process state, per-unit resource usage, I/O latency or pressure, service and kernel logs, and a repeated workload after the change.",
        whyItMatters: "The debt is cleared only when the learner can explain both the causal hypothesis and the evidence that could falsify it.",
        sourceIds: ["source-kernel-proc", "source-systemd-resource", "source-kernel-cgroup"]
      }
    ]
  };
}

export function createDemoAnswerFallback(input) {
  const answer = clean(input?.answer).toLowerCase();
  const signals = [
    /d-state|uninterruptible|不可中断|阻塞/.test(answer),
    /i\/o|io wait|等待.*(磁盘|存储|输入输出)|磁盘|存储/.test(answer),
    /不是.*根因|症状|不一定.*nginx|restart|重启.*(不|未必)/.test(answer),
    /日志|latency|延迟|iostat|pressure|proc|监控|指标|验证/.test(answer)
  ];
  const coverage = signals.filter(Boolean).length / signals.length;
  const missing = [
    !signals[0] && "Explain what D-state means.",
    !signals[1] && "Connect I/O wait to blocked work without assuming one specific device is at fault.",
    !signals[2] && "Separate the visible service from the underlying cause.",
    !signals[3] && "Name evidence you would collect to verify the diagnosis and repair."
  ].filter(Boolean);
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
    materialSourceIds: ["source-kernel-proc", "source-systemd-resource", "source-kernel-cgroup"],
    feedback: coverage >= 0.75
      ? "你已经覆盖了主要诊断链。当前缺少实时 AI 评价，因此仍需查证。"
      : "回答已记录。请补充进程状态、I/O wait、根因和验证证据之间的关系。",
    teaching: "D 状态和 I/O wait 都是现象。完整解释需要提出原因、支持证据，以及能推翻该判断的结果。",
    nextQuestion: "哪些证据可以区分存储瓶颈、Nginx 问题和上游服务故障？",
    recommendation: "continue"
  };
}
