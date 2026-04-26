import { useState, useEffect, useRef, useCallback } from "react";
import type { RoomState, ServerToClientMessage } from "../domain";

interface UseRoomResult {
  state: RoomState | null;
  connected: boolean;
  lastError: string | null;
  clearError: () => void;
  send: (message: unknown) => boolean;
}

export function useRoom(roomId: string, participantId: string, connectionToken?: string): UseRoomResult {
  const [state, setState] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
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
    let disposed = false;

    function clearReconnectTimer() {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    function scheduleReconnect(delay = 750) {
      if (disposed || reconnectTimerRef.current !== null) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (disposed) return;
        if (navigator.onLine) {
          connect();
        } else {
          scheduleReconnect();
        }
      }, delay);
    }

    function connect() {
      clearReconnectTimer();
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/rooms/${encodeURIComponent(roomId)}/ws`;
      const ws = new WebSocket(wsUrl, [
        "retro-board",
        `pid-${participantId}`,
        `auth-${connectionToken}`,
      ]);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (wsRef.current !== ws || disposed) return;
        setConnected(true);
        setLastError(null);
      });

      ws.addEventListener("message", (event) => {
        if (wsRef.current !== ws || disposed) return;
        try {
          const msg = JSON.parse(event.data as string) as ServerToClientMessage;
          if (msg.type === "snapshot") {
            setState(msg.state);
          } else if (msg.type === "participant-joined") {
            setState((prev) => {
              if (!prev) return prev;
              const exists = prev.participants.some((p) => p.id === msg.participant.id);
              if (exists) return prev;
              return { ...prev, participants: [...prev.participants, msg.participant] };
            });
          } else if (msg.type === "participant-left") {
            setState((prev) => prev ? {
              ...prev,
              participants: prev.participants.filter((p) => p.id !== msg.participantId),
            } : prev);
          } else if (msg.type === "phase-changed") {
            setState((prev) => prev ? { ...prev, phase: msg.phase } : prev);
          } else if (msg.type === "item-added") {
            setState((prev) => {
              if (!prev) return prev;
              const exists = prev.items.some((i) => i.id === msg.item.id);
              if (exists) return prev;
              return { ...prev, items: [...prev.items, msg.item] };
            });
          } else if (msg.type === "items-reordered") {
            setState((prev) => prev ? { ...prev, items: msg.items } : prev);
          } else if (msg.type === "groups-changed") {
            setState((prev) => prev ? { ...prev, groups: msg.groups } : prev);
          } else if (msg.type === "vote-changed") {
            // Vote updates come via snapshot broadcast; this handler is a no-op
            // since the snapshot will carry the full authoritative votes array.
          } else if (msg.type === "timer-updated") {
            setState((prev) => prev ? { ...prev, timer: msg.timer } : prev);
          } else if (msg.type === "error") {
            setLastError(msg.message);
          }
        } catch {
          // ignore parse errors
        }
      });

      ws.addEventListener("close", () => {
        if (wsRef.current !== ws || disposed) return;
        setConnected(false);
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
    connect();

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
      setLastError("Reconnecting. Please try again once the room is connected.");
      return false;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setLastError(null);
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    setLastError("Reconnecting. Please try again once the room is connected.");
    return false;
  }, []);

  const clearError = useCallback(() => setLastError(null), []);

  return { state, connected, lastError, clearError, send };
}
