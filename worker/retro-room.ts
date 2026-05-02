import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import type { Env } from "./index";
import type {
  RoomState,
  Phase,
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
} from "./room-types";
import {
  EMPTY_ROOM_PURGE_DELAY_MS,
  MAX_ROOM_LIFETIME_MS,
} from "./room-types";

import {
  authorizeParticipantEffect,
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
import { joinRoomParticipant, type RoomParticipantHost } from "./room-participants";
import { toRoomState } from "./room-presenter";
import { setPhaseForRoom, setReviewTargetForRoom, setTimerForRoom } from "./room-phase";
import { purgeRoomByFacilitator } from "./room-purge";
import {
  castVoteForRoom,
  choosePairwiseForRoom,
  removeVoteForRoom,
  setRankingMethodForRoom,
  setVoteBudgetForRoom,
  toggleReactionForRoom,
} from "./room-ranking";
import { handleRoomRealtimeMessage } from "./room-realtime";
import { RoomRealtimeLimiter } from "./room-realtime-limits";
import { createInitialStoredState, hydrateStoredState } from "./room-storage";
import {
  consumeWebSocketTicketForRoom,
  createWebSocketTicketForRoom,
  deleteOutstandingWebSocketTicketForRoom,
} from "./room-websocket-tickets";
import { handleRoomWebSocketRequest, type RoomWebSocketHost } from "./room-websocket";
import {
  handleRoomWebSocketClose,
  handleRoomWebSocketMessage,
  type RoomWebSocketEventHost,
} from "./room-websocket-events";
import { createStoredStateForTest } from "./room-test-state";

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

  private participantHost(): RoomParticipantHost {
    return {
      ...this.commandHost(),
      cancelEmptyRoomPurge: () => this.cancelEmptyRoomPurge(),
      closeParticipantSocket: (participantId, reason) => this.closeParticipantSocket(participantId, reason),
      deleteOutstandingWebSocketTicket: (participantId) => this.deleteOutstandingWebSocketTicket(participantId),
      scheduleEmptyRoomPurge: () => this.scheduleEmptyRoomPurge(),
      getSessionCount: () => this.sessions.size,
    };
  }

  private webSocketHost(): RoomWebSocketHost {
    return {
      consumeWebSocketTicket: (ticket) => this.consumeWebSocketTicket(ticket),
      loadState: () => this.loadState(),
      cancelEmptyRoomPurge: () => this.cancelEmptyRoomPurge(),
      closeParticipantSocket: (participantId, reason) => this.closeParticipantSocket(participantId, reason),
      setSession: (participantId, socket) => this.sessions.set(participantId, socket),
      acceptWebSocket: (socket) => this.ctx.acceptWebSocket(socket),
      broadcast: (message, excludeId) => this.broadcast(message, excludeId),
    };
  }

  private webSocketEventHost(): RoomWebSocketEventHost {
    return {
      getSession: (participantId) => this.sessions.get(participantId),
      removeSession: (participantId) => {
        this.sessions.delete(participantId);
      },
      removeRealtimeParticipant: (participantId) => this.realtimeLimiter.removeParticipant(participantId),
      allowWebSocketMessage: (participantId) => this.allowWebSocketMessage(participantId),
      handleRealtimeMessage: (participantId, message) => handleRoomRealtimeMessage(this, participantId, message),
      broadcast: (message, excludeId) => this.broadcast(message, excludeId),
      scheduleEmptyRoomPurge: () => this.scheduleEmptyRoomPurge(),
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
    return joinRoomParticipant(this.participantHost(), participantId, displayName, connectionToken, facilitatorClaimToken);
  }

  async purgeByFacilitator(participantId: string): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    return purgeRoomByFacilitator(s, participantId, (reason) => this.purgeRoom(reason));
  }

  async setVoteBudget(participantId: string, budget: number): Promise<{ success: boolean; error?: string }> {
    return setVoteBudgetForRoom(this.commandHost(), participantId, budget);
  }

  async setRankingMethod(participantId: string, rankingMethod: RankingMethod): Promise<{ success: boolean; error?: string }> {
    return setRankingMethodForRoom(this.commandHost(), participantId, rankingMethod);
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
    await deleteOutstandingWebSocketTicketForRoom(this.ctx.storage, participantId);
  }

  async createWebSocketTicket(participantId: string, connectionToken: unknown): Promise<{ success: boolean; error?: string; ticket?: string }> {
    return createWebSocketTicketForRoom({
      loadState: () => this.loadState(),
      get: (key) => this.ctx.storage.get(key),
      put: (key, value) => this.ctx.storage.put(key, value),
      delete: (key) => this.ctx.storage.delete(key),
    }, participantId, connectionToken);
  }

  private async consumeWebSocketTicket(ticket: string | null): Promise<{ success: true; participantId: string } | { success: false; error: string }> {
    return consumeWebSocketTicketForRoom({
      loadState: () => this.loadState(),
      get: (key) => this.ctx.storage.get(key),
      put: (key, value) => this.ctx.storage.put(key, value),
      delete: (key) => this.ctx.storage.delete(key),
      hasParticipant: async (participantId) => this.hasParticipant(await this.loadState(), participantId),
    }, ticket);
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
    return toggleReactionForRoom(this.commandHost(), participantId, target, emoji);
  }

  async castVote(participantId: string, targetOrGroupId: VoteTarget | string, count: number): Promise<{ success: boolean; error?: string }> {
    return castVoteForRoom(this.commandHost(), participantId, targetOrGroupId, count);
  }

  async removeVote(participantId: string, targetOrGroupId: VoteTarget | string): Promise<{ success: boolean; error?: string }> {
    return removeVoteForRoom(this.commandHost(), participantId, targetOrGroupId);
  }

  async choosePairwise(participantId: string, winner: VoteTarget, loser: VoteTarget): Promise<{ success: boolean; error?: string }> {
    return choosePairwiseForRoom(this.commandHost(), participantId, winner, loser);
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
    const httpResponse = await handleRoomHttpRequest(this, request);
    if (httpResponse) return httpResponse;

    const webSocketResponse = await handleRoomWebSocketRequest(this.webSocketHost(), request);
    if (webSocketResponse) return webSocketResponse;

    return new Response("Not found", { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await handleRoomWebSocketMessage(this.webSocketEventHost(), ws, message);
  }

  override webSocketClose(ws: WebSocket): void {
    handleRoomWebSocketClose({
      ...this.webSocketEventHost(),
      scheduleEmptyRoomPurge: () => {
        this.ctx.waitUntil(this.scheduleEmptyRoomPurge());
        return Promise.resolve();
      },
    }, ws);
  }

  sendParticipantError(participantId: string, message: string): void {
    this.sessions.get(participantId)?.send(JSON.stringify({ type: "error", message }));
  }

  async setPhaseForTest(phase: RoomState["phase"]): Promise<void> {
    const s = await this.loadState();
    s.phase = phase;
    await this.saveState();
  }

  async runEmptyRoomAlarmForTest(): Promise<void> { await this.alarm(); }

  allowWebSocketMessageForTest(participantId: string, now = Date.now()): { allowed: boolean; reason?: string } {
    return this.allowWebSocketMessage(participantId, now);
  }

  async seedStoredStateForTest(state: Partial<StoredState> & Pick<StoredState, "roomId">): Promise<void> {
    await this.ctx.storage.put("room", createStoredStateForTest(state));
    this.state = null;
  }
}
