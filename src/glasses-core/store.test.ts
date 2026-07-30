/**
 * Unit tests for the platform-independent glasses core state machine.
 */
import { describe, expect, it } from "vitest";
import {
  GlassesCoreStore,
  buildSummary,
  createInitialState,
  currentCard,
  mapGestureToAction,
  reduce,
  reduceBurst,
  restoreState,
  runSync,
  serializeState
} from "./store";
import { DEMO_CARDS, createDemoQueue, makeDemoError } from "./fixtures";
import type { CardLayer, QueueState } from "./types";

function demoState(): QueueState {
  return createDemoQueue();
}

describe("navigation actions", () => {
  it("NEXT_CARD advances and resets the layer to question", () => {
    const revealed = reduce(demoState(), "REVEAL_HINT").state;
    expect(revealed.layer).toBe("why");
    const next = reduce(revealed, "NEXT_CARD").state;
    expect(next.currentIndex).toBe(1);
    expect(next.layer).toBe("question");
  });

  it("NEXT_CARD clamps on the last card instead of wrapping", () => {
    let state = demoState();
    state = reduce(state, "NEXT_CARD").state;
    state = reduce(state, "NEXT_CARD").state;
    expect(state.currentIndex).toBe(2);
    const clamped = reduce(state, "NEXT_CARD").state;
    expect(clamped.currentIndex).toBe(2);
  });

  it("PREVIOUS_CARD goes back and clamps on the first card", () => {
    let state = demoState();
    expect(reduce(state, "PREVIOUS_CARD").state.currentIndex).toBe(0);
    state = reduce(state, "NEXT_CARD").state;
    const back = reduce(state, "PREVIOUS_CARD").state;
    expect(back.currentIndex).toBe(0);
    expect(back.layer).toBe("question");
  });
});

describe("reveal actions", () => {
  it("REVEAL_HINT walks question -> why -> evidence -> answer and stays", () => {
    let state = demoState();
    const seen: CardLayer[] = [state.layer];
    state = reduce(state, "REVEAL_HINT").state;
    seen.push(state.layer);
    state = reduce(state, "REVEAL_HINT").state;
    seen.push(state.layer);
    state = reduce(state, "REVEAL_HINT").state;
    seen.push(state.layer);
    expect(seen).toEqual(["question", "why", "evidence", "answer"]);
    const stuck = reduce(state, "REVEAL_HINT").state;
    expect(stuck.layer).toBe("answer");
  });

  it("sets answerRevealed only when the answer layer is reached", () => {
    let state = demoState();
    state = reduce(state, "REVEAL_HINT").state;
    state = reduce(state, "REVEAL_HINT").state;
    expect(state.progress["demo-card-001"].answerRevealed).toBe(false);
    expect(state.progress["demo-card-001"].deepestLayer).toBe("evidence");
    state = reduce(state, "REVEAL_HINT").state;
    expect(state.progress["demo-card-001"].answerRevealed).toBe(true);
    expect(state.progress["demo-card-001"].deepestLayer).toBe("answer");
  });

  it("REVEAL_ANSWER jumps straight to the answer layer", () => {
    const state = reduce(demoState(), "REVEAL_ANSWER").state;
    expect(state.layer).toBe("answer");
    expect(state.progress["demo-card-001"].answerRevealed).toBe(true);
    expect(state.progress["demo-card-001"].deepestLayer).toBe("answer");
  });

  it("LAYER_BACK steps one layer back and stops at question", () => {
    let state = reduce(demoState(), "REVEAL_ANSWER").state;
    state = reduce(state, "LAYER_BACK").state;
    expect(state.layer).toBe("evidence");
    state = reduce(state, "LAYER_BACK").state;
    state = reduce(state, "LAYER_BACK").state;
    expect(state.layer).toBe("question");
    expect(reduce(state, "LAYER_BACK").state.layer).toBe("question");
  });
});

