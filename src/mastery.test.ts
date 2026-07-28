// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  canTransition,
  transitionStatus,
  deriveStatusFromStage,
  updateMasteryProfile,
  calculateOverallMastery,
  deriveUnderstandingLevel,
  masteryLabel,
  handleRelapse,
  createCognitiveDebt,
  migrateLegacySession,
  MASTERY_WEIGHTS,
  UNDERSTANDING_THRESHOLDS
} from "../mastery.js";

describe("mastery — status transitions", () => {
  it("allows valid transitions", () => {
    expect(canTransition("new", "initial_training")).toBe(true);
    expect(canTransition("initial_training", "initially_understood")).toBe(true);
    expect(canTransition("initially_understood", "review_scheduled")).toBe(true);
    expect(canTransition("review_scheduled", "review_due")).toBe(true);
    expect(canTransition("review_due", "independently_explainable")).toBe(true);
    expect(canTransition("independently_explainable", "transfer_training")).toBe(true);
    expect(canTransition("transfer_training", "mastered")).toBe(true);
    expect(canTransition("mastered", "relapsed")).toBe(true);
    expect(canTransition("relapsed", "initial_training")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransition("new", "mastered")).toBe(false);
    expect(canTransition("initial_training", "mastered")).toBe(false);
    expect(canTransition("initially_understood", "mastered")).toBe(false);
    expect(canTransition("mastered", "new")).toBe(false);
  });

  it("transitionStatus returns target on valid path", () => {
    expect(transitionStatus("new", "initial_training")).toBe("initial_training");
    expect(transitionStatus("mastered", "relapsed")).toBe("relapsed");
  });

  it("transitionStatus throws on invalid path", () => {
    expect(() => transitionStatus("new", "mastered")).toThrow(/Invalid status transition/);
  });
});

describe("mastery — deriveStatusFromStage", () => {
  it("initial_compensation passed → initially_understood", () => {
    const status = deriveStatusFromStage("initial_compensation", { passed: true });
    expect(status).toBe("initially_understood");
  });

  it("delayed_recall passed → independently_explainable", () => {
    const status = deriveStatusFromStage("delayed_recall", { passed: true });
    expect(status).toBe("independently_explainable");
  });

  it("scenario_transfer passed → transfer_training", () => {
    const status = deriveStatusFromStage("scenario_transfer", { passed: true });
    expect(status).toBe("transfer_training");
  });

  it("real_work_validation passed → mastered", () => {
    const status = deriveStatusFromStage("real_work_validation", { passed: true });
    expect(status).toBe("mastered");
  });

  it("failed delayed_recall → initially_understood (regression)", () => {
    const status = deriveStatusFromStage("delayed_recall", { passed: false });
    expect(status).toBe("initially_understood");
  });

  it("failed scenario_transfer → independently_explainable (regression)", () => {
    const status = deriveStatusFromStage("scenario_transfer", { passed: false });
    expect(status).toBe("independently_explainable");
  });
});

