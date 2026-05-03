import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { readCreateRoomBodyEffect } from "./create-room-body";

function createRequest(body: unknown): Request {
  return new Request("https://retro.thethracian.com/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("create room body effect", () => {
  it("reads valid create-room bodies through Effect", async () => {
    await expect(Effect.runPromise(readCreateRoomBodyEffect(
      createRequest({ turnstileToken: "token" }),
    ))).resolves.toEqual({ turnstileToken: "token" });
  });

  it("falls back to an empty body for missing, malformed, or schema-invalid JSON", async () => {
    await expect(Effect.runPromise(readCreateRoomBodyEffect(
      new Request("https://retro.thethracian.com/api/rooms", { method: "POST" }),
    ))).resolves.toEqual({});

    await expect(Effect.runPromise(readCreateRoomBodyEffect(
      new Request("https://retro.thethracian.com/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
    ))).resolves.toEqual({});

    await expect(Effect.runPromise(readCreateRoomBodyEffect(
      createRequest({ turnstileToken: 123 }),
    ))).resolves.toEqual({});
  });
});
