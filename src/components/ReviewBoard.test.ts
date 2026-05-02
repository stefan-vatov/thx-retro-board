import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoomState, Column, Group, RetroItem } from "../domain";
import { groupVoteTarget, itemVoteTarget } from "../domain";
import { ReviewBoard } from "./ReviewBoard";

function makeRoomState(groups: Group[], items: RetroItem[] = [], votes: RoomState["votes"] = []): RoomState {
  const columns: Column[] = [
    { id: "column-1", name: "Column 1", order: 0 },
    { id: "column-2", name: "Column 2", order: 1 },
  ];

  return {
    schemaVersion: 2,
    roomId: "room-review-slideshow",
    startedAt: 1000,
    purgeScheduledAt: null,
    phase: "review",
    participants: [{ id: "fac1", displayName: "Alice", isFacilitator: true }],
    columns,
    groups,
    items,
    votes,
    actions: [],
    rankingMethod: "score",
    pairwiseChoices: [],
    reviewTargetKey: null,
    reactions: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version: 1,
  };
}

function renderReviewBoard(roomState: RoomState, isFacilitator = true): string {
  return renderToStaticMarkup(
    createElement(ReviewBoard, {
      roomState,
      participantId: isFacilitator ? "fac1" : "p2",
      isFacilitator,
    }),
  );
}

describe("ReviewBoard slideshow", () => {
  it("renders one active mixed target slide sorted by votes descending", () => {
    const groups: Group[] = [
      { id: "group-low", name: "Low vote group", columnId: "column-1", order: 0 },
      { id: "group-high", name: "High vote group", columnId: "column-2", order: 0 },
    ];
    const items: RetroItem[] = [
      { id: "item-low", text: "Less important", authorId: "fac1", columnId: "column-1", groupId: "group-low", order: 0 },
      { id: "item-high", text: "Most important", authorId: "fac1", columnId: "column-2", groupId: "group-high", order: 0 },
      { id: "item-top", text: "Ungrouped winner", authorId: "fac1", columnId: "column-1", groupId: null, order: 1 },
    ];

    const markup = renderReviewBoard(makeRoomState(groups, items, [
      { participantId: "fac1", target: groupVoteTarget("group-low"), count: 1 },
      { participantId: "fac1", target: groupVoteTarget("group-high"), count: 3 },
      { participantId: "fac1", target: itemVoteTarget("item-top"), count: 4 },
    ]));

    expect(markup).toContain("Slide 1 of 3");
    expect(markup).toContain("Ungrouped winner");
    expect(markup).toContain("Item result");
    expect(markup).toContain("Column 1");
    expect(markup).toContain("4 votes");
    expect(markup).not.toContain("High vote group");
    expect(markup).not.toContain("Most important");
    expect(markup).not.toContain("Low vote group");
    expect(markup).not.toContain("Less important");
    expect(markup).toContain("Previous review target");
    expect(markup).toContain("Next review target");
    expect(markup).not.toContain("Add a vote");
    expect(markup).not.toContain("Create group");
  });

  it("uses deterministic tie ordering and includes zero-vote groups and items", () => {
    const groups: Group[] = [
      { id: "group-b", name: "Second tied group", columnId: "column-2", order: 0 },
      { id: "group-a", name: "First tied group", columnId: "column-1", order: 0 },
      { id: "group-c", name: "Later zero group", columnId: "column-2", order: 1 },
    ];
    const items: RetroItem[] = [
      { id: "item-a", text: "First ungrouped item", authorId: "fac1", columnId: "column-1", groupId: null, order: 1 },
      { id: "item-b", text: "Second ungrouped item", authorId: "fac1", columnId: "column-2", groupId: null, order: 0 },
    ];

    const markup = renderReviewBoard(makeRoomState(groups, items));

    expect(markup).toContain("Slide 1 of 5");
    expect(markup).toContain("First tied group");
    expect(markup).toContain("0 votes");
    expect(markup).not.toContain("Second tied group");
    expect(markup).not.toContain("First ungrouped item");
    expect(markup).not.toContain("Later zero group");
  });

  it("shows ungrouped item slides even when there are no groups", () => {
    const items: RetroItem[] = [
      { id: "item-1", text: "Ungrouped topic", authorId: "fac1", columnId: "column-1", groupId: null, order: 0 },
    ];

    const markup = renderReviewBoard(makeRoomState([], items));

    expect(markup).toContain("Slide 1 of 1");
    expect(markup).toContain("Ungrouped topic");
    expect(markup).toContain("Column 1");
    expect(markup).not.toContain("No review targets yet.");
  });

  it("shows a stable empty review state only when there are no targets", () => {
    const markup = renderReviewBoard(makeRoomState([]));

    expect(markup).toContain("No review targets yet.");
    expect(markup).toContain("Add ungrouped items or create groups before review to produce slides.");
    expect(markup).toContain("Assign next steps");
    expect(markup).not.toContain("Slide 1");
  });

  it("renders saved action items during review", () => {
    const markup = renderReviewBoard({
      ...makeRoomState([]),
      actions: [{ id: "action-1", text: "Book rollout follow-up", authorId: "fac1", order: 0 }],
    });

    expect(markup).toContain("Action items");
    expect(markup).toContain("Book rollout follow-up");
    expect(markup).toContain("Edit action 1");
    expect(markup).toContain("Delete action 1");
  });

  it("uses the shared review target key as the active slide", () => {
    const groups: Group[] = [
      { id: "group-first", name: "First group", columnId: "column-1", order: 0 },
      { id: "group-second", name: "Synced group", columnId: "column-2", order: 0 },
    ];
    const state = {
      ...makeRoomState(groups),
      reviewTargetKey: "group:group-second",
    };

    const markup = renderReviewBoard(state);

    expect(markup).toContain("Slide 2 of 2");
    expect(markup).toContain("Synced group");
    expect(markup).not.toContain("First group");
  });

  it("keeps non-facilitator review navigation read-only", () => {
    const items: RetroItem[] = [
      { id: "item-1", text: "First topic", authorId: "fac1", columnId: "column-1", groupId: null, order: 0 },
      { id: "item-2", text: "Second topic", authorId: "fac1", columnId: "column-2", groupId: null, order: 0 },
    ];

    const markup = renderReviewBoard(makeRoomState([], items), false);

    expect(markup).toContain("Facilitator controls this for everyone");
    expect(markup).toContain("Only the facilitator can change the review slide");
    expect(markup).toContain("disabled=\"\" aria-label=\"Next review target\"");
  });
});
