import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  missingTurnstileTokenError,
  turnstileFailure,
  verifyTurnstileTokenEffect,
} from "./turnstile";

describe("Turnstile verification Effect", () => {
  it("allows room creation when no secret is configured", async () => {
    await expect(Effect.runPromise(verifyTurnstileTokenEffect({}, undefined, "unknown"))).resolves.toEqual({ success: true });
  });

  it("requires a token when a secret is configured", async () => {
    await expect(Effect.runPromise(verifyTurnstileTokenEffect({ secret: "secret" }, "   ", "unknown"))).resolves.toEqual({
      success: false,
      error: missingTurnstileTokenError,
    });
  });

  it("posts the token and remote IP to Cloudflare siteverify", async () => {
    let submitted: Record<string, string> = {};
    const fetcher: typeof fetch = async (_input, init) => {
      submitted = Object.fromEntries((init?.body as FormData).entries()) as Record<string, string>;
      return Response.json({ success: true });
    };

    await expect(Effect.runPromise(verifyTurnstileTokenEffect(
      { secret: "secret", fetcher },
      "token",
      "203.0.113.10",
    ))).resolves.toEqual({ success: true });
    expect(submitted).toEqual({
      secret: "secret",
      response: "token",
      remoteip: "203.0.113.10",
    });
  });

  it("fails closed when siteverify rejects, returns malformed JSON, or is unreachable", async () => {
    await expect(Effect.runPromise(verifyTurnstileTokenEffect({
      secret: "secret",
      fetcher: async () => Response.json({ success: false }),
    }, "token", "unknown"))).resolves.toEqual({ success: false, error: turnstileFailure });

    await expect(Effect.runPromise(verifyTurnstileTokenEffect({
      secret: "secret",
      fetcher: async () => new Response("{bad-json"),
    }, "token", "unknown"))).resolves.toEqual({ success: false, error: turnstileFailure });

    await expect(Effect.runPromise(verifyTurnstileTokenEffect({
      secret: "secret",
      fetcher: async () => {
        throw new TypeError("network down");
      },
    }, "token", "unknown"))).resolves.toEqual({ success: false, error: turnstileFailure });
  });
});
