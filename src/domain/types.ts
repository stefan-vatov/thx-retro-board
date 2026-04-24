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
  groupId: string | null;
  order: number;
}

export interface Group {
  id: string;
  name: string;
  order: number;
}

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
  groups: Group[];
  votes: VoteAllocation[];
  timer: TimerState;
  voteBudget: number;
}
