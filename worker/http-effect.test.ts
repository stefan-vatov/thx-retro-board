import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  readJsonBodyEffect,
  readValidatedJsonBodyEffect,
  readValidatedJsonBody,
  validJsonBodyError,
} from "./http-effect";

const ExampleSchema = Schema.Struct({
  name: Schema.String,
  count: Schema.Number,
});

function jsonRequest(body: unknown, init?: { contentType?: string; contentLength?: string }): Request {
  return new Request("http://localhost/example", {
    method: "POST",
    headers: {
      "Content-Type": init?.contentType ?? "application/json",
      ...(init?.contentLength ? { "Content-Length": init.contentLength } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("Effect HTTP body helpers", () => {
  it("reads valid JSON bodies through an Effect boundary", async () => {
    await expect(Effect.runPromise(readJsonBodyEffect(jsonRequest({ ok: true }), { maxBytes: 128 }))).resolves.toEqual({ ok: true });
  });

  it("fails closed for non-json, malformed, and oversized bodies", async () => {
    await expect(Effect.runPromise(readJsonBodyEffect(jsonRequest({ ok: true }, { contentType: "text/plain" }), { maxBytes: 128 }))).resolves.toBeNull();
    await expect(Effect.runPromise(readJsonBodyEffect(new Request("http://localhost/example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    }), { maxBytes: 128 }))).resolves.toBeNull();
    await expect(Effect.runPromise(readJsonBodyEffect(jsonRequest({ value: "x".repeat(129) }), { maxBytes: 32 }))).resolves.toBeNull();
    await expect(Effect.runPromise(readJsonBodyEffect(jsonRequest({ ok: true }, { contentLength: "9999" }), { maxBytes: 32 }))).resolves.toBeNull();
  });

  it("decodes JSON with Effect Schema and returns the shared 400 response on invalid input", async () => {
    await expect(Effect.runPromise(
      readValidatedJsonBodyEffect(jsonRequest({ name: "retro", count: 2 }), ExampleSchema, { maxBytes: 128 }),
    )).resolves.toEqual({ name: "retro", count: 2 });

    const response = await Effect.runPromise(
      readValidatedJsonBodyEffect(jsonRequest({ name: "retro" }), ExampleSchema, { maxBytes: 128 }),
    );
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(400);
    await expect((response as Response).json()).resolves.toEqual(validJsonBodyError);
  });

  it("keeps the Promise wrapper behavior aligned with the Effect validator", async () => {
    await expect(readValidatedJsonBody(jsonRequest({ name: "retro", count: 2 }), ExampleSchema, { maxBytes: 128 }))
      .resolves.toEqual({ name: "retro", count: 2 });
  });
});
