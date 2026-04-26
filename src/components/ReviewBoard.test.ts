import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoomState, Column, Group, RetroItem } from "../domain";
import { ReviewBoard } from "./ReviewBoard";

function makeRoomState(groups: Group[], items: RetroItem[] = [], votes: RoomState["votes"] = []): RoomState {
  const columns: Column[] = [
    { id: "column-1", name: "Column 1", order: 0 },
    { id: "column-2", name: "Column 2", order: 1 },
  ];

  return {
    schemaVersion: 2,
    roomId: "room-review-slideshow",
    phase: "review",
    participants: [{ id: "fac1", displayName: "Alice", isFacilitator: true }],
    columns,
    groups,
    items,
    votes,
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version: 1,
  };
}

describe("ReviewBoard slideshow", () => {
  it("renders one active group slide sorted by group votes descending", () => {
    const groups: Group[] = [
      { id: "group-low", name: "Low vote group", columnId: "column-1", order: 0 },
      { id: "group-high", name: "High vote group", columnId: "column-2", order: 0 },
    ];
    const items: RetroItem[] = [
      { id: "item-low", text: "Less important", authorId: "fac1", columnId: "column-1", groupId: "group-low", order: 0 },
      { id: "item-high", text: "Most important", authorId: "fac1", columnId: "column-2", groupId: "group-high", order: 0 },
    ];

    const markup = renderToStaticMarkup(
      createElement(ReviewBoard, {
        roomState: makeRoomState(groups, items, [
          { participantId: "fac1", groupId: "group-low", count: 1 },
          { participantId: "fac1", groupId: "group-high", count: 3 },
        ]),
      }),
    );

    expect(markup).toContain("Slide 1 of 2");
    expect(markup).toContain("High vote group");
    expect(markup).toContain("Most important");
    expect(markup).toContain("3 votes");
    expect(markup).not.toContain("Low vote group");
    expect(markup).not.toContain("Less important");
    expect(markup).toContain("Previous group");
    expect(markup).toContain("Next group");
    expect(markup).not.toContain("Add a vote");
    expect(markup).not.toContain("Create group");
  });

  it("uses deterministic tie ordering and includes zero-vote groups", () => {
    const groups: Group[] = [
      { id: "group-b", name: "Second tied group", columnId: "column-2", order: 0 },
      { id: "group-a", name: "First tied group", columnId: "column-1", order: 0 },
      { id: "group-c", name: "Later zero group", columnId: "column-2", order: 1 },
    ];

    const markup = renderToStaticMarkup(
      createElement(ReviewBoard, {
        roomState: makeRoomState(groups),
      }),
    );

    expect(markup).toContain("Slide 1 of 3");
    expect(markup).toContain("First tied group");
    expect(markup).toContain("0 votes");
    expect(markup).not.toContain("Second tied group");
    expect(markup).not.toContain("Later zero group");
  });

  it("shows a stable no-group review state without slides", () => {
    const items: RetroItem[] = [
      { id: "item-1", text: "Ungrouped topic", authorId: "fac1", columnId: "column-1", groupId: null, order: 0 },
    ];

    const markup = renderToStaticMarkup(
      createElement(ReviewBoard, {
        roomState: makeRoomState([], items),
      }),
    );

    expect(markup).toContain("No groups to review.");
    expect(markup).toContain("Create groups during organise to produce review slides.");
    expect(markup).not.toContain("Slide 1");
    expect(markup).not.toContain("Ungrouped topic");
  });
});
