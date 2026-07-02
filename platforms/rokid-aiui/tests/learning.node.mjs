import test from "node:test";
import assert from "node:assert/strict";
import {
  assessmentToReview,
  commandFromUtterance,
  conciseFeedback
} from "../utils/learning.js";

test("short explicit commands are classified conservatively", () => {
  assert.equal(commandFromUtterance("下一题"), "next");
  assert.equal(commandFromUtterance("上一张。"), "previous");
  assert.equal(commandFromUtterance("会了"), "known");
  assert.equal(commandFromUtterance("再说一遍"), "repeat");
});

test("long explanations remain answers even when they contain command words", () => {
  assert.equal(
    commandFromUtterance("我认为下一题的核心不是切换，而是先解释当前概念"),
    "answer"
  );
  assert.equal(
    commandFromUtterance("Backpressure means the producer slows down when the consumer cannot keep up."),
    "answer"
  );
});

test("AI assessment maps to transparent review states", () => {
  assert.equal(assessmentToReview("correct"), "mastered");
  assert.equal(assessmentToReview("partial"), "partial");
  assert.equal(assessmentToReview("incorrect"), "incorrect");
  assert.equal(assessmentToReview("unknown"), "partial");
});

test("glasses feedback prefers the concise display contract", () => {
  assert.equal(
    conciseFeedback({
      display: { feedback: "补一个真实例子" },
      tutor: { g2Text: "unused" }
    }),
    "补一个真实例子"
  );
});
