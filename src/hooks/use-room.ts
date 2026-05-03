import { useState, useEffect, useRef, useCallback } from "react";
import { Effect, Exit, Schema } from "effect";
import { createWebSocketTicketEffect } from "../api";
import {
  ClientToServerMessageSchema,
  ServerToClientMessageSchema,
} from "../domain";
import type { RoomState, ServerToClientMessage } from "../domain";
import { applyRealtimeMessageEffect } from "./room-realtime-state";
import type { RealtimeMessageResult } from "./room-realtime-state";

export const INITIAL_RECONNECT_DELAY_MS = 750;
export const MAX_RECONNECT_DELAY_MS = 30_000;
export const MAX_RECONNECT_ATTEMPTS = 8;
export const STABLE_CONNECTION_RESET_MS = 5_000;

export function getRealtimeReconnectDelay(reconnectAttempts: number): number {
  return Math.min(
    MAX_RECONNECT_DELAY_MS,
    INITIAL_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
  );
}

export function canAttemptRealtimeReconnect(
  reconnectAttempts: number,
): boolean {
  return reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
}

export function shouldResetRealtimeReconnectAttempts(
  openDurationMs: number,
): boolean {
  return openDurationMs >= STABLE_CONNECTION_RESET_MS;
}

export class RealtimeMessageError extends Error {
  constructor(message = "Invalid realtime message") {
    super(message);
    this.name = "RealtimeMessageError";
  }
}

export function decodeRealtimeMessageEffect(
  raw: string,
): Effect.Effect<ServerToClientMessage, RealtimeMessageError> {
  return Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: () => new RealtimeMessageError(),
    });
    const decoded = yield* Schema.decodeUnknown(ServerToClientMessageSchema)(
      parsed,
    ).pipe(Effect.mapError(() => new RealtimeMessageError()));
    return decoded as ServerToClientMessage;
  });
}

export function prepareRealtimeSendEffect(
  message: unknown,
): Effect.Effect<string, RealtimeMessageError> {
  return Schema.decodeUnknown(ClientToServerMessageSchema)(message).pipe(
    Effect.mapError(() => new RealtimeMessageError("Invalid realtime command")),
    Effect.map((validated) => JSON.stringify(validated)),
  );
}

export async function runRealtimeMessageDecode(
  raw: string,
): Promise<ServerToClientMessage | null> {
  const exit = await Effect.runPromiseExit(decodeRealtimeMessageEffect(raw));
  return Exit.isSuccess(exit) ? exit.value : null;
}

type RealtimeWebSocketTicketResult = {
  success: boolean;
  error?: string;
  ticket?: string;
};

export type RealtimeWebSocketRequest = {
  roomId: string;
  participantId: string;
  connectionToken: string;
  protocol: "ws:" | "wss:";
  host: string;
};

export interface RealtimeWebSocketDeps {
  createTicket(
    roomId: string,
    participantId: string,
    connectionToken: string,
  ): Effect.Effect<RealtimeWebSocketTicketResult, unknown>;
  createSocket(
    url: string,
    protocols: string[],
  ): Effect.Effect<WebSocket, unknown>;
}

export type OpenRealtimeWebSocketResult =
  | { success: true; socket: WebSocket }
  | { success: false; error: string };

export function openRealtimeWebSocketEffect(
  request: RealtimeWebSocketRequest,
  deps: RealtimeWebSocketDeps,
): Effect.Effect<OpenRealtimeWebSocketResult, unknown> {
  return Effect.gen(function* () {
    const ticket = yield* deps.createTicket(
      request.roomId,
      request.participantId,
      request.connectionToken,
    );
    if (!ticket.success || !ticket.ticket) {
      return {
        success: false as const,
        error: ticket.error ?? "Could not establish realtime connection.",
      };
    }

    const url = `${request.protocol}//${request.host}/api/rooms/${encodeURIComponent(request.roomId)}/ws`;
    const socket = yield* deps.createSocket(url, [
      "retro-board",
      `ticket-${ticket.ticket}`,
    ]);
    return { success: true as const, socket };
  });
}

interface UseRoomResult {
  state: RoomState | null;
  connected: boolean;
  lastError: string | null;
  roomPurged: boolean;
  clearError: () => void;
  send: (message: unknown) => boolean;
}

