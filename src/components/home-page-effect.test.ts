import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createHomeRoomEffect,
  loadHomePublicConfigEffect,
} from "./home-page-effect";
import type { PublicConfig } from "../api";

describe("loadHomePublicConfigEffect", () => {
  it("returns the configured Turnstile site key", async () => {
    await expect(
      Effect.runPromise(
        loadHomePublicConfigEffect(
          Effect.succeed({
            turnstileSiteKey: "site-key",
          } satisfies PublicConfig),
        ),
      ),
    ).resolves.toEqual({ turnstileSiteKey: "site-key" });
  });

  it("fails open to no Turnstile key when public config loading fails", async () => {
    await expect(
      Effect.runPromise(
        loadHomePublicConfigEffect(Effect.fail(new Error("network failed"))),
      ),
    ).resolves.toEqual({ turnstileSiteKey: null });
  });

  it("blocks room creation until Turnstile is complete when configured", async () => {
    const result = await Effect.runPromise(
      createHomeRoomEffect(
        { creating: false, turnstileSiteKey: "site-key", turnstileToken: null },
        {
          createRoom: () =>
            Effect.sync(() => {
              throw new Error("createRoom should not be called");
            }),
          storeFacilitatorClaimToken: () => Effect.void,
          navigate: () => Effect.void,
        },
      ),
    );

    expect(result).toEqual({
      status: "blocked",
      error: "Please complete the verification before creating a room.",
    });
  });

  it("creates the room, stores the facilitator claim token, and navigates", async () => {
    const calls: string[] = [];

    const result = await Effect.runPromise(
      createHomeRoomEffect(
        {
          creating: false,
          turnstileSiteKey: "site-key",
          turnstileToken: "turnstile-token",
        },
        {
          createRoom: (token) =>
            Effect.sync(() => {
              calls.push(`create:${token}`);
              return { roomId: "room-1", facilitatorClaimToken: "claim-token" };
            }),
          storeFacilitatorClaimToken: (roomId, token) =>
            Effect.sync(() => {
              calls.push(`store:${roomId}:${token}`);
            }),
          navigate: (path) =>
            Effect.sync(() => {
              calls.push(`navigate:${path}`);
            }),
        },
      ),
    );

    expect(result).toEqual({ status: "created", roomId: "room-1" });
    expect(calls).toEqual([
      "create:turnstile-token",
      "store:room-1:claim-token",
      "navigate:/room/room-1",
    ]);
  });
});
