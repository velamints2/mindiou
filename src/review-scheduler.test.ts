// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  calculateNextReview,
  sortReviewTasks,
  selectTasksByTimeBudget,
  recommendNextStage,
  REVIEW_INTERVALS
} from "../review-scheduler.js";

describe("review-scheduler — calculateNextReview", () => {
  it("schedules 3 days for high-quality initial with no hints", () => {
    const result = calculateNextReview({
      trainingStage: "initial_compensation",
      evaluation: { passed: true, hintDependency: 10 },
      hintEvents: [],
      previousAttempts: [],
      currentMastery: null
    });
    expect(result.intervalMs).toBe(REVIEW_INTERVALS.initialHighQuality);
    expect(result.nextReviewAt).toBeTruthy();
    expect(result.reason).toContain("3天");
  });

  it("schedules 1 day for initial with some hints", () => {
    const result = calculateNextReview({
      trainingStage: "initial_compensation",
      evaluation: { passed: true, hintDependency: 40 },
      hintEvents: [{ level: 2 }, { level: 3 }],
      previousAttempts: [],
      currentMastery: null
    });
    expect(result.intervalMs).toBe(REVIEW_INTERVALS.initialWithHints);
    expect(result.reason).toContain("1天");
  });

  it("schedules 6 hours for high hint dependency", () => {
    const result = calculateNextReview({
      trainingStage: "initial_compensation",
      evaluation: { passed: true, hintDependency: 70 },
      hintEvents: [{ level: 5 }, { level: 6 }],
      previousAttempts: [],
      currentMastery: null
    });
    expect(result.intervalMs).toBe(REVIEW_INTERVALS.initialHighDependency);
    expect(result.reason).toContain("6小时");
  });

  it("schedules 7 days for delayed_recall passed", () => {
    const result = calculateNextReview({
      trainingStage: "delayed_recall",
      evaluation: { passed: true, hintDependency: 0 },
      hintEvents: [],
      previousAttempts: [{ evaluation: { passed: true } }],
      currentMastery: { overallMastery: 60 }
    });
    expect(result.intervalMs).toBe(REVIEW_INTERVALS.delayedRecallPassed);
  });

  it("schedules 14 days for scenario_transfer passed", () => {
    const result = calculateNextReview({
      trainingStage: "scenario_transfer",
      evaluation: { passed: true, hintDependency: 0 },
      hintEvents: [],
      previousAttempts: [{ evaluation: { passed: true } }],
      currentMastery: { overallMastery: 70 }
    });
    expect(result.intervalMs).toBe(REVIEW_INTERVALS.transferPassed);
  });

  it("schedules 30 days for consecutive stable passes", () => {
    const result = calculateNextReview({
      trainingStage: "scenario_transfer",
      evaluation: { passed: true, hintDependency: 0 },
      hintEvents: [],
      previousAttempts: [
        { evaluation: { passed: true } },
        { evaluation: { passed: true } }
      ],
      currentMastery: { overallMastery: 90 }
    });
    expect(result.intervalMs).toBe(REVIEW_INTERVALS.stableMastery);
    expect(result.reason).toContain("30天");
  });

  it("schedules 12 hours for failed review", () => {
    const result = calculateNextReview({
      trainingStage: "delayed_recall",
      evaluation: { passed: false, hintDependency: 30 },
      hintEvents: [],
      previousAttempts: [],
      currentMastery: null
    });
    expect(result.intervalMs).toBe(REVIEW_INTERVALS.reviewFailed);
    expect(result.reason).toContain("未通过");
  });
});

describe("review-scheduler — sortReviewTasks", () => {
  it("prioritizes relapsed debts", () => {
    const tasks = [
      { id: "t1", cognitiveDebtId: "d1", dueAt: "2026-07-28T10:00:00Z" },
      { id: "t2", cognitiveDebtId: "d2", dueAt: "2026-07-28T10:00:00Z" }
    ];
    const masteryMap = {
      d1: { relapseCount: 0, failedAttempts: 0, hintIndependence: 80 },
      d2: { relapseCount: 2, failedAttempts: 1, hintIndependence: 70 }
    };
    const sorted = sortReviewTasks(tasks, masteryMap);
    expect(sorted[0].id).toBe("t2"); // relapsed first
  });

  it("prioritizes by failed attempts when no relapse", () => {
    const tasks = [
      { id: "t1", cognitiveDebtId: "d1", dueAt: "2026-07-28T10:00:00Z" },
      { id: "t2", cognitiveDebtId: "d2", dueAt: "2026-07-28T10:00:00Z" }
    ];
    const masteryMap = {
      d1: { relapseCount: 0, failedAttempts: 3, hintIndependence: 80 },
      d2: { relapseCount: 0, failedAttempts: 0, hintIndependence: 80 }
    };
    const sorted = sortReviewTasks(tasks, masteryMap);
    expect(sorted[0].id).toBe("t1");
  });

  it("prioritizes by hint dependency when failures equal", () => {
    const tasks = [
      { id: "t1", cognitiveDebtId: "d1", dueAt: "2026-07-28T10:00:00Z" },
      { id: "t2", cognitiveDebtId: "d2", dueAt: "2026-07-28T10:00:00Z" }
    ];
    const masteryMap = {
      d1: { relapseCount: 0, failedAttempts: 1, hintIndependence: 90 },
      d2: { relapseCount: 0, failedAttempts: 1, hintIndependence: 40 }
    };
    const sorted = sortReviewTasks(tasks, masteryMap);
    expect(sorted[0].id).toBe("t2"); // lower hintIndependence = higher dep
  });
});

describe("review-scheduler — selectTasksByTimeBudget", () => {
  it("selects tasks within time budget", () => {
    const tasks = [
      { taskType: "short_recall" },       // 1 min
      { taskType: "feynman_explanation" }, // 3 min
      { taskType: "scenario_judgment" }    // 5 min
    ];
    const selected = selectTasksByTimeBudget(tasks, 5);
    expect(selected).toHaveLength(2); // 1+3 = 4 min, 5 min doesn't fit
    expect(selected[0].taskType).toBe("short_recall");
    expect(selected[1].taskType).toBe("feynman_explanation");
  });

  it("returns empty when no time available", () => {
    const tasks = [{ taskType: "short_recall" }];
    const selected = selectTasksByTimeBudget(tasks, 0);
    expect(selected).toHaveLength(0);
  });

  it("selects all when plenty of time", () => {
    const tasks = [
      { taskType: "short_recall" },
      { taskType: "feynman_explanation" }
    ];
    const selected = selectTasksByTimeBudget(tasks, 30);
    expect(selected).toHaveLength(2);
  });
});

describe("review-scheduler — recommendNextStage", () => {
  it("recommends delayed_recall after stage 1", () => {
    const stage = recommendNextStage(1, { passed: true }, { currentStage: 1 });
    expect(stage).toBe("delayed_recall");
  });

  it("recommends misconception_check after stage 2", () => {
    const stage = recommendNextStage(2, { passed: true }, { currentStage: 2 });
    expect(stage).toBe("misconception_check");
  });

  it("recommends scenario_transfer after stage 3", () => {
    const stage = recommendNextStage(3, { passed: true }, { currentStage: 3 });
    expect(stage).toBe("scenario_transfer");
  });

  it("recommends real_work_validation at stage 4+", () => {
    const stage = recommendNextStage(4, { passed: true }, { currentStage: 4 });
    expect(stage).toBe("real_work_validation");
  });

  it("repeats current stage when not passed", () => {
    const stage = recommendNextStage(2, { passed: false }, { currentStage: 2 });
    expect(stage).toBe("delayed_recall");
  });
});
