import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { groupVoteTarget, itemVoteTarget } from "../src/domain";
import {
  normalizeColumns,
  normalizeColumnsEffect,
  normalizePairwiseChoices,
  normalizePairwiseChoicesEffect,
  normalizeReactions,
  normalizeReactionsEffect,
  normalizeVotes,
  normalizeVotesEffect,
} from "./room-normalize";
import type { StoredState } from "./room-types";

describe("room normalization Effect helpers", () => {
  const participants = [{ id: "p1", displayName: "P1", isFacilitator: true }];
  const groups = [{ id: "group-a", name: "Group A", columnId: "mad", order: 0 }];
  const items = [
    { id: "item-a", text: "Item A", authorId: "p1", columnId: "mad", groupId: null, order: 0 },
    { id: "item-b", text: "Item B", authorId: "p1", columnId: "mad", groupId: "group-a", order: 0 },
  ];

  it("normalizes columns through an Effect boundary", async () => {
    const stored = {
      columns: [{ id: "mad", name: "  Mad  ", order: 4 }],
      groups: [],
    } as Pick<StoredState, "columns" | "groups">;

    await expect(Effect.runPromise(normalizeColumnsEffect(stored)))
      .resolves.toEqual(normalizeColumns(stored));
  });

  it("normalizes votes through an Effect boundary", async () => {
    const votes = [
      { participantId: "p1", target: groupVoteTarget("group-a"), count: 1 },
      { participantId: "p1", target: itemVoteTarget("item-a"), count: 2 },
      { participantId: "missing", target: itemVoteTarget("item-a"), count: 1 },
    ];

    await expect(Effect.runPromise(normalizeVotesEffect(votes, participants, groups, items)))
      .resolves.toEqual(normalizeVotes(votes, participants, groups, items));
  });

  it("normalizes pairwise choices and reactions through Effect boundaries", async () => {
    const choices = [
      { participantId: "p1", winner: groupVoteTarget("group-a"), loser: itemVoteTarget("item-a") },
      { participantId: "p1", winner: itemVoteTarget("item-a"), loser: itemVoteTarget("item-a") },
    ];
    const reactions = [
      { participantId: "p1", target: groupVoteTarget("group-a"), emoji: "👍" },
      { participantId: "p1", target: itemVoteTarget("missing"), emoji: "👍" },
    ];

    await expect(Effect.runPromise(normalizePairwiseChoicesEffect(choices, participants, groups, items)))
      .resolves.toEqual(normalizePairwiseChoices(choices, participants, groups, items));
    await expect(Effect.runPromise(normalizeReactionsEffect(reactions, participants, groups, items)))
      .resolves.toEqual(normalizeReactions(reactions, participants, groups, items));
  });
});
