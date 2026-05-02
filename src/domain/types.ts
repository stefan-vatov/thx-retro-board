export type Phase = "setup" | "write" | "organise" | "vote" | "review" | "finalize";

export type RankingMethod = "score" | "pairwise";

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
  columnId: string;
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

export type VoteTarget = { type: "group"; id: string } | { type: "item"; id: string };

export type ReactionTarget = VoteTarget;

export interface Reaction {
  participantId: string;
  target: ReactionTarget;
  emoji: string;
}

export interface VoteAllocation {
  participantId: string;
  /** Canonical target for this allocation. */
  target?: VoteTarget;
  /** @deprecated Compatibility alias for group targets while UI message names migrate. */
  groupId?: string;
  /** @deprecated Compatibility alias for legacy group targets or ungrouped item targets while UI message names migrate. */
  itemId?: string;
  count: number;
}

export interface PairwiseChoice {
  participantId: string;
  winner: VoteTarget;
  loser: VoteTarget;
  /** Aggregate count for anonymous projected/exported pairwise choices. Individual ballots omit this. */
  count?: number;
}

export interface PairwiseProgress {
  participantId: string;
  answered: number;
  total: number;
}

export interface ActionItem {
  id: string;
  text: string;
  authorId: string;
  order: number;
}

export interface TimerState {
  startedAt: number | null;
  durationSeconds: number | null;
  expired: boolean;
}

export interface RoomState {
  schemaVersion: 2;
  roomId: string;
  startedAt: number;
  purgeScheduledAt: number | null;
  phase: Phase;
  participants: Participant[];
  items: RetroItem[];
  columns: Column[];
  /** @deprecated Compatibility alias for columns while the UI migrates from groups to columns. */
  groups: Group[];
  votes: VoteAllocation[];
  rankingMethod: RankingMethod;
  pairwiseChoices: PairwiseChoice[];
  pairwiseProgress: PairwiseProgress[];
  reviewTargetKey: string | null;
  actions: ActionItem[];
  reactions: Reaction[];
  timer: TimerState;
  voteBudget: number;
  version: number;
}