describe("mark actions", () => {
  it("MARK_KNOWN records the mark and auto-advances", () => {
    const state = reduce(demoState(), "MARK_KNOWN").state;
    expect(state.progress["demo-card-001"].mark).toBe("known");
    expect(state.currentIndex).toBe(1);
    expect(state.layer).toBe("question");
    expect(state.finished).toBe(false);
  });

  it("MARK_REVIEW on the last card stays and signals finished", () => {
    let state = demoState();
    state = reduce(state, "MARK_KNOWN").state;
    state = reduce(state, "MARK_KNOWN").state;
    state = reduce(state, "MARK_REVIEW").state;
    expect(state.currentIndex).toBe(2);
    expect(state.progress["demo-card-003"].mark).toBe("review");
    expect(state.finished).toBe(true);
  });

  it("RETRY undoes the previously marked card and returns to its question layer", () => {
    let state = demoState();
    state = reduce(state, "REVEAL_ANSWER").state;
    state = reduce(state, "MARK_REVIEW").state;
    expect(state.currentIndex).toBe(1);
    const retried = reduce(state, "RETRY").state;
    expect(retried.currentIndex).toBe(0);
    expect(retried.layer).toBe("question");
    expect(retried.progress["demo-card-001"].mark).toBeUndefined();
    // Session evidence of what was seen is preserved.
    expect(retried.progress["demo-card-001"].answerRevealed).toBe(true);
  });

  it("RETRY on a marked current card clears that mark and resets finished", () => {
    let state = demoState();
    state = reduce(state, "MARK_KNOWN").state;
    state = reduce(state, "MARK_KNOWN").state;
    state = reduce(state, "MARK_KNOWN").state;
    expect(state.finished).toBe(true);
    const retried = reduce(state, "RETRY").state;
    expect(retried.finished).toBe(false);
    expect(retried.progress["demo-card-003"].mark).toBeUndefined();
    expect(retried.currentIndex).toBe(2);
  });

  it("RETRY without any mark is a no-op", () => {
    const state = demoState();
    expect(reduce(state, "RETRY").state).toEqual(state);
  });
});

describe("EXIT", () => {
  it("returns a session summary without changing data", () => {
    let state = demoState();
    state = reduce(state, "REVEAL_ANSWER").state;
    state = reduce(state, "MARK_KNOWN").state;
    state = reduce(state, "MARK_REVIEW").state;
    const result = reduce(state, "EXIT");
    expect(result.state).toEqual(state);
    expect(result.summary).toEqual({
      totalCards: 3,
      known: 1,
      review: 1,
      unseen: 1,
      answerRevealedCount: 1
    });
    expect(buildSummary(state)).toEqual(result.summary);
  });
});

describe("SYNC", () => {
  it("SYNC moves idle to syncing", () => {
    const state = reduce(demoState(), "SYNC").state;
    expect(state.syncStatus).toBe("syncing");
    expect(state.error).toBeUndefined();
    expect(reduce(state, "SYNC").state.syncStatus).toBe("syncing");
  });

  it("runSync success transitions to synced", async () => {
    let snapshot: string | null = null;
    const next = await runSync(demoState(), async (value) => {
      snapshot = value;
    });
    expect(next.syncStatus).toBe("synced");
    expect(next.error).toBeUndefined();
    expect(snapshot).not.toBeNull();
  });

  it("runSync failure keeps marks and reports a readable error", async () => {
    let state = demoState();
    state = reduce(state, "MARK_KNOWN").state;
    const next = await runSync(state, async () => {
      throw makeDemoError();
    });
    expect(next.syncStatus).toBe("error");
    expect(next.error).toContain("同步失败");
    expect(next.error).toContain("DEMO");
    expect(next.progress["demo-card-001"].mark).toBe("known");
    expect(next.currentIndex).toBe(1);
  });

  it("store dispatch(SYNC) without an injected function errors readably", () => {
    const store = new GlassesCoreStore(demoState());
    store.dispatch("SYNC");
    expect(store.getState().syncStatus).toBe("error");
    expect(store.getState().error).toContain("同步");
  });

  it("store dispatch(SYNC) runs the injected function to completion", async () => {
    const store = new GlassesCoreStore(demoState(), { syncFn: async () => {} });
    store.dispatch("SYNC");
    expect(store.getState().syncStatus).toBe("syncing");
    await store.sync();
    expect(store.getState().syncStatus).toBe("synced");
  });
});

