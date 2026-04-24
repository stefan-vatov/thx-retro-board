import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import type {
  RoomState,
  Participant,
  RetroItem,
  ServerToClientMessage,
  ClientToServerMessage,
} from "../src/domain";
import {
  sanitizeItemText,
  isValidItemText,
} from "../src/domain";

interface StoredState {
  roomId: string;
  phase: RoomState["phase"];
  participants: Participant[];
  items: RetroItem[];
  facilitatorId: string | null;
  voteBudget: number;
  version: number;
  connectionTokens: Record<string, string>;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class RetroRoom extends DurableObject<Env> {
  private state: StoredState | null = null;
  private sessions = new Map<string, WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Restore session map from hibernated WebSockets
    for (const ws of ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as { participantId: string } | null;
      if (attachment?.participantId) {
        this.sessions.set(attachment.participantId, ws);
      }
    }
  }

  private async loadState(): Promise<StoredState> {
    if (this.state) return this.state;
    const stored = await this.ctx.storage.get<StoredState>("room");
    if (stored) {
      this.state = stored;
      return stored;
    }
    return this.state!;
  }

  private async saveState(): Promise<void> {
    if (this.state) {
      this.state.version += 1;
      await this.ctx.storage.put("room", this.state);
    }
  }

  async initRoom(roomId: string): Promise<void> {
    const existing = await this.ctx.storage.get<StoredState>("room");
    if (existing) {
      this.state = existing;
      return;
    }
    this.state = {
      roomId,
      phase: "write",
      participants: [],
      items: [],
      facilitatorId: null,
      voteBudget: 5,
      version: 0,
      connectionTokens: {},
    };
    await this.saveState();
  }

  async getRoomState(): Promise<RoomState> {
    const s = await this.loadState();
    return {
      roomId: s.roomId,
      phase: s.phase,
      participants: s.participants,
      items: s.items,
      groups: [],
      votes: [],
      timer: { startedAt: null, durationSeconds: null, expired: false },
      voteBudget: s.voteBudget,
      version: s.version,
    };
  }

  async hasRoom(): Promise<boolean> {
    const stored = await this.ctx.storage.get<StoredState>("room");
    return stored !== undefined;
  }

  async join(participantId: string, displayName: string): Promise<{ success: boolean; error?: string; state?: RoomState; connectionToken?: string }> {
    const s = await this.loadState();
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      return { success: false, error: "Display name cannot be blank" };
    }
    const sanitized = trimmed.slice(0, 50);

    const existing = s.participants.find((p) => p.id === participantId);
    if (existing) {
      const token = generateToken();
      s.connectionTokens[participantId] = token;
      await this.saveState();
      return { success: true, state: await this.getRoomState(), connectionToken: token };
    }

    const isFacilitator = s.participants.length === 0;
    const participant: Participant = {
      id: participantId,
      displayName: sanitized,
      isFacilitator,
    };
    s.participants.push(participant);
    if (isFacilitator) {
      s.facilitatorId = participantId;
    }
    const token = generateToken();
    s.connectionTokens[participantId] = token;
    await this.saveState();

    const broadcast: ServerToClientMessage = {
      type: "participant-joined",
      participant,
    };
    this.broadcast(broadcast, participantId);

    this.broadcastState(s, participantId);