export function useRoom(
  roomId: string,
  participantId: string,
  connectionToken?: string,
): UseRoomResult {
  const [state, setState] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [roomPurgedState, setRoomPurgedState] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    function handleOffline() {
      setConnected(false);
      wsRef.current?.close();
    }

    window.addEventListener("offline", handleOffline);
    return () => window.removeEventListener("offline", handleOffline);
  }, []);

  useEffect(() => {
    if (!connectionToken) return;
    const realtimeConnectionToken = connectionToken;
    let disposed = false;
    let roomPurged = false;
    let reconnectAttempts = 0;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function getReconnectDelay() {
      return getRealtimeReconnectDelay(reconnectAttempts);
    }

    function scheduleReconnect(delay?: number, consumeAttempt = true) {
      if (disposed || reconnectTimerRef.current !== null) return;
      if (consumeAttempt) {
        if (!canAttemptRealtimeReconnect(reconnectAttempts)) {
          setConnected(false);
          setLastError(
            "Realtime reconnect paused after repeated failures. Refresh the room to try again.",
          );
          return;
        }
        reconnectAttempts += 1;
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (disposed) return;
        if (navigator.onLine) {
          void connect();
        } else {
          scheduleReconnect(1_000, false);
        }
      }, delay ?? getReconnectDelay());
    }

    async function connect() {
      clearReconnectTimer();
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      setRoomPurgedState(false);
      const realtimeConnection = await Effect.runPromise(
        openRealtimeWebSocketEffect(
          {
            roomId,
            participantId,
            connectionToken: realtimeConnectionToken,
            protocol,
            host: window.location.host,
          },
          {
            createTicket: (
              ticketRoomId,
              ticketParticipantId,
              ticketConnectionToken,
            ) =>
              createWebSocketTicketEffect(
                ticketRoomId,
                ticketParticipantId,
                ticketConnectionToken,
              ),
            createSocket: (url, protocols) =>
              Effect.sync(() => new WebSocket(url, protocols)),
          },
        ),
      );
      if (disposed) return;
      if (!realtimeConnection.success) {
        setConnected(false);
        setLastError(realtimeConnection.error);
        scheduleReconnect();
        return;
      }
      const ws = realtimeConnection.socket;
      wsRef.current = ws;
      let openedAt: number | null = null;

      ws.addEventListener("open", () => {
        if (wsRef.current !== ws || disposed) return;
        openedAt = Date.now();
        setConnected(true);
        setLastError(null);
      });

      ws.addEventListener("message", (event) => {
        if (wsRef.current !== ws || disposed) return;
        void handleRealtimeMessage(event.data as string);
      });

      async function handleRealtimeMessage(raw: string) {
        const msg = await runRealtimeMessageDecode(raw);
        if (!msg || wsRef.current !== ws || disposed) return;
        let result: RealtimeMessageResult | undefined;
        setState((previous) => {
          const exit = Effect.runSyncExit(
            applyRealtimeMessageEffect(previous, msg),
          );
          if (Exit.isFailure(exit)) return previous;
          result = exit.value;
          return result.state;
        });
        if (!result) return;
        if (result.lastError !== undefined) setLastError(result.lastError);
        if (result.roomPurged) {
          roomPurged = true;
          setConnected(false);
          setRoomPurgedState(true);
        }
        if (result.shouldCloseSocket) {
          ws.close(1000, "Room data deleted");
        }
      }

      ws.addEventListener("close", () => {
        if (wsRef.current !== ws || disposed) return;
        setConnected(false);
        if (
          openedAt !== null &&
          shouldResetRealtimeReconnectAttempts(Date.now() - openedAt)
        ) {
          reconnectAttempts = 0;
        }
        if (roomPurged) return;
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        if (wsRef.current !== ws || disposed) return;
        setConnected(false);
        scheduleReconnect();
      });
    }

    function handleOnline() {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        scheduleReconnect(0);
      }
    }

    window.addEventListener("online", handleOnline);
    void connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      window.removeEventListener("online", handleOnline);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomId, participantId, connectionToken]);

  const send = useCallback((message: unknown) => {
    if (!navigator.onLine) {
      setConnected(false);
      setLastError(
        "Reconnecting. Please try again once the room is connected.",
      );
      return false;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const encoded = Effect.runSyncExit(prepareRealtimeSendEffect(message));
      if (Exit.isFailure(encoded)) {
        setLastError("Invalid realtime command.");
        return false;
      }
      setLastError(null);
      wsRef.current.send(encoded.value);
      return true;
    }
    setLastError("Reconnecting. Please try again once the room is connected.");
    return false;
  }, []);

  const clearError = useCallback(() => setLastError(null), []);

  return {
    state,
    connected,
    lastError,
    roomPurged: roomPurgedState,
    clearError,
    send,
  };
}
