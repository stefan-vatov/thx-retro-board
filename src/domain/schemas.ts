import { Schema } from "effect";
import type {
  ActionItem,
  ClientToServerMessage,
  Column,
  Group,
  PairwiseChoice,
  Participant,
  Phase,
  RankingMethod,
  RetroItem,
  RoomState,
  ServerToClientMessage,
  TimerState,
} from ".";

const MutableArray = <S extends Schema.Schema.Any>(schema: S) => Schema.mutable(Schema.Array(schema));

export const PhaseSchema: Schema.Schema<Phase> = Schema.Literal("setup", "write", "organise", "vote", "review", "finalize");
export const RankingMethodSchema: Schema.Schema<RankingMethod> = Schema.Literal("score", "pairwise");
export const VoteTargetSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal("group"), id: Schema.String }),
  Schema.Struct({ type: Schema.Literal("item"), id: Schema.String }),
);
export const ParticipantSchema: Schema.Schema<Participant> = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  isFacilitator: Schema.Boolean,
});
export const ColumnSchema: Schema.Schema<Column> = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  order: Schema.Number,
});
export const GroupSchema: Schema.Schema<Group> = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  columnId: Schema.String,
  order: Schema.Number,
});
export const RetroItemSchema: Schema.Schema<RetroItem> = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  authorId: Schema.String,
  columnId: Schema.String,
  groupId: Schema.NullOr(Schema.String),
  order: Schema.Number,
});
export const VoteAllocationSchema = Schema.Struct({
  participantId: Schema.String,
  target: Schema.optional(VoteTargetSchema),
  groupId: Schema.optional(Schema.String),
  itemId: Schema.optional(Schema.String),
  count: Schema.Number,
});
export const PairwiseChoiceSchema: Schema.Schema<PairwiseChoice> = Schema.Struct({
  participantId: Schema.String,
  winner: VoteTargetSchema,
  loser: VoteTargetSchema,
  count: Schema.optional(Schema.Number),
});
export const PairwiseProgressSchema = Schema.Struct({
  participantId: Schema.String,
  answered: Schema.Number,
  total: Schema.Number,
});
export const ActionItemSchema: Schema.Schema<ActionItem> = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  authorId: Schema.String,
  order: Schema.Number,
});
export const ReactionSchema = Schema.Struct({
  participantId: Schema.String,
  target: VoteTargetSchema,
  emoji: Schema.String,
});
export const TimerStateSchema: Schema.Schema<TimerState> = Schema.Struct({
  startedAt: Schema.NullOr(Schema.Number),
  durationSeconds: Schema.NullOr(Schema.Number),
  expired: Schema.Boolean,
});
export const RoomStateSchema: Schema.Schema<RoomState> = Schema.mutable(Schema.Struct({
  schemaVersion: Schema.Literal(2),
  roomId: Schema.String,
  startedAt: Schema.Number,
  purgeScheduledAt: Schema.NullOr(Schema.Number),
  phase: PhaseSchema,
  participants: MutableArray(ParticipantSchema),
  items: MutableArray(RetroItemSchema),
  columns: MutableArray(ColumnSchema),
  groups: MutableArray(GroupSchema),
  votes: MutableArray(VoteAllocationSchema),
  rankingMethod: RankingMethodSchema,
  pairwiseChoices: MutableArray(PairwiseChoiceSchema),
  pairwiseProgress: MutableArray(PairwiseProgressSchema),
  reviewTargetKey: Schema.NullOr(Schema.String),
  actions: MutableArray(ActionItemSchema),
  reactions: MutableArray(ReactionSchema),
  timer: TimerStateSchema,
  voteBudget: Schema.Number,
  version: Schema.Number,
}));

