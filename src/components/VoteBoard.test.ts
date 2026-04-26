import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoomState, Column, Group, RetroItem } from "../domain";
import { VoteBoard } from "./VoteBoard";

function makeRoomState(groups: Group[] = [], items: RetroItem[] = [], votes: RoomState["votes"] = []): RoomState {
  const columns: Column[] = [
    { id: "column-1", name: "Column 1", order: 0 },
  ];

  return {
    schemaVersion: 2,
    roomId: "room-vote-groups",
    phase: "vote",
    participants: [
      { id: "fac1", displayName: "Alice", isFacilitator: true },
      { id: "p2", displayName: "Bob", isFacilitator: false },
    ],
    columns,
    groups,
    items,
    votes,
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version: 1,
  };
}

describe("VoteBoard group voting", () => {
  it("renders vote controls on group cards and no item row vote controls", () => {
    const groups: Group[] = [{ id: "group-1", name: "Release wins", columnId: "column-1", order: 0 }];
    const items: RetroItem[] = [
      { id: "item-1", text: "Shipped faster", authorId: "fac1", columnId: "column-1", groupId: "group-1", order: 0 },
    ];

    const markup = renderToStaticMarkup(
      createElement(VoteBoard, {
        roomState: makeRoomState(groups, items, [
          { participantId: "fac1", groupId: "group-1", count: 2 },
          { participantId: "p2", groupId: "group-1", count: 1 },
        ]),
        participantId: "fac1",
        send: () => true,
      }),
    );

    expect(markup).toContain("Release wins");
    expect(markup).toContain("Shipped faster");
    expect(markup).toContain("3 votes");
    expect(markup).toContain("(you: 2)");
    expect(markup).toContain("Add a vote to Release wins");
    expect(markup).not.toContain("Add a vote to Shipped faster");
    expect(markup).not.toContain("Remove one of your votes from Shipped faster");
  });

  it("shows a stable no-groups empty state without vote controls", () => {
    const items: RetroItem[] = [
      { id: "item-1", text: "Ungrouped topic", authorId: "fac1", columnId: "column-1", groupId: null, order: 0 },
    ];

    const markup = renderToStaticMarkup(
      createElement(VoteBoard, {
        roomState: makeRoomState([], items),
        participantId: "fac1",
        send: () => true,
      }),
    );

    expect(markup).toContain("No groups to vote on.");
    expect(markup).toContain("Create groups during organise before voting, or advance when there is nothing to vote on.");
    expect(markup).not.toContain("Add a vote");
    expect(markup).not.toContain("Remove one of your votes");
  });
});
