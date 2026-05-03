import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { forwardValidatedRoomMutationEffect } from "./room-mutation-forwarder";

const MutationSchema = Schema.Struct({
  participantId: Schema.String,
  value: Schema.Number,
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/rooms/ABCDEFGHIJKLMNOPQRSTU/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("room mutation forwarding effects", () => {
  it("validates and forwards decoded mutation bodies through Effect", async () => {
    const forwarded: unknown[] = [];
    const response = await Effect.runPromise(forwardValidatedRoomMutationEffect(
      request({ participantId: "p1", value: 7 }),
      MutationSchema,
      (body) => {
        forwarded.push(body);
        return Promise.resolve(Response.json({ ok: true }));
      },
    ));

    expect(response.status).toBe(200);
    expect(forwarded).toEqual([{ participantId: "p1", value: 7 }]);
  });

  it("returns the shared 400 response without forwarding malformed bodies", async () => {
    const forwarded: unknown[] = [];
    const response = await Effect.runPromise(forwardValidatedRoomMutationEffect(
      request({ participantId: "p1" }),
      MutationSchema,
      (body) => {
        forwarded.push(body);
        return Promise.resolve(Response.json({ ok: true }));
      },
    ));

    expect(response.status).toBe(400);
    expect(forwarded).toEqual([]);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Valid JSON body is required",
    });
  });
});