describe("mastery — updateMasteryProfile", () => {
  it("creates initial profile from first attempt", () => {
    const attempt = {
      cognitiveDebtId: "debt-1",
      capabilityId: "cap-1",
      trainingStage: "initial_compensation",
      evaluation: {
        passed: true,
        conceptualAccuracy: 70,
        hintDependency: 30,
        independentRecall: 40,
        transferAbility: 0
      },
      completedAt: "2026-07-28T10:00:00Z"
    };
    const profile = updateMasteryProfile(null, attempt);
    expect(profile.cognitiveDebtId).toBe("debt-1");
    expect(profile.capabilityId).toBe("cap-1");
    expect(profile.conceptualUnderstanding).toBeGreaterThan(0);
    expect(profile.hintIndependence).toBeGreaterThan(0);
    expect(profile.successfulAttempts).toBe(1);
    expect(profile.currentStage).toBe(1);
    expect(profile.lastAttemptAt).toBe("2026-07-28T10:00:00Z");
  });

  it("updates independentRecall on delayed_recall stage", () => {
    const existing = {
      cognitiveDebtId: "debt-1",
      conceptualUnderstanding: 60,
      independentRecall: 20,
      hintIndependence: 50,
      misconceptionResistance: 0,
      transferAbility: 0,
      retentionStrength: 0,
      overallMastery: 0,
      currentStage: 1,
      lastAttemptAt: "2026-07-28T10:00:00Z",
      nextReviewAt: undefined,
      successfulAttempts: 1,
      failedAttempts: 0,
      relapseCount: 0
    };
    const attempt = {
      cognitiveDebtId: "debt-1",
      trainingStage: "delayed_recall",
      evaluation: {
        passed: true,
        conceptualAccuracy: 80,
        hintDependency: 0,
        independentRecall: 80,
        transferAbility: 0
      },
      completedAt: "2026-07-29T10:00:00Z"
    };
    const profile = updateMasteryProfile(existing, attempt);
    expect(profile.independentRecall).toBeGreaterThan(20);
    expect(profile.retentionStrength).toBeGreaterThan(0);
    expect(profile.currentStage).toBe(2);
    expect(profile.successfulAttempts).toBe(2);
  });

  it("updates transferAbility on scenario_transfer stage", () => {
    const existing = {
      cognitiveDebtId: "debt-1",
      conceptualUnderstanding: 70,
      independentRecall: 65,
      hintIndependence: 80,
      misconceptionResistance: 60,
      transferAbility: 0,
      retentionStrength: 50,
      overallMastery: 0,
      currentStage: 2,
      lastAttemptAt: "2026-07-29T10:00:00Z",
      nextReviewAt: undefined,
      successfulAttempts: 2,
      failedAttempts: 0,
      relapseCount: 0
    };
    const attempt = {
      cognitiveDebtId: "debt-1",
      trainingStage: "scenario_transfer",
      evaluation: {
        passed: true,
        conceptualAccuracy: 85,
        hintDependency: 0,
        independentRecall: 80,
        transferAbility: 75
      },
      completedAt: "2026-08-01T10:00:00Z"
    };
    const profile = updateMasteryProfile(existing, attempt);
    expect(profile.transferAbility).toBeGreaterThan(0);
    expect(profile.currentStage).toBe(4);
  });

  it("increments failedAttempts when not passed", () => {
    const attempt = {
      cognitiveDebtId: "debt-1",
      trainingStage: "delayed_recall",
      evaluation: { passed: false, conceptualAccuracy: 20, hintDependency: 50, independentRecall: 10, transferAbility: 0 },
      completedAt: "2026-07-29T10:00:00Z"
    };
    const profile = updateMasteryProfile(null, attempt);
    expect(profile.failedAttempts).toBe(1);
    expect(profile.successfulAttempts).toBe(0);
  });
});

describe("mastery — calculateOverallMastery", () => {
  it("computes weighted sum correctly", () => {
    const profile = {
      conceptualUnderstanding: 100,
      independentRecall: 100,
      hintIndependence: 100,
      misconceptionResistance: 100,
      transferAbility: 100,
      retentionStrength: 100
    };
    const result = calculateOverallMastery(profile);
    expect(result).toBe(100);
  });

  it("returns 0 for all-zero profile", () => {
    const profile = {
      conceptualUnderstanding: 0,
      independentRecall: 0,
      hintIndependence: 0,
      misconceptionResistance: 0,
      transferAbility: 0,
      retentionStrength: 0
    };
    expect(calculateOverallMastery(profile)).toBe(0);
  });

  it("respects weight proportions", () => {
    const profile = {
      conceptualUnderstanding: 100,
      independentRecall: 0,
      hintIndependence: 0,
      misconceptionResistance: 0,
      transferAbility: 0,
      retentionStrength: 0
    };
    const result = calculateOverallMastery(profile);
    expect(result).toBe(Math.round(100 * MASTERY_WEIGHTS.conceptualUnderstanding));
  });
});