    return { success: true, state: await this.getRoomState(), connectionToken: token };
  }

  async setVoteBudget(participantId: string, budget: number): Promise<{ success: boolean; error?: string }> {
    const s = await this.loadState();
    if (s.facilitatorId !== participantId) {
      return { success: false, error: "Only the facilitator can set vote budget" };
    }
    if (typeof budget !== "number" || budget < 1 || budget > 100 || !Number.isInteger(budget)) {
      return { success: false, error: "Vote budget must be an integer between 1 and 100" };
    }
    s.voteBudget = budget;
    await this.saveState();
    this.broadcastState(s);
    return { success: true };
  }

  async addItem(participantId: string, rawText: string): Promise<{ success: boolean; error?: string; item?: RetroItem }> {
    const s = await this.loadState();

    if (s.phase !== "write") {
      return { success: false, error: "Cannot add items outside write phase" };
    }

    const sanitized = sanitizeItemText(rawText);
    if (!isValidItemText(rawText)) {
      return { success: false, error: "Item text cannot be empty" };
    }

    const item: RetroItem = {
      id: crypto.randomUUID(),
      text: sanitized,
      authorId: participantId,
      groupId: null,
      order: s.items.length,
    };
    s.items.push(item);
    await this.saveState();

    const broadcast: ServerToClientMessage = { type: "item-added", item };
    this.broadcast(broadcast);

    return { success: true, item };
  }

  private broadcast(message: ServerToClientMessage, excludeId?: string) {
    const payload = JSON.stringify(message);
    for (const [id, ws] of this.sessions) {
      if (id !== excludeId && ws.readyState === WebSocket.READY_STATE_OPEN) {
        ws.send(payload);
      }
    }
  }

  private broadcastState(s: StoredState, excludeId?: string) {
    const state: RoomState = {
      roomId: s.roomId,
      phase: s.phase,
      participants: s.participants,
      items: s.items,
      groups: [],
      votes: [],
      timer: { startedAt: null, durationSeconds: null, expired: false },
      voteBudget: s.voteBudget,
      version: s.version,
    };
    this.broadcast({ type: "snapshot", state }, excludeId);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/join" && request.method === "POST") {
      const body = await request.json() as { participantId: string; displayName: string };
      const result = await this.join(body.participantId, body.displayName);
      return Response.json(result);
    }

    if (url.pathname === "/state" && request.method === "GET") {
      const state = await this.getRoomState();
      return Response.json(state);
    }

    if (url.pathname === "/vote-budget" && request.method === "POST") {
      const body = await request.json() as { participantId: string; budget: number };
      const result = await this.setVoteBudget(body.participantId, body.budget);
      return Response.json(result);
    }

    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

      const pid = url.searchParams.get("pid");
      const token = url.searchParams.get("token");

      if (!pid || !token) {
        return new Response(JSON.stringify({ error: "Missing pid or token" }), { status: 400 });
      }

      const s = await this.loadState();
      const expectedToken = s.connectionTokens[pid];
      if (!expectedToken || expectedToken !== token) {
        return new Response(JSON.stringify({ error: "Invalid participant credentials" }), { status: 403 });
      }

      const participantId = pid;
      this.sessions.set(participantId, server);
      server.serializeAttachment({ participantId });
      this.ctx.acceptWebSocket(server);

      const snapshot = await this.getRoomState();
      server.send(JSON.stringify({ type: "snapshot", state: snapshot }));

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as { participantId: string } | null;
    const participantId = attachment?.participantId;
    if (!participantId) return;

    try {
      const msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)) as ClientToServerMessage;
      await this.handleMessage(participantId, msg);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
    }
  }

  override webSocketClose(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as { participantId: string } | null;
    const participantId = attachment?.participantId;
    if (!participantId) return;

    this.sessions.delete(participantId);
    const leftMsg: ServerToClientMessage = { type: "participant-left", participantId };
    this.broadcast(leftMsg);
  }

  private async handleMessage(participantId: string, msg: ClientToServerMessage): Promise<void> {
    switch (msg.type) {
      case "join": {
        await this.join(participantId, msg.displayName);
        break;
      }
      case "add-item": {
        const result = await this.addItem(participantId, msg.text);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      case "set-vote-budget": {
        const result = await this.setVoteBudget(participantId, msg.budget);
        if (!result.success) {
          const ws = this.sessions.get(participantId);
          ws?.send(JSON.stringify({ type: "error", message: result.error }));
        }
        break;
      }
      default:
        break;
    }
  }

  async sayHello(): Promise<string> {
    const result = this.ctx.storage.sql
      .exec("SELECT 'Hello from RetroRoom!' as greeting")
      .one();
    return result.greeting as string;
  }

  async setPhaseForTest(phase: RoomState["phase"]): Promise<void> {
    const s = await this.loadState();
    s.phase = phase;
    await this.saveState();
  }
}
