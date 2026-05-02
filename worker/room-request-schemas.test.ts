import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  CreateRoomRequestSchema,
  JoinRoomRequestSchema,
  PhaseRequestSchema,
  RankingMethodRequestSchema,
} from "./room-request-schemas";

describe("room HTTP request schemas", () => {
  it("accepts valid create, join, phase, and ranking method bodies", async () => {
    await expect(Effect.runPromise(Schema.decodeUnknown(CreateRoomRequestSchema)({ turnstileToken: "token" }))).resolves.toEqual({ turnstileToken: "token" });
    await expect(Effect.runPromise(Schema.decodeUnknown(JoinRoomRequestSchema)({
      participantId: "p1",
      displayName: "Pat",
      connectionToken: "token",
      facilitatorClaimToken: "claim",
    }))).resolves.toEqual({
      participantId: "p1",
      displayName: "Pat",
      connectionToken: "token",
      facilitatorClaimToken: "claim",
    });
    await expect(Effect.runPromise(Schema.decodeUnknown(PhaseRequestSchema)({
      participantId: "fac",
      connectionToken: "token",
      phase: "write",
    }))).resolves.toEqual({ participantId: "fac", connectionToken: "token", phase: "write" });
    await expect(Effect.runPromise(Schema.decodeUnknown(RankingMethodRequestSchema)({
      participantId: "fac",
      rankingMethod: "pairwise",
    }))).resolves.toEqual({ participantId: "fac", rankingMethod: "pairwise" });
  });

  it("rejects malformed join, phase, and ranking method bodies", async () => {
    expect(Exit.isFailure(await Effect.runPromiseExit(Schema.decodeUnknown(JoinRoomRequestSchema)({ participantId: "p1" })))).toBe(true);
    expect(Exit.isFailure(await Effect.runPromiseExit(Schema.decodeUnknown(PhaseRequestSchema)({
      participantId: "fac",
      phase: "done",
    })))).toBe(true);
    expect(Exit.isFailure(await Effect.runPromiseExit(Schema.decodeUnknown(RankingMethodRequestSchema)({
      participantId: "fac",
      rankingMethod: "stars",
    })))).toBe(true);
  });
});
