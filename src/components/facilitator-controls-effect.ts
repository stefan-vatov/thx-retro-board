import { Effect } from "effect";
import type { Phase, RankingMethod } from "../domain";
import { PHASE_ORDER } from "../domain";

export type VoteBudgetParseResult =
  | { success: true; budget: number }
  | { success: false; error: string };

export type TimerMinutesParseResult =
  | { success: true; durationSeconds: number }
  | { success: false; error: string };

export function parseVoteBudgetEffect(
  rawValue: string,
): Effect.Effect<VoteBudgetParseResult> {
  return Effect.sync(() => {
    const rawBudget = rawValue.trim();
    const budget = Number(rawBudget);
    if (
      !/^\d+$/.test(rawBudget) ||
      !Number.isInteger(budget) ||
      budget < 1 ||
      budget > 100
    ) {
      return {
        success: false,
        error: "Vote budget must be an integer between 1 and 100.",
      };
    }
    return { success: true, budget };
  });
}

export function parseTimerMinutesEffect(
  rawValue: string,
): Effect.Effect<TimerMinutesParseResult> {
  return Effect.sync(() => {
    const raw = rawValue.trim();
    if (!raw) return { success: false, error: "Timer cannot be blank." };
    const minutes = parseInt(raw, 10);
    if (Number.isNaN(minutes) || minutes < 1) {
      return { success: false, error: "Timer must be at least 1 minute." };
    }
    if (minutes > 60) {
      return { success: false, error: "Timer cannot exceed 60 minutes." };
    }
    return { success: true, durationSeconds: minutes * 60 };
  });
}

export function getNextPhaseEffect(
  phase: Phase,
): Effect.Effect<Phase | undefined> {
  return Effect.sync(() => {
    const currentIdx = PHASE_ORDER.indexOf(phase);
    return PHASE_ORDER[currentIdx + 1] as Phase | undefined;
  });
}

export function getRankingMethodSuccessMessageEffect(
  rankingMethod: RankingMethod,
): Effect.Effect<string> {
  return Effect.sync(() =>
    rankingMethod === "pairwise"
      ? "Pairwise ranking selected."
      : "Score voting selected.",
  );
}
