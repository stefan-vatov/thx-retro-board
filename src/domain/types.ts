export type Phase = "write" | "organise" | "vote" | "review";

export interface Participant {
  id: string;
  displayName: string;
  isFacilitator: boolean;
}

export interface RetroItem {
  id: string;
  text: string;
  authorId: string;
  /** Canonical configured column association. Null is accepted only for legacy/unassigned items. */
  columnId: string | null;
  /** @deprecated Compatibility alias for columnId while the UI migrates from groups to columns. */
  groupId: string | null;
  order: number;
}

export interface Column {
  id: string;
  name: string;
  order: number;
}

/** @deprecated Product-facing columns are canonical; Group remains a compatibility alias. */
export type Group = Column;

export interface VoteAllocation {
  participantId: string;
  itemId: string;
  count: number;
}

export interface TimerState {
  startedAt: number | null;
  durationSeconds: number | null;
  expired: boolean;
}

export interface RoomState {
  roomId: string;
  phase: Phase;
  participants: Participant[];
  items: RetroItem[];
  columns: Column[];
  /** @deprecated Compatibility alias for columns while the UI migrates from groups to columns. */
  groups: Group[];
  votes: VoteAllocation[];
  timer: TimerState;
  voteBudget: number;
  version: number;
}
