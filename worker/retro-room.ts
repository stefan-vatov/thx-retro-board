import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import type { Env } from "./index";
import type {
  RoomState,
  Phase,
  Participant,
  RetroItem,
  ActionItem,
  ReactionTarget,
  VoteTarget,
  RankingMethod,
  ServerToClientMessage,
} from "../src/domain";
import type {
  ItemReorderPreconditions,
  MoveItemPreconditions,
  StoredState,
  WebSocketTicket,
} from "./room-types";
import {
  EMPTY_ROOM_PURGE_DELAY_MS,
  MAX_ROOM_LIFETIME_MS,
  MAX_WEBSOCKET_MESSAGE_BYTES,
  WEBSOCKET_TICKET_TTL_MS,
} from "./room-types";

import {
  authorizeParticipantEffect,
  parseClientWebSocketMessageEffect,
  validatePairwiseChoiceEffect,
  validateParticipantJoinEffect,
  validateRankingMethodChangeEffect,
  validateReactionToggleEffect,
  validateVoteBudgetChangeEffect,
  validateVoteCastEffect,
  validateVoteRemoveEffect,
} from "./validation";
import { handleRoomHttpRequest } from "./room-http";
import {
  createActionForRoom,
  deleteActionForRoom,
  editActionForRoom,
} from "./room-actions";
import {
  createColumnForRoom,
  deleteColumnForRoom,
  editColumnForRoom,
  reorderColumnsForRoom,
} from "./room-columns";
import type { RoomCommandHost } from "./room-command-host";
import {
  createGroupForRoom,
  deleteGroupForRoom,
  editGroupForRoom,
  moveItemToGroupForRoom,
  reorderGroupsForRoom,
  reorderItemsForRoom,
} from "./room-groups";
import { addItemForRoom, deleteItemForRoom, editItemForRoom } from "./room-items";
import { toRoomState } from "./room-presenter";
import { setPhaseForRoom, setReviewTargetForRoom, setTimerForRoom } from "./room-phase";
import { handleRoomRealtimeMessage } from "./room-realtime";
import { RoomRealtimeLimiter } from "./room-realtime-limits";
import { createInitialStoredState, hydrateStoredState } from "./room-storage";
import { generateToken, getWebSocketTicket } from "./room-tickets";

