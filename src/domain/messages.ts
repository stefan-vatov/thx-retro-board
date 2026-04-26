export type ServerToClientMessage =
  | { type: "snapshot"; state: import("./types").RoomState }
  | { type: "participant-joined"; participant: import("./types").Participant }
  | { type: "participant-left"; participantId: string }
  | { type: "phase-changed"; phase: import("./types").Phase }
  | { type: "item-added"; item: import("./types").RetroItem }
  | { type: "items-reordered"; items: import("./types").RetroItem[] }
  | { type: "groups-changed"; groups: import("./types").Group[] }
  | { type: "columns-changed"; columns: import("./types").Column[]; version: number }
  | { type: "vote-changed"; groupId: string; itemId?: string; participantId: string; delta: number; totalForItem: number }
  // delta > 0 for cast-vote (always +count), delta < 0 for remove-vote (always -1).
  // The vote-changed message is informational; authoritative state arrives via snapshot broadcast.
  | { type: "timer-updated"; timer: import("./types").TimerState }
  | { type: "error"; message: string };

export type ClientToServerMessage =
  | { type: "join"; participantId: string; displayName: string }
  | { type: "add-item"; text: string; columnId?: string | null }
  | { type: "reorder-items"; itemIds: string[] }
  | { type: "create-group"; name: string; columnId: string }
  | { type: "edit-group"; groupId: string; name: string }
  | { type: "delete-group"; groupId: string }
  | { type: "create-column"; name: string }
  | { type: "edit-column"; columnId: string; name: string }
  | { type: "delete-column"; columnId: string }
  | { type: "reorder-columns"; columnIds: string[] }
  | { type: "reorder-groups"; groupIds: string[] }
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
  | { type: "cast-vote"; groupId?: string; itemId?: string; count: number }
  | { type: "remove-vote"; groupId?: string; itemId?: string }
  | { type: "set-timer"; durationSeconds: number };
