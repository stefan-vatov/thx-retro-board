import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  buildReactionBarModelEffect,
  planReactionMenuToggleEffect,
} from "./reaction-bar-effect";
import { itemVoteTarget } from "../domain";
import type { Reaction } from "../domain";

describe("buildReactionBarModelEffect", () => {
  it("returns unique active emoji pills with counts and selected state", async () => {
    const target = itemVoteTarget("item-1");
    const reactions: Reaction[] = [
      { participantId: "p1", target, emoji: "👍" },
      { participantId: "p2", target, emoji: "👍" },
      { participantId: "p1", target, emoji: "❤️" },
    ];

    await expect(
      Effect.runPromise(
        buildReactionBarModelEffect({
          reactions,
          target,
          participantId: "p1",
        }),
      ),
    ).resolves.toEqual([
      { emoji: "👍", count: 2, selected: true },
      { emoji: "❤️", count: 1, selected: true },
    ]);
  });
});

describe("planReactionMenuToggleEffect", () => {
  it("toggles the reaction menu and preserves optional event isolation intent", async () => {
    await expect(
      Effect.runPromise(
        planReactionMenuToggleEffect({
          open: false,
          stopPropagation: true,
        }),
      ),
    ).resolves.toEqual({ nextOpen: true, shouldStopPropagation: true });
  });
});
