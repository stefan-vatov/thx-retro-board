import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoomState, Column, Group, RetroItem } from "../domain";
import { groupVoteTarget, itemVoteTarget } from "../domain";
import { VoteBoard } from "./VoteBoard";

function makeRoomState(groups: Group[] = [], items: RetroItem[] = [], votes: RoomState["votes"] = []): RoomState {
  const columns: Column[] = [
    { id: "column-1", name: "Column 1", order: 0 },
  ];

  return {
    schemaVersion: 2,
    roomId: "room-vote-groups",
    startedAt: 1000,
    purgeScheduledAt: null,
    phase: "vote",
    participants: [
      { id: "fac1", displayName: "Alice", isFacilitator: true },
      { id: "p2", displayName: "Bob", isFacilitator: false },
    ],
    columns,
    groups,
    items,
    votes,
    rankingMethod: "score",
    pairwiseChoices: [],
    pairwiseProgress: [],
    reviewTargetKey: null,
    actions: [],
    reactions: [],
    timer: { startedAt: null, durationSeconds: null, expired: false },
    voteBudget: 5,
    version: 1,
  };
}

describe("VoteBoard mixed target voting", () => {
  it("renders group cards and ungrouped item cards with no controls on grouped item rows", () => {
    const groups: Group[] = [{ id: "group-1", name: "Release wins", columnId: "column-1", order: 0 }];
    const items: RetroItem[] = [
      { id: "item-1", text: "Shipped faster", authorId: "fac1", columnId: "column-1", groupId: "group-1", order: 0 },
      { id: "item-2", text: "Needs follow-up", authorId: "p2", columnId: "column-1", groupId: null, order: 1 },
    ];

    const markup = renderToStaticMarkup(
      createElement(VoteBoard, {
        roomState: makeRoomState(groups, items, [
          { participantId: "fac1", target: groupVoteTarget("group-1"), count: 2 },
          { participantId: "p2", target: groupVoteTarget("group-1"), count: 1 },
          { participantId: "fac1", target: itemVoteTarget("item-2"), count: 1 },
        ]),
        participantId: "fac1",
        send: () => true,
      }),
    );

    expect(markup).toContain("Release wins");
    expect(markup).toContain("Shipped faster");
    expect(markup).toContain("3 votes");
    expect(markup).toContain("You: 2");
    expect(markup).toContain("Add a vote to Release wins");
    expect(markup).toContain("Needs follow-up");
    expect(markup).toContain("Add a vote to Needs follow-up");
    expect(markup).toContain("Remove one of your votes from Needs follow-up");
    expect(markup).toContain("data-vote-item-id=\"item-2\"");
    expect(markup).not.toContain("Add a vote to Shipped faster");
    expect(markup).not.toContain("Remove one of your votes from Shipped faster");
  });

  it("renders ungrouped items as votable targets when no groups exist", () => {
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

    expect(markup).toContain("Ungrouped topic");
    expect(markup).toContain("Add a vote to Ungrouped topic");
    expect(markup).toContain("data-vote-item-id=\"item-1\"");
    expect(markup).not.toContain("No vote targets yet.");
  });

  it("shows a stable empty state only when no groups or ungrouped items exist", () => {
    const markup = renderToStaticMarkup(
      createElement(VoteBoard, {
        roomState: makeRoomState([], []),
        participantId: "fac1",
        send: () => true,
      }),
    );

    expect(markup).toContain("No vote targets yet.");
    expect(markup).not.toContain("Add a vote");
    expect(markup).not.toContain("Remove one of your votes");
  });

  it("renders grouped card contents in pairwise options", () => {
    const groups: Group[] = [
      { id: "group-1", name: "Launch blockers", columnId: "column-1", order: 0 },
      { id: "group-2", name: "Release confidence", columnId: "column-1", order: 1 },
    ];
    const items: RetroItem[] = [
      { id: "item-1", text: "Auth migration is risky", authorId: "fac1", columnId: "column-1", groupId: "group-1", order: 0 },
      { id: "item-2", text: "QA window is too short", authorId: "p2", columnId: "column-1", groupId: "group-1", order: 1 },
      { id: "item-3", text: "Rollback plan is clear", authorId: "fac1", columnId: "column-1", groupId: "group-2", order: 0 },
    ];

    const markup = renderToStaticMarkup(
      createElement(VoteBoard, {
        roomState: { ...makeRoomState(groups, items), rankingMethod: "pairwise" },
        participantId: "fac1",
        send: () => true,
      }),
    );

    expect(markup).toContain("Launch blockers");
    expect(markup).toContain("Auth migration is risky");
    expect(markup).toContain("QA window is too short");
    expect(markup).toContain("Release confidence");
    expect(markup).toContain("Rollback plan is clear");
    expect(markup).toContain("Cards in Launch blockers");
  });

  it("shows realtime-style pairwise progress for every participant", () => {
    const items: RetroItem[] = [
      { id: "item-1", text: "First target", authorId: "fac1", columnId: "column-1", groupId: null, order: 0 },
      { id: "item-2", text: "Second target", authorId: "p2", columnId: "column-1", groupId: null, order: 1 },
      { id: "item-3", text: "Third target", authorId: "fac1", columnId: "column-1", groupId: null, order: 2 },
    ];
    const state: RoomState = {
      ...makeRoomState([], items),
      rankingMethod: "pairwise",
      pairwiseChoices: [
        { participantId: "fac1", winner: itemVoteTarget("item-1"), loser: itemVoteTarget("item-2") },
        { participantId: "fac1", winner: itemVoteTarget("item-1"), loser: itemVoteTarget("item-3") },
        { participantId: "fac1", winner: itemVoteTarget("item-2"), loser: itemVoteTarget("item-3") },
      ],
      pairwiseProgress: [
        { participantId: "fac1", answered: 3, total: 3 },
        { participantId: "p2", answered: 1, total: 3 },
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(VoteBoard, {
        roomState: state,
        participantId: "fac1",
        send: () => true,
      }),
    );

    expect(markup).toContain("Ranking progress");
    expect(markup).toContain("Visible to everyone in the room");
    expect(markup).toContain("Alice");
    expect(markup).toContain("You");
    expect(markup).toContain("3/3");
    expect(markup).toContain("Bob");
    expect(markup).toContain("1/3");
    expect(markup).toContain("67%");
  });
});
