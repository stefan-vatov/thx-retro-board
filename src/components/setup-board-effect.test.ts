import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Column, Phase } from "../domain";
import {
  buildColumnCreateCommandEffect,
  buildColumnDeleteCommandEffect,
  buildColumnEditCommandEffect,
  buildColumnReorderCommandEffect,
} from "./setup-board-effect";

const columns: Column[] = [
  { id: "mad", name: "Mad", order: 0 },
  { id: "glad", name: "Glad", order: 1 },
  { id: "sad", name: "Sad", order: 2 },
];

describe("setup board column effects", () => {
  it("builds create column commands during setup", async () => {
    await expect(
      Effect.runPromise(
        buildColumnCreateCommandEffect({
          phase: "setup",
          isAtMax: false,
          rawName: "  Risks  ",
        }),
      ),
    ).resolves.toEqual({
      success: true,
      message: { type: "create-column", name: "Risks" },
    });
  });

  it("rejects create column commands outside setup or at max columns", async () => {
    await expect(
      Effect.runPromise(
        buildColumnCreateCommandEffect({
          phase: "write",
          isAtMax: false,
          rawName: "Risks",
        }),
      ),
    ).resolves.toEqual({
      success: false,
      error: "Columns can only be configured during setup.",
    });

    await expect(
      Effect.runPromise(
        buildColumnCreateCommandEffect({
          phase: "setup",
          isAtMax: true,
          rawName: "Risks",
        }),
      ),
    ).resolves.toMatchObject({ success: false });
  });

  it("validates and sanitizes edit column commands", async () => {
    await expect(
      Effect.runPromise(buildColumnEditCommandEffect("mad", "  Angry  ")),
    ).resolves.toEqual({
      success: true,
      message: { type: "edit-column", columnId: "mad", name: "Angry" },
    });

    await expect(
      Effect.runPromise(buildColumnEditCommandEffect("mad", "  ")),
    ).resolves.toEqual({
      success: false,
      error: "Column name cannot be empty.",
    });
  });

  it("builds reorder commands from source and target indexes", async () => {
    await expect(
      Effect.runPromise(buildColumnReorderCommandEffect(columns, 2, 0)),
    ).resolves.toEqual({
      success: true,
      message: { type: "reorder-columns", columnIds: ["sad", "mad", "glad"] },
    });
  });

  it("ignores invalid reorder indexes", async () => {
    await expect(
      Effect.runPromise(buildColumnReorderCommandEffect(columns, 4, 0)),
    ).resolves.toEqual({ success: false, error: null });
  });

  it("builds delete column commands only during setup", async () => {
    await expect(
      Effect.runPromise(buildColumnDeleteCommandEffect("mad", "setup")),
    ).resolves.toEqual({
      success: true,
      message: { type: "delete-column", columnId: "mad" },
    });

    await expect(
      Effect.runPromise(
        buildColumnDeleteCommandEffect("mad", "write" as Phase),
      ),
    ).resolves.toEqual({
      success: false,
      error: "Columns can only be configured during setup.",
    });
  });
});
