export type ServerToClientMessage =
  | { type: "snapshot"; state: import("./types").RoomState }
  | { type: "participant-joined"; participant: import("./types").Participant }
  | { type: "participant-left"; participantId: string }
  | { type: "phase-changed"; phase: import("./types").Phase }
  | { type: "item-added"; item: import("./types").RetroItem }
  | { type: "items-reordered"; items: import("./types").RetroItem[] }
  | { type: "groups-changed"; groups: import("./types").Group[] }
  | { type: "vote-changed"; itemId: string; participantId: string; delta: number; totalForItem: number }
  | { type: "timer-updated"; timer: import("./types").TimerState }
  | { type: "error"; message: string };

export type ClientToServerMessage =
  | { type: "join"; participantId: string; displayName: string }
  | { type: "add-item"; text: string }
  | { type: "reorder-items"; itemIds: string[] }
  | { type: "create-group"; name: string }
  | { type: "reorder-groups"; groupIds: string[] }
  | { type: "move-item-to-group"; itemId: string; groupId: string | null; index: number }
  | { type: "set-phase"; phase: import("./types").Phase }
  | { type: "set-vote-budget"; budget: number }
  | { type: "cast-vote"; itemId: string; count: number }
  | { type: "remove-vote"; itemId: string }
  | { type: "set-timer"; durationSeconds: number };
