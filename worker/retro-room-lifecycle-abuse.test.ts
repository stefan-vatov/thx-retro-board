// @ts-expect-error -- cloudflare:workers vitest module
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getDefaultColumns, groupVoteTarget, itemVoteTarget } from "../src/domain";
import { initRaw, init, deleteAllColumns } from "./retro-room-test-helpers";

describe("RetroRoom lifecycle and abuse controls", () => {
  it("initializes new rooms as v2 with customer-ready default columns", async () => {
    const stub = await initRaw("test-v2-empty-room");
  
    const state = await stub.getRoomState();
    expect(state.schemaVersion).toBe(2);
    expect(state.roomId).toBe("test-v2-empty-room");
    expect(state.phase).toBe("setup");
    expect(state.columns).toEqual(getDefaultColumns());
    expect(state.groups).toEqual([]);
    expect(state.items).toEqual([]);
    expect(state.votes).toEqual([]);
    expect(state.rankingMethod).toBe("score");
    expect(state.pairwiseChoices).toEqual([]);
    expect(state.actions).toEqual([]);
    expect(state.reactions).toEqual([]);
    expect(state.columns.map((column) => column.name)).toEqual(["Mad", "Glad", "Sad"]);
  });
  
  it("resets incompatible legacy board content on load", async () => {
    const roomId = "test-v2-legacy-reset";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      phase: "vote",
      items: [{ id: "legacy-item", text: "Old item", authorId: "fac1", columnId: "start", groupId: "start", order: 0 }],
      groups: [{ id: "start", name: "Start", order: 0 }],
      votes: [{ participantId: "fac1", itemId: "legacy-item", count: 3 }],
      version: 41,
    } as never);
  
    const state = await stub.getRoomState();
    expect(state.schemaVersion).toBe(2);
    expect(state.phase).toBe("setup");
    expect(state.participants).toEqual([{ id: "fac1", displayName: "Facilitator", isFacilitator: true }]);
    expect(state.columns).toEqual(getDefaultColumns());
    expect(state.groups).toEqual([]);
    expect(state.items).toEqual([]);
    expect(state.votes).toEqual([]);
    expect(state.actions).toEqual([]);
    expect(state.reactions).toEqual([]);
  });
  
  it("toggles realtime reactions on cards and groups while validating targets", async () => {
    const stub = await init("test-v2-reactions");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const columnId = (await stub.getRoomState()).columns[0]!.id;
    const item = await stub.addItem("fac1", "Reactable card", columnId);
    expect(item.success).toBe(true);
  
    await expect(stub.toggleReaction("p2", itemVoteTarget(item.item!.id), "👍")).resolves.toMatchObject({ success: true });
    await expect(stub.toggleReaction("fac1", itemVoteTarget(item.item!.id), "👍")).resolves.toMatchObject({ success: true });
    let state = await stub.getRoomState();
    expect(state.reactions).toEqual([
      { participantId: "p2", target: itemVoteTarget(item.item!.id), emoji: "👍" },
      { participantId: "fac1", target: itemVoteTarget(item.item!.id), emoji: "👍" },
    ]);
  
    await expect(stub.toggleReaction("p2", itemVoteTarget(item.item!.id), "👍")).resolves.toMatchObject({ success: true });
    state = await stub.getRoomState();
    expect(state.reactions).toEqual([{ participantId: "fac1", target: itemVoteTarget(item.item!.id), emoji: "👍" }]);
  
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Reactable group", columnId);
    expect(group.success).toBe(true);
    await expect(stub.toggleReaction("p2", groupVoteTarget(group.group!.id), "🔥")).resolves.toMatchObject({ success: true });
    await expect(stub.toggleReaction("p2", groupVoteTarget(group.group!.id), "not-emoji")).resolves.toMatchObject({ success: false });
    await expect(stub.toggleReaction("p2", itemVoteTarget("missing-item"), "👍")).resolves.toMatchObject({ success: false });
  
    state = await stub.getRoomState();
    expect(state.reactions).toEqual([
      { participantId: "fac1", target: itemVoteTarget(item.item!.id), emoji: "👍" },
      { participantId: "p2", target: groupVoteTarget(group.group!.id), emoji: "🔥" },
    ]);
  });
  
  it("creates, edits, and deletes collaborative action items only during review", async () => {
    const stub = await init("test-v2-review-actions");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
  
    const beforeReview = await stub.getRoomState();
    await expect(stub.createAction("p2", "Follow up before review")).resolves.toMatchObject({ success: false });
    expect(await stub.getRoomState()).toEqual(beforeReview);
  
    await stub.setPhase("fac1", "organise");
    await stub.setPhase("fac1", "vote");
    await stub.setPhase("fac1", "review");
  
    const created = await stub.createAction("p2", "  Book incident follow-up  ");
    expect(created.success).toBe(true);
    expect(created.action).toMatchObject({
      text: "Book incident follow-up",
      authorId: "p2",
      order: 0,
    });
  
    const edited = await stub.editAction("fac1", created.action!.id, "Confirm owner for rollout checklist");
    expect(edited.success).toBe(true);
  
    let state = await stub.getRoomState();
    expect(state.actions).toEqual([
      {
        id: created.action!.id,
        text: "Confirm owner for rollout checklist",
        authorId: "p2",
        order: 0,
      },
    ]);
  
    const second = await stub.createAction("fac1", "Second action");
    expect(second.success).toBe(true);
    const deletedByOtherParticipant = await stub.deleteAction("p2", second.action!.id);
    expect(deletedByOtherParticipant.success).toBe(true);
  
    state = await stub.getRoomState();
    expect(state.actions).toEqual([
      {
        id: created.action!.id,
        text: "Confirm owner for rollout checklist",
        authorId: "p2",
        order: 0,
      },
    ]);
  
    await stub.setPhase("fac1", "finalize");
    const beforeLateDelete = await stub.getRoomState();
    await expect(stub.deleteAction("fac1", created.action!.id)).resolves.toMatchObject({ success: false });
    expect(await stub.getRoomState()).toEqual(beforeLateDelete);
  });
  
  it("lets only the facilitator move the shared review slide during review", async () => {
    const stub = await init("test-v2-review-target-sync");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
    const columnId = (await stub.getRoomState()).columns[0]!.id;
    const item = await stub.addItem("fac1", "Review target card", columnId);
    expect(item.success).toBe(true);
    await stub.setPhase("fac1", "organise");
    const group = await stub.createGroup("fac1", "Review target group", columnId);
    expect(group.success).toBe(true);
    await stub.setPhase("fac1", "vote");
    await stub.setPhase("fac1", "review");
  
    const targetKey = "group:" + group.group!.id;
    await expect(stub.setReviewTarget("p2", targetKey)).resolves.toMatchObject({
      success: false,
      error: "Only the facilitator can change review slide",
    });
    expect((await stub.getRoomState()).reviewTargetKey).toBeNull();
  
    await expect(stub.setReviewTarget("fac1", targetKey)).resolves.toMatchObject({ success: true });
    expect((await stub.getRoomState()).reviewTargetKey).toBe(targetKey);
    await expect(stub.setReviewTarget("fac1", "item:missing")).resolves.toMatchObject({
      success: false,
      error: "Review target not found",
    });
  });
  
  it("locks setup-only decisions after setup and requires at least one column before write", async () => {
    const stub = await initRaw("test-v2-setup-locks");
    await stub.join("fac1", "Facilitator");
  
    expect(await stub.setVoteBudget("fac1", 8)).toMatchObject({ success: true });
    await deleteAllColumns(stub);
    const blocked = await stub.setPhase("fac1", "write");
    expect(blocked).toMatchObject({ success: false, error: "Add at least one column before starting write phase" });
    expect((await stub.getRoomState()).phase).toBe("setup");
  
    const column = await stub.createColumn("fac1", "Only lane");
    expect(column.success).toBe(true);
    expect(await stub.setPhase("fac1", "write")).toMatchObject({ success: true });
    expect(await stub.setVoteBudget("fac1", 3)).toMatchObject({ success: false, error: "Vote budget can only be changed during setup" });
    expect((await stub.getRoomState()).voteBudget).toBe(8);
  });
  
  it("purges stored room data after the empty-room alarm fires", async () => {
    const roomId = "test-v2-empty-room-purge";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      purgeScheduledAt: Date.now() - 1,
    });
  
    const state = await stub.getRoomState();
    expect(state.purgeScheduledAt).toBeLessThanOrEqual(Date.now());
  
    await stub.runEmptyRoomAlarmForTest();
  
    await expect(stub.hasRoom()).resolves.toBe(false);
  });
  
  it("ignores stale empty-room alarms before the scheduled purge time", async () => {
    const roomId = "test-v2-empty-room-stale-alarm";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      purgeScheduledAt: Date.now() + 60_000,
    });
  
    await stub.runEmptyRoomAlarmForTest();
  
    await expect(stub.hasRoom()).resolves.toBe(true);
  });
  
  it("purges rooms past the absolute lifetime even when a websocket session is active", async () => {
    const roomId = "test-v2-absolute-room-lifetime-purge";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      startedAt: Date.now() - 13 * 60 * 60 * 1000,
      purgeScheduledAt: Date.now() + 60_000,
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      connectionTokens: { fac1: "token" },
    });
  
    const ticket = await stub.createWebSocketTicket("fac1", "token");
    expect(ticket).toMatchObject({ success: true });
    const response = await stub.fetch(new Request("http://do/ws", {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `ticket-${ticket.ticket}`,
      },
    }));
    expect(response.status).toBe(101);
  
    await stub.runEmptyRoomAlarmForTest();
  
    await expect(stub.hasRoom()).resolves.toBe(false);
  });
  
  it("purges rooms past the absolute lifetime on access even if the alarm was missed", async () => {
    const roomId = "test-v2-absolute-room-lifetime-access-purge";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    await stub.seedStoredStateForTest({
      roomId,
      startedAt: Date.now() - 13 * 60 * 60 * 1000,
      purgeScheduledAt: null,
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      connectionTokens: { fac1: "token" },
    });
  
    await expect(stub.hasRoom()).resolves.toBe(false);
    await expect(stub.getRoomStateForParticipant("fac1", "token")).resolves.toMatchObject({
      success: false,
      error: "Room not found",
    });
  });
  
  it("lets only the facilitator manually purge room data", async () => {
    const stub = await initRaw("test-v2-manual-purge");
    await stub.join("fac1", "Facilitator");
    await stub.join("p2", "Participant");
  
    await expect(stub.purgeByFacilitator("p2")).resolves.toMatchObject({
      success: false,
      error: "Only the facilitator can delete room data",
    });
    await expect(stub.hasRoom()).resolves.toBe(true);
  
    await expect(stub.purgeByFacilitator("fac1")).resolves.toMatchObject({ success: true });
    await expect(stub.hasRoom()).resolves.toBe(false);
  });
  
  it("enforces generous public-room caps before storing more data", async () => {
    const roomId = "test-v2-public-room-caps";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    const columns = getDefaultColumns();
    const firstColumnId = columns[0]!.id;
  
    await stub.seedStoredStateForTest({
      roomId,
      phase: "setup",
      columns,
      groups: [],
      items: [],
      votes: [],
      participants: Array.from({ length: 100 }, (_, index) => ({
        id: `p${index}`,
        displayName: `Participant ${index}`,
        isFacilitator: index === 0,
      })),
      facilitatorId: "p0",
    });
    await expect(stub.join("p-over-limit", "Overflow")).resolves.toMatchObject({
      success: false,
      error: "Rooms can have at most 100 participants",
    });
  
    await stub.seedStoredStateForTest({
      roomId,
      phase: "write",
      columns,
      groups: [],
      items: Array.from({ length: 400 }, (_, index) => ({
        id: `item-${index}`,
        text: `Item ${index}`,
        authorId: "fac1",
        columnId: firstColumnId,
        groupId: null,
        order: index,
      })),
      votes: [],
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
    });
    await expect(stub.addItem("fac1", "One too many", firstColumnId)).resolves.toMatchObject({
      success: false,
      error: "Rooms can have at most 400 cards",
    });
  });
  
  it("allows only one outstanding websocket ticket per participant and invalidates tickets on token rotation", async () => {
    const stub = await initRaw("test-v2-ws-ticket-rotation");
    const joined = await stub.join("fac1", "Facilitator");
    expect(joined.success).toBe(true);
  
    const firstTicket = await stub.createWebSocketTicket("fac1", joined.connectionToken);
    expect(firstTicket).toMatchObject({ success: true });
    const secondTicket = await stub.createWebSocketTicket("fac1", joined.connectionToken);
    expect(secondTicket).toMatchObject({ success: true });
    expect(secondTicket.ticket).not.toBe(firstTicket.ticket);
  
    const firstResponse = await stub.fetch(new Request("http://do/ws", {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `ticket-${firstTicket.ticket}`,
      },
    }));
    expect(firstResponse.status).toBe(403);
  
    const rejoined = await stub.join("fac1", "Facilitator", joined.connectionToken);
    expect(rejoined.success).toBe(true);
    const staleResponse = await stub.fetch(new Request("http://do/ws", {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": `ticket-${secondTicket.ticket}`,
      },
    }));
    expect(staleResponse.status).toBe(403);
  });
  
  it("caps realtime messages per participant and per room window", async () => {
    const stub = await initRaw("test-v2-ws-room-rate-limit");
    const now = Date.now();
  
    for (let index = 0; index < 20; index += 1) {
      await expect(stub.allowWebSocketMessageForTest("fac1", now)).resolves.toEqual({ allowed: true });
    }
    await expect(stub.allowWebSocketMessageForTest("fac1", now)).resolves.toMatchObject({
      allowed: false,
      reason: "Too many realtime updates. Reconnect and slow down.",
    });
    await expect(stub.allowWebSocketMessageForTest("fac1", now + 10_000)).resolves.toEqual({ allowed: true });
  
    for (let index = 0; index < 60; index += 1) {
      await expect(stub.allowWebSocketMessageForTest(`p-${index}`, now + 20_000)).resolves.toEqual({ allowed: true });
    }
    await expect(stub.allowWebSocketMessageForTest("p-over-room-limit", now + 20_000)).resolves.toMatchObject({
      allowed: false,
      reason: "This room is receiving too many realtime updates. Please slow down.",
    });
  });
  
  it("caps pairwise target counts before storing large comparison sets", async () => {
    const roomId = "test-v2-pairwise-target-cap";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    const columns = getDefaultColumns();
    const firstColumnId = columns[0]!.id;
  
    await stub.seedStoredStateForTest({
      roomId,
      phase: "vote",
      rankingMethod: "pairwise",
      columns,
      groups: [],
      votes: [],
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      items: Array.from({ length: 51 }, (_, index) => ({
        id: `item-${index}`,
        text: `Item ${index}`,
        authorId: "fac1",
        columnId: firstColumnId,
        groupId: null,
        order: index,
      })),
    });
  
    await expect(stub.choosePairwise("fac1", itemVoteTarget("item-0"), itemVoteTarget("item-1"))).resolves.toMatchObject({
      success: false,
      error: "Pairwise ranking supports at most 50 cards or groups",
    });
  });
  
  it("blocks entering pairwise vote when the board has too many decision targets", async () => {
    const roomId = "test-v2-pairwise-target-cap-phase";
    const id = env.RETRO_ROOM.idFromName(roomId);
    const stub = env.RETRO_ROOM.get(id);
    const columns = getDefaultColumns();
    const firstColumnId = columns[0]!.id;
  
    await stub.seedStoredStateForTest({
      roomId,
      phase: "organise",
      rankingMethod: "pairwise",
      columns,
      groups: [],
      votes: [],
      participants: [{ id: "fac1", displayName: "Facilitator", isFacilitator: true }],
      facilitatorId: "fac1",
      items: Array.from({ length: 51 }, (_, index) => ({
        id: `item-${index}`,
        text: `Item ${index}`,
        authorId: "fac1",
        columnId: firstColumnId,
        groupId: null,
        order: index,
      })),
    });
  
    await expect(stub.setPhase("fac1", "vote")).resolves.toMatchObject({
      success: false,
      error: "Pairwise ranking supports at most 50 cards or groups",
    });
    expect((await stub.getRoomState()).phase).toBe("organise");
  });
   });
