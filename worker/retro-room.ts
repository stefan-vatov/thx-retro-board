import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import type {
  RoomState,
  Phase,
  Participant,
  RetroItem,
  Group,
  Column,
  ActionItem,
  Reaction,
  ReactionTarget,
  VoteAllocation,
  VoteTarget,
  PairwiseChoice,
  RankingMethod,
  ServerToClientMessage,
  ClientToServerMessage,
} from "../src/domain";
import {
  sanitizeItemText,
  isValidItemText,
  sanitizeActionText,
  isValidActionText,
  createActionItem,
  canTransition,
  PHASE_ORDER,
  sanitizeColumnName,
  isValidColumnName,
  MAX_COLUMNS,
  applyReorderColumns,
  applyEditColumn,
  applyDeleteColumn,
  validateFullColumnPermutation,
  validateGroupReorderPayload,
  applyReorderColumnGroups,
  applyEditGroup,
  hasDuplicateGroupNameInColumn,
  applyDeleteGroup,
  applyReorderItems,
  validateItemReorderPayload,
  validateExistingColumnId,
  applyMoveItemToGroup,
  applyCastVote,
  applyRemoveVote,
  getVoteTarget,
  groupVoteTarget,
  itemVoteTarget,
  sameVoteTarget,
  voteTargetKey,
  pairwiseComparisonKey,
  getDefaultColumns,
  isAllowedReactionEmoji,
} from "../src/domain";

interface StoredTimer {
  startedAt: number | null;
  durationSeconds: number | null;
  expired: boolean;
}

interface StoredState {
  schemaVersion?: 2;
  roomId: string;
  startedAt?: number;
  purgeScheduledAt?: number | null;
  phase: RoomState["phase"];
  participants: Participant[];
  items: RetroItem[];
  columns?: Column[];
  groups: Group[];
  votes: VoteAllocation[];
  rankingMethod?: RankingMethod;
  pairwiseChoices?: PairwiseChoice[];
  reviewTargetKey?: string | null;
  actions: ActionItem[];
  reactions?: Reaction[];
  facilitatorId: string | null;
  facilitatorClaimToken?: string | null;
  votingParticipantIds?: string[];
  voteBudget: number;
  version: number;
  connectionTokens: Record<string, string>;
  timer: StoredTimer;
}

interface WebSocketTicket {
  participantId: string;
  expiresAt: number;
}

const EMPTY_ROOM_PURGE_DELAY_MS = 60 * 60 * 1000;
const MAX_ROOM_LIFETIME_MS = 12 * 60 * 60 * 1000;
const MAX_PARTICIPANTS_PER_ROOM = 100;
const MAX_ITEMS_PER_ROOM = 400;
const MAX_GROUPS_PER_ROOM = 120;
const MAX_ACTIONS_PER_ROOM = 150;
const MAX_REACTIONS_PER_ROOM = 3000;
const MAX_REACTIONS_PER_TARGET = 300;
const MAX_PAIRWISE_CHOICES_PER_ROOM = 6000;
const MAX_PAIRWISE_TARGETS = 50;
const MAX_WEBSOCKET_MESSAGE_BYTES = 16 * 1024;
const MAX_WEBSOCKET_MESSAGES_PER_WINDOW = 20;
const MAX_ROOM_WEBSOCKET_MESSAGES_PER_WINDOW = 60;
const WEBSOCKET_RATE_WINDOW_MS = 10 * 1000;
const WEBSOCKET_TICKET_TTL_MS = 30 * 1000;
const ANONYMOUS_VOTE_PARTICIPANT_ID = "__anonymous__";

interface MoveItemPreconditions {
  expectedVersion: number;
  sourceGroupId: string | null;
  sourceIndex: number;
}

interface ItemReorderPreconditions {
  expectedVersion: number;
  sourceColumnId: string;
  sourceGroupId: string | null;
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

function validateItemReorderPreconditions(
  preconditions: Partial<ItemReorderPreconditions> | undefined,
): { success: true; preconditions: ItemReorderPreconditions } | { success: false; error: string } {
  const hasExpectedVersion = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "expectedVersion");
  const hasSourceColumnId = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "sourceColumnId");
  const hasSourceGroupId = Object.prototype.hasOwnProperty.call(preconditions ?? {}, "sourceGroupId");

  if (!hasExpectedVersion || !hasSourceColumnId || !hasSourceGroupId) {
    return { success: false, error: "Item reorder preconditions are required" };
  }

  const expectedVersion = preconditions?.expectedVersion;
  const sourceColumnId = preconditions?.sourceColumnId;
  const sourceGroupId = preconditions?.sourceGroupId;

  if (typeof expectedVersion !== "number" || !Number.isFinite(expectedVersion) || !Number.isInteger(expectedVersion)) {
    return { success: false, error: "Expected version must be a finite integer" };
  }
  if (typeof sourceColumnId !== "string" || sourceColumnId.trim().length === 0) {
    return { success: false, error: "Source column precondition is required" };
  }
  if (sourceGroupId !== null && typeof sourceGroupId !== "string") {
    return { success: false, error: "Source group precondition must be a string or null" };
  }

  return { success: true, preconditions: { expectedVersion, sourceColumnId, sourceGroupId } };
}

function validateExpectedVersion(
  expectedVersion: unknown,
): { success: true; expectedVersion: number } | { success: false; error: string } {
  if (typeof expectedVersion !== "number" || !Number.isFinite(expectedVersion) || !Number.isInteger(expectedVersion)) {
    return { success: false, error: "Expected version must be a finite integer" };
  }
  return { success: true, expectedVersion };
}

function parseVoteTargetMessage(
  msg: Extract<ClientToServerMessage, { type: "cast-vote" | "remove-vote" }>,
): { success: true; target: VoteTarget } | { success: false; error: string } {
  const hasGroupId = Object.prototype.hasOwnProperty.call(msg, "groupId");
  const hasItemId = Object.prototype.hasOwnProperty.call(msg, "itemId");
  if (hasGroupId && hasItemId) {
    return { success: false, error: "Vote target must specify exactly one target" };
  }
  if (hasGroupId) {
    return typeof msg.groupId === "string" && msg.groupId.trim().length > 0
      ? { success: true, target: groupVoteTarget(msg.groupId) }
      : { success: false, error: "Group not found" };
  }
  if (hasItemId) {
    return typeof msg.itemId === "string" && msg.itemId.trim().length > 0
      ? { success: true, target: itemVoteTarget(msg.itemId) }
      : { success: false, error: "Item not found" };
  }
  return { success: false, error: "Vote target is required" };
}

