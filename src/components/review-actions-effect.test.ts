import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  buildActionCreateCommandEffect,
  buildActionDeleteCommandEffect,
  buildActionEditCommandEffect,
} from "./review-actions-effect";

describe("review action command effects", () => {
  it("sanitizes and builds create action messages", async () => {
    await expect(
      Effect.runPromise(
        buildActionCreateCommandEffect("  Follow up with QA  "),
      ),
    ).resolves.toEqual({
      success: true,
      message: { type: "create-action", text: "Follow up with QA" },
    });
  });

  it("rejects blank create action text", async () => {
    await expect(
      Effect.runPromise(buildActionCreateCommandEffect("   ")),
    ).resolves.toEqual({
      success: false,
      error: "Add a clear action before saving.",
    });
  });

  it("sanitizes and builds edit action messages", async () => {
    await expect(
      Effect.runPromise(
        buildActionEditCommandEffect("action-1", "  Ship the notes  "),
      ),
    ).resolves.toEqual({
      success: true,
      message: {
        type: "edit-action",
        actionId: "action-1",
        text: "Ship the notes",
      },
    });
  });

  it("rejects empty edit text", async () => {
    await expect(
      Effect.runPromise(buildActionEditCommandEffect("action-1", " ")),
    ).resolves.toEqual({
      success: false,
      error: "Action text cannot be empty.",
    });
  });

  it("builds delete action messages", async () => {
    await expect(
      Effect.runPromise(buildActionDeleteCommandEffect("action-1")),
    ).resolves.toEqual({
      type: "delete-action",
      actionId: "action-1",
    });
  });
});
