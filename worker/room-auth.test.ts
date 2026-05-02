import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { authorizeLoadedParticipantResultEffect } from "./room-auth";
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
});
