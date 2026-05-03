import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  parseClientWebSocketMessageEffect,
  authorizeParticipantEffect,
  validatePhaseChangeEffect,
  validateRankingMethodChangeEffect,
  validateVoteBudgetChangeEffect,
} from "./validation";
import { initRaw } from "./retro-room-test-helpers";

describe("RetroRoom validation: protocol and setup", () => {
  it("parses valid websocket client messages through Effect", async () => {
    await expect(Effect.runPromise(parseClientWebSocketMessageEffect(JSON.stringify({
      type: "create-action",
      text: "Follow up",
    })))).resolves.toEqual({
      type: "create-action",
      text: "Follow up",
    });
  });
  
  it("rejects malformed websocket client messages through Effect", async () => {
    const exit = await Effect.runPromiseExit(parseClientWebSocketMessageEffect(JSON.stringify({
      type: "set-phase",
      phase: "done",
    })));
  
    expect(Exit.isFailure(exit)).toBe(true);
  });
  
  it("rejects malformed Durable Object join request bodies through Effect", async () => {
    const stub = await initRaw("test-do-invalid-join-body");
  
    const response = await stub.fetch(new Request("http://do/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "p1" }),
    }));
  
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Valid JSON body is required",
    });
  });
  
  it("rejects malformed Durable Object mutation bodies through Effect before authorization", async () => {
    const stub = await initRaw("test-do-invalid-phase-body");
  
    const response = await stub.fetch(new Request("http://do/phase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "fac1", connectionToken: "wrong", phase: "done" }),
    }));
  
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Valid JSON body is required",
    });
  });
  
  it("authorizes participant credentials through Effect", async () => {
    const state = {
      participants: [{ id: "p1", displayName: "Pat", isFacilitator: false }],
      connectionTokens: { p1: "token" },
    };
  
    await expect(Effect.runPromise(authorizeParticipantEffect(state, "p1", "token"))).resolves.toEqual({
      participantId: "p1",
    });
  
    const missingParticipant = await Effect.runPromiseExit(authorizeParticipantEffect(state, "missing", "token"));
    expect(Exit.isFailure(missingParticipant)).toBe(true);
  
    const invalidToken = await Effect.runPromiseExit(authorizeParticipantEffect(state, "p1", "wrong"));
    expect(Exit.isFailure(invalidToken)).toBe(true);
  
    const missingRoom = await Effect.runPromiseExit(authorizeParticipantEffect(null, "p1", "token"));
    expect(Exit.isFailure(missingRoom)).toBe(true);
  });
  
  it("validates vote budget mutations through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "setup",
    };
  
    await expect(Effect.runPromise(validateVoteBudgetChangeEffect(state, "fac1", 12))).resolves.toEqual({ budget: 12 });
  
    const invalidBudget = await Effect.runPromiseExit(validateVoteBudgetChangeEffect(state, "fac1", 0));
    expect(Exit.isFailure(invalidBudget)).toBe(true);
  
    const nonFacilitator = await Effect.runPromiseExit(validateVoteBudgetChangeEffect({
      ...state,
      participants: [...state.participants, { id: "p2", displayName: "Pat", isFacilitator: false }],
    }, "p2", 12));
    expect(Exit.isFailure(nonFacilitator)).toBe(true);
  });
  
  it("validates ranking method mutations through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "setup",
    };
  
    await expect(Effect.runPromise(validateRankingMethodChangeEffect(state, "fac1", "pairwise"))).resolves.toEqual({
      rankingMethod: "pairwise",
    });
  
    const lateChange = await Effect.runPromiseExit(validateRankingMethodChangeEffect({
      ...state,
      phase: "write",
    }, "fac1", "pairwise"));
    expect(Exit.isFailure(lateChange)).toBe(true);
  });
  
  it("validates phase transitions through Effect before state changes", async () => {
    const state = {
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "setup",
      columns: [{ id: "col-1", name: "Mad", order: 0 }],
      rankingMethod: "score",
    };
  
    await expect(Effect.runPromise(validatePhaseChangeEffect(state, "fac1", "write", 0))).resolves.toEqual({ phase: "write" });
  
    const invalidTransition = await Effect.runPromiseExit(validatePhaseChangeEffect(state, "fac1", "vote", 0));
    expect(Exit.isFailure(invalidTransition)).toBe(true);
  
    const noColumns = await Effect.runPromiseExit(validatePhaseChangeEffect({ ...state, columns: [] }, "fac1", "write", 0));
    expect(Exit.isFailure(noColumns)).toBe(true);
  });
   });
