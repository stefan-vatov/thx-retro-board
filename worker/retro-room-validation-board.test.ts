import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { groupVoteTarget, itemVoteTarget } from "../src/domain";
import {
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
} from "./validation";

describe("RetroRoom validation: board structure", () => {
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
   });
