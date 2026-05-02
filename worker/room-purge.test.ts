import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { purgeRoomByFacilitatorEffect } from "./room-purge";
import { createInitialStoredState } from "./room-storage";

describe("room purge command", () => {
  it("purges room data through the Effect API for facilitators", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    let reason: string | null = null;

    const result = await Effect.runPromise(purgeRoomByFacilitatorEffect(state, "fac", (message) => {
      reason = message;
      return Promise.resolve();
    }));

    expect(result).toEqual({ success: true });
    expect(reason).toBe("The facilitator deleted this room's data.");
  });

  it("rejects non-facilitators through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [
      { id: "fac", displayName: "Fac", isFacilitator: true },
      { id: "p1", displayName: "P1", isFacilitator: false },
    ];
    state.facilitatorId = "fac";

    const result = await Effect.runPromise(purgeRoomByFacilitatorEffect(state, "p1", () => {
      throw new Error("should not purge");
    }));

    expect(result).toEqual({ success: false, error: "Only the facilitator can delete room data" });
  });
});