describe("mastery — deriveUnderstandingLevel", () => {
  it("returns not_understood for low scores", () => {
    const profile = { overallMastery: 10 };
    expect(deriveUnderstandingLevel(profile)).toBe("not_understood");
  });

  it("returns prompt_supported when hintDependency is high", () => {
    const profile = { overallMastery: 60 };
    const eval_ = { hintDependency: 70 };
    expect(deriveUnderstandingLevel(profile, eval_)).toBe("prompt_supported");
  });

  it("returns stable_mastery for high scores", () => {
    const profile = { overallMastery: 95 };
    expect(deriveUnderstandingLevel(profile)).toBe("stable_mastery");
  });

  it("returns transferable at 85+", () => {
    const profile = { overallMastery: 88 };
    expect(deriveUnderstandingLevel(profile)).toBe("transferable");
  });
});

describe("mastery — masteryLabel", () => {
  it("returns Chinese labels", () => {
    expect(masteryLabel("not_understood")).toBe("正在补偿");
    expect(masteryLabel("prompt_supported")).toBe("在提示帮助下能够解释");
    expect(masteryLabel("initially_understood")).toBe("已初步理解");
    expect(masteryLabel("independently_explainable")).toBe("能够独立解释");
    expect(masteryLabel("transferable")).toBe("能够迁移使用");
    expect(masteryLabel("stable_mastery")).toBe("已形成稳定掌握");
  });
});

describe("mastery — handleRelapse", () => {
  it("increments relapseCount and reduces dimensions", () => {
    const profile = {
      relapseCount: 0,
      retentionStrength: 80,
      transferAbility: 70,
      overallMastery: 85
    };
    const result = handleRelapse(profile);
    expect(result.relapseCount).toBe(1);
    expect(result.retentionStrength).toBe(40);
    expect(result.transferAbility).toBe(49);
    expect(result.overallMastery).toBe(0);
  });
});

describe("mastery — createCognitiveDebt", () => {
  it("creates debt with required fields", () => {
    const debt = createCognitiveDebt({
      userId: "user-1",
      reportId: "report-1",
      cardId: "card-1",
      gapText: "不理解 Git 工作区",
      gapEvidence: "用户未解释 git add"
    });
    expect(debt.id).toBeTruthy();
    expect(debt.userId).toBe("user-1");
    expect(debt.gapText).toBe("不理解 Git 工作区");
    expect(debt.status).toBe("new");
    expect(debt.recurrenceCount).toBe(0);
    expect(debt.sourceReports).toEqual(["report-1"]);
    expect(debt.createdAt).toBeTruthy();
  });
});

describe("mastery — migrateLegacySession", () => {
  it("marks ended sessions as initially_understood, not mastered", () => {
    const session = {
      userId: "user-1",
      reportId: "report-1",
      cardId: "card-1",
      state: "ended",
      endedAt: "2026-07-20T10:00:00Z",
      finalResult: { status: "provisionally_cleared" },
      originalCard: { target: "Git 工作区" }
    };
    const { debt, profile } = migrateLegacySession(session, { userId: "user-1" });
    expect(debt.status).toBe("initially_understood");
    expect(profile.conceptualUnderstanding).toBe(50);
    expect(profile.hintIndependence).toBe(50); // unknown
    expect(profile.successfulAttempts).toBe(1);
  });

  it("marks failed sessions with low scores", () => {
    const session = {
      userId: "user-1",
      reportId: "report-1",
      cardId: "card-1",
      state: "ended",
      endedAt: "2026-07-20T10:00:00Z",
      finalResult: { status: "needs_practice" },
      originalCard: { target: "Git 工作区" }
    };
    const { debt, profile } = migrateLegacySession(session, { userId: "user-1" });
    expect(profile.conceptualUnderstanding).toBe(20);
    expect(profile.successfulAttempts).toBe(0);
    expect(profile.failedAttempts).toBe(1);
  });
});
