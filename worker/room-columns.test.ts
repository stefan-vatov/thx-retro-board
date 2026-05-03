import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createInitialStoredState } from "./room-storage";
import {
  createColumnForRoom,
  createColumnForRoomEffect,
  deleteColumnForRoom,
  deleteColumnForRoomEffect,
  editColumnForRoomEffect,
  reorderColumnsForRoomEffect,
} from "./room-columns";

describe("room column commands", () => {
  it("creates setup columns for facilitators", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";

    let saved = false;
    const result = await createColumnForRoom({
      loadState: async () => state,
      saveState: async () => {
        saved = true;
      },
      broadcast: () => {},
      broadcastState: () => {},
    }, "fac", "  Risks  ");

    expect(result).toMatchObject({ success: true });
    expect(saved).toBe(true);
    expect(result.column?.name).toBe("Risks");
    expect(state.columns.at(-1)).toEqual(result.column);
  });

  it("deletes columns and normalizes dependent room data", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    state.items = [{ id: "item-a", text: "A", authorId: "fac", columnId: "mad", groupId: null, order: 0 }];
    state.votes = [{ participantId: "fac", target: { type: "item", id: "item-a" }, count: 1 }];

    const result = await deleteColumnForRoom({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "fac", "mad");

    expect(result).toEqual({ success: true });
    expect(state.columns.some((column) => column.id === "mad")).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.votes).toEqual([]);
  });

  it("creates columns through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";

    const result = await Effect.runPromise(createColumnForRoomEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "fac", "  Start  "));

    expect(result).toMatchObject({ success: true });
    expect(result.column?.name).toBe("Start");
    expect(state.columns.at(-1)).toEqual(result.column);
  });

  it("creates columns through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    const calls: string[] = [];

    const result = await Effect.runPromise(createColumnForRoomEffect({} as never, "fac", "  Risks  ", {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      generateColumnId: () => Effect.succeed("col-injected"),
      saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
        calls.push(`save:${savedState.columns.at(-1)?.id}`);
      }),
    }));

    expect(result).toEqual({
      success: true,
      column: { id: "col-injected", name: "Risks", order: 3 },
    });
    expect(calls).toEqual(["load", "save:col-injected"]);
  });

  it("edits columns through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";

    const result = await Effect.runPromise(editColumnForRoomEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "fac", "mad", "Signals"));

    expect(result).toMatchObject({ success: true, column: { id: "mad", name: "Signals" } });
    expect(state.columns.find((column) => column.id === "mad")?.name).toBe("Signals");
  });

  it("edits columns through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    const calls: string[] = [];

    const result = await Effect.runPromise(editColumnForRoomEffect({} as never, "fac", "mad", "Signals", {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
        calls.push(`save:${savedState.columns.find((column) => column.id === "mad")?.name}`);
      }),
    }));

    expect(result).toMatchObject({ success: true, column: { id: "mad", name: "Signals" } });
    expect(calls).toEqual(["load", "save:Signals"]);
  });

  it("reorders columns through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";

    const result = await Effect.runPromise(reorderColumnsForRoomEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "fac", ["sad", "glad", "mad"]));

    expect(result).toEqual({ success: true });
    expect(state.columns.map((column) => [column.id, column.order])).toEqual([
      ["sad", 0],
      ["glad", 1],
      ["mad", 2],
    ]);
  });

  it("reorders columns through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    const calls: string[] = [];

    const result = await Effect.runPromise(reorderColumnsForRoomEffect({} as never, "fac", ["sad", "glad", "mad"], {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
        calls.push(`save:${savedState.columns.map((column) => column.id).join(",")}`);
      }),
    }));

    expect(result).toEqual({ success: true });
    expect(state.columns.map((column) => [column.id, column.order])).toEqual([
      ["sad", 0],
      ["glad", 1],
      ["mad", 2],
    ]);
    expect(calls).toEqual(["load", "save:sad,glad,mad"]);
  });

  it("deletes columns through the Effect API", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";

    const result = await Effect.runPromise(deleteColumnForRoomEffect({
      loadState: async () => state,
      saveState: async () => {},
      broadcast: () => {},
      broadcastState: () => {},
    }, "fac", "sad"));

    expect(result).toEqual({ success: true });
    expect(state.columns.map((column) => column.id)).toEqual(["mad", "glad"]);
  });

  it("deletes columns through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-a");
    state.participants = [{ id: "fac", displayName: "Fac", isFacilitator: true }];
    state.facilitatorId = "fac";
    const calls: string[] = [];

    const result = await Effect.runPromise(deleteColumnForRoomEffect({} as never, "fac", "sad", {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
        calls.push(`save:${savedState.columns.map((column) => column.id).join(",")}`);
      }),
    }));

    expect(result).toEqual({ success: true });
    expect(state.columns.map((column) => column.id)).toEqual(["mad", "glad"]);
    expect(calls).toEqual(["load", "save:mad,glad"]);
  });
});