function normalizeColumns(stored: Pick<StoredState, "columns" | "groups">): Column[] {
  const source = stored.columns;
  if (!Array.isArray(source)) {
    return [];
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

function isV2StoredState(stored: Partial<StoredState>): boolean {
  if (stored.schemaVersion !== 2) return false;
  if (!Array.isArray(stored.columns) || !Array.isArray(stored.groups)) return false;
  if (!Array.isArray(stored.items) || !Array.isArray(stored.votes)) return false;
  return true;
}

function normalizeGroups(groups: Group[], columns: Column[]): Group[] {
  const validColumnIds = new Set(columns.map((column) => column.id));
  const normalized = groups
    .filter((group): group is Group =>
      Boolean(group)
      && typeof group.id === "string"
      && typeof group.name === "string"
      && typeof group.columnId === "string"
      && validColumnIds.has(group.columnId),
    )
    .map((group, index) => ({
      id: group.id,
      name: sanitizeColumnName(group.name) || `Group ${index + 1}`,
      columnId: group.columnId,
      order: Number.isInteger(group.order) ? group.order : index,
    }))
    .sort((a, b) => a.order - b.order);

  const nextOrderByColumn = new Map<string, number>();
  return normalized.map((group) => {
    const order = nextOrderByColumn.get(group.columnId) ?? 0;
    nextOrderByColumn.set(group.columnId, order + 1);
    return { ...group, order };
  });
}

function normalizeItems(items: RetroItem[], columns: Column[], groups: Group[]): RetroItem[] {
  const validColumnIds = new Set(columns.map((column) => column.id));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const normalized = items.flatMap((item) => {
    if (
      !item
      || typeof item.id !== "string"
      || typeof item.text !== "string"
      || typeof item.authorId !== "string"
    ) {
      return [];
    }
    const columnId = item.columnId;
    if (typeof columnId !== "string" || !validColumnIds.has(columnId)) return [];
    const groupId = typeof item.groupId === "string" && groupsById.get(item.groupId)?.columnId === columnId ? item.groupId : null;
    return {
      ...item,
      columnId,
      groupId,
      order: Number.isInteger(item.order) ? item.order : 0,
    };
  }).sort((a, b) => a.order - b.order)
    .map((item) => item);

  const nextOrderByList = new Map<string, number>();
  return normalized.map((item) => {
    const listKey = `${item.columnId}:${item.groupId ?? "__ungrouped__"}`;
    const order = nextOrderByList.get(listKey) ?? 0;
    nextOrderByList.set(listKey, order + 1);
    return { ...item, order };
  });
}

function normalizeVoteTarget(vote: VoteAllocation, groups: Group[], items: RetroItem[]): VoteTarget | null {
  const validGroupIds = new Set(groups.map((group) => group.id));
  const validUngroupedItemIds = new Set(items.filter((item) => item.groupId === null).map((item) => item.id));
  const canonicalTarget = vote.target
    && (vote.target.type === "group" || vote.target.type === "item")
    && typeof vote.target.id === "string"
    ? vote.target
    : null;
  const legacyGroupTarget = typeof vote.groupId === "string" ? groupVoteTarget(vote.groupId) : null;
  const legacyItemId = typeof vote.itemId === "string" ? vote.itemId : null;
  const legacyItemTarget = legacyItemId === null
    ? null
    : validGroupIds.has(legacyItemId)
      ? groupVoteTarget(legacyItemId)
      : itemVoteTarget(legacyItemId);

  const target = canonicalTarget ?? legacyGroupTarget ?? legacyItemTarget;
  if (target === null) return null;
  const aliases = [legacyGroupTarget, legacyItemTarget].filter((alias): alias is VoteTarget => alias !== null);
  if (aliases.some((alias) => !sameVoteTarget(alias, target))) return null;
  if (target.type === "group") {
    return validGroupIds.has(target.id) ? target : null;
  }
  return validUngroupedItemIds.has(target.id) ? target : null;
}

function normalizeVotes(votes: VoteAllocation[], participants: Participant[], groups: Group[], items: RetroItem[]): VoteAllocation[] {
  const validParticipantIds = new Set(participants.map((participant) => participant.id));
  const merged = new Map<string, VoteAllocation>();
  for (const vote of votes) {
    if (
      !vote
      || typeof vote.participantId !== "string"
      || !validParticipantIds.has(vote.participantId)
      || typeof vote.count !== "number"
      || !Number.isInteger(vote.count)
      || vote.count < 1
    ) {
      continue;
    }
    const target = normalizeVoteTarget(vote, groups, items);
    if (target === null) continue;
    const key = `${vote.participantId}:${voteTargetKey(target)}`;
    const existing = merged.get(key);
    merged.set(key, {
      participantId: vote.participantId,
      target,
      count: (existing?.count ?? 0) + vote.count,
    });
  }
  return [...merged.values()];
}

function normalizeRankingMethod(method: unknown): RankingMethod {
  return method === "pairwise" ? "pairwise" : "score";
}

function normalizePairwiseChoices(choices: PairwiseChoice[] | undefined, participants: Participant[], groups: Group[], items: RetroItem[]): PairwiseChoice[] {
  if (!Array.isArray(choices)) return [];
  const validParticipantIds = new Set(participants.map((participant) => participant.id));
  const merged = new Map<string, PairwiseChoice>();
  for (const choice of choices) {
    if (
      !choice
      || typeof choice.participantId !== "string"
      || !validParticipantIds.has(choice.participantId)
    ) {
      continue;
    }
    const winner = normalizeVoteTarget({ participantId: choice.participantId, target: choice.winner, count: 1 }, groups, items);
    const loser = normalizeVoteTarget({ participantId: choice.participantId, target: choice.loser, count: 1 }, groups, items);
    if (winner === null || loser === null || sameVoteTarget(winner, loser)) continue;
    const key = `${choice.participantId}:${pairwiseComparisonKey(winner, loser)}`;
    merged.set(key, { participantId: choice.participantId, winner, loser });
  }
  return [...merged.values()];
}

function normalizeReviewTargetKey(targetKey: unknown, groups: Group[], items: RetroItem[]): string | null {
  if (typeof targetKey !== "string") return null;
  const validTargetKeys = new Set<string>([
    ...groups.map((group) => voteTargetKey(groupVoteTarget(group.id))),
    ...items.filter((item) => item.groupId === null).map((item) => voteTargetKey(itemVoteTarget(item.id))),
  ]);
  return validTargetKeys.has(targetKey) ? targetKey : null;
}

function normalizeActions(actions: ActionItem[] | undefined, participants: Participant[]): ActionItem[] {
  if (!Array.isArray(actions)) return [];
  const participantIds = new Set(participants.map((participant) => participant.id));
  return actions
    .filter((action): action is ActionItem =>
      Boolean(action)
      && typeof action.id === "string"
      && typeof action.text === "string"
      && typeof action.authorId === "string",
    )
    .map((action, index) => ({
      id: action.id,
      text: sanitizeActionText(action.text) || `Action ${index + 1}`,
      authorId: participantIds.has(action.authorId) ? action.authorId : "",
      order: Number.isInteger(action.order) ? action.order : index,
    }))
    .sort((a, b) => a.order - b.order)
    .map((action, index) => ({ ...action, order: index }));
}

function normalizeReactions(reactions: Reaction[] | undefined, participants: Participant[], groups: Group[], items: RetroItem[]): Reaction[] {
  if (!Array.isArray(reactions)) return [];
  const participantIds = new Set(participants.map((participant) => participant.id));
  const groupIds = new Set(groups.map((group) => group.id));
  const itemIds = new Set(items.map((item) => item.id));
  const merged = new Map<string, Reaction>();
  for (const reaction of reactions) {
    if (
      !reaction
      || typeof reaction.participantId !== "string"
      || !participantIds.has(reaction.participantId)
      || typeof reaction.emoji !== "string"
      || !isAllowedReactionEmoji(reaction.emoji)
      || !reaction.target
      || (reaction.target.type !== "group" && reaction.target.type !== "item")
      || typeof reaction.target.id !== "string"
    ) {
      continue;
    }
    if (reaction.target.type === "group" && !groupIds.has(reaction.target.id)) continue;
    if (reaction.target.type === "item" && !itemIds.has(reaction.target.id)) continue;
    const key = `${reaction.participantId}:${voteTargetKey(reaction.target)}:${reaction.emoji}`;
    merged.set(key, { participantId: reaction.participantId, target: reaction.target, emoji: reaction.emoji });
  }
  return [...merged.values()];
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getWebSocketTicket(request: Request): string | null {
  const protocols = (request.headers.get("Sec-WebSocket-Protocol") ?? "")
    .split(",")
    .map((protocol) => protocol.trim());
  const ticketProtocol = protocols.find((protocol) => protocol.startsWith("ticket-"));
  return ticketProtocol ? ticketProtocol.slice("ticket-".length) : null;
}

async function readJsonBody<T>(request: Request): Promise<T | null> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return null;
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && (!Number.isFinite(Number(contentLength)) || Number(contentLength) > MAX_WEBSOCKET_MESSAGE_BYTES)) return null;

  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_WEBSOCKET_MESSAGE_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } else {
    body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_WEBSOCKET_MESSAGE_BYTES) return null;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

export class RetroRoom extends DurableObject<Env> {
  private state: StoredState | null = null;
  private sessions = new Map<string, WebSocket>();
  private messageWindows = new Map<string, { startedAt: number; count: number }>();
  private roomMessageWindow: { startedAt: number; count: number } | null = null;

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
      if (!isV2StoredState(stored)) {
        this.state = {
          ...stored,
          schemaVersion: 2,
          startedAt: Number.isFinite(stored.startedAt) ? stored.startedAt : Date.now(),
          purgeScheduledAt: Number.isFinite(stored.purgeScheduledAt) ? stored.purgeScheduledAt : null,
          phase: "setup",
          items: [],
          columns: getDefaultColumns(),
          groups: [],
          votes: [],
          rankingMethod: "score",
          pairwiseChoices: [],
          reviewTargetKey: null,
          actions: [],
          reactions: [],
          facilitatorClaimToken: null,
          votingParticipantIds: [],
        };
        await this.ctx.storage.put("room", this.state);
        return this.state;
      }
      const columns = normalizeColumns(stored);
      const groups = normalizeGroups(stored.groups ?? [], columns);
      this.state = {
        ...stored,
        schemaVersion: 2,
        startedAt: Number.isFinite(stored.startedAt) ? stored.startedAt : Date.now(),
        purgeScheduledAt: Number.isFinite(stored.purgeScheduledAt) ? stored.purgeScheduledAt : null,
        columns,
        groups,
        items: normalizeItems(stored.items ?? [], columns, groups),
        votes: [],
        rankingMethod: normalizeRankingMethod(stored.rankingMethod),
        pairwiseChoices: [],
        reviewTargetKey: null,
        actions: normalizeActions(stored.actions, stored.participants ?? []),
        reactions: [],
        facilitatorClaimToken: typeof stored.facilitatorClaimToken === "string" ? stored.facilitatorClaimToken : null,
        votingParticipantIds: Array.isArray(stored.votingParticipantIds)
          ? stored.votingParticipantIds.filter((id) => typeof id === "string" && stored.participants.some((participant) => participant.id === id))
          : [],
      };
      this.state.votes = normalizeVotes(stored.votes ?? [], this.state.participants, groups, this.state.items);
      this.state.pairwiseChoices = normalizePairwiseChoices(stored.pairwiseChoices, this.state.participants, groups, this.state.items);
      this.state.reviewTargetKey = normalizeReviewTargetKey(stored.reviewTargetKey, groups, this.state.items);
      this.state.reactions = normalizeReactions(stored.reactions, this.state.participants, groups, this.state.items);
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
    this.state = {
      schemaVersion: 2,
      roomId,
      startedAt: Date.now(),
      purgeScheduledAt: null,
      phase: "setup",
      participants: [],
      items: [],
      columns: getDefaultColumns(),
      groups: [],
      votes: [],
      rankingMethod: "score",
      pairwiseChoices: [],
      reviewTargetKey: null,
      actions: [],
      reactions: [],
      facilitatorId: null,
      facilitatorClaimToken,
      votingParticipantIds: [],
      voteBudget: 5,
      version: 0,
      connectionTokens: {},
      timer: { startedAt: null, durationSeconds: null, expired: false },
    };
    await this.saveState();
    await this.scheduleEmptyRoomPurge();
  }

  private getPairwiseProgress(s: StoredState) {
    const targets = this.getDecisionTargetCount(s);
    const total = targets < 2 ? 0 : (targets * (targets - 1)) / 2;
    return s.participants.map((participant) => {
      const answered = (s.pairwiseChoices ?? []).filter((choice) => choice.participantId === participant.id).length;
      return { participantId: participant.id, answered: Math.min(answered, total), total };
    });
  }

  private getDecisionTargetCount(s: StoredState): number {
    return s.groups.length + s.items.filter((item) => item.groupId === null).length;
  }

  private getProjectedVotes(s: StoredState, participantId?: string): VoteAllocation[] {
    if (!participantId) return s.votes;
    const projected = s.votes.filter((vote) => vote.participantId === participantId);
    const anonymousTotals = new Map<string, VoteAllocation>();
    for (const vote of s.votes) {
      if (vote.participantId === participantId) continue;
      const target = getVoteTarget(vote);
      if (target === null) continue;
      const key = voteTargetKey(target);
      const existing = anonymousTotals.get(key);
      anonymousTotals.set(key, {
        participantId: ANONYMOUS_VOTE_PARTICIPANT_ID,
        target,
        count: (existing?.count ?? 0) + vote.count,
      });
    }
    return [...projected, ...anonymousTotals.values()];
  }

  private getProjectedPairwiseChoices(s: StoredState, participantId?: string): PairwiseChoice[] {
    if (!participantId) return s.pairwiseChoices ?? [];
    if (s.phase !== "review" && s.phase !== "finalize") {
      return (s.pairwiseChoices ?? []).filter((choice) => choice.participantId === participantId);
    }

    const aggregateCounts = new Map<string, { winner: VoteTarget; loser: VoteTarget; count: number }>();
    for (const choice of s.pairwiseChoices ?? []) {
      const key = `${pairwiseComparisonKey(choice.winner, choice.loser)}:${voteTargetKey(choice.winner)}`;
      const existing = aggregateCounts.get(key);
      aggregateCounts.set(key, {
        winner: choice.winner,
        loser: choice.loser,
        count: (existing?.count ?? 0) + 1,
      });
    }

    const projected: PairwiseChoice[] = [];
    let anonymousIndex = 0;
    for (const aggregate of aggregateCounts.values()) {
      projected.push({
        participantId: `${ANONYMOUS_VOTE_PARTICIPANT_ID}-${anonymousIndex}`,
        winner: aggregate.winner,
        loser: aggregate.loser,
        count: aggregate.count,
      });
      anonymousIndex += 1;
    }
    return projected;
  }

  private toRoomState(s: StoredState, participantId?: string): RoomState {
    const timer = this.computeTimerStatus(s.timer);
    return {
      schemaVersion: 2,
      roomId: s.roomId,
      startedAt: s.startedAt ?? Date.now(),
      purgeScheduledAt: s.purgeScheduledAt ?? null,
      phase: s.phase,
      participants: s.participants,
      items: s.items,
      columns: s.columns ?? s.groups,
      groups: s.groups,
      votes: this.getProjectedVotes(s, participantId),
      rankingMethod: s.rankingMethod ?? "score",
      pairwiseChoices: this.getProjectedPairwiseChoices(s, participantId),
      pairwiseProgress: this.getPairwiseProgress(s),
      reviewTargetKey: normalizeReviewTargetKey(s.reviewTargetKey, s.groups, s.items),
      actions: s.actions ?? [],
      reactions: s.reactions ?? [],
      timer,
      voteBudget: s.voteBudget,
      version: s.version,
    };
  }

  async getRoomState(): Promise<RoomState> {
    const s = await this.loadState();
    return this.toRoomState(s);
  }

  async getRoomStateForParticipant(participantId: string, connectionToken: unknown): Promise<{ success: boolean; error?: string; state?: RoomState }> {
    const s = await this.loadState();
    const auth = this.authorizeHttpMutation(s, participantId, connectionToken);
    if (!auth.success) return auth;
    return { success: true, state: this.toRoomState(s, auth.participantId) };
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
    if (stored && await this.purgeIfExpired(stored)) return false;
    return stored !== undefined;
  }

  async join(participantId: string, displayName: string, connectionToken?: string, facilitatorClaimToken?: unknown): Promise<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }> {
    const s = await this.loadState();
    if (typeof participantId !== "string" || participantId.trim().length === 0 || participantId.length > 128) {
      return { success: false, error: "Participant not found" };
    }
    if (typeof displayName !== "string") {
      return { success: false, error: "Display name cannot be blank" };
    }
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      return { success: false, error: "Display name cannot be blank" };
    }
    const sanitized = trimmed.slice(0, 50);

    const existing = s.participants.find((p) => p.id === participantId);
    if (existing) {
      if (!this.hasValidConnectionToken(s, participantId, connectionToken)) {
        return { success: false, error: "Invalid participant credentials" };
      }
      if (
        s.facilitatorId === null
        && typeof facilitatorClaimToken === "string"
        && typeof s.facilitatorClaimToken === "string"
        && facilitatorClaimToken === s.facilitatorClaimToken
      ) {
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
        participant: existing,
      };
      this.broadcast(broadcast, participantId);

      if (this.sessions.size === 0) {
        await this.scheduleEmptyRoomPurge();
      }

      return { success: true, state: this.toRoomState(s, participantId), connectionToken: token };
    }

    if (s.participants.length >= MAX_PARTICIPANTS_PER_ROOM) {
      return { success: false, error: `Rooms can have at most ${MAX_PARTICIPANTS_PER_ROOM} participants` };
    }

    await this.cancelEmptyRoomPurge();
    const canClaimFacilitator = s.facilitatorId === null
      && typeof facilitatorClaimToken === "string"
      && typeof s.facilitatorClaimToken === "string"
      && facilitatorClaimToken === s.facilitatorClaimToken;
    const isFacilitator = s.participants.length === 0 && s.facilitatorClaimToken === null
      ? true
      : canClaimFacilitator;
    const participant: Participant = {
      id: participantId,
      displayName: sanitized,
      isFacilitator,
    };
    s.participants.push(participant);
    if (isFacilitator) {
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

    return { success: true, state: this.toRoomState(s, participantId), connectionToken: token };
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
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (s.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can set vote budget" };
    }
    if (s.phase !== "setup") {
      return { success: false, error: "Vote budget can only be changed during setup" };
    }
    if (typeof budget !== "number" || budget < 1 || budget > 100 || !Number.isInteger(budget)) {
      return { success: false, error: "Vote budget must be an integer between 1 and 100" };
    }
    s.voteBudget = budget;
    await this.saveState();
    this.broadcastState(s);
    return { success: true };
  }

  async setRankingMethod(participantId: string, rankingMethod: RankingMethod): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (s.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can set ranking method" };
    }
    if (s.phase !== "setup") {
      return { success: false, error: "Ranking method can only be changed during setup" };
    }
    if (rankingMethod !== "score" && rankingMethod !== "pairwise") {
      return { success: false, error: "Invalid ranking method" };
    }

    s.rankingMethod = rankingMethod;
    s.votes = [];
    s.pairwiseChoices = [];
    await this.saveState();
    this.broadcast({ type: "ranking-method-changed", rankingMethod });
    this.broadcastState(s);
    return { success: true };
  }

  async addItem(participantId: string, rawText: string, columnId?: unknown): Promise<{ success: boolean; error?: string; item?: RetroItem }> {
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
    if (s.items.length >= MAX_ITEMS_PER_ROOM) {
      return { success: false, error: `Rooms can have at most ${MAX_ITEMS_PER_ROOM} cards` };
    }
    const columnValidation = validateExistingColumnId(s.columns ?? [], columnId);
    if (!columnValidation.valid) {
      return { success: false, error: columnValidation.error };
    }

    const item: RetroItem = {
      id: crypto.randomUUID(),
      text: sanitized,
      authorId: participantId,
      columnId: columnValidation.columnId,
      groupId: null,
      order: s.items.length,
    };
    s.items.push(item);
    await this.saveState();

    const broadcast: ServerToClientMessage = { type: "item-added", item };
    this.broadcast(broadcast);
    this.broadcastState(s);

    return { success: true, item };
  }

  async editItem(participantId: string, itemId: string, rawText: string): Promise<{ success: boolean; error?: string; item?: RetroItem }> {
    const s = await this.loadState();

    if (s.phase !== "write") {
      return { success: false, error: "Cannot edit items outside write phase" };
    }
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (!isValidItemText(rawText)) {
      return { success: false, error: "Item text cannot be empty" };
    }

    const itemIndex = s.items.findIndex((item) => item.id === itemId);
    if (itemIndex === -1) {
      return { success: false, error: "Item not found" };
    }
    const existing = s.items[itemIndex];
    if (!existing || existing.authorId !== participantId) {
      return { success: false, error: "Only the author can edit this item" };
    }

    const item = { ...existing, text: sanitizeItemText(rawText) };
    s.items = s.items.map((candidate) => candidate.id === itemId ? item : candidate);
    await this.saveState();
    this.broadcastState(s);
    return { success: true, item };
  }

  async deleteItem(participantId: string, itemId: string): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.phase !== "write") {
      return { success: false, error: "Cannot delete items outside write phase" };
    }
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }

    const existing = s.items.find((item) => item.id === itemId);
    if (!existing) {
      return { success: false, error: "Item not found" };
    }
    if (existing.authorId !== participantId) {
      return { success: false, error: "Only the author can delete this item" };
    }

    const target = itemVoteTarget(itemId);
    s.items = s.items
      .filter((item) => item.id !== itemId)
      .sort((a, b) => a.order - b.order)
      .map((item, _index, allItems) => ({
        ...item,
        order: allItems.filter((candidate) => candidate.columnId === item.columnId && candidate.groupId === item.groupId && candidate.order < item.order).length,
      }));
    s.votes = s.votes.filter((vote) => {
      const voteTarget = getVoteTarget(vote);
      return voteTarget === null || !sameVoteTarget(voteTarget, target);
    });
    s.pairwiseChoices = normalizePairwiseChoices(
      (s.pairwiseChoices ?? []).filter((choice) => !sameVoteTarget(choice.winner, target) && !sameVoteTarget(choice.loser, target)),
      s.participants,
      s.groups,
      s.items,
    );
    s.reactions = (s.reactions ?? []).filter((reaction) => !sameVoteTarget(reaction.target, target));

    await this.saveState();
    this.broadcastState(s);
    return { success: true };
  }

  async createAction(participantId: string, rawText: string): Promise<{ success: boolean; error?: string; action?: ActionItem }> {
    const s = await this.loadState();

    if (s.phase !== "review") {
      return { success: false, error: "Cannot add actions outside review phase" };
    }
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (!isValidActionText(rawText)) {
      return { success: false, error: "Action text cannot be empty" };
    }
    if ((s.actions ?? []).length >= MAX_ACTIONS_PER_ROOM) {
      return { success: false, error: `Rooms can have at most ${MAX_ACTIONS_PER_ROOM} actions` };
    }

    const action = createActionItem(crypto.randomUUID(), rawText, participantId, (s.actions ?? []).length);
    s.actions = [...(s.actions ?? []), action];
    await this.saveState();

    this.broadcast({ type: "actions-changed", actions: s.actions });
    this.broadcastState(s);

    return { success: true, action };
  }

  async editAction(participantId: string, actionId: string, rawText: string): Promise<{ success: boolean; error?: string; action?: ActionItem }> {
    const s = await this.loadState();

    if (s.phase !== "review") {
      return { success: false, error: "Cannot edit actions outside review phase" };
    }
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (typeof actionId !== "string" || actionId.trim().length === 0) {
      return { success: false, error: "Action not found" };
    }
    if (!isValidActionText(rawText)) {
      return { success: false, error: "Action text cannot be empty" };
    }

    const actionIndex = (s.actions ?? []).findIndex((action) => action.id === actionId);
    if (actionIndex === -1) {
      return { success: false, error: "Action not found" };
    }

    s.actions = [...(s.actions ?? [])];
    const existing = s.actions[actionIndex];
    if (!existing) {
      return { success: false, error: "Action not found" };
    }
    s.actions[actionIndex] = { ...existing, text: sanitizeActionText(rawText) };
    await this.saveState();

    this.broadcast({ type: "actions-changed", actions: s.actions });
    this.broadcastState(s);

    return { success: true, action: s.actions[actionIndex] };
  }

  async deleteAction(participantId: string, actionId: string): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.phase !== "review") {
      return { success: false, error: "Cannot delete actions outside review phase" };
    }
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (typeof actionId !== "string" || actionId.trim().length === 0) {
      return { success: false, error: "Action not found" };
    }

    const existing = s.actions ?? [];
    if (!existing.some((action) => action.id === actionId)) {
      return { success: false, error: "Action not found" };
    }

    s.actions = existing
      .filter((action) => action.id !== actionId)
      .sort((a, b) => a.order - b.order)
      .map((action, order) => ({ ...action, order }));
    await this.saveState();

    this.broadcast({ type: "actions-changed", actions: s.actions });
    this.broadcastState(s);

    return { success: true };
  }

  async setPhase(participantId: string, phase: Phase): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }

    if (s.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can change phase" };
    }

    if (!PHASE_ORDER.includes(phase)) {
      return { success: false, error: "Invalid phase" };
    }

    if (!canTransition(s.phase, phase)) {
      return { success: false, error: `Cannot transition from ${s.phase} to ${phase}` };
    }
    if (s.phase === "setup" && phase === "write" && (s.columns ?? []).length === 0) {
      return { success: false, error: "Add at least one column before starting write phase" };
    }
    if (phase === "vote" && (s.rankingMethod ?? "score") === "pairwise" && this.getDecisionTargetCount(s) > MAX_PAIRWISE_TARGETS) {
      return { success: false, error: `Pairwise ranking supports at most ${MAX_PAIRWISE_TARGETS} cards or groups` };
    }

    s.phase = phase;
    if (phase === "vote") {
      s.votingParticipantIds = s.participants.map((participant) => participant.id);
    }
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

    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }

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
    this.broadcastState(s);

    return { success: true };
  }

  async setReviewTarget(participantId: string, reviewTargetKey: string | null): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (s.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can change review slide" };
    }
    if (s.phase !== "review") {
      return { success: false, error: "Review slide can only be changed during review" };
    }

    const normalizedTargetKey = normalizeReviewTargetKey(reviewTargetKey, s.groups, s.items);
    if (reviewTargetKey !== null && normalizedTargetKey === null) {
      return { success: false, error: "Review target not found" };
    }

    s.reviewTargetKey = normalizedTargetKey;
    await this.saveState();
    this.broadcast({ type: "review-target-changed", reviewTargetKey: normalizedTargetKey });
    this.broadcastState(s);
    return { success: true };
  }

  private canMutateColumns(s: StoredState, participantId: string): { success: true } | { success: false; error: string } {
    if (!s.participants.some((participant) => participant.id === participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (s.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can configure columns" };
    }
    if (s.phase !== "setup") {
      return { success: false, error: "Columns can only be configured during setup" };
    }
    return { success: true };
  }

  private hasParticipant(s: StoredState, participantId: string): boolean {
    return s.participants.some((participant) => participant.id === participantId);
  }

  private hasValidConnectionToken(s: StoredState, participantId: string, connectionToken: unknown): boolean {
    return typeof connectionToken === "string"
      && connectionToken.length > 0
      && s.connectionTokens[participantId] === connectionToken;
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
    this.messageWindows.delete(participantId);
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
    const auth = this.authorizeHttpMutation(s, participantId, connectionToken);
    if (!auth.success) return auth;

    await this.deleteOutstandingWebSocketTicket(auth.participantId);

    const ticket = generateToken();
    const record: WebSocketTicket = {
      participantId: auth.participantId,
      expiresAt: Date.now() + WEBSOCKET_TICKET_TTL_MS,
    };
    await Promise.all([
      this.ctx.storage.put(`ws-ticket:${ticket}`, record),
      this.ctx.storage.put(`ws-ticket-by-participant:${auth.participantId}`, ticket),
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
    const existing = this.messageWindows.get(participantId);
    if (!existing || now - existing.startedAt >= WEBSOCKET_RATE_WINDOW_MS) {
      this.messageWindows.set(participantId, { startedAt: now, count: 1 });
    } else {
      if (existing.count >= MAX_WEBSOCKET_MESSAGES_PER_WINDOW) {
        return { allowed: false, reason: "Too many realtime updates. Reconnect and slow down." };
      }
      existing.count += 1;
    }

    if (!this.roomMessageWindow || now - this.roomMessageWindow.startedAt >= WEBSOCKET_RATE_WINDOW_MS) {
      this.roomMessageWindow = { startedAt: now, count: 1 };
      return { allowed: true };
    }
    if (this.roomMessageWindow.count >= MAX_ROOM_WEBSOCKET_MESSAGES_PER_WINDOW) {
      return { allowed: false, reason: "This room is receiving too many realtime updates. Please slow down." };
    }
    this.roomMessageWindow.count += 1;
    return { allowed: true };
  }

  private authorizeHttpMutation(
    s: StoredState | null,
    participantId: unknown,
    connectionToken: unknown,
  ): { success: true; participantId: string } | { success: false; error: string } {
    if (!s) {
      return { success: false, error: "Room not found" };
    }
    if (typeof participantId !== "string" || !this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (!this.hasValidConnectionToken(s, participantId, connectionToken)) {
      return { success: false, error: "Invalid participant credentials" };
    }
    return { success: true, participantId };
  }

  async createColumn(participantId: string, rawName: string): Promise<{ success: boolean; error?: string; column?: Column }> {
    const s = await this.loadState();
    const allowed = this.canMutateColumns(s, participantId);
    if (!allowed.success) return allowed;

    const sanitized = sanitizeColumnName(rawName);
    if (!isValidColumnName(rawName)) {
      return { success: false, error: "Column name cannot be empty" };
    }
    if ((s.columns ?? []).length >= MAX_COLUMNS) {
      return { success: false, error: `Rooms can have at most ${MAX_COLUMNS} columns` };
    }

    const column: Column = {
      id: crypto.randomUUID(),
      name: sanitized,
      order: (s.columns ?? []).length,
    };
    s.columns = [...(s.columns ?? []), column];
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

    const result = applyEditColumn(s.columns ?? [], columnId, rawName);
    if (result.error) {
      return { success: false, error: result.error };
    }
    s.columns = result.columns;
    await this.saveState();
    this.broadcastState(s);
    return { success: true, column: s.columns.find((column) => column.id === columnId) };
  }

  async reorderColumns(participantId: string, orderedIds: unknown): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    const allowed = this.canMutateColumns(s, participantId);
    if (!allowed.success) return allowed;

    const validation = validateFullColumnPermutation(s.columns ?? [], orderedIds);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    s.columns = applyReorderColumns(s.columns ?? [], validation.ids);
    await this.saveState();
    this.broadcastState(s);
    return { success: true };
  }

  async deleteColumn(participantId: string, columnId: string): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    const allowed = this.canMutateColumns(s, participantId);
    if (!allowed.success) return allowed;
    if (typeof columnId !== "string" || columnId.trim().length === 0) {
      return { success: false, error: "Column not found" };
    }

    const result = applyDeleteColumn(s.columns ?? [], s.groups, s.items, s.votes, columnId);
    if (result.error) {
      return { success: false, error: result.error };
    }

    s.columns = result.columns;
    s.groups = result.groups;
    s.items = result.items;
    s.votes = result.votes;
    s.pairwiseChoices = normalizePairwiseChoices(s.pairwiseChoices, s.participants, s.groups, s.items);
    s.reactions = normalizeReactions(s.reactions, s.participants, s.groups, s.items);
    await this.saveState();
    this.broadcastState(s);
    return { success: true };
  }

  async createGroup(participantId: string, rawName: string, columnId?: string): Promise<{ success: boolean; error?: string; group?: Group }> {
    const s = await this.loadState();
    if (s.phase !== "organise") {
      return { success: false, error: "Cannot create groups outside organise phase" };
    }
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (typeof columnId !== "string" || !s.columns?.some((column) => column.id === columnId)) {
      return { success: false, error: "Column not found" };
    }

    const sanitized = sanitizeColumnName(rawName);
    if (!isValidColumnName(rawName)) {
      return { success: false, error: "Group name cannot be empty" };
    }
    if (hasDuplicateGroupNameInColumn(s.groups, columnId, sanitized)) {
      return { success: false, error: "Group name already exists in this column" };
    }
    if (s.groups.length >= MAX_GROUPS_PER_ROOM) {
      return { success: false, error: `Rooms can have at most ${MAX_GROUPS_PER_ROOM} groups` };
    }

    const group: Group = {
      id: crypto.randomUUID(),
      name: sanitized,
      columnId,
      order: s.groups.filter((candidate) => candidate.columnId === columnId).length,
    };
    s.groups.push(group);
    await this.saveState();
    this.broadcastState(s);

    return { success: true, group };
  }

  async reorderItems(
    participantId: string,
    orderedIds: unknown,
    preconditions?: Partial<ItemReorderPreconditions>,
  ): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.phase !== "organise") {
      return { success: false, error: "Cannot reorder items outside organise phase" };
    }

    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }

    const validatedPreconditions = validateItemReorderPreconditions(preconditions);
    if (!validatedPreconditions.success) {
      return validatedPreconditions;
    }

    if (validatedPreconditions.preconditions.expectedVersion !== s.version) {
      return { success: false, error: "Stale item reorder rejected: room version changed" };
    }

    const validation = validateItemReorderPayload(s.items, orderedIds);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const firstItem = s.items.find((item) => item.id === validation.ids[0]);
    if (
      !firstItem
      || firstItem.columnId !== validatedPreconditions.preconditions.sourceColumnId
      || firstItem.groupId !== validatedPreconditions.preconditions.sourceGroupId
    ) {
      return { success: false, error: "Stale item reorder rejected: source list changed" };
    }

    s.items = applyReorderItems(s.items, validation.ids);
    await this.saveState();

    const broadcast: ServerToClientMessage = { type: "items-reordered", items: s.items };
    this.broadcast(broadcast);
    this.broadcastState(s);

    return { success: true };
  }

  private canMutateGroups(s: StoredState, participantId: string): { success: true } | { success: false; error: string } {
    if (s.phase !== "organise") {
      return { success: false, error: "Cannot mutate groups outside organise phase" };
    }
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    return { success: true };
  }

  async editGroup(participantId: string, groupId: string, rawName: string): Promise<{ success: boolean; error?: string; group?: Group }> {
    const s = await this.loadState();
    const allowed = this.canMutateGroups(s, participantId);
    if (!allowed.success) return allowed;
    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      return { success: false, error: "Group not found" };
    }

    const result = applyEditGroup(s.groups, groupId, rawName);
    if (result.error) {
      return { success: false, error: result.error };
    }
    s.groups = result.groups;
    await this.saveState();
    this.broadcastState(s);
    return { success: true, group: s.groups.find((group) => group.id === groupId) };
  }

  async deleteGroup(participantId: string, groupId: string): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    const allowed = this.canMutateGroups(s, participantId);
    if (!allowed.success) return allowed;
    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      return { success: false, error: "Group not found" };
    }

    const result = applyDeleteGroup(s.groups, s.items, s.votes, groupId);
    if (result.error) {
      return { success: false, error: result.error };
    }
    s.groups = result.groups;
    s.items = result.items;
    s.votes = result.votes;
    s.pairwiseChoices = normalizePairwiseChoices(s.pairwiseChoices, s.participants, s.groups, s.items);
    s.reactions = (s.reactions ?? []).filter((reaction) => !sameVoteTarget(reaction.target, groupVoteTarget(groupId)));
    await this.saveState();
    this.broadcastState(s);
    return { success: true };
  }

  async reorderGroups(participantId: string, orderedIds: unknown, expectedVersion?: unknown): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    const allowed = this.canMutateGroups(s, participantId);
    if (!allowed.success) return allowed;

    const validatedVersion = validateExpectedVersion(expectedVersion);
    if (!validatedVersion.success) {
      return validatedVersion;
    }
    if (validatedVersion.expectedVersion !== s.version) {
      return { success: false, error: "Stale group reorder rejected: room version changed" };
    }

    const validation = validateGroupReorderPayload(s.groups, orderedIds);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    s.groups = applyReorderColumnGroups(s.groups, validation.ids);
    await this.saveState();
    this.broadcastState(s);
    return { success: true };
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

    const currentSourceGroupId = item.groupId;
    if (validatedPreconditions.preconditions.sourceGroupId !== currentSourceGroupId) {
      return { success: false, error: "Stale item move rejected: source column changed" };
    }

    if (validatedPreconditions.preconditions.sourceIndex !== item.order) {
      return { success: false, error: "Stale item move rejected: source order changed" };
    }

    if (targetGroupId !== null && !s.groups.some((g) => g.id === targetGroupId)) {
      return { success: false, error: "Group not found" };
    }

    if (targetGroupId !== null && s.groups.find((g) => g.id === targetGroupId)?.columnId !== item.columnId) {
      return { success: false, error: "Cannot move item to a group in another column" };
    }

    if (!Number.isFinite(targetIndex) || !Number.isInteger(targetIndex)) {
      return { success: false, error: "Target index must be a finite integer" };
    }

    const targetListLength = s.items.filter(
      (i) => i.id !== item.id && i.columnId === item.columnId && i.groupId === targetGroupId,
    ).length;
    if (targetIndex < 0 || targetIndex > targetListLength) {
      return { success: false, error: "Target index out of bounds" };
    }

    s.items = applyMoveItemToGroup(s.items, itemId, targetGroupId, targetIndex);
    await this.saveState();

    this.broadcastState(s);

    return { success: true };
  }

  private resolveVoteTarget(target: VoteTarget): { success: true; target: VoteTarget } | { success: false; error: string } {
    if (target.type === "group") {
      return this.state?.groups.some((group) => group.id === target.id)
        ? { success: true, target }
        : { success: false, error: "Group not found" };
    }
    const item = this.state?.items.find((candidate) => candidate.id === target.id);
    if (!item) {
      return { success: false, error: "Item not found" };
    }
    if (item.groupId !== null) {
      return { success: false, error: "Cannot vote directly on a grouped item" };
    }
    return { success: true, target };
  }

  private resolveReactionTarget(target: ReactionTarget): { success: true; target: ReactionTarget } | { success: false; error: string } {
    if (!target || (target.type !== "group" && target.type !== "item") || typeof target.id !== "string") {
      return { success: false, error: "Reaction target not found" };
    }
    if (target.type === "group") {
      return this.state?.groups.some((group) => group.id === target.id)
        ? { success: true, target }
        : { success: false, error: "Group not found" };
    }
    return this.state?.items.some((item) => item.id === target.id)
      ? { success: true, target }
      : { success: false, error: "Item not found" };
  }

  async toggleReaction(participantId: string, target: ReactionTarget, emoji: string): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (!isAllowedReactionEmoji(emoji)) {
      return { success: false, error: "Reaction emoji is not supported" };
    }
    const targetValidation = this.resolveReactionTarget(target);
    if (!targetValidation.success) {
      return { success: false, error: targetValidation.error };
    }

    const reactionKey = `${participantId}:${voteTargetKey(targetValidation.target)}:${emoji}`;
    const existing = s.reactions ?? [];
    const hasReaction = existing.some((reaction) =>
      `${reaction.participantId}:${voteTargetKey(reaction.target)}:${reaction.emoji}` === reactionKey,
    );
    if (!hasReaction) {
      if (existing.length >= MAX_REACTIONS_PER_ROOM) {
        return { success: false, error: `Rooms can have at most ${MAX_REACTIONS_PER_ROOM} reactions` };
      }
      const targetReactionCount = existing.filter((reaction) => sameVoteTarget(reaction.target, targetValidation.target)).length;
      if (targetReactionCount >= MAX_REACTIONS_PER_TARGET) {
        return { success: false, error: `A card or group can have at most ${MAX_REACTIONS_PER_TARGET} reactions` };
      }
    }
    s.reactions = hasReaction
      ? existing.filter((reaction) => `${reaction.participantId}:${voteTargetKey(reaction.target)}:${reaction.emoji}` !== reactionKey)
      : [...existing, { participantId, target: targetValidation.target, emoji }];
    await this.saveState();
    this.broadcastState(s);
    return { success: true };
  }

  async castVote(participantId: string, targetOrGroupId: VoteTarget | string, count: number): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.phase !== "vote") {
      return { success: false, error: "Cannot vote outside vote phase" };
    }

    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (s.votingParticipantIds?.length && !s.votingParticipantIds.includes(participantId)) {
      return { success: false, error: "Participant joined after voting started" };
    }
    if ((s.rankingMethod ?? "score") !== "score") {
      return { success: false, error: "This room is using pairwise ranking" };
    }

    const target = typeof targetOrGroupId === "string" ? groupVoteTarget(targetOrGroupId) : targetOrGroupId;
    const targetValidation = this.resolveVoteTarget(target);
    if (!targetValidation.success) {
      return { success: false, error: targetValidation.error };
    }

    const result = applyCastVote(s.votes, participantId, targetValidation.target, count, s.voteBudget);
    if (result.error) {
      return { success: false, error: result.error };
    }

    s.votes = result.votes;
    await this.saveState();

    this.broadcastState(s);

    return { success: true };
  }

  async removeVote(participantId: string, targetOrGroupId: VoteTarget | string): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.phase !== "vote") {
      return { success: false, error: "Cannot remove votes outside vote phase" };
    }

    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (s.votingParticipantIds?.length && !s.votingParticipantIds.includes(participantId)) {
      return { success: false, error: "Participant joined after voting started" };
    }
    if ((s.rankingMethod ?? "score") !== "score") {
      return { success: false, error: "This room is using pairwise ranking" };
    }

    const target = typeof targetOrGroupId === "string" ? groupVoteTarget(targetOrGroupId) : targetOrGroupId;
    const targetValidation = this.resolveVoteTarget(target);
    if (!targetValidation.success) {
      return { success: false, error: targetValidation.error };
    }

    const existing = s.votes.find(
      (v) => {
        const voteTarget = getVoteTarget(v);
        return v.participantId === participantId && voteTarget !== null && sameVoteTarget(voteTarget, targetValidation.target);
      },
    );
    if (!existing) {
      return { success: false, error: "No votes to remove" };
    }

    s.votes = applyRemoveVote(s.votes, participantId, targetValidation.target);
    await this.saveState();

    this.broadcastState(s);

    return { success: true };
  }

  async choosePairwise(participantId: string, winner: VoteTarget, loser: VoteTarget): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();

    if (s.phase !== "vote") {
      return { success: false, error: "Cannot rank outside vote phase" };
    }
    if ((s.rankingMethod ?? "score") !== "pairwise") {
      return { success: false, error: "This room is using score voting" };
    }
    if (!this.hasParticipant(s, participantId)) {
      return { success: false, error: "Participant not found" };
    }
    if (s.votingParticipantIds?.length && !s.votingParticipantIds.includes(participantId)) {
      return { success: false, error: "Participant joined after voting started" };
    }

    const winnerValidation = this.resolveVoteTarget(winner);
    if (!winnerValidation.success) return { success: false, error: winnerValidation.error };
    const loserValidation = this.resolveVoteTarget(loser);
    if (!loserValidation.success) return { success: false, error: loserValidation.error };
    if (sameVoteTarget(winnerValidation.target, loserValidation.target)) {
      return { success: false, error: "Pairwise targets must be different" };
    }

    const targetKeys = new Set<string>([
      ...s.groups.map((group) => voteTargetKey(groupVoteTarget(group.id))),
      ...s.items.filter((item) => item.groupId === null).map((item) => voteTargetKey(itemVoteTarget(item.id))),
    ]);
    if (targetKeys.size > MAX_PAIRWISE_TARGETS) {
      return { success: false, error: `Pairwise ranking supports at most ${MAX_PAIRWISE_TARGETS} cards or groups` };
    }

    const choice: PairwiseChoice = {
      participantId,
      winner: winnerValidation.target,
      loser: loserValidation.target,
    };
    const choiceKey = `${participantId}:${pairwiseComparisonKey(choice.winner, choice.loser)}`;
    const existingChoices = s.pairwiseChoices ?? [];
    const isReplacingChoice = existingChoices.some((candidate) => `${candidate.participantId}:${pairwiseComparisonKey(candidate.winner, candidate.loser)}` === choiceKey);
    if (!isReplacingChoice && existingChoices.length >= MAX_PAIRWISE_CHOICES_PER_ROOM) {
      return { success: false, error: `Rooms can have at most ${MAX_PAIRWISE_CHOICES_PER_ROOM} pairwise choices` };
    }
    s.pairwiseChoices = [
      ...existingChoices.filter((candidate) => `${candidate.participantId}:${pairwiseComparisonKey(candidate.winner, candidate.loser)}` !== choiceKey),
      choice,
    ];
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
      ws.send(JSON.stringify({ type: "snapshot", state: this.toRoomState(s, participantId) }));
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/join" && request.method === "POST") {
      const body = await readJsonBody<{ participantId: string; displayName: string; connectionToken?: string; facilitatorClaimToken?: string }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const result = await this.join(body.participantId, body.displayName, body.connectionToken, body.facilitatorClaimToken);
      return Response.json(result);
    }

    if (url.pathname === "/state" && request.method === "POST") {
      const body = await readJsonBody<{ participantId: string; connectionToken?: string }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const result = await this.getRoomStateForParticipant(body.participantId, body.connectionToken);
      return Response.json(result, { status: result.success ? 200 : 403 });
    }

    if (url.pathname === "/vote-budget" && request.method === "POST") {
      const body = await readJsonBody<{ participantId: string; connectionToken?: string; budget: number }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const auth = this.authorizeHttpMutation(await this.loadState(), body.participantId, body.connectionToken);
      if (!auth.success) return Response.json(auth, { status: 403 });
      const result = await this.setVoteBudget(auth.participantId, body.budget);
      return Response.json(result);
    }

    if (url.pathname === "/ranking-method" && request.method === "POST") {
      const body = await readJsonBody<{ participantId: string; connectionToken?: string; rankingMethod: RankingMethod }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const auth = this.authorizeHttpMutation(await this.loadState(), body.participantId, body.connectionToken);
      if (!auth.success) return Response.json(auth, { status: 403 });
      const result = await this.setRankingMethod(auth.participantId, body.rankingMethod);
      return Response.json(result);
    }

    if (url.pathname === "/phase" && request.method === "POST") {
      const body = await readJsonBody<{ participantId: string; connectionToken?: string; phase: string }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const auth = this.authorizeHttpMutation(await this.loadState(), body.participantId, body.connectionToken);
      if (!auth.success) return Response.json(auth, { status: 403 });
      const result = await this.setPhase(auth.participantId, body.phase as Phase);
      return Response.json(result);
    }

    if (url.pathname === "/items" && request.method === "POST") {
      const body = await readJsonBody<{ participantId: string; connectionToken?: string; text: string; columnId?: string }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const auth = this.authorizeHttpMutation(await this.loadState(), body.participantId, body.connectionToken);
      if (!auth.success) return Response.json(auth, { status: 403 });
      const result = await this.addItem(auth.participantId, body.text, body.columnId);
      return Response.json(result);
    }

    const itemMatch = url.pathname.match(/^\/items\/([^/]+)$/);
    if (itemMatch && request.method === "PATCH") {
      const body = await readJsonBody<{ participantId: string; connectionToken?: string; text: string }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const auth = this.authorizeHttpMutation(await this.loadState(), body.participantId, body.connectionToken);
      if (!auth.success) return Response.json(auth, { status: 403 });
      const result = await this.editItem(auth.participantId, decodeURIComponent(itemMatch[1]!), body.text);
      return Response.json(result);
    }

    if (itemMatch && request.method === "DELETE") {
      const body = await readJsonBody<{ participantId: string; connectionToken?: string }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const auth = this.authorizeHttpMutation(await this.loadState(), body.participantId, body.connectionToken);
      if (!auth.success) return Response.json(auth, { status: 403 });
      const result = await this.deleteItem(auth.participantId, decodeURIComponent(itemMatch[1]!));
      return Response.json(result);
    }

    if (url.pathname === "/timer" && request.method === "POST") {
      const body = await readJsonBody<{ participantId: string; connectionToken?: string; durationSeconds: number }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const auth = this.authorizeHttpMutation(await this.loadState(), body.participantId, body.connectionToken);
      if (!auth.success) return Response.json(auth, { status: 403 });
      const result = await this.setTimer(auth.participantId, body.durationSeconds);
      return Response.json(result);
    }

    if (url.pathname === "/review-target" && request.method === "POST") {
      const body = await readJsonBody<{ participantId: string; connectionToken?: string; reviewTargetKey: string | null }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const auth = this.authorizeHttpMutation(await this.loadState(), body.participantId, body.connectionToken);
      if (!auth.success) return Response.json(auth, { status: 403 });
      const result = await this.setReviewTarget(auth.participantId, body.reviewTargetKey);
      return Response.json(result);
    }

    if (url.pathname === "/purge" && request.method === "POST") {
      const body = await readJsonBody<{ participantId: string; connectionToken?: string }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const auth = this.authorizeHttpMutation(await this.loadState(), body.participantId, body.connectionToken);
      if (!auth.success) return Response.json(auth, { status: 403 });
      const result = await this.purgeByFacilitator(auth.participantId);
      return Response.json(result);
    }

    if (url.pathname === "/ws-ticket" && request.method === "POST") {
      const body = await readJsonBody<{ participantId: string; connectionToken?: string }>(request);
      if (!body) return Response.json({ success: false, error: "Valid JSON body is required" }, { status: 400 });
      const result = await this.createWebSocketTicket(body.participantId, body.connectionToken);
      return Response.json(result, { status: result.success ? 200 : 403 });
    }

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

      const snapshot = this.toRoomState(s, participantId);
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

    if (this.sessions.get(participantId) !== ws) return;
    this.sessions.delete(participantId);
    this.messageWindows.delete(participantId);
    const leftMsg: ServerToClientMessage = { type: "participant-left", participantId };
    this.broadcast(leftMsg);
    this.ctx.waitUntil(this.scheduleEmptyRoomPurge());
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
      case "edit-item": {
        const result = await this.editItem(participantId, msg.itemId, msg.text);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "delete-item": {
        const result = await this.deleteItem(participantId, msg.itemId);
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
      case "set-ranking-method": {
        const result = await this.setRankingMethod(participantId, msg.rankingMethod);
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
        const result = await this.createGroup(participantId, msg.name, msg.columnId);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "edit-group": {
        const result = await this.editGroup(participantId, msg.groupId, msg.name);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "delete-group": {
        const result = await this.deleteGroup(participantId, msg.groupId);
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
      case "delete-column": {
        const result = await this.deleteColumn(participantId, msg.columnId);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "reorder-items": {
        const result = await this.reorderItems(participantId, msg.itemIds, {
          expectedVersion: msg.expectedVersion,
          sourceColumnId: msg.sourceColumnId,
          sourceGroupId: msg.sourceGroupId,
        });
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "reorder-groups": {
        const result = await this.reorderGroups(participantId, msg.groupIds, msg.expectedVersion);
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
      case "set-review-target": {
        const result = await this.setReviewTarget(participantId, msg.reviewTargetKey);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "cast-vote": {
        const target = parseVoteTargetMessage(msg);
        const result = target.success
          ? await this.castVote(participantId, target.target, msg.count)
          : { success: false, error: target.error };
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "remove-vote": {
        const target = parseVoteTargetMessage(msg);
        const result = target.success
          ? await this.removeVote(participantId, target.target)
          : { success: false, error: target.error };
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "choose-pairwise": {
        const result = await this.choosePairwise(participantId, msg.winner, msg.loser);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "toggle-reaction": {
        const result = await this.toggleReaction(participantId, msg.target, msg.emoji);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "create-action": {
        const result = await this.createAction(participantId, msg.text);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "edit-action": {
        const result = await this.editAction(participantId, msg.actionId, msg.text);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "delete-action": {
        const result = await this.deleteAction(participantId, msg.actionId);
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
