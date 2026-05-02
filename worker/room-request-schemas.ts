import { Schema } from "effect";
import { PhaseSchema, RankingMethodSchema } from "../src/domain";

export const OptionalConnectionTokenSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
});

export const CreateRoomRequestSchema = Schema.Struct({
  turnstileToken: Schema.optional(Schema.String),
});

export const JoinRoomRequestSchema = Schema.Struct({
  participantId: Schema.String,
  displayName: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  facilitatorClaimToken: Schema.optional(Schema.String),
});

export const VoteBudgetRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  budget: Schema.Number,
});

export const RankingMethodRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  rankingMethod: RankingMethodSchema,
});

export const PhaseRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  phase: PhaseSchema,
});

export const AddItemRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  text: Schema.String,
  columnId: Schema.optional(Schema.String),
});

export const EditItemRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  text: Schema.String,
});

export const TimerRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  durationSeconds: Schema.Number,
});

export const ReviewTargetRequestSchema = Schema.Struct({
  participantId: Schema.String,
  connectionToken: Schema.optional(Schema.String),
  reviewTargetKey: Schema.NullOr(Schema.String),
});
