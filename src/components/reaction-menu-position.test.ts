import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { getReactionMenuPositionEffect } from "./reaction-menu-position";

describe("getReactionMenuPositionEffect", () => {
  it("opens below the add button when there is enough lower viewport space", async () => {
    await expect(
      Effect.runPromise(
        getReactionMenuPositionEffect({
          anchorRect: { top: 100, right: 300, bottom: 132 },
          viewport: { width: 1200, height: 900 },
          picker: { width: 352, height: 384, gutter: 12, offset: 8 },
        }),
      ),
    ).resolves.toEqual({
      top: 140,
      left: 12,
      width: 352,
      height: 384,
    });
  });

  it("opens above the add button when lower viewport space is constrained", async () => {
    await expect(
      Effect.runPromise(
        getReactionMenuPositionEffect({
          anchorRect: { top: 700, right: 900, bottom: 732 },
          viewport: { width: 1200, height: 900 },
          picker: { width: 352, height: 384, gutter: 12, offset: 8 },
        }),
      ),
    ).resolves.toEqual({
      top: 308,
      left: 556,
      width: 352,
      height: 384,
    });
  });

  it("clamps size and position inside small viewports", async () => {
    await expect(
      Effect.runPromise(
        getReactionMenuPositionEffect({
          anchorRect: { top: 10, right: 1000, bottom: 42 },
          viewport: { width: 280, height: 220 },
          picker: { width: 352, height: 384, gutter: 12, offset: 8 },
        }),
      ),
    ).resolves.toEqual({
      top: 12,
      left: 12,
      width: 256,
      height: 196,
    });
  });
});
