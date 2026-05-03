import { Effect } from "effect";
import {
  pairwiseComparisonKey,
  type RoomState,
  type ServerToClientMessage,
} from "../domain";

export interface RealtimeMessageResult {
  state: RoomState | null;
  roomPurged: boolean;
  lastError?: string;
  shouldCloseSocket?: boolean;
}

function withState(state: RoomState | null): RealtimeMessageResult {
  return { state, roomPurged: false };
}

export function applyRealtimeMessageEffect(
  current: RoomState | null,
  message: ServerToClientMessage,
): Effect.Effect<RealtimeMessageResult> {
  return Effect.sync(() => {
    if (message.type === "snapshot") return withState(message.state as RoomState);
    if (message.type === "room-purged") {
      return {
        state: null,
        roomPurged: true,
        lastError: message.reason,
        shouldCloseSocket: true,
      };
    }
    if (message.type === "error") {
      return { state: current, roomPurged: false, lastError: message.message };
    }
    if (!current) return withState(current);

    switch (message.type) {
      case "participant-joined": {
        const exists = current.participants.some((participant) => participant.id === message.participant.id);
        return withState(exists ? current : { ...current, participants: [...current.participants, message.participant] });
      }
      case "participant-left":
        return withState({
          ...current,
          participants: current.participants.filter((participant) => participant.id !== message.participantId),
        });
      case "phase-changed":
        return withState({ ...current, phase: message.phase });
      case "item-added": {
        const exists = current.items.some((item) => item.id === message.item.id);
        return withState(exists ? current : { ...current, items: [...current.items, message.item] });
      }
      case "items-reordered":
        return withState({ ...current, items: message.items });
      case "groups-changed":
        return withState({ ...current, groups: message.groups });
      case "actions-changed":
        return withState({ ...current, actions: message.actions });
      case "columns-changed":
        return withState({ ...current, columns: message.columns, version: message.version });
      case "ranking-method-changed":
        return withState({ ...current, rankingMethod: message.rankingMethod });
      case "pairwise-choice-changed": {
        const choiceKey = `${message.choice.participantId}:${pairwiseComparisonKey(message.choice.winner, message.choice.loser)}`;
        const pairwiseChoices = [
          ...(current.pairwiseChoices ?? []).filter((choice) =>
            `${choice.participantId}:${pairwiseComparisonKey(choice.winner, choice.loser)}` !== choiceKey,
          ),
          message.choice,
        ];
        return withState({ ...current, pairwiseChoices });
      }
      case "review-target-changed":
        return withState({ ...current, reviewTargetKey: message.reviewTargetKey });
      case "timer-updated":
        return withState({ ...current, timer: message.timer });
      case "vote-changed":
        return withState(current);
    }
  });
}
