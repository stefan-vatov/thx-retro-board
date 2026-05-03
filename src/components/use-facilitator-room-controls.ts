import { useEffect, useRef, useState, type RefObject } from "react";
import { Effect } from "effect";
import {
  getRoomStateEffect,
  purgeRoomEffect,
  setPhaseEffect,
  setRankingMethodEffect,
  setTimerEffect,
  setVoteBudgetEffect,
} from "../api";
import type { RankingMethod, RoomState } from "../domain";
import {
  getNextPhaseEffect,
  getRankingMethodSuccessMessageEffect,
  parseTimerMinutesEffect,
  parseVoteBudgetEffect,
} from "./facilitator-controls-effect";
import {
  clearStoredIdentity,
  runRoomMutationWithRefreshEffect,
} from "./room-session";

type UseFacilitatorRoomControlsArgs = {
  roomId: string | undefined;
  roomState: RoomState | null;
  participantId: string;
  connectionToken: string | undefined;
  phaseStatusRef: RefObject<HTMLDivElement | null>;
  clearError: () => void;
  setLocalRoomState: (state: RoomState | null) => void;
  setPageState: (state: "not-found") => void;
};

export function useFacilitatorRoomControls({
  roomId,
  roomState,
  participantId,
  connectionToken,
  phaseStatusRef,
  clearError,
  setLocalRoomState,
  setPageState,
}: UseFacilitatorRoomControlsArgs) {
  const [voteBudgetInput, setVoteBudgetInput] = useState("5");
  const [voteBudgetDirty, setVoteBudgetDirty] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);
  const [timerMinutesInput, setTimerMinutesInput] = useState("5");
  const [timerMsg, setTimerMsg] = useState<string | null>(null);
  const [timerInputError, setTimerInputError] = useState<string | null>(null);
  const [phaseMsg, setPhaseMsg] = useState<string | null>(null);
  const [rankingMsg, setRankingMsg] = useState<string | null>(null);
  const [budgetPending, setBudgetPending] = useState(false);
  const [rankingPending, setRankingPending] = useState(false);
  const [phasePending, setPhasePending] = useState(false);
  const [timerPending, setTimerPending] = useState(false);
  const [purgePending, setPurgePending] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);
  const lastAuthoritativeVoteBudgetRef = useRef<number | null>(null);
  const nextPhase = roomState
    ? Effect.runSync(getNextPhaseEffect(roomState.phase))
    : undefined;

  useEffect(() => {
    const timeout = window.setTimeout(() => setTimerPending(false), 0);
    return () => window.clearTimeout(timeout);
  }, [roomState?.timer.startedAt, roomState?.timer.durationSeconds]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPhaseMsg(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [roomState?.phase]);

  useEffect(() => {
    if (!roomState) return undefined;
    const nextBudget = roomState.voteBudget;
    const previousBudget = lastAuthoritativeVoteBudgetRef.current;
    if (previousBudget === nextBudget) return undefined;

    lastAuthoritativeVoteBudgetRef.current = nextBudget;
    const nextBudgetInput = String(nextBudget);
    if (
      !voteBudgetDirty ||
      voteBudgetInput === nextBudgetInput ||
      budgetPending
    ) {
      const timeout = window.setTimeout(() => {
        setVoteBudgetInput(nextBudgetInput);
        setVoteBudgetDirty(false);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [
    budgetPending,
    roomState,
    roomState?.voteBudget,
    voteBudgetDirty,
    voteBudgetInput,
  ]);

  async function handleSetBudget() {
    if (!roomId || budgetPending) return;
    setBudgetMsg(null);
    const parsedBudget = Effect.runSync(parseVoteBudgetEffect(voteBudgetInput));
    if (!parsedBudget.success) {
      setBudgetMsg(parsedBudget.error);
      return;
    }
    const { budget } = parsedBudget;
    setBudgetPending(true);
    try {
      const result = await Effect.runPromise(
        runRoomMutationWithRefreshEffect(
          setVoteBudgetEffect(roomId, participantId, connectionToken, budget),
          getRoomStateEffect(roomId, participantId, connectionToken),
        ),
      );
      if (result.success) {
        setBudgetMsg("Vote budget updated.");
        setVoteBudgetInput(String(budget));
        setVoteBudgetDirty(false);
        if (result.state) setLocalRoomState(result.state);
      } else {
        setBudgetMsg(result.error ?? "Failed to update budget.");
      }
    } finally {
      setBudgetPending(false);
    }
  }

  async function handleSetRankingMethod(rankingMethod: RankingMethod) {
    if (
      !roomId ||
      !roomState ||
      rankingPending ||
      roomState.rankingMethod === rankingMethod
    )
      return;
    setRankingMsg(null);
    clearError();
    setRankingPending(true);
    try {
      const result = await Effect.runPromise(
        runRoomMutationWithRefreshEffect(
          setRankingMethodEffect(
            roomId,
            participantId,
            connectionToken,
            rankingMethod,
          ),
          getRoomStateEffect(roomId, participantId, connectionToken),
        ),
      );
      if (result.success) {
        setRankingMsg(
          Effect.runSync(getRankingMethodSuccessMessageEffect(rankingMethod)),
        );
        if (result.state) setLocalRoomState(result.state);
      } else {
        setRankingMsg(result.error ?? "Failed to update ranking method.");
      }
    } finally {
      setRankingPending(false);
    }
  }

  async function handleAdvancePhase() {
    if (!roomId || !roomState || phasePending) return;
    setPhaseMsg(null);
    const nextPhase = Effect.runSync(getNextPhaseEffect(roomState.phase));
    if (!nextPhase) return;
    setPhasePending(true);
    try {
      const result = await Effect.runPromise(
        runRoomMutationWithRefreshEffect(
          setPhaseEffect(roomId, participantId, connectionToken, nextPhase),
          getRoomStateEffect(roomId, participantId, connectionToken),
        ),
      );
      if (result.success) {
        setPhaseMsg(`Advanced to ${nextPhase}.`);
        window.setTimeout(() => phaseStatusRef.current?.focus(), 0);
        if (result.state) setLocalRoomState(result.state);
      } else {
        setPhaseMsg(result.error ?? "Failed to change phase.");
      }
    } finally {
      setPhasePending(false);
    }
  }

  async function handleSetTimer() {
    if (!roomId || !roomState || timerPending) return;
    setTimerMsg(null);
    setTimerInputError(null);
    const parsedTimer = Effect.runSync(
      parseTimerMinutesEffect(timerMinutesInput),
    );
    if (!parsedTimer.success) {
      setTimerInputError(parsedTimer.error);
      return;
    }
    setTimerPending(true);
    try {
      const result = await Effect.runPromise(
        runRoomMutationWithRefreshEffect(
          setTimerEffect(
            roomId,
            participantId,
            connectionToken,
            parsedTimer.durationSeconds,
          ),
          getRoomStateEffect(roomId, participantId, connectionToken),
        ),
      );
      if (!result.success) {
        setTimerInputError(result.error ?? "Failed to start timer.");
        return;
      }
      setTimerMsg("Timer started.");
      if (result.state) setLocalRoomState(result.state);
    } catch {
      setTimerInputError(
        "Failed to start timer. Check the room connection and try again.",
      );
    } finally {
      setTimerPending(false);
    }
  }

  async function handlePurgeRoom() {
    if (!roomId || purgePending) return;
    const confirmed = window.confirm(
      "Delete this room and scrub all retro data now? This cannot be undone.",
    );
    if (!confirmed) return;

    setPurgeMsg(null);
    setPurgePending(true);
    try {
      const result = await Effect.runPromise(
        purgeRoomEffect(roomId, participantId, connectionToken),
      );
      if (!result.success) {
        setPurgeMsg(result.error ?? "Failed to delete room data.");
        return;
      }
      clearStoredIdentity(roomId);
      setLocalRoomState(null);
      setPageState("not-found");
    } catch {
      setPurgeMsg(
        "Failed to delete room data. Check the room connection and try again.",
      );
    } finally {
      setPurgePending(false);
    }
  }

  return {
    nextPhase,
    facilitatorControls: {
      voteBudgetInput,
      budgetMsg,
      budgetPending,
      phaseMsg,
      phasePending,
      timerMinutesInput,
      timerMsg,
      timerInputError,
      timerPending,
      purgeMsg,
      purgePending,
      onVoteBudgetChange: (value: string) => {
        setVoteBudgetInput(value);
        setVoteBudgetDirty(true);
        if (budgetMsg) setBudgetMsg(null);
      },
      onSetBudget: handleSetBudget,
      onAdvancePhase: handleAdvancePhase,
      onTimerMinutesChange: (value: string) => {
        setTimerMinutesInput(value);
        if (timerInputError) setTimerInputError(null);
      },
      onSetTimer: handleSetTimer,
      onPurgeRoom: handlePurgeRoom,
    },
    ranking: {
      pending: rankingPending,
      message: rankingMsg,
      onMethodChange: handleSetRankingMethod,
    },
  };
}
