import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { loadHomePublicConfigEffect } from "./home-page-effect";
import type { PublicConfig } from "../api";

describe("loadHomePublicConfigEffect", () => {
  it("returns the configured Turnstile site key", async () => {
    await expect(Effect.runPromise(loadHomePublicConfigEffect(
      Effect.succeed({ turnstileSiteKey: "site-key" } satisfies PublicConfig),
    ))).resolves.toEqual({ turnstileSiteKey: "site-key" });
  });

  it("fails open to no Turnstile key when public config loading fails", async () => {
    await expect(Effect.runPromise(loadHomePublicConfigEffect(
      Effect.fail(new Error("network failed")),
    ))).resolves.toEqual({ turnstileSiteKey: null });
  });
});
