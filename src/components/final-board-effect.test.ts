import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  buildFinalizeExportCardsEffect,
  buildFinalizeStatsEffect,
} from "./final-board-effect";
import {
  buildAnonymousRetroExport,
  getAnonymousActions,
  type RoomState,
} from "../domain";

function makeFinalRoomState(): RoomState {
  return {
    schemaVersion: 2,
    roomId: "room-final",
    startedAt: 1000,
    purgeScheduledAt: null,
    phase: "finalize",
    participants: [{ id: "p1", displayName: "Alex", isFacilitator: true }],
    columns: [{ id: "col-1", name: "Mad", order: 0 }],
    groups: [{ id: "group-1", name: "Group", columnId: "col-1", order: 0 }],
    items: [
      {
        id: "item-1",
        text: "Test",
        authorId: "p1",
        columnId: "col-1",
        groupId: "group-1",
        order: 0,
      },
    ],
    votes: [],
    rankingMethod: "score",
    pairwiseChoices: [],
    pairwiseProgress: [],
    reviewTargetKey: null,
    actions: [{ id: "action-1", text: "Follow up", authorId: "p1", order: 0 }],
    reactions: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version: 1,
  };
}

describe("final board Effect helpers", () => {
  it("builds export stats from room state", async () => {
    await expect(
      Effect.runPromise(buildFinalizeStatsEffect(makeFinalRoomState())),
    ).resolves.toEqual({ columns: 1, items: 1, groups: 1, actions: 1 });
  });

  it("builds the full export card set from anonymous exports", async () => {
    const state = makeFinalRoomState();
    const exportData = buildAnonymousRetroExport(
      state,
      "2026-05-03T00:00:00.000Z",
    );
    const actions = getAnonymousActions(state.actions);

    const cards = await Effect.runPromise(
      buildFinalizeExportCardsEffect({
        roomId: state.roomId,
        exportData,
        actions,
      }),
    );

    expect(cards.map((card) => card.id)).toEqual([
      "retro-json",
      "retro-markdown",
      "actions-json",
      "actions-markdown",
      "actions-csv",
    ]);
    expect(cards[0]).toMatchObject({
      filename: "retro-room-final.json",
      mimeType: "application/json",
    });
    expect(cards[4].content).toBe("order,text\n1,Follow up\n");
  });
});