export const ServerToClientMessageSchema: Schema.Schema<ServerToClientMessage> = Schema.mutable(Schema.Union(
  Schema.Struct({ type: Schema.Literal("snapshot"), state: RoomStateSchema }),
  Schema.Struct({ type: Schema.Literal("participant-joined"), participant: ParticipantSchema }),
  Schema.Struct({ type: Schema.Literal("participant-left"), participantId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("phase-changed"), phase: PhaseSchema }),
  Schema.Struct({ type: Schema.Literal("item-added"), item: RetroItemSchema }),
  Schema.Struct({ type: Schema.Literal("items-reordered"), items: MutableArray(RetroItemSchema) }),
  Schema.Struct({ type: Schema.Literal("groups-changed"), groups: MutableArray(GroupSchema) }),
  Schema.Struct({ type: Schema.Literal("actions-changed"), actions: MutableArray(ActionItemSchema) }),
  Schema.Struct({ type: Schema.Literal("columns-changed"), columns: MutableArray(ColumnSchema), version: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("vote-changed"), target: Schema.optional(VoteTargetSchema), groupId: Schema.String, itemId: Schema.optional(Schema.String), participantId: Schema.String, delta: Schema.Number, totalForGroup: Schema.Number, totalForItem: Schema.optional(Schema.Number) }),
  Schema.Struct({ type: Schema.Literal("ranking-method-changed"), rankingMethod: RankingMethodSchema }),
  Schema.Struct({ type: Schema.Literal("pairwise-choice-changed"), choice: PairwiseChoiceSchema }),
  Schema.Struct({ type: Schema.Literal("review-target-changed"), reviewTargetKey: Schema.NullOr(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("timer-updated"), timer: TimerStateSchema }),
  Schema.Struct({ type: Schema.Literal("room-purged"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
));

export const ClientToServerMessageSchema: Schema.Schema<ClientToServerMessage> = Schema.mutable(Schema.Union(
  Schema.Struct({ type: Schema.Literal("join"), participantId: Schema.String, displayName: Schema.String }),
  Schema.Struct({ type: Schema.Literal("add-item"), text: Schema.String, columnId: Schema.optional(Schema.NullOr(Schema.String)) }),
  Schema.Struct({ type: Schema.Literal("edit-item"), itemId: Schema.String, text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("delete-item"), itemId: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("reorder-items"),
    itemIds: MutableArray(Schema.String),
    expectedVersion: Schema.Number,
    sourceColumnId: Schema.String,
    sourceGroupId: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("create-group"), name: Schema.String, columnId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("edit-group"), groupId: Schema.String, name: Schema.String }),
  Schema.Struct({ type: Schema.Literal("delete-group"), groupId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("create-column"), name: Schema.String }),
  Schema.Struct({ type: Schema.Literal("edit-column"), columnId: Schema.String, name: Schema.String }),
  Schema.Struct({ type: Schema.Literal("delete-column"), columnId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("reorder-columns"), columnIds: MutableArray(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("reorder-groups"), groupIds: MutableArray(Schema.String), expectedVersion: Schema.Number }),
  Schema.Struct({
    type: Schema.Literal("move-item-to-group"),
    itemId: Schema.String,
    groupId: Schema.NullOr(Schema.String),
    index: Schema.Number,
    expectedVersion: Schema.Number,
    sourceGroupId: Schema.NullOr(Schema.String),
    sourceIndex: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("set-phase"), phase: PhaseSchema }),
  Schema.Struct({ type: Schema.Literal("set-vote-budget"), budget: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("set-ranking-method"), rankingMethod: RankingMethodSchema }),
  Schema.Struct({ type: Schema.Literal("cast-vote"), groupId: Schema.optional(Schema.String), itemId: Schema.optional(Schema.String), count: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("remove-vote"), groupId: Schema.optional(Schema.String), itemId: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("choose-pairwise"), winner: VoteTargetSchema, loser: VoteTargetSchema }),
  Schema.Struct({ type: Schema.Literal("set-review-target"), reviewTargetKey: Schema.NullOr(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("toggle-reaction"), target: VoteTargetSchema, emoji: Schema.String }),
  Schema.Struct({ type: Schema.Literal("create-action"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("edit-action"), actionId: Schema.String, text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("delete-action"), actionId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("set-timer"), durationSeconds: Schema.Number }),
));