export class RetroRoom extends DurableObject<Env> {
  private state: StoredState | null = null;
  private sessions = new Map<string, WebSocket>();
  private realtimeLimiter = new RoomRealtimeLimiter();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Restore session map from hibernated WebSockets
    for (const ws of ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as { participantId: string } | null;
      if (attachment?.participantId) {
        this.sessions.set(attachment.participantId, ws);
      }
    }
  }

  private async loadState(): Promise<StoredState> {
    if (this.state) return this.state;
    const stored = await this.ctx.storage.get<StoredState>("room");
    if (stored) {
      this.state = hydrateStoredState(stored);
      await this.ctx.storage.put("room", this.state);
      return this.state;
    }
    return this.state!;
  }

  private async cancelEmptyRoomPurge(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    if (this.state && this.state.purgeScheduledAt !== null) {
      this.state.purgeScheduledAt = null;
      await this.saveState();
    }
    if (this.state) {
      await this.ctx.storage.setAlarm(this.getAbsoluteRoomExpiresAt(this.state));
    }
  }

  private async scheduleEmptyRoomPurge(): Promise<void> {
    const s = await this.loadState();
    if (this.sessions.size > 0) {
      await this.ctx.storage.setAlarm(this.getAbsoluteRoomExpiresAt(s));
      return;
    }
    const purgeScheduledAt = Date.now() + EMPTY_ROOM_PURGE_DELAY_MS;
    s.purgeScheduledAt = purgeScheduledAt;
    await this.ctx.storage.setAlarm(Math.min(purgeScheduledAt, this.getAbsoluteRoomExpiresAt(s)));
    await this.saveState();
  }

  private getAbsoluteRoomExpiresAt(s: Pick<StoredState, "startedAt">): number {
    return (s.startedAt ?? Date.now()) + MAX_ROOM_LIFETIME_MS;
  }

  private async purgeRoom(reason: string): Promise<void> {
    this.broadcast({ type: "room-purged", reason });
    for (const ws of this.sessions.values()) {
      try {
        ws.close(1000, "Room data deleted");
      } catch {
        // Ignore already-closing sockets.
      }
    }
    this.sessions.clear();
    this.state = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private isPastAbsoluteRoomLifetime(s: Pick<StoredState, "startedAt">): boolean {
    return Date.now() >= this.getAbsoluteRoomExpiresAt(s);
  }

  private commandHost(): RoomCommandHost {
    return {
      loadState: () => this.loadState(),
      saveState: () => this.saveState(),
      broadcast: (message, excludeId) => this.broadcast(message, excludeId),
      broadcastState: (state, excludeId) => this.broadcastState(state, excludeId),
    };
  }

  private async purgeIfExpired(stored?: StoredState | null): Promise<boolean> {
    const state = stored ?? await this.ctx.storage.get<StoredState>("room");
    if (!state || !this.isPastAbsoluteRoomLifetime(state)) return false;
    await this.purgeRoom("Room data was deleted after reaching the maximum room lifetime.");
    return true;
  }

  override async alarm(): Promise<void> {
    const stored = await this.ctx.storage.get<StoredState>("room");
    if (!stored) return;
    if (await this.purgeIfExpired(stored)) return;
    const purgeScheduledAt = typeof stored.purgeScheduledAt === "number" && Number.isFinite(stored.purgeScheduledAt)
      ? stored.purgeScheduledAt
      : null;
    if (purgeScheduledAt === null || Date.now() < purgeScheduledAt) {
      return;
    }
    if (this.sessions.size > 0) {
      await this.cancelEmptyRoomPurge();
      return;
    }
    await this.purgeRoom("Room data was deleted after one hour without active participants.");
  }

  private async saveState(): Promise<void> {
    if (this.state) {
      this.state.schemaVersion = 2;
      this.state.version += 1;
      await this.ctx.storage.put("room", this.state);
    }
  }

  async initRoom(roomId: string, facilitatorClaimToken: string | null = null): Promise<void> {
    const existing = await this.ctx.storage.get<StoredState>("room");
    if (existing) {
      this.state = null;
      await this.loadState();
      return;
    }
    this.state = createInitialStoredState(roomId, facilitatorClaimToken);
    await this.saveState();
    await this.scheduleEmptyRoomPurge();
  }

  async getRoomState(): Promise<RoomState> {
    const s = await this.loadState();
    return toRoomState(s);
  }

  async getRoomStateForParticipant(participantId: string, connectionToken: unknown): Promise<{ success: boolean; error?: string; state?: RoomState }> {
    const s = await this.loadState();
    const auth = await Effect.runPromise(Effect.either(authorizeParticipantEffect(s, participantId, connectionToken)));
    if (auth._tag === "Left") return { success: false, error: auth.left.message };
    return { success: true, state: toRoomState(s, auth.right.participantId) };
  }

  async hasRoom(): Promise<boolean> {
    const stored = await this.ctx.storage.get<StoredState>("room");
    if (stored && await this.purgeIfExpired(stored)) return false;
    return stored !== undefined;
  }

  async join(participantId: string, displayName: string, connectionToken?: string, facilitatorClaimToken?: unknown): Promise<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }> {
    const s = await this.loadState();
    const validation = await Effect.runPromise(Effect.either(validateParticipantJoinEffect(
      s,
      participantId,
      displayName,
      connectionToken,
      facilitatorClaimToken,
    )));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }
    const validated = validation.right;

    if (validated.existing) {
      if (validated.shouldClaimFacilitator) {
        s.facilitatorId = participantId;
        s.facilitatorClaimToken = null;
        s.participants = s.participants.map((participant) =>
          participant.id === participantId ? { ...participant, isFacilitator: true } : participant,
        );
      }
      await this.cancelEmptyRoomPurge();
      this.closeParticipantSocket(participantId, "Participant reconnected");
      await this.deleteOutstandingWebSocketTicket(participantId);
      const token = generateToken();
      s.connectionTokens[participantId] = token;
      await this.saveState();

      // Broadcast participant presence to other clients on reconnect
      const broadcast: ServerToClientMessage = {
        type: "participant-joined",
        participant: validated.existing,
      };
      this.broadcast(broadcast, participantId);

      if (this.sessions.size === 0) {
        await this.scheduleEmptyRoomPurge();
      }

      return { success: true, state: toRoomState(s, participantId), connectionToken: token };
    }

    await this.cancelEmptyRoomPurge();
    const participant: Participant = {
      id: participantId,
      displayName: validated.displayName,
      isFacilitator: validated.isFacilitator,
    };
    s.participants.push(participant);
    if (validated.isFacilitator) {
      s.facilitatorId = participantId;
      s.facilitatorClaimToken = null;
    }
    const token = generateToken();
    s.connectionTokens[participantId] = token;
    await this.saveState();

    const broadcast: ServerToClientMessage = {
      type: "participant-joined",
      participant,
    };
    this.broadcast(broadcast, participantId);

    this.broadcastState(s, participantId);
    if (this.sessions.size === 0) {
      await this.scheduleEmptyRoomPurge();
    }

    return { success: true, state: toRoomState(s, participantId), connectionToken: token };
  }

  async purgeByFacilitator(participantId: string): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (s.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can delete room data" };
    }
    await this.purgeRoom("The facilitator deleted this room's data.");
    return { success: true };
  }

  async setVoteBudget(participantId: string, budget: number): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    let validated: { budget: number };
    try {
      validated = await Effect.runPromise(validateVoteBudgetChangeEffect(s, participantId, budget));
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Vote budget validation failed",
      };
    }
    s.voteBudget = validated.budget;
    await this.saveState();
    this.broadcastState(s);
    return { success: true };
  }

  async setRankingMethod(participantId: string, rankingMethod: RankingMethod): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    let validated: { rankingMethod: RankingMethod };
    try {
      validated = await Effect.runPromise(validateRankingMethodChangeEffect(s, participantId, rankingMethod));
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Ranking method validation failed",
      };
    }

    s.rankingMethod = validated.rankingMethod;
    s.votes = [];
    s.pairwiseChoices = [];
    await this.saveState();
    this.broadcast({ type: "ranking-method-changed", rankingMethod: validated.rankingMethod });
    this.broadcastState(s);
    return { success: true };
  }

  async addItem(participantId: string, rawText: string, columnId?: unknown): Promise<{ success: boolean; error?: string; item?: RetroItem }> {
    return addItemForRoom(this.commandHost(), participantId, rawText, columnId);
  }

  async editItem(participantId: string, itemId: string, rawText: string): Promise<{ success: boolean; error?: string; item?: RetroItem }> {
    return editItemForRoom(this.commandHost(), participantId, itemId, rawText);
  }

  async deleteItem(participantId: string, itemId: string): Promise<{ success: boolean; error?: string }> {
    return deleteItemForRoom(this.commandHost(), participantId, itemId);
  }

  async createAction(participantId: string, rawText: string): Promise<{ success: boolean; error?: string; action?: ActionItem }> {
    return createActionForRoom(this.commandHost(), participantId, rawText);
  }

  async editAction(participantId: string, actionId: string, rawText: string): Promise<{ success: boolean; error?: string; action?: ActionItem }> {
    return editActionForRoom(this.commandHost(), participantId, actionId, rawText);
  }

  async deleteAction(participantId: string, actionId: string): Promise<{ success: boolean; error?: string }> {
    return deleteActionForRoom(this.commandHost(), participantId, actionId);
  }

  async setPhase(participantId: string, phase: Phase): Promise<{ success: boolean; error?: string }> {
    return setPhaseForRoom(this.commandHost(), participantId, phase);
  }

  async setTimer(participantId: string, durationSeconds: number): Promise<{ success: boolean; error?: string }> {
    return setTimerForRoom(this.commandHost(), participantId, durationSeconds);
  }

  async setReviewTarget(participantId: string, reviewTargetKey: string | null): Promise<{ success: boolean; error?: string }> {
    return setReviewTargetForRoom(this.commandHost(), participantId, reviewTargetKey);
  }

  private hasParticipant(s: StoredState, participantId: string): boolean {
    return s.participants.some((participant) => participant.id === participantId);
  }

  private closeParticipantSocket(participantId: string, reason: string): void {
    const existing = this.sessions.get(participantId);
    if (!existing) return;
    try {
      existing.close(1000, reason);
    } catch {
      // Ignore already-closing sockets.
    }
    this.sessions.delete(participantId);
    this.realtimeLimiter.removeParticipant(participantId);
  }

  private async deleteOutstandingWebSocketTicket(participantId: string): Promise<void> {
    const existingTicket = await this.ctx.storage.get<string>(`ws-ticket-by-participant:${participantId}`);
    if (existingTicket) {
      await this.ctx.storage.delete(`ws-ticket:${existingTicket}`);
    }
    await this.ctx.storage.delete(`ws-ticket-by-participant:${participantId}`);
  }

  async createWebSocketTicket(participantId: string, connectionToken: unknown): Promise<{ success: boolean; error?: string; ticket?: string }> {
    const s = await this.loadState();
    const auth = await Effect.runPromise(Effect.either(authorizeParticipantEffect(s, participantId, connectionToken)));
    if (auth._tag === "Left") return { success: false, error: auth.left.message };

    await this.deleteOutstandingWebSocketTicket(auth.right.participantId);

    const ticket = generateToken();
    const record: WebSocketTicket = {
      participantId: auth.right.participantId,
      expiresAt: Date.now() + WEBSOCKET_TICKET_TTL_MS,
    };
    await Promise.all([
      this.ctx.storage.put(`ws-ticket:${ticket}`, record),
      this.ctx.storage.put(`ws-ticket-by-participant:${auth.right.participantId}`, ticket),
    ]);
    return { success: true, ticket };
  }

  private async consumeWebSocketTicket(ticket: string | null): Promise<{ success: true; participantId: string } | { success: false; error: string }> {
    if (typeof ticket !== "string" || ticket.length !== 64 || !/^[a-f0-9]+$/.test(ticket)) {
      return { success: false, error: "Missing or invalid websocket ticket" };
    }

    const key = `ws-ticket:${ticket}`;
    const record = await this.ctx.storage.get<WebSocketTicket>(key);
    await this.ctx.storage.delete(key);
    if (
      !record
      || typeof record.participantId !== "string"
      || typeof record.expiresAt !== "number"
    ) {
      return { success: false, error: "Missing or invalid websocket ticket" };
    }
    const participantTicketKey = `ws-ticket-by-participant:${record.participantId}`;
    const currentParticipantTicket = await this.ctx.storage.get<string>(participantTicketKey);
    if (currentParticipantTicket === ticket) {
      await this.ctx.storage.delete(participantTicketKey);
    }
    if (record.expiresAt < Date.now()) {
      return { success: false, error: "Websocket ticket expired" };
    }

    const s = await this.loadState();
    if (!this.hasParticipant(s, record.participantId)) {
      return { success: false, error: "Participant not found" };
    }
    return { success: true, participantId: record.participantId };
  }

  private allowWebSocketMessage(participantId: string, now = Date.now()): { allowed: true } | { allowed: false; reason: string } {
    return this.realtimeLimiter.allow(participantId, now);
  }

  authorizeHttpParticipant(
    participantId: unknown,
    connectionToken: unknown,
  ): Promise<{ success: true; participantId: string; state: StoredState } | { success: false; error: string }> {
    return this.loadState().then((s) => this.authorizeLoadedParticipant(s, participantId, connectionToken));
  }

  private authorizeLoadedParticipant(
    s: StoredState,
    participantId: unknown,
    connectionToken: unknown,
  ): Promise<{ success: true; participantId: string; state: StoredState } | { success: false; error: string }> {
    return Effect.runPromise(Effect.either(authorizeParticipantEffect(s, participantId, connectionToken))).then((auth) =>
      auth._tag === "Left"
        ? { success: false, error: auth.left.message }
        : { success: true, participantId: auth.right.participantId, state: s },
    );
  }

  async createColumn(participantId: string, rawName: string): ReturnType<typeof createColumnForRoom> {
    return createColumnForRoom(this.commandHost(), participantId, rawName);
  }

  async editColumn(participantId: string, columnId: string, rawName: string): ReturnType<typeof editColumnForRoom> {
    return editColumnForRoom(this.commandHost(), participantId, columnId, rawName);
  }

  async reorderColumns(participantId: string, orderedIds: unknown): ReturnType<typeof reorderColumnsForRoom> {
    return reorderColumnsForRoom(this.commandHost(), participantId, orderedIds);
  }

  async deleteColumn(participantId: string, columnId: string): ReturnType<typeof deleteColumnForRoom> {
    return deleteColumnForRoom(this.commandHost(), participantId, columnId);
  }

  async createGroup(participantId: string, rawName: string, columnId?: string): ReturnType<typeof createGroupForRoom> {
    return createGroupForRoom(this.commandHost(), participantId, rawName, columnId);
  }

  async reorderItems(
    participantId: string,
    orderedIds: unknown,
    preconditions?: Partial<ItemReorderPreconditions>,
  ): ReturnType<typeof reorderItemsForRoom> {
    return reorderItemsForRoom(this.commandHost(), participantId, orderedIds, preconditions);
  }

  async editGroup(participantId: string, groupId: string, rawName: string): ReturnType<typeof editGroupForRoom> {
    return editGroupForRoom(this.commandHost(), participantId, groupId, rawName);
  }

  async deleteGroup(participantId: string, groupId: string): ReturnType<typeof deleteGroupForRoom> {
    return deleteGroupForRoom(this.commandHost(), participantId, groupId);
  }

  async reorderGroups(participantId: string, orderedIds: unknown, expectedVersion?: unknown): ReturnType<typeof reorderGroupsForRoom> {
    return reorderGroupsForRoom(this.commandHost(), participantId, orderedIds, expectedVersion);
  }

  async moveItemToGroup(
    participantId: string,
    itemId: string,
    targetGroupId: string | null,
    targetIndex: number,
    preconditions?: Partial<MoveItemPreconditions>,
  ): ReturnType<typeof moveItemToGroupForRoom> {
    return moveItemToGroupForRoom(this.commandHost(), participantId, itemId, targetGroupId, targetIndex, preconditions);
  }

  async toggleReaction(participantId: string, target: ReactionTarget, emoji: string): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    const validation = await Effect.runPromise(Effect.either(validateReactionToggleEffect(s, participantId, target, emoji)));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }
    s.reactions = validation.right.reactions;
    await this.saveState();
    this.broadcastState(s);
    return { success: true };
  }

  async castVote(participantId: string, targetOrGroupId: VoteTarget | string, count: number): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    const validation = await Effect.runPromise(Effect.either(validateVoteCastEffect(s, participantId, targetOrGroupId, count)));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.votes = validation.right.votes;
    await this.saveState();

    this.broadcastState(s);

    return { success: true };
  }

  async removeVote(participantId: string, targetOrGroupId: VoteTarget | string): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    const validation = await Effect.runPromise(Effect.either(validateVoteRemoveEffect(s, participantId, targetOrGroupId)));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.votes = validation.right.votes;
    await this.saveState();

    this.broadcastState(s);

    return { success: true };
  }

  async choosePairwise(participantId: string, winner: VoteTarget, loser: VoteTarget): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    const validation = await Effect.runPromise(Effect.either(validatePairwiseChoiceEffect(s, participantId, winner, loser)));
    if (validation._tag === "Left") {
      return { success: false, error: validation.left.message };
    }

    s.pairwiseChoices = validation.right.pairwiseChoices;
    await this.saveState();

    this.broadcastState(s);

    return { success: true };
  }

  private broadcast(message: ServerToClientMessage, excludeId?: string) {
    const payload = JSON.stringify(message);
    for (const [id, ws] of this.sessions) {
      if (id !== excludeId && ws.readyState === WebSocket.READY_STATE_OPEN) {
        ws.send(payload);
      }
    }
  }

  private broadcastState(s: StoredState, excludeId?: string) {
    for (const [participantId, ws] of this.sessions) {
      if (participantId === excludeId || ws.readyState !== WebSocket.READY_STATE_OPEN) continue;
      ws.send(JSON.stringify({ type: "snapshot", state: toRoomState(s, participantId) }));
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const httpResponse = await handleRoomHttpRequest(this, request);
    if (httpResponse) return httpResponse;

    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

      const ticket = await this.consumeWebSocketTicket(getWebSocketTicket(request));
      if (!ticket.success) {
        return new Response(JSON.stringify({ error: ticket.error }), { status: 403 });
      }

      const participantId = ticket.participantId;
      const s = await this.loadState();
      await this.cancelEmptyRoomPurge();
      this.closeParticipantSocket(participantId, "Participant opened a new connection");
      this.sessions.set(participantId, server);
      server.serializeAttachment({ participantId });
      this.ctx.acceptWebSocket(server);

      // Broadcast reconnecting participant presence to other clients
      const participant = s.participants.find((p) => p.id === participantId);
      if (participant) {
        const presenceMsg: ServerToClientMessage = {
          type: "participant-joined",
          participant,
        };
        this.broadcast(presenceMsg, participantId);
      }

      const snapshot = toRoomState(s, participantId);
      server.send(JSON.stringify({ type: "snapshot", state: snapshot }));

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "Sec-WebSocket-Protocol": "retro-board" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as { participantId: string } | null;
    const participantId = attachment?.participantId;
    if (!participantId) return;
    if (this.sessions.get(participantId) !== ws) {
      try {
        ws.close(1008, "Obsolete realtime session");
      } catch {
        // Ignore already-closing sockets.
      }
      return;
    }

    try {
      const rateLimit = this.allowWebSocketMessage(participantId);
      if (!rateLimit.allowed) {
        ws.send(JSON.stringify({ type: "error", message: rateLimit.reason }));
        ws.close(1008, "Realtime rate limit exceeded");
        return;
      }
      const messageSize = typeof message === "string" ? message.length : message.byteLength;
      if (messageSize > MAX_WEBSOCKET_MESSAGE_BYTES) {
        ws.send(JSON.stringify({ type: "error", message: "Message is too large" }));
        return;
      }
      const msg = await Effect.runPromise(parseClientWebSocketMessageEffect(message));
      await handleRoomRealtimeMessage(this, participantId, msg);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
    }
  }

  override webSocketClose(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as { participantId: string } | null;
    const participantId = attachment?.participantId;
    if (!participantId) return;

    if (this.sessions.get(participantId) !== ws) return;
    this.sessions.delete(participantId);
    this.realtimeLimiter.removeParticipant(participantId);
    const leftMsg: ServerToClientMessage = { type: "participant-left", participantId };
    this.broadcast(leftMsg);
    this.ctx.waitUntil(this.scheduleEmptyRoomPurge());
  }

  sendParticipantError(participantId: string, message: string): void {
    this.sessions.get(participantId)?.send(JSON.stringify({ type: "error", message }));
  }

  async sayHello(): Promise<string> {
    const result = this.ctx.storage.sql
      .exec("SELECT 'Hello from RetroRoom!' as greeting")
      .one();
    return result.greeting as string;
  }

  async setPhaseForTest(phase: RoomState["phase"]): Promise<void> {
    const s = await this.loadState();
    s.phase = phase;
    await this.saveState();
  }

  async runEmptyRoomAlarmForTest(): Promise<void> {
    await this.alarm();
  }

  allowWebSocketMessageForTest(participantId: string, now = Date.now()): { allowed: boolean; reason?: string } {
    return this.allowWebSocketMessage(participantId, now);
  }

  async seedStoredStateForTest(state: Partial<StoredState> & Pick<StoredState, "roomId">): Promise<void> {
    const stored: StoredState = {
      schemaVersion: 2,
      startedAt: Date.now(),
      purgeScheduledAt: null,
      phase: "setup",
      participants: [],
      items: [],
      groups: [],
      votes: [],
      rankingMethod: "score",
      pairwiseChoices: [],
      reviewTargetKey: null,
      actions: [],
      facilitatorId: null,
      facilitatorClaimToken: null,
      votingParticipantIds: [],
      voteBudget: 5,
      version: 0,
      connectionTokens: {},
      timer: { startedAt: null, durationSeconds: null, expired: false },
      ...state,
    };
    await this.ctx.storage.put("room", stored);
    this.state = null;
  }
}
