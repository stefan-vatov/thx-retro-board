import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import type {
  RoomState,
  Phase,
  Participant,
  RetroItem,
  Group,
  Column,
  VoteAllocation,
  ServerToClientMessage,
  ClientToServerMessage,
} from "../src/domain";
import {
  sanitizeItemText,
  isValidItemText,
  canTransition,
  PHASE_ORDER,
  sanitizeColumnName,
  isValidColumnName,
  MAX_COLUMNS,
  getDefaultColumns,
  applyReorderColumns,
  applyEditColumn,
  validateFullColumnPermutation,
  applyReorderItems,
  validateItemReorderPayload,
  applyMoveItemToGroup,
  applyCastVote,
  applyRemoveVote,
  getVotesForItem,
} from "../src/domain";

interface StoredTimer {
  startedAt: number | null;
  durationSeconds: number | null;
  expired: boolean;
}

interface StoredState {
  roomId: string;
  phase: RoomState["phase"];
  participants: Participant[];
  items: RetroItem[];
  columns?: Column[];
  groups: Group[];
  votes: VoteAllocation[];
  facilitatorId: string | null;
  voteBudget: number;
  version: number;
  connectionTokens: Record<string, string>;
  timer: StoredTimer;
}

interface MoveItemPreconditions {
  expectedVersion: number;
  sourceGroupId: string | null;
  sourceIndex: number;
}

function validateMoveItemPreconditions(
  preconditions: Partial<MoveItemPreconditions> | undefined,
): { success: true; preconditions: MoveItemPreconditions } | { success: false; error: string } {
  const hasExpectedVersion = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "expectedVersion");
  const hasSourceGroupId = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "sourceGroupId");
  const hasSourceIndex = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "sourceIndex");

  if (!hasExpectedVersion || !hasSourceGroupId || !hasSourceIndex) {
    return { success: false, error: "Move item preconditions are required" };
  }

  const expectedVersion = preconditions?.expectedVersion;
  const sourceGroupId = preconditions?.sourceGroupId;
  const sourceIndex = preconditions?.sourceIndex;

  if (typeof expectedVersion !== "number" || !Number.isFinite(expectedVersion) || !Number.isInteger(expectedVersion)) {
    return { success: false, error: "Expected version must be a finite integer" };
  }
  if (sourceGroupId !== null && typeof sourceGroupId !== "string") {
    return { success: false, error: "Source column precondition must be a string or null" };
  }
  if (typeof sourceIndex !== "number" || !Number.isFinite(sourceIndex) || !Number.isInteger(sourceIndex)) {
    return { success: false, error: "Source index must be a finite integer" };
  }

  return {
    success: true,
    preconditions: {
      expectedVersion,
      sourceGroupId,
      sourceIndex,
    },
  };
}

function normalizeColumns(stored: Pick<StoredState, "columns" | "groups">): Column[] {
  const source = stored.columns ?? stored.groups;
  if (!Array.isArray(source) || source.length === 0) {
    return getDefaultColumns();
  }
  return source
    .filter((column): column is Column => Boolean(column) && typeof column.id === "string" && typeof column.name === "string")
    .map((column, index) => ({
      id: column.id,
      name: sanitizeColumnName(column.name) || `Column ${index + 1}`,
      order: Number.isInteger(column.order) ? column.order : index,
    }))
    .sort((a, b) => a.order - b.order)
    .map((column, index) => ({ ...column, order: index }));
}

