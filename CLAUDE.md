# MyndHyve CLI

## Project Context

This CLI project (`/Users/david/dev/myndhyve-cli`) is an extension of the main MyndHyve project at `/Users/david/dev/myndhyve`. The CLI serves as the command-line interface for interacting with MyndHyve cloud services, managing relay agents, messaging channels, AI chat, projects, and workflows.

When making changes, be aware that the CLI depends on APIs and services defined in the main MyndHyve project. Consult `/Users/david/dev/myndhyve` for backend context when needed.

## Workspace-Scoped Data

All collaborative Firestore data lives at `workspaces/{workspaceId}/` (not `users/{userId}/`). The shared path helper at `src/utils/workspacePaths.ts` provides:

```typescript
import { resolveCollectionPath, resolveDocumentPath } from '../utils/workspacePaths.js';

// Returns 'workspaces/ws-personal-{userId}/agents' (personal workspace)
resolveCollectionPath(userId, 'agents');

// With explicit workspace ID (team workspace)
resolveCollectionPath(userId, 'agents', 'ws-team-abc');
```

Every user has a personal workspace `ws-personal-{userId}`. Personal data (secrets, messaging, bridge sessions) stays at `users/{userId}/`.

## Terminology

The project uses **Canvas Type** terminology:
- `canvasTypeId` — identifier for a canvas type (e.g., `app-builder`, `campaign-studio`)
- `CanvasType` — type for system canvas type metadata (in `src/api/canvasTypes.ts`)
- `CanvasSummary` / `CanvasDetail` — types for canvas documents
- CLI command: `canvas-types` (e.g., `myndhyve-cli canvas-types list`)
- Firestore fields and collections use `canvasTypeId` and `canvases` (migration complete)

## Key Files

| File | Purpose |
|------|---------|
| `src/api/canvasTypes.ts` | Canvas type metadata + canvas document CRUD |
| `src/api/projects.ts` | Project CRUD |
| `src/api/workflows.ts` | Workflow operations |
| `src/api/cms.ts` | CMS page management, blog, engagement (comments, reactions, shares) |
| `src/context.ts` | Active project context (`canvasTypeId`) |
| `src/cli/canvasTypes.ts` | `canvas-types` command group |
| `src/cli/cms.ts` | `cms` command group (pages, comments, export/import, blog) |
| `src/cli/program.ts` | Commander program definition |
| `src/chat/index.ts` | AI chat sessions |
| `src/cron/types.ts` | Cron job types |
| `src/utils/format.ts` | Shared formatters: `formatTimeSince`, `formatTimeUntil`, `formatRunError` (maps `RUN_ERROR_CODES` → operator hints — see "Wire-error formatting" below) |

## Wire-error formatting

When surfacing a structured `RunError` from the workflow runtime
(`run.error` on `RunDetail`, error frames on stream callbacks, etc.),
ALWAYS route through `formatRunError(error, { withHint: true })` from
`src/utils/format.ts` — never inline the `[code] message (node)` build.
The helper:

- emits the canonical `[code] message (node?)` head line so output stays
  consistent across surfaces
- appends a second `Hint: …` line for codes in the shared
  `RUN_ERROR_CODES` set with a known remediation (e.g.
  `recursion_limit_exceeded` → "Increase
  `RunOptions.configurable.recursionLimit` or simplify the workflow")
- silently skips the hint for unknown wire codes (forward-compat — a
  future server code emitted before the CLI is rebuilt won't crash)

Adding a new wire code? After landing it in
`packages/types/src/errors.ts` (main project), open
`src/utils/format.ts` `RUN_ERROR_HINTS` and add a hint entry. The
drift-gate test in `format.test.ts` ("every wire code in
RUN_ERROR_CODES has a hint entry") will fail in CI otherwise. Hints
should be one line and operator-actionable — name the field/flag/
flag-doc the user adjusts to recover.

## Commerce Module

The standalone e-commerce module provides CLI access to product catalog, order management, and commerce analytics.

| File | Purpose |
|------|---------|
| `src/api/commerce.ts` | Commerce entity CRUD, order lifecycle, stats, low-stock queries |
| `src/cli/commerce.ts` | `commerce` command group |

**Firestore paths:** Uses `commerce_` prefix (NOT `crm/`):
- `workspaces/{workspaceId}/commerce_{collection}/{entityId}`
- Personal workspace: `workspaces/ws-personal-{userId}/commerce_{collection}/{entityId}`

**Collections:** products, orders, customers, coupons, affiliates

**Commands:**
- `commerce list <collection>` — List entities (with `--status` filter)
- `commerce get <collection> <id>` — Entity detail
- `commerce create <collection> --data '{...}'` — Create entity
- `commerce update <collection> <id> --data '{...}'` — Update entity
- `commerce delete <collection> <id> --force` — Delete (orders blocked)
- `commerce fulfill <orderId> [--tracking <num>]` — Fulfill order
- `commerce refund <orderId> --force` — Refund order
- `commerce cancel <orderId> --force` — Cancel order
- `commerce stats` — Revenue, orders, products, customers dashboard
- `commerce low-stock` — Products below inventory threshold
- `commerce collections` — List available collections

**Note:** Commerce collections also exist in the CRM module (`crm list orders`) but use different Firestore paths (`crm/` vs `commerce_`). The `commerce` command group uses the correct standalone paths.

## Cloud Function APIs

| API | Base URL |
|-----|----------|
| canvasApi | `https://us-central1-myndhyve.cloudfunctions.net/canvasApi` |
| agentApi | `https://us-central1-myndhyve.cloudfunctions.net/agentApi` |
| aiProxy | `https://us-central1-myndhyve.cloudfunctions.net/aiProxy` |
| promptApi | `https://us-central1-myndhyve.cloudfunctions.net/promptApi` |
| cmsApi | `https://us-central1-myndhyve.cloudfunctions.net/cmsApi` |

## Dependencies

- `@hapi/boom` and `pino` are direct dependencies required by `@whiskeysockets/baileys` (WhatsApp SDK). They are directly imported in `src/channels/whatsapp/session.ts` for Baileys error handling and logging.
