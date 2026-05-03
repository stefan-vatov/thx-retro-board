import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { groupVoteTarget, itemVoteTarget } from "../src/domain";
import {
  resolveReactionTargetForStateEffect,
  resolveVoteTargetForStateEffect,
  validateExpectedVersionEffect,
  validateItemReorderPreconditionsEffect,
  validateMoveItemPreconditionsEffect,
} from "./validation/shared";

describe("shared validation effects", () => {
  it("validates expected versions through Effect", async () => {
    await expect(Effect.runPromise(validateExpectedVersionEffect(7))).resolves.toBe(7);

    const exit = await Effect.runPromiseExit(validateExpectedVersionEffect(1.5));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("validates item reorder preconditions through Effect", async () => {
    await expect(Effect.runPromise(validateItemReorderPreconditionsEffect({
      expectedVersion: 3,
      sourceColumnId: "col-1",
      sourceGroupId: null,
    }))).resolves.toEqual({
      expectedVersion: 3,
      sourceColumnId: "col-1",
      sourceGroupId: null,
    });

    const exit = await Effect.runPromiseExit(validateItemReorderPreconditionsEffect({
      expectedVersion: 3,
      sourceGroupId: null,
    }));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("validates item move preconditions through Effect", async () => {
    await expect(Effect.runPromise(validateMoveItemPreconditionsEffect({
      expectedVersion: 4,
      sourceGroupId: "group-1",
      sourceIndex: 2,
    }))).resolves.toEqual({
      expectedVersion: 4,
      sourceGroupId: "group-1",
      sourceIndex: 2,
    });

    const exit = await Effect.runPromiseExit(validateMoveItemPreconditionsEffect({
      expectedVersion: 4,
      sourceGroupId: "group-1",
    }));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("resolves vote targets through Effect", async () => {
    const state = {
      groups: [{ id: "group-1", columnId: "col-1", name: "Theme", order: 0 }],
      items: [
        { id: "item-1", text: "Free", authorId: "p1", columnId: "col-1", groupId: null, order: 0 },
        { id: "item-2", text: "Grouped", authorId: "p1", columnId: "col-1", groupId: "group-1", order: 0 },
      ],
    };

    await expect(Effect.runPromise(resolveVoteTargetForStateEffect(state, groupVoteTarget("group-1"))))
      .resolves.toEqual(groupVoteTarget("group-1"));

    const groupedItem = await Effect.runPromiseExit(resolveVoteTargetForStateEffect(state, itemVoteTarget("item-2")));
    expect(Exit.isFailure(groupedItem)).toBe(true);
  });

  it("resolves reaction targets through Effect", async () => {
    const state = {
      groups: [{ id: "group-1", columnId: "col-1", name: "Theme", order: 0 }],
      items: [{ id: "item-1", text: "Free", authorId: "p1", columnId: "col-1", groupId: null, order: 0 }],
    };

    await expect(Effect.runPromise(resolveReactionTargetForStateEffect(state, itemVoteTarget("item-1"))))
      .resolves.toEqual(itemVoteTarget("item-1"));

    const missingTarget = await Effect.runPromiseExit(resolveReactionTargetForStateEffect(state, itemVoteTarget("missing")));
    expect(Exit.isFailure(missingTarget)).toBe(true);
  });
});
