import type {
  ActionItem,
  Column,
  Group,
  PairwiseChoice,
  Participant,
  RankingMethod,
  Reaction,
  RetroItem,
  RoomState,
  VoteAllocation,
} from "../src/domain";

export interface StoredTimer {
  startedAt: number | null;
  durationSeconds: number | null;
  expired: boolean;
}

export interface StoredState {
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

export interface WebSocketTicket {
  participantId: string;
  expiresAt: number;
}

export const EMPTY_ROOM_PURGE_DELAY_MS = 60 * 60 * 1000;
export const MAX_ROOM_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const MAX_PARTICIPANTS_PER_ROOM = 100;
export const MAX_ITEMS_PER_ROOM = 400;
export const MAX_GROUPS_PER_ROOM = 120;
export const MAX_ACTIONS_PER_ROOM = 150;
export const MAX_REACTIONS_PER_ROOM = 3000;
export const MAX_REACTIONS_PER_TARGET = 300;
export const MAX_PAIRWISE_CHOICES_PER_ROOM = 6000;
export const MAX_PAIRWISE_TARGETS = 50;
export const MAX_WEBSOCKET_MESSAGE_BYTES = 16 * 1024;
export const MAX_WEBSOCKET_MESSAGES_PER_WINDOW = 20;
export const MAX_ROOM_WEBSOCKET_MESSAGES_PER_WINDOW = 60;
export const WEBSOCKET_RATE_WINDOW_MS = 10 * 1000;
export const WEBSOCKET_TICKET_TTL_MS = 30 * 1000;
export const ANONYMOUS_VOTE_PARTICIPANT_ID = "__anonymous__";

export interface MoveItemPreconditions {
  expectedVersion: number;
  sourceGroupId: string | null;
  sourceIndex: number;
}

export interface ItemReorderPreconditions {
  expectedVersion: number;
  sourceColumnId: string;
  sourceGroupId: string | null;
}