describe("serialization", () => {
  it("serialize/restore round-trips the full state", () => {
    let state = demoState();
    state = reduce(state, "REVEAL_ANSWER").state;
    state = reduce(state, "MARK_REVIEW").state;
    const restored = restoreState(serializeState(state), DEMO_CARDS);
    expect(restored).toEqual(state);
  });

  it("restore falls back to a safe initial state on broken data", () => {
    const fallback = createInitialState(DEMO_CARDS);
    expect(restoreState("{not json", DEMO_CARDS)).toEqual(fallback);
    expect(restoreState(null, DEMO_CARDS)).toEqual(fallback);
    expect(restoreState(undefined, DEMO_CARDS)).toEqual(fallback);
    expect(restoreState(JSON.stringify({ foo: 1 }), DEMO_CARDS)).toEqual(fallback);
    expect(restoreState(JSON.stringify({ cards: [{ id: 1 }] }), DEMO_CARDS)).toEqual(fallback);
  });

  it("restore sanitizes field-level problems instead of crashing", () => {
    const raw = {
      cards: DEMO_CARDS,
      currentIndex: 99,
      layer: "bogus",
      syncStatus: "bogus",
      finished: "yes",
      progress: {
        "demo-card-001": {
          cardId: "demo-card-001",
          deepestLayer: "answer",
          answerRevealed: true,
          mark: "known"
        },
        "ghost-card": { cardId: "ghost-card", deepestLayer: "why", answerRevealed: false },
        "demo-card-002": { cardId: "demo-card-002", deepestLayer: "nowhere", answerRevealed: true }
      }
    };
    const restored = restoreState(JSON.stringify(raw), DEMO_CARDS);
    expect(restored.currentIndex).toBe(2);
    expect(restored.layer).toBe("question");
    expect(restored.syncStatus).toBe("idle");
    expect(restored.finished).toBe(false);
    expect(Object.keys(restored.progress)).toEqual(["demo-card-001"]);
    expect(restored.progress["demo-card-001"].mark).toBe("known");
  });

  it("store toJSON/fromJSON round-trips", () => {
    const store = new GlassesCoreStore(demoState());
    store.dispatch("MARK_KNOWN");
    const restored = GlassesCoreStore.fromJSON(store.toJSON(), DEMO_CARDS);
    expect(restored.getState()).toEqual(store.getState());
  });
});

describe("mapGestureToAction", () => {
  it("maps every gesture from the question layer", () => {
    expect(mapGestureToAction("swipe_down", "question")).toBe("NEXT_CARD");
    expect(mapGestureToAction("swipe_up", "question")).toBe("PREVIOUS_CARD");
    expect(mapGestureToAction("click", "question")).toBe("REVEAL_HINT");
    expect(mapGestureToAction("double_click", "question")).toBe("MARK_REVIEW");
  });

  it("double_click steps one layer back below the question layer", () => {
    expect(mapGestureToAction("double_click", "why")).toBe("LAYER_BACK");
    expect(mapGestureToAction("double_click", "evidence")).toBe("LAYER_BACK");
    expect(mapGestureToAction("double_click", "answer")).toBe("LAYER_BACK");
  });

  it("gestures compose with reduce end to end", () => {
    let state = demoState();
    state = reduce(state, mapGestureToAction("click", state.layer)).state;
    expect(state.layer).toBe("why");
    state = reduce(state, mapGestureToAction("double_click", state.layer)).state;
    expect(state.layer).toBe("question");
    state = reduce(state, mapGestureToAction("swipe_down", state.layer)).state;
    expect(state.currentIndex).toBe(1);
  });
});

describe("burst input coalescing", () => {
  it("reduces every action but exposes only the final state for rendering", () => {
    const result = reduceBurst(demoState(), ["NEXT_CARD", "NEXT_CARD", "NEXT_CARD", "NEXT_CARD"]);
    expect(result.state.currentIndex).toBe(2);
    expect(result.state.layer).toBe("question");
  });

  it("a rapid mark-then-next burst keeps the mark", () => {
    // MARK_KNOWN auto-advances to card 2, then NEXT_CARD lands on card 3.
    const result = reduceBurst(demoState(), ["MARK_KNOWN", "NEXT_CARD"]);
    expect(result.state.progress["demo-card-001"].mark).toBe("known");
    expect(result.state.currentIndex).toBe(2);
  });
});

describe("store wrapper", () => {
  it("dispatch updates getState and currentCard tracks the index", () => {
    const store = new GlassesCoreStore(demoState());
    store.dispatch("NEXT_CARD");
    expect(store.getState().currentIndex).toBe(1);
    expect(currentCard(store.getState())?.id).toBe("demo-card-002");
  });
});
