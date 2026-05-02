export type ServerToClientMessage =
  | { type: "snapshot"; state: import("./types").RoomState }
  | { type: "participant-joined"; participant: import("./types").Participant }
  | { type: "participant-left"; participantId: string }
  | { type: "phase-changed"; phase: import("./types").Phase }
  | { type: "item-added"; item: import("./types").RetroItem }
  | { type: "items-reordered"; items: import("./types").RetroItem[] }
  | { type: "groups-changed"; groups: import("./types").Group[] }
  | { type: "actions-changed"; actions: import("./types").ActionItem[] }
  | { type: "columns-changed"; columns: import("./types").Column[]; version: number }
  | { type: "vote-changed"; target?: import("./types").VoteTarget; groupId: string; itemId?: string; participantId: string; delta: number; totalForGroup: number; totalForItem?: number }
  | { type: "ranking-method-changed"; rankingMethod: import("./types").RankingMethod }
  | { type: "pairwise-choice-changed"; choice: import("./types").PairwiseChoice }
  | { type: "review-target-changed"; reviewTargetKey: string | null }
  | { type: "room-purged"; reason: string }
  // delta > 0 for cast-vote (always +count), delta < 0 for remove-vote (always -1).
  // The vote-changed message is informational; authoritative state arrives via snapshot broadcast.
  | { type: "timer-updated"; timer: import("./types").TimerState }
  | { type: "error"; message: string };

export type ClientToServerMessage =
  | { type: "join"; participantId: string; displayName: string }
  | { type: "add-item"; text: string; columnId?: string | null }
  | { type: "edit-item"; itemId: string; text: string }
  | { type: "delete-item"; itemId: string }
  | { type: "reorder-items"; itemIds: string[]; expectedVersion: number; sourceColumnId: string; sourceGroupId: string | null }
  | { type: "create-group"; name: string; columnId: string }
  | { type: "edit-group"; groupId: string; name: string }
  | { type: "delete-group"; groupId: string }
  | { type: "create-column"; name: string }
  | { type: "edit-column"; columnId: string; name: string }
  | { type: "delete-column"; columnId: string }
  | { type: "reorder-columns"; columnIds: string[] }
  | { type: "reorder-groups"; groupIds: string[]; expectedVersion: number }
  | {
      type: "move-item-to-group";
      itemId: string;
      groupId: string | null;
      index: number;
      expectedVersion: number;
      sourceGroupId: string | null;
      sourceIndex: number;
    }
  | { type: "set-phase"; phase: import("./types").Phase }
  | { type: "set-vote-budget"; budget: number }
  | { type: "set-ranking-method"; rankingMethod: import("./types").RankingMethod }
  | { type: "cast-vote"; groupId?: string; itemId?: string; count: number }
  | { type: "remove-vote"; groupId?: string; itemId?: string }
  | { type: "choose-pairwise"; winner: import("./types").VoteTarget; loser: import("./types").VoteTarget }
  | { type: "set-review-target"; reviewTargetKey: string | null }
  | { type: "toggle-reaction"; target: import("./types").ReactionTarget; emoji: string }
  | { type: "create-action"; text: string }
  | { type: "edit-action"; actionId: string; text: string }
  | { type: "delete-action"; actionId: string }
  | { type: "set-timer"; durationSeconds: number };
