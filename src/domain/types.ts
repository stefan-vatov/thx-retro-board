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
  /** Original configured column association. */
  columnId: string | null;
  /** Current nested group membership; null means ungrouped within the item's original column. */
  groupId: string | null;
  order: number;
}

export interface Column {
  id: string;
  name: string;
  order: number;
}

export interface Group {
  id: string;
  name: string;
  columnId: string;
  order: number;
}

export interface VoteAllocation {
  participantId: string;
  /** Group targeted by this allocation. */
  groupId: string;
  /** @deprecated Compatibility alias for groupId while UI message names migrate. */
  itemId?: string;
  count: number;
}

export interface TimerState {
  startedAt: number | null;
  durationSeconds: number | null;
  expired: boolean;
}

export interface RoomState {
  schemaVersion: 2;
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
