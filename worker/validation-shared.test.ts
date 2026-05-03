import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
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
});
