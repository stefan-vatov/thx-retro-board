import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  authorizeLoadedParticipantResultEffect,
  authorizeParticipantFromStateEffect,
} from "./room-auth";
import { createInitialStoredState } from "./room-storage";

describe("room auth result helpers", () => {
  it("maps valid credentials to participant-scoped success", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: true }];
    state.connectionTokens.p1 = "token";

    await expect(Effect.runPromise(authorizeLoadedParticipantResultEffect(state, "p1", "token")))
      .resolves.toEqual({ success: true, participantId: "p1", state });
  });

  it("maps invalid credentials to explicit failure", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: true }];
    state.connectionTokens.p1 = "token";

    await expect(Effect.runPromise(authorizeLoadedParticipantResultEffect(state, "p1", "bad")))
      .resolves.toEqual({ success: false, error: "Invalid participant credentials" });
  });

  it("loads state before authorizing participant credentials", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: true }];
    state.connectionTokens.p1 = "token";

    await expect(Effect.runPromise(authorizeParticipantFromStateEffect(
      () => Promise.resolve(state),
      "p1",
      "token",
    ))).resolves.toEqual({ success: true, participantId: "p1", state });
  });

  it("loads state through an injected Effect dependency", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "p1", displayName: "P1", isFacilitator: true }];
    state.connectionTokens.p1 = "token";
    const calls: string[] = [];

    await expect(Effect.runPromise(authorizeParticipantFromStateEffect(
      () => {
        throw new Error("promise loader should not run");
      },
      "p1",
      "token",
      {
        loadState: (loadState) => Effect.sync(() => {
          calls.push("load");
          expect(loadState).toBeTypeOf("function");
          return state;
        }),
      },
    ))).resolves.toEqual({ success: true, participantId: "p1", state });
    expect(calls).toEqual(["load"]);
  });
});