function normalizeItems(items: RetroItem[], columns: Column[]): RetroItem[] {
  const validColumnIds = new Set(columns.map((column) => column.id));
  return items.map((item, index) => {
    const candidate = item.columnId ?? item.groupId ?? null;
    const columnId = candidate !== null && validColumnIds.has(candidate) ? candidate : null;
    return {
      ...item,
      columnId,
      groupId: columnId,
      order: Number.isInteger(item.order) ? item.order : index,
    };
  });
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class RetroRoom extends DurableObject<Env> {
  private state: StoredState | null = null;
  private sessions = new Map<string, WebSocket>();

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
      const columns = normalizeColumns(stored);
      this.state = {
        ...stored,
        columns,
        groups: columns,
        items: normalizeItems(stored.items ?? [], columns),
      };
      return this.state;
    }
    return this.state!;
  }

  private async saveState(): Promise<void> {
    if (this.state) {
      this.state.groups = this.state.columns ?? this.state.groups;
      this.state.version += 1;
      await this.ctx.storage.put("room", this.state);
    }
  }

  async initRoom(roomId: string): Promise<void> {
    const existing = await this.ctx.storage.get<StoredState>("room");
    if (existing) {
      this.state = existing;
      return;
    }
    this.state = {
      roomId,
      phase: "write",
      participants: [],
      items: [],
      columns: getDefaultColumns(),
      groups: getDefaultColumns(),
      votes: [],
      facilitatorId: null,
      voteBudget: 5,
      version: 0,
      connectionTokens: {},
      timer: { startedAt: null, durationSeconds: null, expired: false },
    };
    await this.saveState();
  }

  async getRoomState(): Promise<RoomState> {
    const s = await this.loadState();
    const timer = this.computeTimerStatus(s.timer);
    return {
      roomId: s.roomId,
      phase: s.phase,
      participants: s.participants,
      items: s.items,
      columns: s.columns ?? s.groups,
      groups: s.groups,
      votes: s.votes,
      timer,
      voteBudget: s.voteBudget,
      version: s.version,
    };
  }

  private computeTimerStatus(timer: StoredTimer): StoredTimer {
    if (timer.startedAt !== null && timer.durationSeconds !== null && !timer.expired) {
      const elapsed = (Date.now() - timer.startedAt) / 1000;
      if (elapsed >= timer.durationSeconds) {
        return { ...timer, expired: true };
      }
    }
    return timer;
  }

  async hasRoom(): Promise<boolean> {
    const stored = await this.ctx.storage.get<StoredState>("room");
    return stored !== undefined;
  }

  async join(participantId: string, displayName: string): Promise<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }> {
    const s = await this.loadState();
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      return { success: false, error: "Display name cannot be blank" };
    }
    const sanitized = trimmed.slice(0, 50);

    const existing = s.participants.find((p) => p.id === participantId);
    if (existing) {
      const token = generateToken();
      s.connectionTokens[participantId] = token;
      await this.saveState();

      // Broadcast participant presence to other clients on reconnect
      const broadcast: ServerToClientMessage = {
        type: "participant-joined",
        participant: existing,
      };
      this.broadcast(broadcast, participantId);

      return { success: true, state: await this.getRoomState(), connectionToken: token };
    }

    const isFacilitator = s.participants.length === 0;
    const participant: Participant = {
      id: participantId,
      displayName: sanitized,
      isFacilitator,
    };
    s.participants.push(participant);
    if (isFacilitator) {
      s.facilitatorId = participantId;
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

    return { success: true, state: await this.getRoomState(), connectionToken: token };
  }

  async setVoteBudget(participantId: string, budget: number): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    if (s.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can set vote budget" };
    }
    if (typeof budget !== "number" || budget < 1 || budget > 100 || !Number.isInteger(budget)) {
      return { success: false, error: "Vote budget must be an integer between 1 and 100" };
    }
    s.voteBudget = budget;
    await this.saveState();
    this.broadcastState(s);
    return { success: true };
  }

  async addItem(participantId: string, rawText: string, columnId: string | null = null): Promise<{ success: boolean; error?: string; item?: RetroItem }> {
    const s = await this.loadState();

    if (s.phase !== "write") {
      return { success: false, error: "Cannot add items outside write phase" };
    }

    const sanitized = sanitizeItemText(rawText);
    if (!isValidItemText(rawText)) {
      return { success: false, error: "Item text cannot be empty" };
    }
    if (!s.participants.some((participant) => participant.id === participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (columnId !== null && !s.groups.some((column) => column.id === columnId)) {
      return { success: false, error: "Column not found" };
    }

    const item: RetroItem = {
      id: crypto.randomUUID(),
      text: sanitized,
      authorId: participantId,
      columnId,
      groupId: columnId,
      order: s.items.length,
    };
    s.items.push(item);
    await this.saveState();

    const broadcast: ServerToClientMessage = { type: "item-added", item };
    this.broadcast(broadcast);

    return { success: true, item };
  }

  async setPhase(participantId: string, phase: Phase): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can change phase" };
    }

    if (!PHASE_ORDER.includes(phase)) {
      return { success: false, error: "Invalid phase" };
    }

    if (!canTransition(s.phase, phase)) {
      return { success: false, error: `Cannot transition from ${s.phase} to ${phase}` };
    }

    s.phase = phase;
    // Reset timer on phase change
    s.timer = { startedAt: null, durationSeconds: null, expired: false };
    await this.saveState();

    // Broadcast phase change to all connected clients
    const broadcast: ServerToClientMessage = { type: "phase-changed", phase };
    this.broadcast(broadcast);

    this.broadcastState(s);

    return { success: true };
  }

  async setTimer(participantId: string, durationSeconds: number): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can set timers" };
    }

    if (typeof durationSeconds !== "number" || durationSeconds < 1 || !Number.isInteger(durationSeconds)) {
      return { success: false, error: "Timer duration must be a positive integer (seconds)" };
    }

    s.timer = {
      startedAt: Date.now(),
      durationSeconds,
      expired: false,
    };
    await this.saveState();

    const timerBroadcast: ServerToClientMessage = {
      type: "timer-updated",
      timer: s.timer,
    };
    this.broadcast(timerBroadcast);

    return { success: true };
  }

  private canMutateColumns(s: StoredState, participantId: string): { success: true } | { success: false; error: string } {
    if (!s.participants.some((participant) => participant.id === participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (s.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can configure columns" };
    }
    if (s.phase !== "write" && s.phase !== "organise") {
      return { success: false, error: "Cannot configure columns during vote or review phase" };
    }
    return { success: true };
  }

  async createColumn(participantId: string, rawName: string): Promise<{ success: boolean; error?: string; column?: Column }> {
    const s = await this.loadState();
    const allowed = this.canMutateColumns(s, participantId);
    if (!allowed.success) return allowed;

    const sanitized = sanitizeColumnName(rawName);
    if (!isValidColumnName(rawName)) {
      return { success: false, error: "Column name cannot be empty" };
    }
    if (s.groups.length >= MAX_COLUMNS) {
      return { success: false, error: `Rooms can have at most ${MAX_COLUMNS} columns` };
    }

    const column: Column = {
      id: crypto.randomUUID(),
      name: sanitized,
      order: s.groups.length,
    };
    s.groups.push(column);
    s.columns = s.groups;
    await this.saveState();
    this.broadcastState(s);

    return { success: true, column };
  }

  async editColumn(participantId: string, columnId: string, rawName: string): Promise<{ success: boolean; error?: string; column?: Column }> {
    const s = await this.loadState();
    const allowed = this.canMutateColumns(s, participantId);
    if (!allowed.success) return allowed;
    if (typeof columnId !== "string" || columnId.trim().length === 0) {
      return { success: false, error: "Column not found" };
    }

    const result = applyEditColumn(s.groups, columnId, rawName);
    if (result.error) {
      return { success: false, error: result.error };
    }
    s.groups = result.columns;
    s.columns = result.columns;
    await this.saveState();
    this.broadcastState(s);
    return { success: true, column: s.groups.find((column) => column.id === columnId) };
  }

  async reorderColumns(participantId: string, orderedIds: unknown): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    const allowed = this.canMutateColumns(s, participantId);
    if (!allowed.success) return allowed;

    const validation = validateFullColumnPermutation(s.groups, orderedIds);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    s.groups = applyReorderColumns(s.groups, validation.ids);
    s.columns = s.groups;
    await this.saveState();
    this.broadcastState(s);
    return { success: true };
  }

  async createGroup(participantId: string, rawName: string): Promise<{ success: boolean; error?: string; group?: Group }> {
    const columnResult = await this.createColumn(participantId, rawName);
    if (!columnResult.success) {
      return { success: false, error: columnResult.error };
    }
    return { success: true, group: columnResult.column };
  }

  async reorderItems(_participantId: string, orderedIds: unknown): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.phase !== "organise") {
      return { success: false, error: "Cannot reorder items outside organise phase" };
    }

    const validation = validateItemReorderPayload(s.items, orderedIds);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    s.items = applyReorderItems(s.items, validation.ids);
    await this.saveState();

    const broadcast: ServerToClientMessage = { type: "items-reordered", items: s.items };
    this.broadcast(broadcast);

    return { success: true };
  }

  async reorderGroups(participantId: string, orderedIds: string[]): Promise<{ success: boolean; error?: string }> {
    return this.reorderColumns(participantId, orderedIds);
  }

  async moveItemToGroup(
    participantId: string,
    itemId: string,
    targetGroupId: string | null,
    targetIndex: number,
    preconditions?: Partial<MoveItemPreconditions>,
  ): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.phase !== "organise") {
      return { success: false, error: "Cannot move items outside organise phase" };
    }

    const participantExists = s.participants.some((participant) => participant.id === participantId);
    if (!participantExists) {
      return { success: false, error: "Participant not found" };
    }

    const validatedPreconditions = validateMoveItemPreconditions(preconditions);
    if (!validatedPreconditions.success) {
      return validatedPreconditions;
    }

    const item = s.items.find((i) => i.id === itemId);
    if (!item) {
      return { success: false, error: "Item not found" };
    }

    if (validatedPreconditions.preconditions.expectedVersion !== s.version) {
      return { success: false, error: "Stale item move rejected: room version changed" };
    }

    const currentSourceGroupId = item.columnId ?? item.groupId;
    if (validatedPreconditions.preconditions.sourceGroupId !== currentSourceGroupId) {
      return { success: false, error: "Stale item move rejected: source column changed" };
    }

    if (validatedPreconditions.preconditions.sourceIndex !== item.order) {
      return { success: false, error: "Stale item move rejected: source order changed" };
    }

    if (targetGroupId !== null && !s.groups.some((g) => g.id === targetGroupId)) {
      return { success: false, error: "Column not found" };
    }

    if (!Number.isFinite(targetIndex) || !Number.isInteger(targetIndex)) {
      return { success: false, error: "Target index must be a finite integer" };
    }

    const targetListLength = s.items.filter(
      (i) => i.id !== item.id && (i.columnId ?? i.groupId) === targetGroupId,
    ).length;
    if (targetIndex < 0 || targetIndex > targetListLength) {
      return { success: false, error: "Target index out of bounds" };
    }

    s.items = applyMoveItemToGroup(s.items, itemId, targetGroupId, targetIndex);
    await this.saveState();

    this.broadcastState(s);

    return { success: true };
  }

  async castVote(participantId: string, itemId: string, count: number): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.phase !== "vote") {
      return { success: false, error: "Cannot vote outside vote phase" };
    }

    const itemExists = s.items.some((i) => i.id === itemId);
    if (!itemExists) {
      return { success: false, error: "Item not found" };
    }

    const result = applyCastVote(s.votes, participantId, itemId, count, s.voteBudget);
    if (result.error) {
      return { success: false, error: result.error };
    }

    s.votes = result.votes;
    await this.saveState();

    const totalForItem = getVotesForItem(s.votes, itemId);
    const broadcast: ServerToClientMessage = {
      type: "vote-changed",
      itemId,
      participantId,
      delta: count,
      totalForItem,
    };
    this.broadcast(broadcast);
    this.broadcastState(s);

    return { success: true };
  }

  async removeVote(participantId: string, itemId: string): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.phase !== "vote") {
      return { success: false, error: "Cannot remove votes outside vote phase" };
    }

    const existing = s.votes.find(
      (v) => v.participantId === participantId && v.itemId === itemId,
    );
    if (!existing) {
      return { success: false, error: "No votes to remove" };
    }

    s.votes = applyRemoveVote(s.votes, participantId, itemId);
    await this.saveState();

    const totalForItem = getVotesForItem(s.votes, itemId);
    const broadcast: ServerToClientMessage = {
      type: "vote-changed",
      itemId,
      participantId,
      delta: -1,
      totalForItem,
    };
    this.broadcast(broadcast);
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
    const timer = this.computeTimerStatus(s.timer);
    const state: RoomState = {
      roomId: s.roomId,
      phase: s.phase,
      participants: s.participants,
      items: s.items,
      columns: s.columns ?? s.groups,
      groups: s.groups,
      votes: s.votes,
      timer,
      voteBudget: s.voteBudget,
      version: s.version,
    };
    this.broadcast({ type: "snapshot", state }, excludeId);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/join" && request.method === "POST") {
      const body = await request.json() as { participantId: string; displayName: string };
      const result = await this.join(body.participantId, body.displayName);
      return Response.json(result);
    }

    if (url.pathname === "/state" && request.method === "GET") {
      const state = await this.getRoomState();
      return Response.json(state);
    }

    if (url.pathname === "/vote-budget" && request.method === "POST") {
      const body = await request.json() as { participantId: string; budget: number };
      const result = await this.setVoteBudget(body.participantId, body.budget);
      return Response.json(result);
    }

    if (url.pathname === "/phase" && request.method === "POST") {
      const body = await request.json() as { participantId: string; phase: string };
      const result = await this.setPhase(body.participantId, body.phase as Phase);
      return Response.json(result);
    }

    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

      const pid = url.searchParams.get("pid");
      const token = url.searchParams.get("token");

      if (!pid || !token) {
        return new Response(JSON.stringify({ error: "Missing pid or token" }), { status: 400 });
      }

      const s = await this.loadState();
      const expectedToken = s.connectionTokens[pid];
      if (!expectedToken || expectedToken !== token) {
        return new Response(JSON.stringify({ error: "Invalid participant credentials" }), { status: 403 });
      }

      const participantId = pid;
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

      const snapshot = await this.getRoomState();
      server.send(JSON.stringify({ type: "snapshot", state: snapshot }));

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as { participantId: string } | null;
    const participantId = attachment?.participantId;
    if (!participantId) return;

    try {
      const msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)) as ClientToServerMessage;
      await this.handleMessage(participantId, msg);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
    }
  }

  override webSocketClose(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as { participantId: string } | null;
    const participantId = attachment?.participantId;
    if (!participantId) return;

    this.sessions.delete(participantId);
    const leftMsg: ServerToClientMessage = { type: "participant-left", participantId };
    this.broadcast(leftMsg);
  }

  private async handleMessage(participantId: string, msg: ClientToServerMessage): Promise<void> {
    switch (msg.type) {
      case "join": {
        await this.join(participantId, msg.displayName);
        break;
      }
      case "add-item": {
        const result = await this.addItem(participantId, msg.text, msg.columnId ?? null);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "set-vote-budget": {
        const result = await this.setVoteBudget(participantId, msg.budget);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "set-phase": {
        const result = await this.setPhase(participantId, msg.phase);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "create-group": {
        const result = await this.createGroup(participantId, msg.name);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "create-column": {
        const result = await this.createColumn(participantId, msg.name);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "edit-column": {
        const result = await this.editColumn(participantId, msg.columnId, msg.name);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "reorder-columns": {
        const result = await this.reorderColumns(participantId, msg.columnIds);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "reorder-items": {
        const result = await this.reorderItems(participantId, msg.itemIds);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "reorder-groups": {
        const result = await this.reorderGroups(participantId, msg.groupIds);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "move-item-to-group": {
        const result = await this.moveItemToGroup(participantId, msg.itemId, msg.groupId, msg.index, {
          expectedVersion: msg.expectedVersion,
          sourceGroupId: msg.sourceGroupId,
          sourceIndex: msg.sourceIndex,
        });
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "set-timer": {
        const result = await this.setTimer(participantId, msg.durationSeconds);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "cast-vote": {
        const result = await this.castVote(participantId, msg.itemId, msg.count);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "remove-vote": {
        const result = await this.removeVote(participantId, msg.itemId);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      default:
        break;
    }
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

  async seedStoredStateForTest(state: Partial<StoredState> & Pick<StoredState, "roomId">): Promise<void> {
    const stored: StoredState = {
      phase: "write",
      participants: [],
      items: [],
      groups: [],
      votes: [],
      facilitatorId: null,
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
