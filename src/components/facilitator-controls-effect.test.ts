import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  getNextPhaseEffect,
  getRankingMethodSuccessMessageEffect,
  parseTimerMinutesEffect,
  parseVoteBudgetEffect,
} from "./facilitator-controls-effect";

describe("facilitator controls effects", () => {
  it("parses vote budgets within the allowed range", async () => {
    await expect(
      Effect.runPromise(parseVoteBudgetEffect(" 12 ")),
    ).resolves.toEqual({
      success: true,
      budget: 12,
    });
  });

  it("rejects invalid vote budgets", async () => {
    await expect(
      Effect.runPromise(parseVoteBudgetEffect("1.5")),
    ).resolves.toEqual({
      success: false,
      error: "Vote budget must be an integer between 1 and 100.",
    });
    await expect(
      Effect.runPromise(parseVoteBudgetEffect("101")),
    ).resolves.toEqual({
      success: false,
      error: "Vote budget must be an integer between 1 and 100.",
    });
  });

  it("parses timer minutes into seconds", async () => {
    await expect(
      Effect.runPromise(parseTimerMinutesEffect(" 5 ")),
    ).resolves.toEqual({
      success: true,
      durationSeconds: 300,
    });
  });

  it("rejects blank and out-of-range timers with specific copy", async () => {
    await expect(
      Effect.runPromise(parseTimerMinutesEffect(" ")),
    ).resolves.toEqual({
      success: false,
      error: "Timer cannot be blank.",
    });
    await expect(
      Effect.runPromise(parseTimerMinutesEffect("0")),
    ).resolves.toEqual({
      success: false,
      error: "Timer must be at least 1 minute.",
    });
    await expect(
      Effect.runPromise(parseTimerMinutesEffect("61")),
    ).resolves.toEqual({
      success: false,
      error: "Timer cannot exceed 60 minutes.",
    });
  });

  it("calculates the next phase", async () => {
    await expect(Effect.runPromise(getNextPhaseEffect("setup"))).resolves.toBe(
      "write",
    );
    await expect(
      Effect.runPromise(getNextPhaseEffect("finalize")),
    ).resolves.toBeUndefined();
  });

  it("returns ranking method success copy", async () => {
    await expect(
      Effect.runPromise(getRankingMethodSuccessMessageEffect("pairwise")),
    ).resolves.toBe("Pairwise ranking selected.");
    await expect(
      Effect.runPromise(getRankingMethodSuccessMessageEffect("score")),
    ).resolves.toBe("Score voting selected.");
  });
});
