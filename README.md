# Retro Board

A real-time team retrospective board built with Vite, React, TypeScript, and Cloudflare Workers with Durable Objects.

## Overview

Retro Board is a collaborative web application for running team retrospectives. Multiple participants join the same room through a shared link, enter a display name, and collaborate through timed phases controlled by the facilitator.

### Phases

1. **Write** — Participants add retro items to a shared list.
2. **Organise** — All participants can create groups, reorder items and groups, and move items between groups.
3. **Vote** — Participants allocate votes within a facilitator-configured budget. Vote stacking on a single item is allowed.
4. **Review** — Read-only presentation of grouped items with vote totals.

## Architecture

- **React SPA** served via Cloudflare Workers Static Assets
- **RetroRoom Durable Object** (one per room) is the server-authoritative owner of all room state: participants, phase, timer, items, groups, ordering, and votes
- **SQLite-backed Durable Object storage** persists canonical room snapshots
- **WebSocket Hibernation API** for real-time state synchronization across connected clients
- **TypeScript shared domain types** used by both client and server

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install

```sh
npm install
```

### Development

Start the local Cloudflare-compatible dev server on port 8787:

```sh
npm run dev
```

Open [http://localhost:8787](http://localhost:8787) in your browser.

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local dev server (port 8787) |
| `npm run build` | Type-check and build for production |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run ESLint on src/ and worker/ |
| `npm run test` | Run unit and integration tests (Vitest) |
| `npm run test:e2e` | Run end-to-end browser tests (Playwright) |
| `npm run deploy` | Build and deploy to Cloudflare |

## Key Design Decisions

- **List-first UI**: The board uses ordered lists with visual groups/sections, not sticky-note or canvas metaphors.
- **Server-authoritative state**: The Durable Object owns phase transitions, permissions, timer state, item ordering, and vote budgets. Clients never directly decide these.
- **Facilitator controls**: The room creator is the facilitator. Only the facilitator can advance phases and set timers/vote budgets.
- **Timer expiry does not auto-advance**: When a timer expires, the phase remains unchanged until the facilitator manually advances.
- **Connection tokens**: WebSocket connections require a valid participant ID and cryptographic token, preventing impersonation.
- **Version-based state reconciliation**: Client merge logic prefers higher-version snapshots, not participant count.

## Testing

### Unit and Integration Tests

```sh
npm run test
```

Covers domain logic (phase transitions, vote budget enforcement, reorder/group operations), Worker routing, Durable Object room isolation, WebSocket authentication, and phase-specific permissions.

### End-to-End Tests

```sh
npm run test:e2e
```

Playwright tests covering the full two-user retro flow from room creation through review, room isolation, refresh/reconnect persistence, and phase-specific controls.

## Deployment

```sh
npm run deploy
```

Requires `wrangler login` or appropriate Cloudflare API credentials. The app deploys as a single Cloudflare Worker with Durable Object bindings and static asset serving.

## Project Structure

```
src/
  domain/          # Shared TypeScript types, state logic, message schemas
  hooks/           # React hooks (use-room WebSocket connection)
  components/      # React UI components
  api.ts           # HTTP API client
  App.tsx          # SPA routing
  main.tsx         # Entry point
worker/
  index.ts         # Worker router (HTTP routes, SPA fallback)
  retro-room.ts    # RetroRoom Durable Object
e2e/               # Playwright end-to-end tests
tests/             # Test configuration
```
