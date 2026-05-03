import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { groupVoteTarget, itemVoteTarget } from "../src/domain";
import {
  validateReactionToggleEffect,
  validatePairwiseChoiceEffect,
  validateParticipantJoinEffect,
  validateVoteCastEffect,
  validateVoteRemoveEffect,
  validateWriteItemCreateEffect,
  validateWriteItemDeleteEffect,
  validateWriteItemEditEffect,
  validateReviewTargetChangeEffect,
  validateReviewActionEffect,
  validateTimerChangeEffect,
} from "./validation";

describe("RetroRoom validation: participant interactions", () => {
  it("validates score vote casting through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      votingParticipantIds: ["p1"],
      phase: "vote",
      rankingMethod: "score",
      voteBudget: 3,
      groups: [{ id: "group-1", columnId: "col-1", name: "Theme", order: 0 }],
      items: [
        { id: "item-1", text: "Free", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
        { id: "item-2", text: "Grouped", authorId: "p1", columnId: "col-1", groupId: "group-1", order: 0 },
      ],
      votes: [],
    };
  
    await expect(Effect.runPromise(validateVoteCastEffect(state, "p1", itemVoteTarget("item-1"), 2))).resolves.toEqual({
      votes: [{ participantId: "p1", target: itemVoteTarget("item-1"), count: 2 }],
    });
  
    const groupedItem = await Effect.runPromiseExit(validateVoteCastEffect(state, "p1", itemVoteTarget("item-2"), 1));
    expect(Exit.isFailure(groupedItem)).toBe(true);
  
    const overBudget = await Effect.runPromiseExit(validateVoteCastEffect({
      ...state,
      votes: [{ participantId: "p1", target: itemVoteTarget("item-1"), count: 3 }],
    }, "p1", groupVoteTarget("group-1"), 1));
    expect(Exit.isFailure(overBudget)).toBe(true);
  });
  
  it("validates score vote removal through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      votingParticipantIds: ["p1"],
      phase: "vote",
      rankingMethod: "score",
      voteBudget: 3,
      groups: [],
      items: [{ id: "item-1", text: "Free", authorId: "p1", columnId: "col-1", groupId: null, order: 0 }],
      votes: [{ participantId: "p1", target: itemVoteTarget("item-1"), count: 2 }],
    };
  
    await expect(Effect.runPromise(validateVoteRemoveEffect(state, "p1", itemVoteTarget("item-1")))).resolves.toEqual({
      votes: [{ participantId: "p1", target: itemVoteTarget("item-1"), count: 1 }],
    });
  
    const missingVote = await Effect.runPromiseExit(validateVoteRemoveEffect({ ...state, votes: [] }, "p1", itemVoteTarget("item-1")));
    expect(Exit.isFailure(missingVote)).toBe(true);
  
    const wrongPhase = await Effect.runPromiseExit(validateVoteRemoveEffect({ ...state, phase: "review" }, "p1", itemVoteTarget("item-1")));
    expect(Exit.isFailure(wrongPhase)).toBe(true);
  });
  
  it("validates reaction toggles through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      groups: [{ id: "group-1", columnId: "col-1", name: "Theme", order: 0 }],
      items: [{ id: "item-1", text: "Free", authorId: "p1", columnId: "col-1", groupId: null, order: 0 }],
      reactions: [],
    };
  
    await expect(Effect.runPromise(validateReactionToggleEffect(state, "p1", itemVoteTarget("item-1"), "🔥"))).resolves.toEqual({
      reactions: [{ participantId: "p1", target: itemVoteTarget("item-1"), emoji: "🔥" }],
    });
  
    await expect(Effect.runPromise(validateReactionToggleEffect({
      ...state,
      reactions: [{ participantId: "p1", target: itemVoteTarget("item-1"), emoji: "🔥" }],
    }, "p1", itemVoteTarget("item-1"), "🔥"))).resolves.toEqual({
      reactions: [],
    });
  
    const badEmoji = await Effect.runPromiseExit(validateReactionToggleEffect(state, "p1", itemVoteTarget("item-1"), "not-emoji"));
    expect(Exit.isFailure(badEmoji)).toBe(true);
  
    const missingTarget = await Effect.runPromiseExit(validateReactionToggleEffect(state, "p1", itemVoteTarget("missing"), "🔥"));
    expect(Exit.isFailure(missingTarget)).toBe(true);
  });
  
  it("validates pairwise choices through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      votingParticipantIds: ["p1"],
      phase: "vote",
      rankingMethod: "pairwise",
      groups: [{ id: "group-1", columnId: "col-1", name: "Theme", order: 0 }],
      items: [
        { id: "item-1", text: "Free", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
        { id: "item-2", text: "Grouped", authorId: "p1", columnId: "col-1", groupId: "group-1", order: 0 },
      ],
      pairwiseChoices: [],
    };
  
    await expect(Effect.runPromise(validatePairwiseChoiceEffect(state, "p1", groupVoteTarget("group-1"), itemVoteTarget("item-1")))).resolves.toEqual({
      pairwiseChoices: [{
        participantId: "p1",
        winner: groupVoteTarget("group-1"),
        loser: itemVoteTarget("item-1"),
      }],
    });
  
    const sameTarget = await Effect.runPromiseExit(validatePairwiseChoiceEffect(state, "p1", itemVoteTarget("item-1"), itemVoteTarget("item-1")));
    expect(Exit.isFailure(sameTarget)).toBe(true);
  
    const groupedItem = await Effect.runPromiseExit(validatePairwiseChoiceEffect(state, "p1", itemVoteTarget("item-2"), itemVoteTarget("item-1")));
    expect(Exit.isFailure(groupedItem)).toBe(true);
  
    const capped = await Effect.runPromiseExit(validatePairwiseChoiceEffect({
      ...state,
      groups: [],
      items: Array.from({ length: 51 }, (_, index) => ({
        id: `item-${index}`,
        text: `Item ${index}`,
        authorId: "p1",
        columnId: "col-1",
        groupId: null,
        order: index,
      })),
    }, "p1", itemVoteTarget("item-0"), itemVoteTarget("item-1")));
    expect(Exit.isFailure(capped)).toBe(true);
  });
  
  it("validates participant joins through Effect before state changes", async () => {
    const emptyState = {
      participants: [],
      facilitatorId: null,
      facilitatorClaimToken: null,
      connectionTokens: {},
    };
  
    await expect(Effect.runPromise(validateParticipantJoinEffect(emptyState, "fac1", "  Facilitator  "))).resolves.toEqual({
      displayName: "Facilitator",
      existing: null,
      isFacilitator: true,
      shouldClaimFacilitator: false,
    });
  
    const blankName = await Effect.runPromiseExit(validateParticipantJoinEffect(emptyState, "fac1", "   "));
    expect(Exit.isFailure(blankName)).toBe(true);
  
    const existingState = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      facilitatorId: null,
      facilitatorClaimToken: "claim-token",
      connectionTokens: { p1: "connection-token" },
    };
  
    await expect(Effect.runPromise(validateParticipantJoinEffect(
      existingState,
      "p1",
      "Pat",
      "connection-token",
      "claim-token",
    ))).resolves.toEqual({
      displayName: "Pat",
      existing: { id: "p1", displayName: "Pat", isFacilitator: false },
      isFacilitator: true,
      shouldClaimFacilitator: true,
    });
  
    const invalidCredentials = await Effect.runPromiseExit(validateParticipantJoinEffect(existingState, "p1", "Pat", "wrong"));
    expect(Exit.isFailure(invalidCredentials)).toBe(true);
  });
  
  it("validates review action mutations through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      phase: "review",
      actions: [],
    };
  
    await expect(Effect.runPromise(validateReviewActionEffect(state, "p1", "Follow up"))).resolves.toEqual({
      text: "Follow up",
    });
  
    const blankText = await Effect.runPromiseExit(validateReviewActionEffect(state, "p1", "   "));
    expect(Exit.isFailure(blankText)).toBe(true);
  
    const wrongPhase = await Effect.runPromiseExit(validateReviewActionEffect({ ...state, phase: "finalize" }, "p1", "Follow up"));
    expect(Exit.isFailure(wrongPhase)).toBe(true);
  });
  
  it("validates write item creation through Effect before state changes", async () => {
    const state = {
      phase: "write",
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      items: [],
      columns: [{ id: "col-1", name: "Mad", order: 0 }],
    };
  
    await expect(Effect.runPromise(validateWriteItemCreateEffect(state, "p1", "  New card  ", "col-1"))).resolves.toEqual({
      text: "New card",
      columnId: "col-1",
      order: 0,
    });
  
    const blankText = await Effect.runPromiseExit(validateWriteItemCreateEffect(state, "p1", "   ", "col-1"));
    expect(Exit.isFailure(blankText)).toBe(true);
  
    const wrongPhase = await Effect.runPromiseExit(validateWriteItemCreateEffect({ ...state, phase: "organise" }, "p1", "New card", "col-1"));
    expect(Exit.isFailure(wrongPhase)).toBe(true);

    const missingColumn = await Effect.runPromiseExit(validateWriteItemCreateEffect(state, "p1", "New card", "missing"));
    expect(Exit.isFailure(missingColumn)).toBe(true);
  });
  
  it("validates write item edits through Effect before state changes", async () => {
    const item = { id: "item-1", text: "Old", authorId: "p1", columnId: "col-1", groupId: null, order: 0 };
    const state = {
      phase: "write",
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      items: [item],
    };
  
    await expect(Effect.runPromise(validateWriteItemEditEffect(state, "p1", "item-1", "  Updated  "))).resolves.toEqual({
      item: { ...item, text: "Updated" },
    });
  
    const wrongAuthor = await Effect.runPromiseExit(validateWriteItemEditEffect({
      ...state,
      participants: [...state.participants, { id: "p2", displayName: "Other", isFacilitator: false }],
    }, "p2", "item-1", "Updated"));
    expect(Exit.isFailure(wrongAuthor)).toBe(true);
  
    const missingItem = await Effect.runPromiseExit(validateWriteItemEditEffect(state, "p1", "missing", "Updated"));
    expect(Exit.isFailure(missingItem)).toBe(true);
  });
  
  it("validates write item deletes through Effect before state changes", async () => {
    const item = { id: "item-1", text: "Old", authorId: "p1", columnId: "col-1", groupId: null, order: 0 };
    const state = {
      phase: "write",
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      items: [item],
    };
  
    await expect(Effect.runPromise(validateWriteItemDeleteEffect(state, "p1", "item-1"))).resolves.toEqual({
      target: itemVoteTarget("item-1"),
    });
  
    const wrongAuthor = await Effect.runPromiseExit(validateWriteItemDeleteEffect({
      ...state,
      participants: [...state.participants, { id: "p2", displayName: "Other", isFacilitator: false }],
    }, "p2", "item-1"));
    expect(Exit.isFailure(wrongAuthor)).toBe(true);
  });
  
  it("validates timer changes through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
    };
  
    await expect(Effect.runPromise(validateTimerChangeEffect(state, "fac1", 300))).resolves.toEqual({ durationSeconds: 300 });
  
    const invalidDuration = await Effect.runPromiseExit(validateTimerChangeEffect(state, "fac1", 0));
    expect(Exit.isFailure(invalidDuration)).toBe(true);
  
    const nonFacilitator = await Effect.runPromiseExit(validateTimerChangeEffect({
      ...state,
      participants: [...state.participants, { id: "p2", displayName: "Pat", isFacilitator: false }],
    }, "p2", 300));
    expect(Exit.isFailure(nonFacilitator)).toBe(true);
  });
  
  it("validates review target changes through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "review",
      groups: [{ id: "group-1", name: "Group", columnId: "col-1", order: 0 }],
      items: [{ id: "item-1", text: "Card", authorId: "fac1", columnId: "col-1", groupId: null, order: 0 }],
    };
  
    await expect(Effect.runPromise(validateReviewTargetChangeEffect(state, "fac1", "group:group-1"))).resolves.toEqual({
      reviewTargetKey: "group:group-1",
    });
    await expect(Effect.runPromise(validateReviewTargetChangeEffect(state, "fac1", null))).resolves.toEqual({
      reviewTargetKey: null,
    });
  
    const missingTarget = await Effect.runPromiseExit(validateReviewTargetChangeEffect(state, "fac1", "item:missing"));
    expect(Exit.isFailure(missingTarget)).toBe(true);
  });
   });
