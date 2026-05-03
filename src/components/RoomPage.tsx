import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Effect } from "effect";
import { ApiError, joinRoomEffect, runApiEffect } from "../api";
import { useRoom } from "../hooks";
import type { RoomState, Phase } from "../domain";
import { getSortedColumnsEffect } from "./room-columns";
import {
  JoinRoomScreen,
  LoadingRoomScreen,
  RoomLoadErrorScreen,
  RoomNotFoundScreen,
} from "./RoomStateScreens";
import { RoomPageLoadedView } from "./RoomPageLoadedView";
import { useWriteCards } from "./use-write-cards";
import {
  classifyRoomLoadErrorEffect,
  clearStoredIdentity,
  getFacilitatorClaimToken,
  getStoredIdentity,
  mergeRoomStateEffect,
  type PageState,
  type RoomLoadError,
} from "./room-session";
import { useFacilitatorRoomControls } from "./use-facilitator-room-controls";

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [identity] = useState(() => getStoredIdentity(roomId!));
  const [participantId, setParticipantId] = useState(
    () => identity.participantId,
  );
  const [displayName, setDisplayName] = useState(() => identity.displayName);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [roomLoadError, setRoomLoadError] = useState<RoomLoadError | null>(
    null,
  );
  const [localRoomState, setLocalRoomState] = useState<RoomState | null>(null);
  const [connectionToken, setConnectionToken] = useState<string | undefined>(
    () => identity.connectionToken,
  );
  const phaseStatusRef = useRef<HTMLDivElement>(null);
  const previousRoomUpdateRef = useRef<{
    phase: Phase;
    version: number;
  } | null>(null);
  const initialLoadStartedRef = useRef(false);

  const {
    state: wsState,
    connected,
    lastError,
    roomPurged,
    clearError,
    send,
  } = useRoom(roomId ?? "", participantId, connectionToken);

  const roomState = Effect.runSync(
    mergeRoomStateEffect(localRoomState, wsState),
  );
  const sortedRoomColumns = roomState
    ? Effect.runSync(getSortedColumnsEffect(roomState))
    : [];
  const writeCards = useWriteCards({
    roomId,
    roomState,
    participantId,
    connectionToken,
    setLocalRoomState,
  });
  const { nextPhase, facilitatorControls, ranking } =
    useFacilitatorRoomControls({
      roomId,
      roomState,
      participantId,
      connectionToken,
      phaseStatusRef,
      clearError,
      setLocalRoomState,
      setPageState,
    });

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
    if (pageState !== "room" || !roomState) return;
    const previous = previousRoomUpdateRef.current;
    previousRoomUpdateRef.current = {
      phase: roomState.phase,
      version: roomState.version,
    };
    if (!previous) return;

    const changed =
      previous.phase !== roomState.phase ||
      previous.version !== roomState.version;
    const activeElement = document.activeElement;
    const focusLostToBody =
      activeElement === document.body ||
      activeElement === document.documentElement ||
      activeElement === null;
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
      const result = await runApiEffect(
        joinRoomEffect(
          roomId,
          participantId,
          identity.displayName,
          identity.connectionToken,
          getFacilitatorClaimToken(roomId),
        ),
      );
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
      setRoomLoadError(Effect.runSync(classifyRoomLoadErrorEffect(error)));
      setPageState("load-error");
    }
  }, [
    roomId,
    participantId,
    identity.displayName,
    identity.connectionToken,
    resetStoredIdentity,
  ]);

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
      const result = await runApiEffect(
        joinRoomEffect(
          roomId,
          participantId,
          trimmed,
          connectionToken,
          getFacilitatorClaimToken(roomId),
        ),
      );
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
      setJoinError(
        "Failed to join room. Please check your connection and try again.",
      );
    } finally {
      setJoinLoading(false);
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
        error={
          roomLoadError ?? Effect.runSync(classifyRoomLoadErrorEffect(null))
        }
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

  return (
    <RoomPageLoadedView
      roomId={roomId!}
      roomState={roomState}
      connected={connected}
      participantId={participantId}
      columnCount={sortedRoomColumns.length}
      nextPhase={nextPhase}
      phaseStatusRef={phaseStatusRef}
      realtime={{ lastError, clearError, send }}
      facilitatorControls={facilitatorControls}
      ranking={ranking}
      writeCards={writeCards}
    />
  );
}
