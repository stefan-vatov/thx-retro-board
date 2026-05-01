# Retro Board

A real-time team retrospective board built with Vite, React, TypeScript, and Cloudflare Workers with Durable Objects.

## Overview

Retro Board is a polished collaborative web application for running team retrospectives. Multiple participants join the same room through a shared link, enter a display name, and collaborate through timed phases controlled by the facilitator in a clean shadcn/Tailwind SaaS-style, responsive full-width interface.

The app is designed for production use on Cloudflare, with accessible controls, keyboard-friendly interactions, responsive layouts, reduced-motion support, mobile-friendly resilience, and considered loading, error, reconnect, focus-recovery, and empty states throughout the retro flow.

### Phases

1. **Write** — Participants add retro items into facilitator-created kanban list columns. Rooms begin with no fixed default columns, so the facilitator defines the board structure before collecting feedback.
2. **Organise** — Participants group, regroup, reorder, and ungroup items within each column. Drag-and-drop is constrained to the same column so each item's original column context is preserved.
3. **Vote** — Participants allocate votes within a facilitator-configured budget across mixed targets: grouped items are voted through their group target, while ungrouped items remain individually votable. Vote stacking on a single target is allowed, with responsive budget and selection feedback.
4. **Review** — Presentation-ready slideshow results include groups and ungrouped items sorted together by total votes, with deterministic tie-breakers and each target shown in its column context.

## Architecture

- **React SPA** with a clean shadcn/Tailwind SaaS-style responsive full-width UI, served through the Cloudflare Vite plugin and Workers Static Assets
- **RetroRoom Durable Object** (one per room) as the server-authoritative owner of room state: participants, phase, timer, user-created columns, item placement, column-scoped groups, ordering, and mixed group/item votes
- **SQLite-backed Durable Object storage** for canonical room snapshots
- **WebSocket Hibernation API** for real-time state synchronization across connected clients
- **WebSocket credentials via subprotocols** so participant IDs and cryptographic tokens are not placed in the WebSocket URL
- **TypeScript shared domain types** used by both client and server
- **Production Cloudflare configuration** for Worker deployment, Durable Object bindings, migrations, and static asset serving

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- For deployment only: a Cloudflare account with `wrangler login` completed, or Cloudflare API credentials available in the environment

### Install

```sh
npm install
```

### Development

Start the local development server:

```sh
npm run dev
```

Vite will print the local URL. For the same host/port used by Playwright, run:

```sh
npm run dev -- --host 127.0.0.1 --port 8787
```

Then open [http://127.0.0.1:8787](http://127.0.0.1:8787).

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the local Cloudflare/Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run ESLint on `src/` and `worker/` |
| `npm run test` | Run unit and integration tests with Vitest and the Cloudflare Workers test pool |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:e2e` | Run end-to-end browser tests with Playwright |
| `npm run preview` | Build and preview the production output locally |
| `npm run deploy` | Build and deploy to Cloudflare with Wrangler |

## Key Design Decisions

- **No fixed default columns**: Rooms start with an empty board. Facilitators create, rename, reorder, and delete columns before vote/review, and item placement follows the item through the flow.
- **Safe column deletion**: Deleting a column cascades only its contained items, column-scoped groups, and group votes while preserving unrelated columns and content.
- **Column-scoped organisation**: Groups live inside a single column. Organise-phase drag, regroup, reorder, and ungroup operations are restricted to that column to keep column meaning stable.
- **Mixed voting targets**: Grouped items are voted only through their group target, while ungrouped items are individually votable. The review slideshow orders groups and ungrouped items together by total votes with deterministic tie-breakers.
- **v2 room schema**: Persisted room snapshots use schema version 2. Incompatible legacy board data from the previous fixed-column model is reset/ignored instead of being migrated into the kanban model.
- **Clean full-width SaaS UI**: The board uses ordered lists with visual columns/groups instead of sticky-note or canvas metaphors, wrapped in a responsive shadcn/Tailwind interface.
- **Accessible phase interactions**: Phase controls, item actions, drag/drop fallbacks, moving, voting, review, and status feedback are designed for keyboard reach, screen-reader labels, and clear responsive behavior.
- **Server-authoritative state**: The Durable Object owns phase transitions, permissions, timer state, item placement, ordering, and vote budgets. Clients never directly decide these.
- **Facilitator controls**: The room creator is the facilitator. Only the facilitator can advance phases, configure columns, and set timers/vote budgets.
- **Timer expiry does not auto-advance**: When a timer expires, the phase remains unchanged until the facilitator manually advances.
- **Credentialed WebSockets**: WebSocket connections require a valid participant ID and cryptographic token, passed through subprotocols to prevent impersonation without exposing credentials in URLs.
- **Resilient realtime UX**: Clients handle reconnects, focus recovery, failed sends, mobile browser behavior, and reduced-motion preferences while reconciling state by version.
- **Version-based state reconciliation**: Client merge logic prefers higher-version snapshots, not participant count.

## Testing

### Unit and Integration Tests

```sh
npm run test
```

Covers domain logic, user-created columns, column deletion cascades, schema v2 legacy resets, same-column organise operations, mixed group/item voting targets, review ordering, phase transitions, vote budget enforcement, Worker routing, Durable Object room isolation, WebSocket authentication, and phase-specific permissions.

### End-to-End Tests

```sh
npm run test:e2e
```

Playwright tests use `npm run dev -- --host 127.0.0.1 --port 8787` automatically and cover the full two-user retro flow from room creation through review, room isolation, refresh/reconnect persistence, focus recovery, mobile/reduced-motion resilience, and phase-specific controls.

## Deployment

```sh
npm run deploy
```

Requires `wrangler login` or appropriate Cloudflare API credentials. The app deploys as a single Cloudflare Worker with Durable Object bindings, SQLite-backed Durable Object storage, migrations, and static asset serving as configured in `wrangler.jsonc`.

## Project Structure

```
src/
  domain/          # Shared TypeScript types, state logic, message schemas
  hooks/           # React hooks, including the room WebSocket connection
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
