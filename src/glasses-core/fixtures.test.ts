/**
 * Structural integrity tests for the demo fixtures.
 */
import { describe, expect, it } from "vitest";
import {
  DEMO_CARDS,
  DEMO_DEBT,
  DEMO_FIXTURE_MARKER,
  DEMO_GAP,
  DEMO_REPORT_ID,
  DEMO_SOURCE,
  createDemoQueue,
  makeDemoError
} from "./fixtures";

describe("demo fixtures", () => {
  it("contains exactly one debt, one root gap, three cards and one source", () => {
    expect(DEMO_DEBT.reportId).toBe(DEMO_REPORT_ID);
    expect(DEMO_DEBT.gapId).toBe(DEMO_GAP.id);
    expect(DEMO_CARDS).toHaveLength(3);
    expect(DEMO_SOURCE.id).toBeTruthy();
  });

  it("every card has all four layers filled and points at the root gap", () => {
    for (const card of DEMO_CARDS) {
      expect(card.reportId).toBe(DEMO_REPORT_ID);
      expect(card.gapId).toBe(DEMO_GAP.id);
      expect(card.title.trim()).not.toBe("");
      expect(card.whyItMatters.trim()).not.toBe("");
      expect(card.evidence.trim()).not.toBe("");
      expect(card.referenceAnswer.trim()).not.toBe("");
      expect(card.sourceRef).toBe(DEMO_SOURCE.id);
    }
  });

  it("carries DEMO markers so fixtures are never mistaken for user data", () => {
    expect(DEMO_FIXTURE_MARKER).toBe("DEMO_FIXTURE");
    expect(DEMO_GAP.demoSource).toBe("DEMO_FIXTURE");
    expect(DEMO_DEBT.demoSource).toBe("DEMO_FIXTURE");
    expect(DEMO_SOURCE.demoSource).toBe("DEMO_FIXTURE");
    for (const card of DEMO_CARDS) {
      expect(card.evidence).toContain("DEMO_FIXTURE");
    }
  });

  it("makeDemoError returns a simulated network error", () => {
    const error = makeDemoError();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("DEMO");
  });

  it("createDemoQueue builds a clean initial queue", () => {
    const queue = createDemoQueue();
    expect(queue.cards).toEqual(DEMO_CARDS);
    expect(queue.currentIndex).toBe(0);
    expect(queue.layer).toBe("question");
    expect(queue.syncStatus).toBe("idle");
    expect(queue.finished).toBe(false);
    expect(queue.progress).toEqual({});
  });
});
