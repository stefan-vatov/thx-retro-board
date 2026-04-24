import { useState, useEffect, useRef, useCallback } from "react";
import type { RoomState, ServerToClientMessage } from "../domain";

interface UseRoomResult {
  state: RoomState | null;
  connected: boolean;
  send: (message: unknown) => void;
}

export function useRoom(roomId: string, participantId: string, connectionToken?: string): UseRoomResult {
  const [state, setState] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!connectionToken) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/rooms/${encodeURIComponent(roomId)}/ws?pid=${encodeURIComponent(participantId)}&token=${encodeURIComponent(connectionToken)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setConnected(true);
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerToClientMessage;
        if (msg.type === "snapshot") {
          setState(msg.state);
        } else if (msg.type === "participant-joined") {
          setState((prev) => prev ? {
            ...prev,
            participants: [...prev.participants, msg.participant],
          } : prev);
        } else if (msg.type === "participant-left") {
          setState((prev) => prev ? {
            ...prev,
            participants: prev.participants.filter((p) => p.id !== msg.participantId),
          } : prev);
        } else if (msg.type === "phase-changed") {
          setState((prev) => prev ? { ...prev, phase: msg.phase } : prev);
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.addEventListener("close", () => {
      setConnected(false);
    });

    ws.addEventListener("error", () => {
      setConnected(false);
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [roomId, participantId, connectionToken]);

  const send = useCallback((message: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { state, connected, send };
}
