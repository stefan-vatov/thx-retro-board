import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  ApiError,
  getRoomStateEffect,
  joinRoomEffect,
  purgeRoomEffect,
  runApiEffect,
  setPhaseEffect,
  setRankingMethodEffect,
  setTimerEffect,
  setVoteBudgetEffect,
} from "../api";
import { useRoom } from "../hooks";
import type { RoomState, Phase, RankingMethod } from "../domain";
import { PHASE_ORDER } from "../domain";
import { FacilitatorControls } from "./FacilitatorControls";
import { RoomBoardArea } from "./RoomBoardArea";
import { getSortedColumns } from "./room-columns";
import { RoomShellHeader, RoomStatus } from "./RoomShell";
import { JoinRoomScreen, LoadingRoomScreen, RoomLoadErrorScreen, RoomNotFoundScreen } from "./RoomStateScreens";
import { useWriteCards } from "./use-write-cards";
import {
  classifyRoomLoadError,
  clearStoredIdentity,
  getFacilitatorClaimToken,
  getStoredIdentity,
  mergeRoomState,
  type PageState,
  type RoomLoadError,
} from "./room-session";

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [identity] = useState(() => getStoredIdentity(roomId!));
  const [participantId, setParticipantId] = useState(() => identity.participantId);
  const [displayName, setDisplayName] = useState(() => identity.displayName);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [roomLoadError, setRoomLoadError] = useState<RoomLoadError | null>(null);
  const [localRoomState, setLocalRoomState] = useState<RoomState | null>(null);
  const [connectionToken, setConnectionToken] = useState<string | undefined>(() => identity.connectionToken);
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
  const phaseStatusRef = useRef<HTMLDivElement>(null);
  const previousRoomUpdateRef = useRef<{ phase: Phase; version: number } | null>(null);
  const initialLoadStartedRef = useRef(false);
  const lastAuthoritativeVoteBudgetRef = useRef<number | null>(null);

  const { state: wsState, connected, lastError, roomPurged, clearError, send } = useRoom(roomId ?? "", participantId, connectionToken);

  const roomState = mergeRoomState(localRoomState, wsState);
  const sortedRoomColumns = roomState ? getSortedColumns(roomState) : [];
  const writeCards = useWriteCards({
    roomId,
    roomState,
    participantId,
    connectionToken,
    setLocalRoomState,
  });
  const currentPhaseIndex = roomState ? PHASE_ORDER.indexOf(roomState.phase) : -1;
  const nextPhase = currentPhaseIndex >= 0 ? PHASE_ORDER[currentPhaseIndex + 1] : undefined;

  const resetStoredIdentity = useCallback(() => {
    if (!roomId) return;
    const nextParticipantId = crypto.randomUUID();
    localStorage.setItem(`retro-participant-${roomId}`, nextParticipantId);
    localStorage.removeItem(`retro-token-${roomId}`);
    setParticipantId(nextParticipantId);
    setConnectionToken(undefined);
  }, [roomId]);

  useEffect(() => {
    if (!roomPurged) return undefined;
    const timeout = window.setTimeout(() => {
      if (roomId) clearStoredIdentity(roomId);
      setLocalRoomState(null);
      setPageState("not-found");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [roomId, roomPurged]);

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
    if (!voteBudgetDirty || voteBudgetInput === nextBudgetInput || budgetPending) {
      const timeout = window.setTimeout(() => {
        setVoteBudgetInput(nextBudgetInput);
        setVoteBudgetDirty(false);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [budgetPending, roomState, roomState?.voteBudget, voteBudgetDirty, voteBudgetInput]);

  useEffect(() => {
    if (pageState !== "room" || !roomState) return;
    const previous = previousRoomUpdateRef.current;
    previousRoomUpdateRef.current = { phase: roomState.phase, version: roomState.version };
    if (!previous) return;

    const changed = previous.phase !== roomState.phase || previous.version !== roomState.version;
    const activeElement = document.activeElement;
    const focusLostToBody = activeElement === document.body || activeElement === document.documentElement || activeElement === null;
    if (changed && focusLostToBody) {
      window.setTimeout(() => phaseStatusRef.current?.focus(), 0);
    }
  }, [pageState, roomState?.phase, roomState?.version, roomState]);

  const loadInitialRoom = useCallback(async () => {
    if (!roomId) return;
    setPageState("loading");
    setRoomLoadError(null);
    if (!identity.displayName || !identity.connectionToken) {
      setPageState("join");
      return;
    }
    try {
      const result = await runApiEffect(joinRoomEffect(roomId, participantId, identity.displayName, identity.connectionToken, getFacilitatorClaimToken(roomId)));
      if (!result.success) {
        resetStoredIdentity();
        setPageState("join");
        return;
      }
      localStorage.setItem(`retro-name-${roomId}`, identity.displayName);
      setLocalRoomState(result.state ?? null);
      if (result.connectionToken) {
        localStorage.setItem(`retro-token-${roomId}`, result.connectionToken);
        setConnectionToken(result.connectionToken);
      }
      setPageState("room");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        clearStoredIdentity(roomId);
        setPageState("not-found");
        return;
      }
      setRoomLoadError(classifyRoomLoadError(error));
      setPageState("load-error");
    }
  }, [roomId, participantId, identity.displayName, identity.connectionToken, resetStoredIdentity]);

  useEffect(() => {
    if (initialLoadStartedRef.current) return undefined;
    const timeout = window.setTimeout(() => {
      if (initialLoadStartedRef.current) return;
      initialLoadStartedRef.current = true;
      void loadInitialRoom();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadInitialRoom]);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!roomId) return;
    setJoinError(null);

    const trimmed = displayName.trim();
    if (!trimmed) {
      setJoinError("Please enter a display name.");
      return;
    }

    setJoinLoading(true);
    try {
      const result = await runApiEffect(joinRoomEffect(roomId, participantId, trimmed, connectionToken, getFacilitatorClaimToken(roomId)));
      if (!result.success) {
        setJoinError(result.error ?? "Failed to join room. Please try again.");
        return;
      }
      localStorage.setItem(`retro-name-${roomId}`, trimmed);
      setLocalRoomState(result.state ?? null);
      if (result.connectionToken) {
        localStorage.setItem(`retro-token-${roomId}`, result.connectionToken);
        setConnectionToken(result.connectionToken);
      }
      sessionStorage.removeItem(`retro-facilitator-claim-${roomId}`);
      setPageState("room");
    } catch {
      setJoinError("Failed to join room. Please check your connection and try again.");
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleSetBudget() {
    if (!roomId || budgetPending) return;
    setBudgetMsg(null);
    const rawBudget = voteBudgetInput.trim();
    const budget = Number(rawBudget);
    if (!/^\d+$/.test(rawBudget) || !Number.isInteger(budget) || budget < 1 || budget > 100) {
      setBudgetMsg("Vote budget must be an integer between 1 and 100.");
      return;
    }
    setBudgetPending(true);
    try {
      const result = await runApiEffect(setVoteBudgetEffect(roomId, participantId, connectionToken, budget));
      if (result.success) {
        setBudgetMsg("Vote budget updated.");
        setVoteBudgetInput(String(budget));
        setVoteBudgetDirty(false);
        // Refetch authoritative state to handle any missed WebSocket broadcasts during reconnect
        try {
          const state = await runApiEffect(getRoomStateEffect(roomId, participantId, connectionToken));
          setLocalRoomState(state);
        } catch {
          // Refetch failed; local optimistic update stands and WebSocket will reconcile
        }
      } else {
        setBudgetMsg(result.error ?? "Failed to update budget.");
      }
    } finally {
      setBudgetPending(false);
    }
  }

  async function handleSetRankingMethod(rankingMethod: RankingMethod) {
    if (!roomId || !roomState || rankingPending || roomState.rankingMethod === rankingMethod) return;
    setRankingMsg(null);
    clearError();
    setRankingPending(true);
    try {
      const result = await runApiEffect(setRankingMethodEffect(roomId, participantId, connectionToken, rankingMethod));
      if (result.success) {
        setRankingMsg(rankingMethod === "pairwise" ? "Pairwise ranking selected." : "Score voting selected.");
        try {
          const state = await runApiEffect(getRoomStateEffect(roomId, participantId, connectionToken));
          setLocalRoomState(state);
        } catch {
          // WebSocket snapshot will reconcile if the refetch misses.
        }
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
    const currentIdx = PHASE_ORDER.indexOf(roomState.phase);
    const nextPhase = PHASE_ORDER[currentIdx + 1] as Phase | undefined;
    if (!nextPhase) return;
    setPhasePending(true);
    try {
      const result = await runApiEffect(setPhaseEffect(roomId, participantId, connectionToken, nextPhase));
      if (result.success) {
        setPhaseMsg(`Advanced to ${nextPhase}.`);
        window.setTimeout(() => phaseStatusRef.current?.focus(), 0);
        // Refetch authoritative state so the UI updates even if the WebSocket broadcast
        // was missed during a post-reload reconnect window
        try {
          const state = await runApiEffect(getRoomStateEffect(roomId, participantId, connectionToken));
          setLocalRoomState(state);
        } catch {
          // Refetch failed; local optimistic update stands and WebSocket will reconcile
        }
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
    const raw = timerMinutesInput.trim();
    if (!raw) {
      setTimerInputError("Timer cannot be blank.");
      return;
    }
    const minutes = parseInt(raw, 10);
    if (isNaN(minutes) || minutes < 1) {
      setTimerInputError("Timer must be at least 1 minute.");
      return;
    }
    if (minutes > 60) {
      setTimerInputError("Timer cannot exceed 60 minutes.");
      return;
    }
    const durationSeconds = minutes * 60;
    setTimerPending(true);
    try {
      const result = await runApiEffect(setTimerEffect(roomId, participantId, connectionToken, durationSeconds));
      if (!result.success) {
        setTimerInputError(result.error ?? "Failed to start timer.");
        return;
      }
      setTimerMsg("Timer started.");
      try {
        const state = await runApiEffect(getRoomStateEffect(roomId, participantId, connectionToken));
        setLocalRoomState(state);
      } catch {
        // WebSocket snapshot will reconcile if refetch misses.
      }
    } catch {
      setTimerInputError("Failed to start timer. Check the room connection and try again.");
    } finally {
      setTimerPending(false);
    }
  }

  async function handlePurgeRoom() {
    if (!roomId || purgePending) return;
    const confirmed = window.confirm("Delete this room and scrub all retro data now? This cannot be undone.");
    if (!confirmed) return;

    setPurgeMsg(null);
    setPurgePending(true);
    try {
      const result = await runApiEffect(purgeRoomEffect(roomId, participantId, connectionToken));
      if (!result.success) {
        setPurgeMsg(result.error ?? "Failed to delete room data.");
        return;
      }
      clearStoredIdentity(roomId);
      setLocalRoomState(null);
      setPageState("not-found");
    } catch {
      setPurgeMsg("Failed to delete room data. Check the room connection and try again.");
    } finally {
      setPurgePending(false);
    }
  }

  if (pageState === "loading") {
    return <LoadingRoomScreen />;
  }

  if (pageState === "not-found") {
    return <RoomNotFoundScreen />;
  }

  if (pageState === "load-error") {
    return (
      <RoomLoadErrorScreen
        error={roomLoadError ?? classifyRoomLoadError(null)}
        onRetry={() => void loadInitialRoom()}
      />
    );
  }

  if (pageState === "join") {
    return (
      <JoinRoomScreen
        displayName={displayName}
        joinError={joinError}
        joinLoading={joinLoading}
        onDisplayNameChange={(value) => {
          setDisplayName(value);
          if (joinError) setJoinError(null);
        }}
        onSubmit={handleJoin}
      />
    );
  }

  const currentParticipant = roomState?.participants.find((p) => p.id === participantId);
  const isFacilitator = currentParticipant?.isFacilitator === true;

  return (
    <div className="content-shell">
      {/* Room Header */}
      <RoomShellHeader roomId={roomId!} connected={connected} />

      <RoomStatus
        roomState={roomState}
        columnCount={sortedRoomColumns.length}
        participantId={participantId}
        phaseStatusRef={phaseStatusRef}
      />

      {/* Facilitator Controls */}
      {isFacilitator && (
        <FacilitatorControls
          roomState={roomState}
          nextPhase={nextPhase}
          voteBudgetInput={voteBudgetInput}
          budgetMsg={budgetMsg}
          budgetPending={budgetPending}
          phaseMsg={phaseMsg}
          phasePending={phasePending}
          timerMinutesInput={timerMinutesInput}
          timerMsg={timerMsg}
          timerInputError={timerInputError}
          timerPending={timerPending}
          purgeMsg={purgeMsg}
          purgePending={purgePending}
          onVoteBudgetChange={(value) => {
            setVoteBudgetInput(value);
            setVoteBudgetDirty(true);
            if (budgetMsg) setBudgetMsg(null);
          }}
          onSetBudget={handleSetBudget}
          onAdvancePhase={handleAdvancePhase}
          onTimerMinutesChange={(value) => {
            setTimerMinutesInput(value);
            if (timerInputError) setTimerInputError(null);
          }}
          onSetTimer={handleSetTimer}
          onPurgeRoom={handlePurgeRoom}
        />
      )}

      {/* Board Area */}
      <RoomBoardArea
        roomState={roomState}
        isFacilitator={isFacilitator}
        participantId={participantId}
        connected={connected}
        send={send}
        serverError={lastError}
        clearServerError={clearError}
        onRankingMethodChange={handleSetRankingMethod}
        rankingPending={rankingPending}
        rankingMsg={rankingMsg}
        writeCards={writeCards}
      />

      {/* Room Footer — safe room code only, no tokens */}
      <footer className="room-footer" role="contentinfo">
        <span className="room-footer__label">Room</span>
        <span className="room-footer__code truncate" aria-label="Room code">
          {roomId}
        </span>
      </footer>
    </div>
  );
}
