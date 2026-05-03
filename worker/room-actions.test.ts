import { describe, expect, it } from "vitest";

import type { ServerToClientMessage } from "../src/domain";
import { createInitialStoredState } from "./room-storage";
import {
  createActionForRoom,
  createActionForRoomEffect,
  deleteActionForRoomEffect,
  editActionForRoomEffect,
} from "./room-actions";
import type { StoredState } from "./room-types";
import { Effect } from "effect";

describe("room action commands", () => {
  it("creates review actions through the room command host", async () => {
    const state = createInitialStoredState("room-a");
    state.phase = "review";
    state.participants = [{ id: "participant-a", displayName: "A", isFacilitator: false }];

    let saved = false;
    const broadcasts: ServerToClientMessage[] = [];
    const result = await createActionForRoom({
      loadState: async () => state,
      saveState: async () => {
        saved = true;
      },
      broadcast: (message) => {
        broadcasts.push(message);
      },
      broadcastState: () => {},
    }, "participant-a", "  Follow up with QA  ");

    expect(result).toMatchObject({ success: true });
    expect(saved).toBe(true);
    expect((result.action ?? { text: "" }).text).toBe("Follow up with QA");
    expect(state.actions).toHaveLength(1);
    expect(broadcasts).toContainEqual({ type: "actions-changed", actions: state.actions });
  });

  it("rejects action creation outside review", async () => {
    const state: StoredState = createInitialStoredState("room-a");
    state.phase = "write";
    state.participants = [{ id: "participant-a", displayName: "A", isFacilitator: false }];

    const result = await createActionForRoom({
      loadState: async () => state,
      saveState: async () => {
        throw new Error("should not save");
      },
      broadcast: () => {},
      broadcastState: () => {},
    }, "participant-a", "Follow up");

    expect(result).toEqual({ success: false, error: "Cannot add actions outside review phase" });
    expect(state.actions).toEqual([]);
  });

  it("exposes an Effect-native action creation command", async () => {
    const state = createInitialStoredState("room-effect");
    state.phase = "review";
    state.participants = [{ id: "participant-a", displayName: "A", isFacilitator: false }];
    let saved = false;

    const result = await Effect.runPromise(createActionForRoomEffect({
      loadState: async () => state,
      saveState: async () => {
        saved = true;
      },
      broadcast: () => {},
      broadcastState: () => {},
    }, "participant-a", "  Effect action  "));

    expect(result).toMatchObject({ success: true });
    expect(saved).toBe(true);
    expect(result.action?.text).toBe("Effect action");
  });

  it("creates actions through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-effect-injected");
    state.phase = "review";
    state.participants = [{ id: "participant-a", displayName: "A", isFacilitator: false }];
    const calls: string[] = [];

    const result = await Effect.runPromise(createActionForRoomEffect({} as never, "participant-a", "  Injected action  ", {
      loadState: () => Effect.sync(() => {
        calls.push("load");
        return state;
      }),
      generateActionId: () => Effect.succeed("action-injected"),
      broadcast: (_host, message) => Effect.sync(() => {
        calls.push(`broadcast:${message.type}`);
      }),
      saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
        calls.push(`save:${savedState.actions.length}`);
      }),
    }));

    expect(result).toEqual({
      success: true,
      action: { id: "action-injected", text: "Injected action", authorId: "participant-a", order: 0 },
    });
    expect(calls).toEqual(["load", "broadcast:actions-changed", "save:1"]);
  });

  it("exposes Effect-native action edit and delete commands", async () => {
    const state = createInitialStoredState("room-effect-edit-delete");
    state.phase = "review";
    state.participants = [{ id: "participant-a", displayName: "A", isFacilitator: false }];
    state.actions = [
      { id: "action-a", text: "Old action", authorId: "participant-a", order: 0 },
      { id: "action-b", text: "Second action", authorId: "participant-a", order: 1 },
    ];
    let saveCount = 0;
    const host = {
      loadState: async () => state,
      saveState: async () => {
        saveCount += 1;
      },
      broadcast: () => {},
      broadcastState: () => {},
    };

    const editResult = await Effect.runPromise(editActionForRoomEffect(host, "participant-a", "action-a", "  New action  "));
    expect(editResult).toMatchObject({ success: true, action: { id: "action-a", text: "New action" } });
    const deleteResult = await Effect.runPromise(deleteActionForRoomEffect(host, "participant-a", "action-a"));
    expect(deleteResult).toEqual({ success: true });
    expect(state.actions).toEqual([{ id: "action-b", text: "Second action", authorId: "participant-a", order: 0 }]);
    expect(saveCount).toBe(2);
  });

  it("edits actions through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-effect-edit-injected");
    state.phase = "review";
    state.participants = [{ id: "participant-a", displayName: "A", isFacilitator: false }];
    state.actions = [{ id: "action-a", text: "Old action", authorId: "participant-a", order: 0 }];
    const calls: string[] = [];

    const result = await Effect.runPromise(editActionForRoomEffect(
      {} as never,
      "participant-a",
      "action-a",
      "  New action  ",
      {
        loadState: () => Effect.sync(() => {
          calls.push("load");
          return state;
        }),
        broadcast: (_host, message) => Effect.sync(() => {
          calls.push(`broadcast:${message.type}`);
        }),
        saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
          calls.push(`save:${savedState.actions[0]?.text}`);
        }),
      },
    ));

    expect(result).toEqual({
      success: true,
      action: { id: "action-a", text: "New action", authorId: "participant-a", order: 0 },
    });
    expect(calls).toEqual(["load", "broadcast:actions-changed", "save:New action"]);
  });

  it("deletes actions through injected Effect dependencies", async () => {
    const state = createInitialStoredState("room-effect-delete-injected");
    state.phase = "review";
    state.participants = [{ id: "participant-a", displayName: "A", isFacilitator: false }];
    state.actions = [
      { id: "action-a", text: "Delete action", authorId: "participant-a", order: 0 },
      { id: "action-b", text: "Keep action", authorId: "participant-a", order: 1 },
    ];
    const calls: string[] = [];

    const result = await Effect.runPromise(deleteActionForRoomEffect(
      {} as never,
      "participant-a",
      "action-a",
      {
        loadState: () => Effect.sync(() => {
          calls.push("load");
          return state;
        }),
        broadcast: (_host, message) => Effect.sync(() => {
          calls.push(`broadcast:${message.type}`);
        }),
        saveAndBroadcastState: (_host, savedState) => Effect.sync(() => {
          calls.push(`save:${savedState.actions.map((action) => action.id).join(",")}`);
        }),
      },
    ));

    expect(result).toEqual({ success: true });
    expect(state.actions).toEqual([{ id: "action-b", text: "Keep action", authorId: "participant-a", order: 0 }]);
    expect(calls).toEqual(["load", "broadcast:actions-changed", "save:action-b"]);
  });
});
