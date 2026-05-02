// @ts-expect-error -- cloudflare:workers vitest module
import { env } from "cloudflare:workers";
import { Effect, Exit } from "effect";
import { describe, it, expect } from "vitest";
import { getDefaultColumns, groupVoteTarget, itemVoteTarget } from "../src/domain";
import type { RoomState } from "../src/domain";
import {
  parseClientWebSocketMessageEffect,
  authorizeParticipantEffect,
  validatePhaseChangeEffect,
  validateRankingMethodChangeEffect,
  validateColumnCreateEffect,
  validateColumnDeleteEffect,
  validateColumnEditEffect,
  validateColumnReorderEffect,
  validateGroupCreateEffect,
  validateGroupDeleteEffect,
  validateGroupEditEffect,
  validateGroupReorderEffect,
  validateItemMoveEffect,
  validateItemReorderEffect,
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
  validateVoteBudgetChangeEffect,
} from "./validation";

describe("RetroRoom Durable Object v2 schema", () => {
  it("parses valid websocket client messages through Effect", async () => {
    await expect(Effect.runPromise(parseClientWebSocketMessageEffect(JSON.stringify({
      type: "create-action",
      text: "Follow up",
    })))).resolves.toEqual({
      type: "create-action",
      text: "Follow up",
    });
  });

  it("rejects malformed websocket client messages through Effect", async () => {
    const exit = await Effect.runPromiseExit(parseClientWebSocketMessageEffect(JSON.stringify({
      type: "set-phase",
      phase: "done",
    })));

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects malformed Durable Object join request bodies through Effect", async () => {
    const stub = await initRaw("test-do-invalid-join-body");

    const response = await stub.fetch(new Request("http://do/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1" }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Valid JSON body is required",
    });
  });

  it("rejects malformed Durable Object mutation bodies through Effect before authorization", async () => {
    const stub = await initRaw("test-do-invalid-phase-body");

    const response = await stub.fetch(new Request("http://do/phase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac1", connectionToken: "wrong", phase: "done" }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Valid JSON body is required",
    });
  });

  it("authorizes participant credentials through Effect", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      connectionTokens: { p1: "token" },
    };

    await expect(Effect.runPromise(authorizeParticipantEffect(state, "p1", "token"))).resolves.toEqual({
      participantId: "p1",
    });

    const missingParticipant = await Effect.runPromiseExit(authorizeParticipantEffect(state, "missing", "token"));
    expect(Exit.isFailure(missingParticipant)).toBe(true);

    const invalidToken = await Effect.runPromiseExit(authorizeParticipantEffect(state, "p1", "wrong"));
    expect(Exit.isFailure(invalidToken)).toBe(true);

    const missingRoom = await Effect.runPromiseExit(authorizeParticipantEffect(null, "p1", "token"));
    expect(Exit.isFailure(missingRoom)).toBe(true);
  });

  it("validates vote budget mutations through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "setup",
    };

    await expect(Effect.runPromise(validateVoteBudgetChangeEffect(state, "fac1", 12))).resolves.toEqual({ budget: 12 });

    const invalidBudget = await Effect.runPromiseExit(validateVoteBudgetChangeEffect(state, "fac1", 0));
    expect(Exit.isFailure(invalidBudget)).toBe(true);

    const nonFacilitator = await Effect.runPromiseExit(validateVoteBudgetChangeEffect({
      ...state,
      participants: [...state.participants, { id: "p2", displayName: "Pat", isFacilitator: false }],
    }, "p2", 12));
    expect(Exit.isFailure(nonFacilitator)).toBe(true);
  });

  it("validates ranking method mutations through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "setup",
    };

    await expect(Effect.runPromise(validateRankingMethodChangeEffect(state, "fac1", "pairwise"))).resolves.toEqual({
      rankingMethod: "pairwise",
    });

    const lateChange = await Effect.runPromiseExit(validateRankingMethodChangeEffect({
      ...state,
      phase: "write",
    }, "fac1", "pairwise"));
    expect(Exit.isFailure(lateChange)).toBe(true);
  });

  it("validates phase transitions through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "setup",
      columns: [{ id: "col-1", name: "Mad", order: 0 }],
      rankingMethod: "score",
    };

    await expect(Effect.runPromise(validatePhaseChangeEffect(state, "fac1", "write", 0))).resolves.toEqual({ phase: "write" });

    const invalidTransition = await Effect.runPromiseExit(validatePhaseChangeEffect(state, "fac1", "vote", 0));
    expect(Exit.isFailure(invalidTransition)).toBe(true);

    const noColumns = await Effect.runPromiseExit(validatePhaseChangeEffect({ ...state, columns: [] }, "fac1", "write", 0));
    expect(Exit.isFailure(noColumns)).toBe(true);
  });

  it("validates column creation through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "setup",
      columns: [],
    };

    await expect(Effect.runPromise(validateColumnCreateEffect(state, "fac1", "  New lane  "))).resolves.toEqual({
      name: "New lane",
      order: 0,
    });

    const blankName = await Effect.runPromiseExit(validateColumnCreateEffect(state, "fac1", "   "));
    expect(Exit.isFailure(blankName)).toBe(true);

    const nonFacilitator = await Effect.runPromiseExit(validateColumnCreateEffect({
      ...state,
      participants: [...state.participants, { id: "p2", displayName: "Pat", isFacilitator: false }],
    }, "p2", "New lane"));
    expect(Exit.isFailure(nonFacilitator)).toBe(true);

    const wrongPhase = await Effect.runPromiseExit(validateColumnCreateEffect({
      ...state,
      phase: "write",
    }, "fac1", "New lane"));
    expect(Exit.isFailure(wrongPhase)).toBe(true);
  });

  it("validates column edits through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "setup",
      columns: [{ id: "col-1", name: "Mad", order: 0 }],
    };

    await expect(Effect.runPromise(validateColumnEditEffect(state, "fac1", "col-1", "  Glad  "))).resolves.toEqual({
      columns: [{ id: "col-1", name: "Glad", order: 0 }],
      column: { id: "col-1", name: "Glad", order: 0 },
    });

    const missingColumn = await Effect.runPromiseExit(validateColumnEditEffect(state, "fac1", "missing", "Glad"));
    expect(Exit.isFailure(missingColumn)).toBe(true);

    const blankName = await Effect.runPromiseExit(validateColumnEditEffect(state, "fac1", "col-1", "   "));
    expect(Exit.isFailure(blankName)).toBe(true);

    const nonFacilitator = await Effect.runPromiseExit(validateColumnEditEffect({
      ...state,
      participants: [...state.participants, { id: "p2", displayName: "Pat", isFacilitator: false }],
    }, "p2", "col-1", "Glad"));
    expect(Exit.isFailure(nonFacilitator)).toBe(true);
  });

  it("validates column reorders through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "setup",
      columns: [
        { id: "col-1", name: "Mad", order: 0 },
        { id: "col-2", name: "Glad", order: 1 },
      ],
    };

    await expect(Effect.runPromise(validateColumnReorderEffect(state, "fac1", ["col-2", "col-1"]))).resolves.toEqual({
      columns: [
        { id: "col-2", name: "Glad", order: 0 },
        { id: "col-1", name: "Mad", order: 1 },
      ],
    });

    const missingColumn = await Effect.runPromiseExit(validateColumnReorderEffect(state, "fac1", ["col-2"]));
    expect(Exit.isFailure(missingColumn)).toBe(true);

    const duplicateColumn = await Effect.runPromiseExit(validateColumnReorderEffect(state, "fac1", ["col-1", "col-1"]));
    expect(Exit.isFailure(duplicateColumn)).toBe(true);
  });

  it("validates column deletes through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "setup",
      columns: [
        { id: "col-1", name: "Mad", order: 0 },
        { id: "col-2", name: "Glad", order: 1 },
      ],
      groups: [{ id: "group-1", columnId: "col-1", name: "Theme", order: 0 }],
      items: [
        { id: "item-1", text: "Keep", authorId: "fac1", columnId: "col-2", groupId: null, order: 0 },
        { id: "item-2", text: "Remove", authorId: "fac1", columnId: "col-1", groupId: "group-1", order: 0 },
      ],
      votes: [
        { participantId: "fac1", target: itemVoteTarget("item-1"), weight: 1 },
        { participantId: "fac1", target: groupVoteTarget("group-1"), weight: 1 },
      ],
    };

    await expect(Effect.runPromise(validateColumnDeleteEffect(state, "fac1", "col-1"))).resolves.toEqual({
      columns: [{ id: "col-2", name: "Glad", order: 0 }],
      groups: [],
      items: [{ id: "item-1", text: "Keep", authorId: "fac1", columnId: "col-2", groupId: null, order: 0 }],
      votes: [{ participantId: "fac1", target: itemVoteTarget("item-1"), weight: 1 }],
    });

    const missingColumn = await Effect.runPromiseExit(validateColumnDeleteEffect(state, "fac1", "missing"));
    expect(Exit.isFailure(missingColumn)).toBe(true);

    const wrongPhase = await Effect.runPromiseExit(validateColumnDeleteEffect({ ...state, phase: "write" }, "fac1", "col-1"));
    expect(Exit.isFailure(wrongPhase)).toBe(true);
  });

  it("validates group creation through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      phase: "organise",
      columns: [{ id: "col-1", name: "Mad", order: 0 }],
      groups: [{ id: "group-1", columnId: "col-1", name: "Existing", order: 0 }],
    };

    await expect(Effect.runPromise(validateGroupCreateEffect(state, "p1", "  New theme  ", "col-1"))).resolves.toEqual({
      name: "New theme",
      columnId: "col-1",
      order: 1,
    });

    const wrongPhase = await Effect.runPromiseExit(validateGroupCreateEffect({ ...state, phase: "write" }, "p1", "New theme", "col-1"));
    expect(Exit.isFailure(wrongPhase)).toBe(true);

    const duplicateName = await Effect.runPromiseExit(validateGroupCreateEffect(state, "p1", "Existing", "col-1"));
    expect(Exit.isFailure(duplicateName)).toBe(true);

    const missingColumn = await Effect.runPromiseExit(validateGroupCreateEffect(state, "p1", "New theme", "missing"));
    expect(Exit.isFailure(missingColumn)).toBe(true);
  });

  it("validates group edits through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      phase: "organise",
      groups: [
        { id: "group-1", columnId: "col-1", name: "Existing", order: 0 },
        { id: "group-2", columnId: "col-1", name: "Other", order: 1 },
      ],
    };

    await expect(Effect.runPromise(validateGroupEditEffect(state, "p1", "group-1", "  Renamed  "))).resolves.toEqual({
      groups: [
        { id: "group-1", columnId: "col-1", name: "Renamed", order: 0 },
        { id: "group-2", columnId: "col-1", name: "Other", order: 1 },
      ],
      group: { id: "group-1", columnId: "col-1", name: "Renamed", order: 0 },
    });

    const duplicateName = await Effect.runPromiseExit(validateGroupEditEffect(state, "p1", "group-1", "Other"));
    expect(Exit.isFailure(duplicateName)).toBe(true);

    const missingGroup = await Effect.runPromiseExit(validateGroupEditEffect(state, "p1", "missing", "Renamed"));
    expect(Exit.isFailure(missingGroup)).toBe(true);
  });

  it("validates group deletes through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      phase: "organise",
      groups: [
        { id: "group-1", columnId: "col-1", name: "Existing", order: 0 },
        { id: "group-2", columnId: "col-1", name: "Other", order: 1 },
      ],
      items: [
        { id: "item-1", text: "Grouped", authorId: "p1", columnId: "col-1", groupId: "group-1", order: 0 },
        { id: "item-2", text: "Free", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
      ],
      votes: [
        { participantId: "p1", target: groupVoteTarget("group-1"), weight: 1 },
        { participantId: "p1", target: itemVoteTarget("item-2"), weight: 1 },
      ],
    };

    await expect(Effect.runPromise(validateGroupDeleteEffect(state, "p1", "group-1"))).resolves.toEqual({
      groups: [{ id: "group-2", columnId: "col-1", name: "Other", order: 0 }],
      items: [
        { id: "item-1", text: "Grouped", authorId: "p1", columnId: "col-1", groupId: null, order: 1 },
        { id: "item-2", text: "Free", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
      ],
      votes: [{ participantId: "p1", target: itemVoteTarget("item-2"), weight: 1 }],
    });

    const missingGroup = await Effect.runPromiseExit(validateGroupDeleteEffect(state, "p1", "missing"));
    expect(Exit.isFailure(missingGroup)).toBe(true);

    const wrongPhase = await Effect.runPromiseExit(validateGroupDeleteEffect({ ...state, phase: "write" }, "p1", "group-1"));
    expect(Exit.isFailure(wrongPhase)).toBe(true);
  });

  it("validates group reorders through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      phase: "organise",
      version: 7,
      groups: [
        { id: "group-1", columnId: "col-1", name: "First", order: 0 },
        { id: "group-2", columnId: "col-1", name: "Second", order: 1 },
      ],
    };

    await expect(Effect.runPromise(validateGroupReorderEffect(state, "p1", ["group-2", "group-1"], 7))).resolves.toEqual({
      groups: [
        { id: "group-1", columnId: "col-1", name: "First", order: 1 },
        { id: "group-2", columnId: "col-1", name: "Second", order: 0 },
      ],
    });

    const staleVersion = await Effect.runPromiseExit(validateGroupReorderEffect(state, "p1", ["group-2", "group-1"], 6));
    expect(Exit.isFailure(staleVersion)).toBe(true);

    const missingGroup = await Effect.runPromiseExit(validateGroupReorderEffect(state, "p1", ["group-2"], 7));
    expect(Exit.isFailure(missingGroup)).toBe(true);
  });

  it("validates item reorders through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      phase: "organise",
      version: 5,
      items: [
        { id: "item-1", text: "First", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
        { id: "item-2", text: "Second", authorId: "p1", columnId: "col-1", groupId: null, order: 1 },
      ],
    };

    await expect(Effect.runPromise(validateItemReorderEffect(state, "p1", ["item-2", "item-1"], {
      expectedVersion: 5,
      sourceColumnId: "col-1",
      sourceGroupId: null,
    }))).resolves.toEqual({
      items: [
        { id: "item-2", text: "Second", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
        { id: "item-1", text: "First", authorId: "p1", columnId: "col-1", groupId: null, order: 1 },
      ],
    });

    const staleVersion = await Effect.runPromiseExit(validateItemReorderEffect(state, "p1", ["item-2", "item-1"], {
      expectedVersion: 4,
      sourceColumnId: "col-1",
      sourceGroupId: null,
    }));
    expect(Exit.isFailure(staleVersion)).toBe(true);

    const missingItem = await Effect.runPromiseExit(validateItemReorderEffect(state, "p1", ["item-2"], {
      expectedVersion: 5,
      sourceColumnId: "col-1",
      sourceGroupId: null,
    }));
    expect(Exit.isFailure(missingItem)).toBe(true);
  });

  it("validates item moves through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      phase: "organise",
      version: 5,
      groups: [{ id: "group-1", columnId: "col-1", name: "Theme", order: 0 }],
      items: [
        { id: "item-1", text: "First", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
        { id: "item-2", text: "Second", authorId: "p1", columnId: "col-1", groupId: "group-1", order: 0 },
      ],
    };

    await expect(Effect.runPromise(validateItemMoveEffect(state, "p1", "item-1", "group-1", 1, {
      expectedVersion: 5,
      sourceGroupId: null,
      sourceIndex: 0,
    }))).resolves.toEqual({
      items: [
        { id: "item-2", text: "Second", authorId: "p1", columnId: "col-1", groupId: "group-1", order: 0 },
        { id: "item-1", text: "First", authorId: "p1", columnId: "col-1", groupId: "group-1", order: 1 },
      ],
    });

    const staleSource = await Effect.runPromiseExit(validateItemMoveEffect(state, "p1", "item-1", "group-1", 0, {
      expectedVersion: 5,
      sourceGroupId: "group-1",
      sourceIndex: 0,
    }));
    expect(Exit.isFailure(staleSource)).toBe(true);

    const badIndex = await Effect.runPromiseExit(validateItemMoveEffect(state, "p1", "item-1", "group-1", 5, {
      expectedVersion: 5,
      sourceGroupId: null,
      sourceIndex: 0,
    }));
    expect(Exit.isFailure(badIndex)).toBe(true);
  });

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

  async function initRaw(roomId: string) {
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.initRoom(roomId);
    return stub;
  }

  async function init(roomId: string) {
    const stub = await initRaw(roomId);
    await stub.setPhaseForTest("write");
    return withWritePhaseColumnSetup(stub);
  }

  function withWritePhaseColumnSetup<T extends {
    getRoomState: () => Promise<RoomState>;
    setPhaseForTest: (phase: RoomState["phase"]) => Promise<void>;
    createColumn: (...args: never[]) => Promise<unknown>;
    editColumn: (...args: never[]) => Promise<unknown>;
    reorderColumns: (...args: never[]) => Promise<unknown>;
    deleteColumn: (...args: never[]) => Promise<unknown>;
  }>(stub: T): T {
    async function runColumnSetup(method: keyof Pick<T, "createColumn" | "editColumn" | "reorderColumns" | "deleteColumn">, args: never[]) {
      const phase = (await stub.getRoomState()).phase;
      if (phase !== "write" || args[0] !== "fac1") {
        return stub[method](...args);
      }
      await stub.setPhaseForTest("setup");
      const result = await stub[method](...args);
      await stub.setPhaseForTest("write");
      return result;
    }

    return new Proxy(stub, {
      get(target, prop, receiver) {
        if (prop === "createColumn" || prop === "editColumn" || prop === "reorderColumns" || prop === "deleteColumn") {
          return (...args: never[]) => runColumnSetup(prop, args);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  async function freshMovePreconditions(stub: { getRoomState: () => Promise<RoomState> }, itemId: string) {
    const state = await stub.getRoomState();
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`Missing item ${itemId}`);
    return {
      expectedVersion: state.version,
      sourceGroupId: item.groupId,
      sourceIndex: item.order,
    };
  }

  async function freshItemReorderPreconditions(stub: { getRoomState: () => Promise<RoomState> }, itemId: string) {
    const state = await stub.getRoomState();
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`Missing item ${itemId}`);
    return {
      expectedVersion: state.version,
      sourceColumnId: item.columnId,
      sourceGroupId: item.groupId,
    };
  }

  async function freshGroupReorderVersion(stub: { getRoomState: () => Promise<RoomState> }) {
    return (await stub.getRoomState()).version;
  }

  async function deleteAllColumns(stub: {
    getRoomState: () => Promise<RoomState>;
    deleteColumn: (participantId: string, columnId: string) => Promise<{ success: boolean; error?: string }>;
  }, participantId = "fac1") {
    const state = await stub.getRoomState();
    for (const column of state.columns) {
      const result = await stub.deleteColumn(participantId, column.id);
      expect(result.success).toBe(true);
    }
  }

  it("initializes new rooms as v2 with customer-ready default columns", async () => {
    const stub = await initRaw("test-v2-empty-room");

    const state = await stub.getRoomState();
    expect(state.schemaVersion).toBe(2);
    expect(state.roomId).toBe("test-v2-empty-room");
    expect(state.phase).toBe("setup");
    expect(state.columns).toEqual(getDefaultColumns());
    expect(state.groups).toEqual([]);
    expect(state.items).toEqual([]);
    expect(state.votes).toEqual([]);
    expect(state.rankingMethod).toBe("score");
    expect(state.pairwiseChoices).toEqual([]);
    expect(state.actions).toEqual([]);
    expect(state.reactions).toEqual([]);
    expect(state.columns.map((column) => column.name)).toEqual(["Mad", "Glad", "Sad"]);
  });

  it("resets incompatible legacy board content on load", async () => {
    const roomId = "test-v2-legacy-reset";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "vote",
      items: [{ id: "legacy-item", text: "Old item", authorId: "fac1", columnId: "start", groupId: "start", order: 0 }],
      groups: [{ id: "start", name: "Start", order: 0 }],
      votes: [{ participantId: "fac1", itemId: "legacy-item", count: 3 }],
      version: 41,
    } as never);

    const state = await stub.getRoomState();
    expect(state.schemaVersion).toBe(2);
    expect(state.phase).toBe("setup");
    expect(state.participants).toEqual([{ id: "fac1", displayName: "Facilitator", isFacilitator: true }]);
    expect(state.columns).toEqual(getDefaultColumns());
    expect(state.groups).toEqual([]);
    expect(state.items).toEqual([]);
    expect(state.votes).toEqual([]);
    expect(state.actions).toEqual([]);
    expect(state.reactions).toEqual([]);
  });

  it("toggles realtime reactions on cards and groups while validating targets", async () => {
    const stub = await init("test-v2-reactions");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const columnId = (await stub.getRoomState()).columns[0]!.id;
    const item = await stub.addItem("fac1", "Reactable card", columnId);
    expect(item.success).toBe(true);

    await expect(stub.toggleReaction("p2", itemVoteTarget(item.item!.id), "👍")).resolves.toMatchObject({ success: true });
    await expect(stub.toggleReaction("fac1", itemVoteTarget(item.item!.id), "👍")).resolves.toMatchObject({ success: true });
    let state = await stub.getRoomState();
    expect(state.reactions).toEqual([
      { participantId: "p2", target: itemVoteTarget(item.item!.id), emoji: "👍" },
      { participantId: "fac1", target: itemVoteTarget(item.item!.id), emoji: "👍" },
    ]);

    await expect(stub.toggleReaction("p2", itemVoteTarget(item.item!.id), "👍")).resolves.toMatchObject({ success: true });
    state = await stub.getRoomState();
    expect(state.reactions).toEqual([{ participantId: "fac1", target: itemVoteTarget(item.item!.id), emoji: "👍" }]);

    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Reactable group", columnId);
    expect(group.success).toBe(true);
    await expect(stub.toggleReaction("p2", groupVoteTarget(group.group!.id), "🔥")).resolves.toMatchObject({ success: true });
    await expect(stub.toggleReaction("p2", groupVoteTarget(group.group!.id), "not-emoji")).resolves.toMatchObject({ success: false });
    await expect(stub.toggleReaction("p2", itemVoteTarget("missing-item"), "👍")).resolves.toMatchObject({ success: false });

    state = await stub.getRoomState();
    expect(state.reactions).toEqual([
      { participantId: "fac1", target: itemVoteTarget(item.item!.id), emoji: "👍" },
      { participantId: "p2", target: groupVoteTarget(group.group!.id), emoji: "🔥" },
    ]);
  });

  it("creates, edits, and deletes collaborative action items only during review", async () => {
    const stub = await init("test-v2-review-actions");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");

    const beforeReview = await stub.getRoomState();
    await expect(stub.createAction("p2", "Follow up before review")).resolves.toMatchObject({ success: false });
    expect(await stub.getRoomState()).toEqual(beforeReview);

    await stub.setPhase("fac1", "organise");
    await stub.setPhase("fac1", "vote");
    await stub.setPhase("fac1", "review");

    const created = await stub.createAction("p2", "  Book incident follow-up  ");
    expect(created.success).toBe(true);
    expect(created.action).toMatchObject({
      text: "Book incident follow-up",
      authorId: "p2",
      order: 0,
    });

    const edited = await stub.editAction("fac1", created.action!.id, "Confirm owner for rollout checklist");
    expect(edited.success).toBe(true);

    let state = await stub.getRoomState();
    expect(state.actions).toEqual([
      {
        id: created.action!.id,
        text: "Confirm owner for rollout checklist",
        authorId: "p2",
        order: 0,
      },
    ]);

    const second = await stub.createAction("fac1", "Second action");
    expect(second.success).toBe(true);
    const deletedByOtherParticipant = await stub.deleteAction("p2", second.action!.id);
    expect(deletedByOtherParticipant.success).toBe(true);

    state = await stub.getRoomState();
    expect(state.actions).toEqual([
      {
        id: created.action!.id,
        text: "Confirm owner for rollout checklist",
        authorId: "p2",
        order: 0,
      },
    ]);

    await stub.setPhase("fac1", "finalize");
    const beforeLateDelete = await stub.getRoomState();
    await expect(stub.deleteAction("fac1", created.action!.id)).resolves.toMatchObject({ success: false });
    expect(await stub.getRoomState()).toEqual(beforeLateDelete);
  });

  it("lets only the facilitator move the shared review slide during review", async () => {
    const stub = await init("test-v2-review-target-sync");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const columnId = (await stub.getRoomState()).columns[0]!.id;
    const item = await stub.addItem("fac1", "Review target card", columnId);
    expect(item.success).toBe(true);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Review target group", columnId);
    expect(group.success).toBe(true);
    await stub.setPhase("fac1", "vote");
    await stub.setPhase("fac1", "review");

    const targetKey = "group:" + group.group!.id;
    await expect(stub.setReviewTarget("p2", targetKey)).resolves.toMatchObject({
      success: false,
      error: "Only the facilitator can change review slide",
    });
    expect((await stub.getRoomState()).reviewTargetKey).toBeNull();

    await expect(stub.setReviewTarget("fac1", targetKey)).resolves.toMatchObject({ success: true });
    expect((await stub.getRoomState()).reviewTargetKey).toBe(targetKey);
    await expect(stub.setReviewTarget("fac1", "item:missing")).resolves.toMatchObject({
      success: false,
      error: "Review target not found",
    });
  });

  it("locks setup-only decisions after setup and requires at least one column before write", async () => {
    const stub = await initRaw("test-v2-setup-locks");
    await stub.join("fac1", "Facilitator");

    expect(await stub.setVoteBudget("fac1", 8)).toMatchObject({ success: true });
    await deleteAllColumns(stub);
    const blocked = await stub.setPhase("fac1", "write");
    expect(blocked).toMatchObject({ success: false, error: "Add at least one column before starting write phase" });
    expect((await stub.getRoomState()).phase).toBe("setup");

    const column = await stub.createColumn("fac1", "Only lane");
    expect(column.success).toBe(true);
    expect(await stub.setPhase("fac1", "write")).toMatchObject({ success: true });
    expect(await stub.setVoteBudget("fac1", 3)).toMatchObject({ success: false, error: "Vote budget can only be changed during setup" });
    expect((await stub.getRoomState()).voteBudget).toBe(8);
  });

  it("purges stored room data after the empty-room alarm fires", async () => {
    const roomId = "test-v2-empty-room-purge";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      purgeScheduledAt: Date.now() - 1,
    });

    const state = await stub.getRoomState();
    expect(state.purgeScheduledAt).toBeLessThanOrEqual(Date.now());

    await stub.runEmptyRoomAlarmForTest();

    await expect(stub.hasRoom()).resolves.toBe(false);
  });

  it("ignores stale empty-room alarms before the scheduled purge time", async () => {
    const roomId = "test-v2-empty-room-stale-alarm";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      purgeScheduledAt: Date.now() + 60_000,
    });

    await stub.runEmptyRoomAlarmForTest();

    await expect(stub.hasRoom()).resolves.toBe(true);
  });

  it("purges rooms past the absolute lifetime even when a websocket session is active", async () => {
    const roomId = "test-v2-absolute-room-lifetime-purge";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      startedAt: Date.now() - 13 * 60 * 60 * 1000,
      purgeScheduledAt: Date.now() + 60_000,
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      connectionTokens: { fac1: "token" },
    });

    const ticket = await stub.createWebSocketTicket("fac1", "token");
    expect(ticket).toMatchObject({ success: true });
    const response = await stub.fetch(new Request("http://do/ws", {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `ticket-${ticket.ticket}`,
      },
    }));
    expect(response.status).toBe(101);

    await stub.runEmptyRoomAlarmForTest();

    await expect(stub.hasRoom()).resolves.toBe(false);
  });

  it("purges rooms past the absolute lifetime on access even if the alarm was missed", async () => {
    const roomId = "test-v2-absolute-room-lifetime-access-purge";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      startedAt: Date.now() - 13 * 60 * 60 * 1000,
      purgeScheduledAt: null,
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      connectionTokens: { fac1: "token" },
    });

    await expect(stub.hasRoom()).resolves.toBe(false);
    await expect(stub.getRoomStateForParticipant("fac1", "token")).resolves.toMatchObject({
      success: false,
      error: "Room not found",
    });
  });

  it("lets only the facilitator manually purge room data", async () => {
    const stub = await initRaw("test-v2-manual-purge");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");

    await expect(stub.purgeByFacilitator("p2")).resolves.toMatchObject({
      success: false,
      error: "Only the facilitator can delete room data",
    });
    await expect(stub.hasRoom()).resolves.toBe(true);

    await expect(stub.purgeByFacilitator("fac1")).resolves.toMatchObject({ success: true });
    await expect(stub.hasRoom()).resolves.toBe(false);
  });

  it("enforces generous public-room caps before storing more data", async () => {
    const roomId = "test-v2-public-room-caps";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    const columns = getDefaultColumns();
    const firstColumnId = columns[0]!.id;

    await stub.seedStoredStateForTest({
      roomId,
      phase: "setup",
      columns,
      groups: [],
      items: [],
      votes: [],
      participants: Array.from({ length: 100 }, (_, index) => ({
        id: `p${index}`,
        displayName: `Participant ${index}`,
        isFacilitator: index === 0,
      })),
      facilitatorId: "p0",
    });
    await expect(stub.join("p-over-limit", "Overflow")).resolves.toMatchObject({
      success: false,
      error: "Rooms can have at most 100 participants",
    });

    await stub.seedStoredStateForTest({
      roomId,
      phase: "write",
      columns,
      groups: [],
      items: Array.from({ length: 400 }, (_, index) => ({
        id: `item-${index}`,
        text: `Item ${index}`,
        authorId: "fac1",
        columnId: firstColumnId,
        groupId: null,
        order: index,
      })),
      votes: [],
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
    });
    await expect(stub.addItem("fac1", "One too many", firstColumnId)).resolves.toMatchObject({
      success: false,
      error: "Rooms can have at most 400 cards",
    });
  });

  it("allows only one outstanding websocket ticket per participant and invalidates tickets on token rotation", async () => {
    const stub = await initRaw("test-v2-ws-ticket-rotation");
    const joined = await stub.join("fac1", "Facilitator");
    expect(joined.success).toBe(true);

    const firstTicket = await stub.createWebSocketTicket("fac1", joined.connectionToken);
    expect(firstTicket).toMatchObject({ success: true });
    const secondTicket = await stub.createWebSocketTicket("fac1", joined.connectionToken);
    expect(secondTicket).toMatchObject({ success: true });
    expect(secondTicket.ticket).not.toBe(firstTicket.ticket);

    const firstResponse = await stub.fetch(new Request("http://do/ws", {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `ticket-${firstTicket.ticket}`,
      },
    }));
    expect(firstResponse.status).toBe(403);

    const rejoined = await stub.join("fac1", "Facilitator", joined.connectionToken);
    expect(rejoined.success).toBe(true);
    const staleResponse = await stub.fetch(new Request("http://do/ws", {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `ticket-${secondTicket.ticket}`,
      },
    }));
    expect(staleResponse.status).toBe(403);
  });

  it("caps realtime messages per participant and per room window", async () => {
    const stub = await initRaw("test-v2-ws-room-rate-limit");
    const now = Date.now();

    for (let index = 0; index < 20; index += 1) {
      await expect(stub.allowWebSocketMessageForTest("fac1", now)).resolves.toEqual({ allowed: true });
    }
    await expect(stub.allowWebSocketMessageForTest("fac1", now)).resolves.toMatchObject({
      allowed: false,
      reason: "Too many realtime updates. Reconnect and slow down.",
    });
    await expect(stub.allowWebSocketMessageForTest("fac1", now + 10_000)).resolves.toEqual({ allowed: true });

    for (let index = 0; index < 60; index += 1) {
      await expect(stub.allowWebSocketMessageForTest(`p-${index}`, now + 20_000)).resolves.toEqual({ allowed: true });
    }
    await expect(stub.allowWebSocketMessageForTest("p-over-room-limit", now + 20_000)).resolves.toMatchObject({
      allowed: false,
      reason: "This room is receiving too many realtime updates. Please slow down.",
    });
  });

  it("caps pairwise target counts before storing large comparison sets", async () => {
    const roomId = "test-v2-pairwise-target-cap";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    const columns = getDefaultColumns();
    const firstColumnId = columns[0]!.id;

    await stub.seedStoredStateForTest({
      roomId,
      phase: "vote",
      rankingMethod: "pairwise",
      columns,
      groups: [],
      votes: [],
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      items: Array.from({ length: 51 }, (_, index) => ({
        id: `item-${index}`,
        text: `Item ${index}`,
        authorId: "fac1",
        columnId: firstColumnId,
        groupId: null,
        order: index,
      })),
    });

    await expect(stub.choosePairwise("fac1", itemVoteTarget("item-0"), itemVoteTarget("item-1"))).resolves.toMatchObject({
      success: false,
      error: "Pairwise ranking supports at most 50 cards or groups",
    });
  });

  it("blocks entering pairwise vote when the board has too many decision targets", async () => {
    const roomId = "test-v2-pairwise-target-cap-phase";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    const columns = getDefaultColumns();
    const firstColumnId = columns[0]!.id;

    await stub.seedStoredStateForTest({
      roomId,
      phase: "organise",
      rankingMethod: "pairwise",
      columns,
      groups: [],
      votes: [],
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      items: Array.from({ length: 51 }, (_, index) => ({
        id: `item-${index}`,
        text: `Item ${index}`,
        authorId: "fac1",
        columnId: firstColumnId,
        groupId: null,
        order: index,
      })),
    });

    await expect(stub.setPhase("fac1", "vote")).resolves.toMatchObject({
      success: false,
      error: "Pairwise ranking supports at most 50 cards or groups",
    });
    expect((await stub.getRoomState()).phase).toBe("organise");
  });

  it("stores distinct columns, column-scoped groups, original item column IDs, and group votes", async () => {
    const stub = await init("test-v2-shape");
    await stub.join("fac1", "Facilitator");

    const column = await stub.createColumn("fac1", "Went well");
    expect(column.success).toBe(true);
    const columnId = column.column!.id;

    const item = await stub.addItem("fac1", "Shipping was smooth", columnId);
    expect(item.success).toBe(true);
    expect(item.item!.columnId).toBe(columnId);
    expect(item.item!.groupId).toBeNull();

    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Release wins", columnId);
    expect(group.success).toBe(true);
    expect(group.group).toMatchObject({ name: "Release wins", columnId, order: 0 });

    const move = await stub.moveItemToGroup(
      "fac1",
      item.item!.id,
      group.group!.id,
      0,
      await freshMovePreconditions(stub, item.item!.id),
    );
    expect(move.success).toBe(true);

    await stub.setPhase("fac1", "vote");
    const vote = await stub.castVote("fac1", group.group!.id, 2);
    expect(vote.success).toBe(true);

    const state = await stub.getRoomState();
    expect(state.columns).toEqual([...getDefaultColumns(), { id: columnId, name: "Went well", order: 3 }]);
    expect(state.groups).toEqual([{ id: group.group!.id, name: "Release wins", columnId, order: 0 }]);
    expect(state.items).toEqual([
      expect.objectContaining({ id: item.item!.id, text: "Shipping was smooth", columnId, groupId: group.group!.id, order: 0 }),
    ]);
    expect(state.votes).toEqual([{ participantId: "fac1", target: groupVoteTarget(group.group!.id), count: 2 }]);
  });

  it("lets authors edit and delete only their own write-phase items", async () => {
    const stub = await init("test-v2-item-author-controls");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const columnId = (await stub.getRoomState()).columns[0]!.id;

    const authored = await stub.addItem("p2", "Original text", columnId);
    expect(authored.success).toBe(true);
    const itemId = authored.item!.id;

    expect(await stub.editItem("fac1", itemId, "Facilitator edit")).toMatchObject({
      success: false,
      error: "Only the author can edit this item",
    });
    expect(await stub.deleteItem("fac1", itemId)).toMatchObject({
      success: false,
      error: "Only the author can delete this item",
    });

    const edited = await stub.editItem("p2", itemId, "Updated text");
    expect(edited).toMatchObject({ success: true, item: expect.objectContaining({ text: "Updated text" }) });

    expect(await stub.deleteItem("p2", itemId)).toMatchObject({ success: true });
    expect((await stub.getRoomState()).items).toEqual([]);
  });

  it("normalizes persisted v2 ordering per column and per item list while preserving duplicate-looking identities", async () => {
    const stub = await init("test-v2-normalize-scoped-duplicate-identities");
    await stub.seedStoredStateForTest({
      roomId: "test-v2-normalize-scoped-duplicate-identities",
      participants: [
        { id: "fac1", displayName: "Facilitator", isFacilitator: true },
        { id: "p2", displayName: "Participant", isFacilitator: false },
      ],
      facilitatorId: "fac1",
      columns: [
        { id: "col-b", name: "Same", order: 20 },
        { id: "col-a", name: "Same", order: 10 },
      ],
      groups: [
        { id: "group-a-2", name: "Duplicate", columnId: "col-a", order: 30 },
        { id: "group-b-1", name: "Duplicate", columnId: "col-b", order: 40 },
        { id: "group-a-1", name: "Duplicate", columnId: "col-a", order: 10 },
      ],
      items: [
        { id: "item-a-2", text: "Same text", authorId: "fac1", columnId: "col-a", groupId: "group-a-1", order: 99 },
        { id: "item-b-1", text: "Same text", authorId: "p2", columnId: "col-b", groupId: "group-b-1", order: 5 },
        { id: "item-a-1", text: "Same text", authorId: "fac1", columnId: "col-a", groupId: "group-a-1", order: 1 },
        { id: "item-a-free", text: "Same text", authorId: "p2", columnId: "col-a", groupId: null, order: 7 },
      ],
      votes: [
        { participantId: "fac1", groupId: "group-a-1", count: 2 },
        { participantId: "p2", groupId: "group-b-1", count: 1 },
      ],
    });

    const state = await stub.getRoomState();

    expect(state.columns.map((column) => [column.id, column.order])).toEqual([
      ["col-a", 0],
      ["col-b", 1],
    ]);
    expect(state.groups
      .filter((group) => group.columnId === "col-a")
      .sort((a, b) => a.order - b.order)
      .map((group) => [group.id, group.order])).toEqual([
      ["group-a-1", 0],
      ["group-a-2", 1],
    ]);
    expect(state.groups
      .filter((group) => group.columnId === "col-b")
      .map((group) => [group.id, group.order])).toEqual([
      ["group-b-1", 0],
    ]);
    expect(state.items
      .filter((item) => item.groupId === "group-a-1")
      .sort((a, b) => a.order - b.order)
      .map((item) => [item.id, item.order])).toEqual([
      ["item-a-1", 0],
      ["item-a-2", 1],
    ]);
    expect(state.items.find((item) => item.id === "item-b-1")).toMatchObject({
      text: "Same text",
      columnId: "col-b",
      groupId: "group-b-1",
      order: 0,
    });
    expect(state.votes).toEqual([
      { participantId: "fac1", target: groupVoteTarget("group-a-1"), count: 2 },
      { participantId: "p2", target: groupVoteTarget("group-b-1"), count: 1 },
    ]);
  });

  it("enforces vote budget against group IDs without item-level allocations", async () => {
    const stub = await init("test-v2-group-vote-budget");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const column = await stub.createColumn("fac1", "Lane");
    const item = await stub.addItem("fac1", "Grouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Vote target", column.column!.id);
    await stub.moveItemToGroup("fac1", item.item!.id, group.group!.id, 0, await freshMovePreconditions(stub, item.item!.id));
    await stub.setPhase("fac1", "vote");

    const accepted = await stub.castVote("p2", group.group!.id, 5);
    expect(accepted.success).toBe(true);
    const beforeOverBudget = await stub.getRoomState();
    expect(beforeOverBudget.votes).toEqual([{ participantId: "p2", target: groupVoteTarget(group.group!.id), count: 5 }]);

    const rejected = await stub.castVote("p2", group.group!.id, 1);
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain("Over budget");
    expect(await stub.getRoomState()).toEqual(beforeOverBudget);

    const itemLevelAttempt = await stub.castVote("p2", itemVoteTarget(item.item!.id), 1);
    expect(itemLevelAttempt.success).toBe(false);
    expect(itemLevelAttempt.error).toBe("Cannot vote directly on a grouped item");
    expect(await stub.getRoomState()).toEqual(beforeOverBudget);
  });

  it("accepts valid ungrouped item votes and shares budget with group votes", async () => {
    const stub = await init("test-v2-mixed-vote-targets");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const column = await stub.createColumn("fac1", "Lane");
    const groupedItem = await stub.addItem("fac1", "Grouped topic", column.column!.id);
    const ungroupedItem = await stub.addItem("fac1", "Ungrouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group target", column.column!.id);
    await stub.moveItemToGroup("fac1", groupedItem.item!.id, group.group!.id, 0, await freshMovePreconditions(stub, groupedItem.item!.id));
    await stub.setPhase("fac1", "vote");

    expect(await stub.castVote("p2", groupVoteTarget(group.group!.id), 2)).toMatchObject({ success: true });
    expect(await stub.castVote("p2", itemVoteTarget(ungroupedItem.item!.id), 3)).toMatchObject({ success: true });
    const beforeOverBudget = await stub.getRoomState();
    expect(beforeOverBudget.votes).toEqual([
      { participantId: "p2", target: groupVoteTarget(group.group!.id), count: 2 },
      { participantId: "p2", target: itemVoteTarget(ungroupedItem.item!.id), count: 3 },
    ]);

    expect(await stub.castVote("p2", itemVoteTarget(ungroupedItem.item!.id), 1)).toMatchObject({ success: false, error: expect.stringContaining("Over budget") });
    expect(await stub.getRoomState()).toEqual(beforeOverBudget);
  });

  it("does not count participants who join after voting starts", async () => {
    const stub = await init("test-v2-vote-roster-freeze");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    const ungroupedItem = await stub.addItem("fac1", "Ungrouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    await stub.setPhase("fac1", "vote");
    await stub.join("late", "Late participant");

    await expect(stub.castVote("late", itemVoteTarget(ungroupedItem.item!.id), 1)).resolves.toMatchObject({
      success: false,
      error: "Participant joined after voting started",
    });
  });

  it("accepts pairwise choices between grouped and ungrouped targets across columns", async () => {
    const stub = await initRaw("test-v2-pairwise-cross-board-targets");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    await expect(stub.setRankingMethod("fac1", "pairwise")).resolves.toMatchObject({ success: true });

    const setupState = await stub.getRoomState();
    const mad = setupState.columns[0]!;
    const glad = setupState.columns[1]!;
    await stub.setPhase("fac1", "write");
    const groupedItem = await stub.addItem("fac1", "Grouped topic", mad.id);
    const ungroupedItem = await stub.addItem("fac1", "Other-column topic", glad.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group target", mad.id);
    await stub.moveItemToGroup("fac1", groupedItem.item!.id, group.group!.id, 0, await freshMovePreconditions(stub, groupedItem.item!.id));
    await stub.setPhase("fac1", "vote");

    await expect(stub.choosePairwise("p2", groupVoteTarget(group.group!.id), itemVoteTarget(ungroupedItem.item!.id))).resolves.toMatchObject({ success: true });
    await expect(stub.choosePairwise("p2", itemVoteTarget(groupedItem.item!.id), itemVoteTarget(ungroupedItem.item!.id))).resolves.toMatchObject({
      success: false,
      error: "Cannot vote directly on a grouped item",
    });

    const state = await stub.getRoomState();
    expect(state.pairwiseChoices).toEqual([
      { participantId: "p2", winner: groupVoteTarget(group.group!.id), loser: itemVoteTarget(ungroupedItem.item!.id) },
    ]);
  });

  it("does not expose other participants' pairwise ballots in participant state", async () => {
    const stub = await initRaw("test-v2-pairwise-privacy-projection");
    const fac = await stub.join("fac1", "Facilitator");
    const p2 = await stub.join("p2", "Participant");
    await expect(stub.setRankingMethod("fac1", "pairwise")).resolves.toMatchObject({ success: true });

    const setupState = await stub.getRoomState();
    const column = setupState.columns[0]!;
    await stub.setPhase("fac1", "write");
    const first = await stub.addItem("fac1", "First topic", column.id);
    const second = await stub.addItem("fac1", "Second topic", column.id);
    await stub.setPhase("fac1", "organise");
    await stub.setPhase("fac1", "vote");

    const firstTarget = itemVoteTarget(first.item!.id);
    const secondTarget = itemVoteTarget(second.item!.id);
    await expect(stub.choosePairwise("fac1", firstTarget, secondTarget)).resolves.toMatchObject({ success: true });
    await expect(stub.choosePairwise("p2", secondTarget, firstTarget)).resolves.toMatchObject({ success: true });

    const voteState = await stub.getRoomStateForParticipant("fac1", fac.connectionToken);
    expect(voteState.success).toBe(true);
    expect(voteState.state?.pairwiseChoices).toEqual([
      { participantId: "fac1", winner: firstTarget, loser: secondTarget },
    ]);

    await stub.setPhase("fac1", "review");
    const reviewState = await stub.getRoomStateForParticipant("fac1", fac.connectionToken);
    expect(reviewState.success).toBe(true);
    expect(reviewState.state?.pairwiseChoices).toHaveLength(2);
    expect(reviewState.state?.pairwiseChoices.some((choice) => choice.participantId === "fac1" || choice.participantId === "p2")).toBe(false);
    expect(reviewState.state?.pairwiseChoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ winner: firstTarget, loser: secondTarget }),
        expect.objectContaining({ winner: secondTarget, loser: firstTarget }),
      ]),
    );

    const p2ReviewState = await stub.getRoomStateForParticipant("p2", p2.connectionToken);
    expect(p2ReviewState.success).toBe(true);
    expect(p2ReviewState.state?.pairwiseChoices.some((choice) => choice.participantId === "fac1" || choice.participantId === "p2")).toBe(false);
  });

  it("compacts pairwise review projections to aggregate counts instead of expanded ballots", async () => {
    const stub = await initRaw("test-v2-pairwise-compact-review-projection");
    const fac = await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant 2");
    await stub.join("p3", "Participant 3");
    await expect(stub.setRankingMethod("fac1", "pairwise")).resolves.toMatchObject({ success: true });

    const setupState = await stub.getRoomState();
    const column = setupState.columns[0]!;
    await stub.setPhase("fac1", "write");
    const first = await stub.addItem("fac1", "First topic", column.id);
    const second = await stub.addItem("fac1", "Second topic", column.id);
    await stub.setPhase("fac1", "organise");
    await stub.setPhase("fac1", "vote");

    const firstTarget = itemVoteTarget(first.item!.id);
    const secondTarget = itemVoteTarget(second.item!.id);
    await expect(stub.choosePairwise("fac1", firstTarget, secondTarget)).resolves.toMatchObject({ success: true });
    await expect(stub.choosePairwise("p2", firstTarget, secondTarget)).resolves.toMatchObject({ success: true });
    await expect(stub.choosePairwise("p3", firstTarget, secondTarget)).resolves.toMatchObject({ success: true });

    await stub.setPhase("fac1", "review");
    const reviewState = await stub.getRoomStateForParticipant("fac1", fac.connectionToken);

    expect(reviewState.success).toBe(true);
    expect(reviewState.state?.pairwiseChoices).toEqual([
      { participantId: "__anonymous__-0", winner: firstTarget, loser: secondTarget, count: 3 },
    ]);
  });

  it("rejects invalid mixed vote targets and counts without mutating state or version", async () => {
    const stub = await init("test-v2-invalid-mixed-vote-targets");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    const groupedItem = await stub.addItem("fac1", "Grouped topic", column.column!.id);
    const ungroupedItem = await stub.addItem("fac1", "Ungrouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group target", column.column!.id);
    await stub.moveItemToGroup("fac1", groupedItem.item!.id, group.group!.id, 0, await freshMovePreconditions(stub, groupedItem.item!.id));
    await stub.setPhase("fac1", "vote");

    const before = await stub.getRoomState();
    const rejectedAttempts = [
      () => stub.castVote("missing", groupVoteTarget(group.group!.id), 1),
      () => stub.castVote("fac1", groupVoteTarget("missing-group"), 1),
      () => stub.castVote("fac1", itemVoteTarget("missing-item"), 1),
      () => stub.castVote("fac1", itemVoteTarget(groupedItem.item!.id), 1),
      () => stub.castVote("fac1", itemVoteTarget(ungroupedItem.item!.id), 0),
      () => stub.castVote("fac1", itemVoteTarget(ungroupedItem.item!.id), 1.5),
      () => stub.removeVote("fac1", itemVoteTarget(groupedItem.item!.id)),
      () => stub.removeVote("fac1", itemVoteTarget(ungroupedItem.item!.id)),
    ];

    for (const attempt of rejectedAttempts) {
      const result = await attempt();
      expect(result.success).toBe(false);
      expect(await stub.getRoomState()).toEqual(before);
    }
  });

  it("removes only the authenticated participant allocation for the selected mixed target", async () => {
    const stub = await init("test-v2-remove-mixed-votes");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const column = await stub.createColumn("fac1", "Lane");
    const ungroupedItem = await stub.addItem("fac1", "Ungrouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group target", column.column!.id);
    await stub.setPhase("fac1", "vote");
    await stub.castVote("fac1", groupVoteTarget(group.group!.id), 1);
    await stub.castVote("fac1", itemVoteTarget(ungroupedItem.item!.id), 2);
    await stub.castVote("p2", itemVoteTarget(ungroupedItem.item!.id), 1);

    expect(await stub.removeVote("fac1", itemVoteTarget(ungroupedItem.item!.id))).toMatchObject({ success: true });

    const state = await stub.getRoomState();
    expect(state.votes).toEqual([
      { participantId: "fac1", target: groupVoteTarget(group.group!.id), count: 1 },
      { participantId: "fac1", target: itemVoteTarget(ungroupedItem.item!.id), count: 1 },
      { participantId: "p2", target: itemVoteTarget(ungroupedItem.item!.id), count: 1 },
    ]);
  });

  it("projects other participants' votes anonymously in participant state", async () => {
    const stub = await init("test-v2-vote-privacy-projection");
    const fac = await stub.join("fac1", "Facilitator");
    const p2 = await stub.join("p2", "Participant");
    const column = await stub.createColumn("fac1", "Lane");
    const ungroupedItem = await stub.addItem("fac1", "Ungrouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group target", column.column!.id);
    await stub.setPhase("fac1", "vote");
    await stub.castVote("fac1", groupVoteTarget(group.group!.id), 2);
    await stub.castVote("p2", groupVoteTarget(group.group!.id), 1);
    await stub.castVote("p2", itemVoteTarget(ungroupedItem.item!.id), 1);

    const facState = await stub.getRoomStateForParticipant("fac1", fac.connectionToken);
    expect(facState.success).toBe(true);
    expect(facState.state?.votes).toEqual([
      { participantId: "fac1", target: groupVoteTarget(group.group!.id), count: 2 },
      { participantId: "__anonymous__", target: groupVoteTarget(group.group!.id), count: 1 },
      { participantId: "__anonymous__", target: itemVoteTarget(ungroupedItem.item!.id), count: 1 },
    ]);
    expect(facState.state?.votes.some((vote) => vote.participantId === "p2")).toBe(false);

    const p2State = await stub.getRoomStateForParticipant("p2", p2.connectionToken);
    expect(p2State.success).toBe(true);
    expect(p2State.state?.votes).toEqual([
      { participantId: "p2", target: groupVoteTarget(group.group!.id), count: 1 },
      { participantId: "p2", target: itemVoteTarget(ungroupedItem.item!.id), count: 1 },
      { participantId: "__anonymous__", target: groupVoteTarget(group.group!.id), count: 2 },
    ]);
  });

  it("rejects item adds without a valid existing column without changing state", async () => {
    const stub = await init("test-v2-add-item-column-required");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Valid lane");
    const beforeMissing = await stub.getRoomState();

    const missing = await stub.addItem("fac1", "No column");
    expect(missing.success).toBe(false);
    expect(missing.error).toBe("Column is required");
    expect(await stub.getRoomState()).toEqual(beforeMissing);

    const nullColumn = await stub.addItem("fac1", "Null column", null);
    expect(nullColumn.success).toBe(false);
    expect(nullColumn.error).toBe("Column is required");
    expect(await stub.getRoomState()).toEqual(beforeMissing);

    const malformed = await stub.addItem("fac1", "Malformed column", 123 as never);
    expect(malformed.success).toBe(false);
    expect(malformed.error).toBe("Column is required");
    expect(await stub.getRoomState()).toEqual(beforeMissing);

    const unknown = await stub.addItem("fac1", "Unknown column", "missing-column");
    expect(unknown.success).toBe(false);
    expect(unknown.error).toBe("Column not found");
    expect(await stub.getRoomState()).toEqual(beforeMissing);

    const valid = await stub.addItem("fac1", "Valid item", column.column!.id);
    expect(valid.success).toBe(true);
    expect(valid.item).toMatchObject({ text: "Valid item", columnId: column.column!.id, groupId: null });
  });

  it("normalizes persisted v2 state by dropping invalid columnless and orphaned items and related votes", async () => {
    const roomId = "test-v2-normalize-invalid-item-columns";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      columns: [
        { id: "col-1", name: "Keep", order: 0 },
        { id: "col-2", name: "Other", order: 1 },
      ],
      groups: [
        { id: "group-1", name: "Kept group", columnId: "col-1", order: 0 },
        { id: "orphan-group", name: "Orphan group", columnId: "missing-column", order: 1 },
      ],
      items: [
        { id: "valid-item", text: "Valid", authorId: "fac1", columnId: "col-1", groupId: "group-1", order: 0 },
        { id: "null-column", text: "Null", authorId: "fac1", columnId: null, groupId: null, order: 1 },
        { id: "missing-column", text: "Missing", authorId: "fac1", groupId: null, order: 2 },
        { id: "malformed-column", text: "Malformed", authorId: "fac1", columnId: 42, groupId: null, order: 3 },
        { id: "unknown-column", text: "Unknown", authorId: "fac1", columnId: "missing-column", groupId: null, order: 4 },
        { id: "cross-group", text: "Cross group", authorId: "fac1", columnId: "col-2", groupId: "group-1", order: 5 },
      ],
      votes: [
        { participantId: "fac1", groupId: "group-1", itemId: "group-1", count: 2 },
        { participantId: "fac1", groupId: "orphan-group", itemId: "orphan-group", count: 3 },
      ],
      version: 12,
    } as never);

    const state = await stub.getRoomState();
    expect(state.columns.map((column) => column.id)).toEqual(["col-1", "col-2"]);
    expect(state.groups).toEqual([{ id: "group-1", name: "Kept group", columnId: "col-1", order: 0 }]);
    expect(state.items).toEqual([
      expect.objectContaining({ id: "valid-item", columnId: "col-1", groupId: "group-1", order: 0 }),
      expect.objectContaining({ id: "cross-group", columnId: "col-2", groupId: null, order: 0 }),
    ]);
    expect(state.votes).toEqual([{ participantId: "fac1", target: groupVoteTarget("group-1"), count: 2 }]);
  });

  it("normalizes persisted mixed votes to canonical safe targets", async () => {
    const roomId = "test-v2-normalize-mixed-votes";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      participants: [
        { id: "fac1", displayName: "Facilitator", isFacilitator: true },
        { id: "p2", displayName: "Participant", isFacilitator: false },
      ],
      facilitatorId: "fac1",
      phase: "vote",
      columns: [{ id: "col-1", name: "Keep", order: 0 }],
      groups: [{ id: "group-1", name: "Kept group", columnId: "col-1", order: 0 }],
      items: [
        { id: "grouped-item", text: "Grouped", authorId: "fac1", columnId: "col-1", groupId: "group-1", order: 0 },
        { id: "free-item", text: "Free", authorId: "fac1", columnId: "col-1", groupId: null, order: 0 },
      ],
      votes: [
        { participantId: "fac1", groupId: "group-1", itemId: "group-1", count: 1 },
        { participantId: "fac1", target: groupVoteTarget("group-1"), count: 2 },
        { participantId: "p2", itemId: "free-item", count: 3 },
        { participantId: "p2", target: itemVoteTarget("free-item"), count: 1 },
        { participantId: "p2", itemId: "grouped-item", count: 1 },
        { participantId: "missing", target: groupVoteTarget("group-1"), count: 1 },
        { participantId: "p2", target: itemVoteTarget("missing-item"), count: 1 },
        { participantId: "p2", groupId: "group-1", itemId: "free-item", count: 1 },
        { participantId: "p2", target: itemVoteTarget("free-item"), count: 0 },
      ],
    });

    const state = await stub.getRoomState();

    expect(state.votes).toEqual([
      { participantId: "fac1", target: groupVoteTarget("group-1"), count: 3 },
      { participantId: "p2", target: itemVoteTarget("free-item"), count: 4 },
    ]);
  });

  it("rejects cross-column item moves without changing state", async () => {
    const stub = await init("test-v2-cross-column-reject");
    await stub.join("fac1", "Facilitator");
    const first = await stub.createColumn("fac1", "First");
    const second = await stub.createColumn("fac1", "Second");
    const item = await stub.addItem("fac1", "Scoped item", first.column!.id);
    await stub.setPhase("fac1", "organise");
    const otherGroup = await stub.createGroup("fac1", "Other column group", second.column!.id);
    const before = await stub.getRoomState();

    const move = await stub.moveItemToGroup(
      "fac1",
      item.item!.id,
      otherGroup.group!.id,
      0,
      await freshMovePreconditions(stub, item.item!.id),
    );

    expect(move.success).toBe(false);
    expect(move.error).toContain("another column");
    expect(await stub.getRoomState()).toEqual(before);
  });

  it("accepts same-column group reorder and rejects duplicate, omitted, unknown, and cross-column group payloads atomically", async () => {
    const stub = await init("test-v2-group-reorder-invariants");
    await stub.join("fac1", "Facilitator");
    const first = await stub.createColumn("fac1", "First");
    const second = await stub.createColumn("fac1", "Second");
    await stub.setPhase("fac1", "organise");
    const firstA = await stub.createGroup("fac1", "First A", first.column!.id);
    const firstB = await stub.createGroup("fac1", "First B", first.column!.id);
    const secondA = await stub.createGroup("fac1", "Second A", second.column!.id);

    const accepted = await stub.reorderGroups("fac1", [firstB.group!.id, firstA.group!.id], await freshGroupReorderVersion(stub));
    expect(accepted.success).toBe(true);
    const afterAccepted = await stub.getRoomState();
    expect(afterAccepted.groups
      .filter((group) => group.columnId === first.column!.id)
      .sort((a, b) => a.order - b.order)
      .map((group) => [group.id, group.order])).toEqual([
      [firstB.group!.id, 0],
      [firstA.group!.id, 1],
    ]);

    for (const groupIds of [
      [firstB.group!.id, firstB.group!.id],
      [firstB.group!.id],
      [firstB.group!.id, "missing-group"],
      [firstB.group!.id, secondA.group!.id],
    ]) {
      const before = await stub.getRoomState();
      const rejected = await stub.reorderGroups("fac1", groupIds, await freshGroupReorderVersion(stub));
      expect(rejected.success).toBe(false);
      expect(await stub.getRoomState()).toEqual(before);
    }
  });

  it("rejects stale item moves without changing state or version", async () => {
    const stub = await init("test-v2-stale-item-move-reject");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    const item = await stub.addItem("fac1", "Scoped item", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group", column.column!.id);
    const stalePreconditions = await freshMovePreconditions(stub, item.item!.id);
    const otherGroup = await stub.createGroup("fac1", "Other group", column.column!.id);
    expect(otherGroup.success).toBe(true);

    const before = await stub.getRoomState();
    const stale = await stub.moveItemToGroup("fac1", item.item!.id, group.group!.id, 0, stalePreconditions);

    expect(stale.success).toBe(false);
    expect(stale.error).toContain("Stale");
    expect(await stub.getRoomState()).toEqual(before);
  });

  it("rejects duplicate, omitted, unknown, and cross-column item reorder payloads atomically", async () => {
    const stub = await init("test-v2-item-reorder-invariants");
    await stub.join("fac1", "Facilitator");
    const first = await stub.createColumn("fac1", "First");
    const second = await stub.createColumn("fac1", "Second");
    const firstA = await stub.addItem("fac1", "First A", first.column!.id);
    const firstB = await stub.addItem("fac1", "First B", first.column!.id);
    const secondA = await stub.addItem("fac1", "Second A", second.column!.id);
    await stub.setPhase("fac1", "organise");

    for (const itemIds of [
      [firstA.item!.id, firstA.item!.id],
      [firstA.item!.id],
      [firstA.item!.id, "missing-item"],
      [firstA.item!.id, secondA.item!.id],
    ]) {
      const before = await stub.getRoomState();
      const rejected = await stub.reorderItems("fac1", itemIds, await freshItemReorderPreconditions(stub, firstA.item!.id));
      expect(rejected.success).toBe(false);
      expect(await stub.getRoomState()).toEqual(before);
    }

    const accepted = await stub.reorderItems("fac1", [firstB.item!.id, firstA.item!.id], await freshItemReorderPreconditions(stub, firstA.item!.id));
    expect(accepted.success).toBe(true);
    const afterAccepted = await stub.getRoomState();
    expect(afterAccepted.items
      .filter((item) => item.columnId === first.column!.id && item.groupId === null)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.id)).toEqual([firstB.item!.id, firstA.item!.id]);
  });

  it("rejects stale complete item reorders without changing state or version", async () => {
    const stub = await init("test-v2-stale-item-reorder-reject");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    const first = await stub.addItem("fac1", "First", column.column!.id);
    const second = await stub.addItem("fac1", "Second", column.column!.id);
    await stub.setPhase("fac1", "organise");

    const stalePreconditions = await freshItemReorderPreconditions(stub, first.item!.id);
    const group = await stub.createGroup("fac1", "Later group", column.column!.id);
    expect(group.success).toBe(true);

    const before = await stub.getRoomState();
    const stale = await stub.reorderItems("fac1", [second.item!.id, first.item!.id], stalePreconditions);

    expect(stale.success).toBe(false);
    expect(stale.error).toContain("Stale");
    expect(await stub.getRoomState()).toEqual(before);
  });

  it("rejects stale complete group reorders without changing state or version", async () => {
    const stub = await init("test-v2-stale-group-reorder-reject");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    await stub.setPhase("fac1", "organise");
    const first = await stub.createGroup("fac1", "First", column.column!.id);
    const second = await stub.createGroup("fac1", "Second", column.column!.id);

    const staleVersion = await freshGroupReorderVersion(stub);
    const third = await stub.createGroup("fac1", "Third", column.column!.id);
    expect(third.success).toBe(true);

    const before = await stub.getRoomState();
    const stale = await stub.reorderGroups("fac1", [second.group!.id, first.group!.id, third.group!.id], staleVersion);

    expect(stale.success).toBe(false);
    expect(stale.error).toContain("Stale");
    expect(await stub.getRoomState()).toEqual(before);
  });

  it("creates, renames, and deletes nested groups while preserving parent column invariants", async () => {
    const stub = await init("test-v2-nested-group-crud-invariants");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    const item = await stub.addItem("fac1", "Grouped item", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Original", column.column!.id);
    await stub.moveItemToGroup("fac1", item.item!.id, group.group!.id, 0, await freshMovePreconditions(stub, item.item!.id));
    await stub.setPhase("fac1", "vote");
    await stub.castVote("fac1", group.group!.id, 1);
    await stub.setPhaseForTest("organise");

    const renamed = await stub.editGroup("fac1", group.group!.id, "Renamed");
    expect(renamed).toMatchObject({ success: true, group: { id: group.group!.id, name: "Renamed", columnId: column.column!.id } });
    const beforeDelete = await stub.getRoomState();

    const deleted = await stub.deleteGroup("fac1", group.group!.id);
    expect(deleted.success).toBe(true);
    const afterDelete = await stub.getRoomState();
    expect(afterDelete.columns).toEqual(beforeDelete.columns);
    expect(afterDelete.groups).toEqual([]);
    expect(afterDelete.items).toEqual([
      expect.objectContaining({ id: item.item!.id, columnId: column.column!.id, groupId: null, order: 0 }),
    ]);
    expect(afterDelete.votes).toEqual([]);
    expect(afterDelete.version).toBe(beforeDelete.version + 1);
  });

  it("rejects missing or unknown group parent columns without changing state", async () => {
    const stub = await init("test-v2-group-parent-required");
    await stub.join("fac1", "Facilitator");
    await stub.createColumn("fac1", "Lane");
    await stub.setPhase("fac1", "organise");
    const before = await stub.getRoomState();

    await expect(stub.createGroup("fac1", "No parent")).resolves.toMatchObject({ success: false, error: "Column not found" });
    await expect(stub.createGroup("fac1", "Unknown parent", "missing-column")).resolves.toMatchObject({ success: false, error: "Column not found" });
    expect(await stub.getRoomState()).toEqual(before);
  });

  it("rejects duplicate sanitized group creates within the same column without changing state or version", async () => {
    const stub = await init("test-v2-duplicate-group-create-reject");
    await stub.join("fac1", "Facilitator");
    const firstColumn = await stub.createColumn("fac1", "First");
    const secondColumn = await stub.createColumn("fac1", "Second");
    await stub.setPhase("fac1", "organise");

    const firstGroup = await stub.createGroup("fac1", "Shared theme", firstColumn.column!.id);
    expect(firstGroup.success).toBe(true);
    const sameNameOtherColumn = await stub.createGroup("fac1", " Shared theme ", secondColumn.column!.id);
    expect(sameNameOtherColumn.success).toBe(true);

    const beforeDuplicate = await stub.getRoomState();
    const duplicate = await stub.createGroup("fac1", " Shared theme ", firstColumn.column!.id);

    expect(duplicate).toMatchObject({ success: false, error: "Group name already exists in this column" });
    expect(await stub.getRoomState()).toEqual(beforeDuplicate);
  });

  it("rejects duplicate sanitized group renames within the same column without changing groups, items, votes, or version", async () => {
    const stub = await init("test-v2-duplicate-group-rename-reject");
    await stub.join("fac1", "Facilitator");
    const firstColumn = await stub.createColumn("fac1", "First");
    const secondColumn = await stub.createColumn("fac1", "Second");
    const item = await stub.addItem("fac1", "Scoped item", firstColumn.column!.id);
    await stub.setPhase("fac1", "organise");
    const existing = await stub.createGroup("fac1", "Existing", firstColumn.column!.id);
    const target = await stub.createGroup("fac1", "Target", firstColumn.column!.id);
    const otherColumn = await stub.createGroup("fac1", "Existing", secondColumn.column!.id);
    expect(existing.success).toBe(true);
    expect(target.success).toBe(true);
    expect(otherColumn.success).toBe(true);
    await stub.moveItemToGroup("fac1", item.item!.id, target.group!.id, 0, await freshMovePreconditions(stub, item.item!.id));
    await stub.setPhase("fac1", "vote");
    await stub.castVote("fac1", target.group!.id, 1);
    await stub.setPhaseForTest("organise");

    const sameCurrentName = await stub.editGroup("fac1", existing.group!.id, " Existing ");
    expect(sameCurrentName).toMatchObject({ success: true, group: { id: existing.group!.id, name: "Existing" } });

    const beforeDuplicate = await stub.getRoomState();
    const duplicate = await stub.editGroup("fac1", target.group!.id, " Existing ");

    expect(duplicate).toMatchObject({ success: false, error: "Group name already exists in this column" });
    expect(await stub.getRoomState()).toEqual(beforeDuplicate);
  });

  it("allows the facilitator to create, rename, reorder, and delete columns during setup", async () => {
    const stub = await init("test-v2-column-crud-facilitator-phases");
    await stub.join("fac1", "Facilitator");
    await deleteAllColumns(stub);

    const first = await stub.createColumn("fac1", "First");
    const second = await stub.createColumn("fac1", "Second");
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const rename = await stub.editColumn("fac1", first.column!.id, "Renamed");
    expect(rename.success).toBe(true);
    expect(rename.column).toMatchObject({ id: first.column!.id, name: "Renamed" });

    const reorder = await stub.reorderColumns("fac1", [second.column!.id, first.column!.id]);
    expect(reorder.success).toBe(true);
    expect((await stub.getRoomState()).columns.map((column) => [column.id, column.order])).toEqual([
      [second.column!.id, 0],
      [first.column!.id, 1],
    ]);

    const third = await stub.createColumn("fac1", "Third");
    expect(third.success).toBe(true);

    const deleteSecond = await stub.deleteColumn("fac1", second.column!.id);
    expect(deleteSecond.success).toBe(true);
    expect((await stub.getRoomState()).columns.map((column) => column.id)).toEqual([first.column!.id, third.column!.id]);
  });

  it("deletes a column with contained groups, items, and votes while preserving unrelated columns", async () => {
    const stub = await init("test-v2-column-delete-cascade");
    await stub.join("fac1", "Facilitator");
    await deleteAllColumns(stub);
    const keep = await stub.createColumn("fac1", "Keep");
    const remove = await stub.createColumn("fac1", "Remove");
    const keepItem = await stub.addItem("fac1", "Keep item", keep.column!.id);
    const removeItem = await stub.addItem("fac1", "Remove item", remove.column!.id);
    const keepFreeItem = await stub.addItem("fac1", "Keep free item", keep.column!.id);
    const removeFreeItem = await stub.addItem("fac1", "Remove free item", remove.column!.id);

    await stub.setPhase("fac1", "organise");
    const keepGroup = await stub.createGroup("fac1", "Keep group", keep.column!.id);
    const removeGroup = await stub.createGroup("fac1", "Remove group", remove.column!.id);
    await stub.moveItemToGroup("fac1", keepItem.item!.id, keepGroup.group!.id, 0, await freshMovePreconditions(stub, keepItem.item!.id));
    await stub.moveItemToGroup("fac1", removeItem.item!.id, removeGroup.group!.id, 0, await freshMovePreconditions(stub, removeItem.item!.id));

    await stub.setPhase("fac1", "vote");
    await stub.castVote("fac1", keepGroup.group!.id, 1);
    await stub.castVote("fac1", removeGroup.group!.id, 2);
    await stub.castVote("fac1", itemVoteTarget(keepFreeItem.item!.id), 1);
    await stub.castVote("fac1", itemVoteTarget(removeFreeItem.item!.id), 1);
    await stub.setPhaseForTest("setup");

    const before = await stub.getRoomState();
    expect(before.votes.map((vote) => vote.target?.id).sort()).toEqual([
      keepFreeItem.item!.id,
      keepGroup.group!.id,
      removeFreeItem.item!.id,
      removeGroup.group!.id,
    ].sort());

    const deleted = await stub.deleteColumn("fac1", remove.column!.id);
    expect(deleted.success).toBe(true);

    const after = await stub.getRoomState();
    expect(after.columns).toEqual([{ id: keep.column!.id, name: "Keep", order: 0 }]);
    expect(after.groups).toEqual([{ id: keepGroup.group!.id, name: "Keep group", columnId: keep.column!.id, order: 0 }]);
    expect(after.items.sort((a, b) => a.text.localeCompare(b.text))).toEqual([
      expect.objectContaining({ id: keepFreeItem.item!.id, text: "Keep free item", columnId: keep.column!.id, groupId: null, order: 0 }),
      expect.objectContaining({ id: keepItem.item!.id, text: "Keep item", columnId: keep.column!.id, groupId: keepGroup.group!.id, order: 0 }),
    ]);
    expect(after.votes).toEqual([
      { participantId: "fac1", target: groupVoteTarget(keepGroup.group!.id), count: 1 },
      { participantId: "fac1", target: itemVoteTarget(keepFreeItem.item!.id), count: 1 },
    ]);
    expect(after.version).toBe(before.version + 1);
  });

  it("deletes the final column without recreating defaults or allowing invalid item adds", async () => {
    const stub = await init("test-v2-column-delete-last");
    await stub.join("fac1", "Facilitator");
    await deleteAllColumns(stub);
    const last = await stub.createColumn("fac1", "Last");
    await stub.addItem("fac1", "Only item", last.column!.id);

    const deleted = await stub.deleteColumn("fac1", last.column!.id);
    expect(deleted.success).toBe(true);

    const state = await stub.getRoomState();
    expect(state.columns).toEqual([]);
    expect(state.groups).toEqual([]);
    expect(state.items).toEqual([]);
    expect(state.votes).toEqual([]);

    const add = await stub.addItem("fac1", "No lane", last.column!.id);
    expect(add.success).toBe(false);
    expect(add.error).toBe("Column not found");
    expect(await stub.getRoomState()).toEqual(state);
  });

  it("rejects participant and late-phase column CRUD without changing state or version", async () => {
    const stub = await init("test-v2-column-crud-rejects");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const first = await stub.createColumn("fac1", "First");
    const second = await stub.createColumn("fac1", "Second");

    const beforeParticipant = await stub.getRoomState();
    await expect(stub.createColumn("p2", "Participant create")).resolves.toMatchObject({ success: false });
    await expect(stub.editColumn("p2", first.column!.id, "Participant rename")).resolves.toMatchObject({ success: false });
    await expect(stub.reorderColumns("p2", [second.column!.id, first.column!.id])).resolves.toMatchObject({ success: false });
    await expect(stub.deleteColumn("p2", first.column!.id)).resolves.toMatchObject({ success: false });
    expect(await stub.getRoomState()).toEqual(beforeParticipant);

    await stub.setPhase("fac1", "organise");
    await stub.setPhase("fac1", "vote");
    const beforeVotePhase = await stub.getRoomState();
    await expect(stub.createColumn("fac1", "Late create")).resolves.toMatchObject({ success: false });
    await expect(stub.editColumn("fac1", first.column!.id, "Late rename")).resolves.toMatchObject({ success: false });
    await expect(stub.reorderColumns("fac1", [second.column!.id, first.column!.id])).resolves.toMatchObject({ success: false });
    await expect(stub.deleteColumn("fac1", first.column!.id)).resolves.toMatchObject({ success: false });
    expect(await stub.getRoomState()).toEqual(beforeVotePhase);

    await stub.setPhase("fac1", "review");
    const beforeReviewPhase = await stub.getRoomState();
    await expect(stub.createColumn("fac1", "Review create")).resolves.toMatchObject({ success: false });
    await expect(stub.editColumn("fac1", first.column!.id, "Review rename")).resolves.toMatchObject({ success: false });
    await expect(stub.reorderColumns("fac1", [second.column!.id, first.column!.id])).resolves.toMatchObject({ success: false });
    await expect(stub.deleteColumn("fac1", first.column!.id)).resolves.toMatchObject({ success: false });
    expect(await stub.getRoomState()).toEqual(beforeReviewPhase);
  });
});
