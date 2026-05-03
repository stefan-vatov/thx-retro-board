import { describe, expect, it } from "vitest";
import { getDefaultColumns, groupVoteTarget, itemVoteTarget } from "../src/domain";
import { initRaw, init, freshMovePreconditions } from "./retro-room-test-helpers";

describe("RetroRoom voting and review projections", () => {
  it("stores distinct columns, column-scoped groups, original item column IDs, and group votes", async () => {
    const stub = await init("test-v2-shape");
    await stub.join("fac1", "Facilitator");
  
    const column = await stub.createColumn("fac1", "Went well");
    expect(column.success).toBe(true);
    const columnId = column.column!.id;
  
    const item = await stub.addItem("fac1", "Shipping was smooth", columnId);
    expect(item.success).toBe(true);
    expect(item.item!.columnId).toBe(columnId);
    expect(item.item!.groupId).toBeNull();
  
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Release wins", columnId);
    expect(group.success).toBe(true);
    expect(group.group).toMatchObject({ name: "Release wins", columnId, order: 0 });
  
    const move = await stub.moveItemToGroup(
      "fac1",
      item.item!.id,
      group.group!.id,
      0,
      await freshMovePreconditions(stub, item.item!.id),
    );
    expect(move.success).toBe(true);
  
    await stub.setPhase("fac1", "vote");
    const vote = await stub.castVote("fac1", group.group!.id, 2);
    expect(vote.success).toBe(true);
  
    const state = await stub.getRoomState();
    expect(state.columns).toEqual([...getDefaultColumns(), { id: columnId, name: "Went well", order: 3 }]);
    expect(state.groups).toEqual([{ id: group.group!.id, name: "Release wins", columnId, order: 0 }]);
    expect(state.items).toEqual([
      expect.objectContaining({ id: item.item!.id, text: "Shipping was smooth", columnId, groupId: group.group!.id, order: 0 }),
    ]);
    expect(state.votes).toEqual([{ participantId: "fac1", target: groupVoteTarget(group.group!.id), count: 2 }]);
  });
  
  it("lets authors edit and delete only their own write-phase items", async () => {
    const stub = await init("test-v2-item-author-controls");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const columnId = (await stub.getRoomState()).columns[0]!.id;
  
    const authored = await stub.addItem("p2", "Original text", columnId);
    expect(authored.success).toBe(true);
    const itemId = authored.item!.id;
  
    expect(await stub.editItem("fac1", itemId, "Facilitator edit")).toMatchObject({
      success: false,
      error: "Only the author can edit this item",
    });
    expect(await stub.deleteItem("fac1", itemId)).toMatchObject({
      success: false,
      error: "Only the author can delete this item",
    });
  
    const edited = await stub.editItem("p2", itemId, "Updated text");
    expect(edited).toMatchObject({ success: true, item: expect.objectContaining({ text: "Updated text" }) });
  
    expect(await stub.deleteItem("p2", itemId)).toMatchObject({ success: true });
    expect((await stub.getRoomState()).items).toEqual([]);
  });
  
  it("normalizes persisted v2 ordering per column and per item list while preserving duplicate-looking identities", async () => {
    const stub = await init("test-v2-normalize-scoped-duplicate-identities");
    await stub.seedStoredStateForTest({
      roomId: "test-v2-normalize-scoped-duplicate-identities",
      participants: [
        { id: "fac1", displayName: "Facilitator", isFacilitator: true },
        { id: "p2", displayName: "Participant", isFacilitator: false },
      ],
      facilitatorId: "fac1",
      columns: [
        { id: "col-b", name: "Same", order: 20 },
        { id: "col-a", name: "Same", order: 10 },
      ],
      groups: [
        { id: "group-a-2", name: "Duplicate", columnId: "col-a", order: 30 },
        { id: "group-b-1", name: "Duplicate", columnId: "col-b", order: 40 },
        { id: "group-a-1", name: "Duplicate", columnId: "col-a", order: 10 },
      ],
      items: [
        { id: "item-a-2", text: "Same text", authorId: "fac1", columnId: "col-a", groupId: "group-a-1", order: 99 },
        { id: "item-b-1", text: "Same text", authorId: "p2", columnId: "col-b", groupId: "group-b-1", order: 5 },
        { id: "item-a-1", text: "Same text", authorId: "fac1", columnId: "col-a", groupId: "group-a-1", order: 1 },
        { id: "item-a-free", text: "Same text", authorId: "p2", columnId: "col-a", groupId: null, order: 7 },
      ],
      votes: [
        { participantId: "fac1", groupId: "group-a-1", count: 2 },
        { participantId: "p2", groupId: "group-b-1", count: 1 },
      ],
    });
  
    const state = await stub.getRoomState();
  
    expect(state.columns.map((column) => [column.id, column.order])).toEqual([
      ["col-a", 0],
      ["col-b", 1],
    ]);
    expect(state.groups
      .filter((group) => group.columnId === "col-a")
      .sort((a, b) => a.order - b.order)
      .map((group) => [group.id, group.order])).toEqual([
      ["group-a-1", 0],
      ["group-a-2", 1],
    ]);
    expect(state.groups
      .filter((group) => group.columnId === "col-b")
      .map((group) => [group.id, group.order])).toEqual([
      ["group-b-1", 0],
    ]);
    expect(state.items
      .filter((item) => item.groupId === "group-a-1")
      .sort((a, b) => a.order - b.order)
      .map((item) => [item.id, item.order])).toEqual([
      ["item-a-1", 0],
      ["item-a-2", 1],
    ]);
    expect(state.items.find((item) => item.id === "item-b-1")).toMatchObject({
      text: "Same text",
      columnId: "col-b",
      groupId: "group-b-1",
      order: 0,
    });
    expect(state.votes).toEqual([
      { participantId: "fac1", target: groupVoteTarget("group-a-1"), count: 2 },
      { participantId: "p2", target: groupVoteTarget("group-b-1"), count: 1 },
    ]);
  });
  
  it("enforces vote budget against group IDs without item-level allocations", async () => {
    const stub = await init("test-v2-group-vote-budget");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const column = await stub.createColumn("fac1", "Lane");
    const item = await stub.addItem("fac1", "Grouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Vote target", column.column!.id);
    await stub.moveItemToGroup("fac1", item.item!.id, group.group!.id, 0, await freshMovePreconditions(stub, item.item!.id));
    await stub.setPhase("fac1", "vote");
  
    const accepted = await stub.castVote("p2", group.group!.id, 5);
    expect(accepted.success).toBe(true);
    const beforeOverBudget = await stub.getRoomState();
    expect(beforeOverBudget.votes).toEqual([{ participantId: "p2", target: groupVoteTarget(group.group!.id), count: 5 }]);
  
    const rejected = await stub.castVote("p2", group.group!.id, 1);
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain("Over budget");
    expect(await stub.getRoomState()).toEqual(beforeOverBudget);
  
    const itemLevelAttempt = await stub.castVote("p2", itemVoteTarget(item.item!.id), 1);
    expect(itemLevelAttempt.success).toBe(false);
    expect(itemLevelAttempt.error).toBe("Cannot vote directly on a grouped item");
    expect(await stub.getRoomState()).toEqual(beforeOverBudget);
  });
  
  it("accepts valid ungrouped item votes and shares budget with group votes", async () => {
    const stub = await init("test-v2-mixed-vote-targets");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const column = await stub.createColumn("fac1", "Lane");
    const groupedItem = await stub.addItem("fac1", "Grouped topic", column.column!.id);
    const ungroupedItem = await stub.addItem("fac1", "Ungrouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group target", column.column!.id);
    await stub.moveItemToGroup("fac1", groupedItem.item!.id, group.group!.id, 0, await freshMovePreconditions(stub, groupedItem.item!.id));
    await stub.setPhase("fac1", "vote");
  
    expect(await stub.castVote("p2", groupVoteTarget(group.group!.id), 2)).toMatchObject({ success: true });
    expect(await stub.castVote("p2", itemVoteTarget(ungroupedItem.item!.id), 3)).toMatchObject({ success: true });
    const beforeOverBudget = await stub.getRoomState();
    expect(beforeOverBudget.votes).toEqual([
      { participantId: "p2", target: groupVoteTarget(group.group!.id), count: 2 },
      { participantId: "p2", target: itemVoteTarget(ungroupedItem.item!.id), count: 3 },
    ]);
  
    expect(await stub.castVote("p2", itemVoteTarget(ungroupedItem.item!.id), 1)).toMatchObject({ success: false, error: expect.stringContaining("Over budget") });
    expect(await stub.getRoomState()).toEqual(beforeOverBudget);
  });
  
  it("does not count participants who join after voting starts", async () => {
    const stub = await init("test-v2-vote-roster-freeze");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    const ungroupedItem = await stub.addItem("fac1", "Ungrouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    await stub.setPhase("fac1", "vote");
    await stub.join("late", "Late participant");
  
    await expect(stub.castVote("late", itemVoteTarget(ungroupedItem.item!.id), 1)).resolves.toMatchObject({
      success: false,
      error: "Participant joined after voting started",
    });
  });
  
  it("accepts pairwise choices between grouped and ungrouped targets across columns", async () => {
    const stub = await initRaw("test-v2-pairwise-cross-board-targets");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    await expect(stub.setRankingMethod("fac1", "pairwise")).resolves.toMatchObject({ success: true });
  
    const setupState = await stub.getRoomState();
    const mad = setupState.columns[0]!;
    const glad = setupState.columns[1]!;
    await stub.setPhase("fac1", "write");
    const groupedItem = await stub.addItem("fac1", "Grouped topic", mad.id);
    const ungroupedItem = await stub.addItem("fac1", "Other-column topic", glad.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group target", mad.id);
    await stub.moveItemToGroup("fac1", groupedItem.item!.id, group.group!.id, 0, await freshMovePreconditions(stub, groupedItem.item!.id));
    await stub.setPhase("fac1", "vote");
  
    await expect(stub.choosePairwise("p2", groupVoteTarget(group.group!.id), itemVoteTarget(ungroupedItem.item!.id))).resolves.toMatchObject({ success: true });
    await expect(stub.choosePairwise("p2", itemVoteTarget(groupedItem.item!.id), itemVoteTarget(ungroupedItem.item!.id))).resolves.toMatchObject({
      success: false,
      error: "Cannot vote directly on a grouped item",
    });
  
    const state = await stub.getRoomState();
    expect(state.pairwiseChoices).toEqual([
      { participantId: "p2", winner: groupVoteTarget(group.group!.id), loser: itemVoteTarget(ungroupedItem.item!.id) },
    ]);
  });
  
  it("does not expose other participants' pairwise ballots in participant state", async () => {
    const stub = await initRaw("test-v2-pairwise-privacy-projection");
    const fac = await stub.join("fac1", "Facilitator");
    const p2 = await stub.join("p2", "Participant");
    await expect(stub.setRankingMethod("fac1", "pairwise")).resolves.toMatchObject({ success: true });
  
    const setupState = await stub.getRoomState();
    const column = setupState.columns[0]!;
    await stub.setPhase("fac1", "write");
    const first = await stub.addItem("fac1", "First topic", column.id);
    const second = await stub.addItem("fac1", "Second topic", column.id);
    await stub.setPhase("fac1", "organise");
    await stub.setPhase("fac1", "vote");
  
    const firstTarget = itemVoteTarget(first.item!.id);
    const secondTarget = itemVoteTarget(second.item!.id);
    await expect(stub.choosePairwise("fac1", firstTarget, secondTarget)).resolves.toMatchObject({ success: true });
    await expect(stub.choosePairwise("p2", secondTarget, firstTarget)).resolves.toMatchObject({ success: true });
  
    const voteState = await stub.getRoomStateForParticipant("fac1", fac.connectionToken);
    expect(voteState.success).toBe(true);
    expect(voteState.state?.pairwiseChoices).toEqual([
      { participantId: "fac1", winner: firstTarget, loser: secondTarget },
    ]);
  
    await stub.setPhase("fac1", "review");
    const reviewState = await stub.getRoomStateForParticipant("fac1", fac.connectionToken);
    expect(reviewState.success).toBe(true);
    expect(reviewState.state?.pairwiseChoices).toHaveLength(2);
    expect(reviewState.state?.pairwiseChoices.some((choice) => choice.participantId === "fac1" || choice.participantId === "p2")).toBe(false);
    expect(reviewState.state?.pairwiseChoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ winner: firstTarget, loser: secondTarget }),
        expect.objectContaining({ winner: secondTarget, loser: firstTarget }),
      ]),
    );
  
    const p2ReviewState = await stub.getRoomStateForParticipant("p2", p2.connectionToken);
    expect(p2ReviewState.success).toBe(true);
    expect(p2ReviewState.state?.pairwiseChoices.some((choice) => choice.participantId === "fac1" || choice.participantId === "p2")).toBe(false);
  });
  
  it("compacts pairwise review projections to aggregate counts instead of expanded ballots", async () => {
    const stub = await initRaw("test-v2-pairwise-compact-review-projection");
    const fac = await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant 2");
    await stub.join("p3", "Participant 3");
    await expect(stub.setRankingMethod("fac1", "pairwise")).resolves.toMatchObject({ success: true });
  
    const setupState = await stub.getRoomState();
    const column = setupState.columns[0]!;
    await stub.setPhase("fac1", "write");
    const first = await stub.addItem("fac1", "First topic", column.id);
    const second = await stub.addItem("fac1", "Second topic", column.id);
    await stub.setPhase("fac1", "organise");
    await stub.setPhase("fac1", "vote");
  
    const firstTarget = itemVoteTarget(first.item!.id);
    const secondTarget = itemVoteTarget(second.item!.id);
    await expect(stub.choosePairwise("fac1", firstTarget, secondTarget)).resolves.toMatchObject({ success: true });
    await expect(stub.choosePairwise("p2", firstTarget, secondTarget)).resolves.toMatchObject({ success: true });
    await expect(stub.choosePairwise("p3", firstTarget, secondTarget)).resolves.toMatchObject({ success: true });
  
    await stub.setPhase("fac1", "review");
    const reviewState = await stub.getRoomStateForParticipant("fac1", fac.connectionToken);
  
    expect(reviewState.success).toBe(true);
    expect(reviewState.state?.pairwiseChoices).toEqual([
      { participantId: "__anonymous__-0", winner: firstTarget, loser: secondTarget, count: 3 },
    ]);
  });
  
  it("rejects invalid mixed vote targets and counts without mutating state or version", async () => {
    const stub = await init("test-v2-invalid-mixed-vote-targets");
    await stub.join("fac1", "Facilitator");
    const column = await stub.createColumn("fac1", "Lane");
    const groupedItem = await stub.addItem("fac1", "Grouped topic", column.column!.id);
    const ungroupedItem = await stub.addItem("fac1", "Ungrouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group target", column.column!.id);
    await stub.moveItemToGroup("fac1", groupedItem.item!.id, group.group!.id, 0, await freshMovePreconditions(stub, groupedItem.item!.id));
    await stub.setPhase("fac1", "vote");
  
    const before = await stub.getRoomState();
    const rejectedAttempts = [
      () => stub.castVote("missing", groupVoteTarget(group.group!.id), 1),
      () => stub.castVote("fac1", groupVoteTarget("missing-group"), 1),
      () => stub.castVote("fac1", itemVoteTarget("missing-item"), 1),
      () => stub.castVote("fac1", itemVoteTarget(groupedItem.item!.id), 1),
      () => stub.castVote("fac1", itemVoteTarget(ungroupedItem.item!.id), 0),
      () => stub.castVote("fac1", itemVoteTarget(ungroupedItem.item!.id), 1.5),
      () => stub.removeVote("fac1", itemVoteTarget(groupedItem.item!.id)),
      () => stub.removeVote("fac1", itemVoteTarget(ungroupedItem.item!.id)),
    ];
  
    for (const attempt of rejectedAttempts) {
      const result = await attempt();
      expect(result.success).toBe(false);
      expect(await stub.getRoomState()).toEqual(before);
    }
  });
  
  it("removes only the authenticated participant allocation for the selected mixed target", async () => {
    const stub = await init("test-v2-remove-mixed-votes");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const column = await stub.createColumn("fac1", "Lane");
    const ungroupedItem = await stub.addItem("fac1", "Ungrouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group target", column.column!.id);
    await stub.setPhase("fac1", "vote");
    await stub.castVote("fac1", groupVoteTarget(group.group!.id), 1);
    await stub.castVote("fac1", itemVoteTarget(ungroupedItem.item!.id), 2);
    await stub.castVote("p2", itemVoteTarget(ungroupedItem.item!.id), 1);
  
    expect(await stub.removeVote("fac1", itemVoteTarget(ungroupedItem.item!.id))).toMatchObject({ success: true });
  
    const state = await stub.getRoomState();
    expect(state.votes).toEqual([
      { participantId: "fac1", target: groupVoteTarget(group.group!.id), count: 1 },
      { participantId: "fac1", target: itemVoteTarget(ungroupedItem.item!.id), count: 1 },
      { participantId: "p2", target: itemVoteTarget(ungroupedItem.item!.id), count: 1 },
    ]);
  });
  
  it("projects other participants' votes anonymously in participant state", async () => {
    const stub = await init("test-v2-vote-privacy-projection");
    const fac = await stub.join("fac1", "Facilitator");
    const p2 = await stub.join("p2", "Participant");
    const column = await stub.createColumn("fac1", "Lane");
    const ungroupedItem = await stub.addItem("fac1", "Ungrouped topic", column.column!.id);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Group target", column.column!.id);
    await stub.setPhase("fac1", "vote");
    await stub.castVote("fac1", groupVoteTarget(group.group!.id), 2);
    await stub.castVote("p2", groupVoteTarget(group.group!.id), 1);
    await stub.castVote("p2", itemVoteTarget(ungroupedItem.item!.id), 1);
  
    const facState = await stub.getRoomStateForParticipant("fac1", fac.connectionToken);
    expect(facState.success).toBe(true);
    expect(facState.state?.votes).toEqual([
      { participantId: "fac1", target: groupVoteTarget(group.group!.id), count: 2 },
      { participantId: "__anonymous__", target: groupVoteTarget(group.group!.id), count: 1 },
      { participantId: "__anonymous__", target: itemVoteTarget(ungroupedItem.item!.id), count: 1 },
    ]);
    expect(facState.state?.votes.some((vote) => vote.participantId === "p2")).toBe(false);
  
    const p2State = await stub.getRoomStateForParticipant("p2", p2.connectionToken);
    expect(p2State.success).toBe(true);
    expect(p2State.state?.votes).toEqual([
      { participantId: "p2", target: groupVoteTarget(group.group!.id), count: 1 },
      { participantId: "p2", target: itemVoteTarget(ungroupedItem.item!.id), count: 1 },
      { participantId: "__anonymous__", target: groupVoteTarget(group.group!.id), count: 2 },
    ]);
  });
   });
