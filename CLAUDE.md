# MyndHyve CLI

## Project Context

This CLI project (`/Users/david/dev/myndhyve-cli`) is an extension of the main MyndHyve project at `/Users/david/dev/myndhyve`. The CLI serves as the command-line interface for interacting with MyndHyve cloud services, managing relay agents, messaging channels, AI chat, projects, and workflows.

When making changes, be aware that the CLI depends on APIs and services defined in the main MyndHyve project. Consult `/Users/david/dev/myndhyve` for backend context when needed.

## Terminology

The project uses **Canvas Type** terminology (not "Hyve"):
- `canvasTypeId` — identifier for a canvas type (e.g., `app-builder`, `landing-page`)
- `CanvasType` — type for system canvas type metadata (in `src/api/canvasTypes.ts`)
- `CanvasSummary` / `CanvasDetail` — types for canvas documents
- CLI command: `canvas-types` (e.g., `myndhyve-cli canvas-types list`)
- Firestore field names still use `hyveId` (data migration is separate from code rename)

## Key Files

| File | Purpose |
|------|---------|
| `src/api/canvasTypes.ts` | Canvas type metadata + canvas document CRUD |
| `src/api/projects.ts` | Project CRUD |
| `src/api/workflows.ts` | Workflow operations |
| `src/context.ts` | Active project context (`canvasTypeId`, not `hyveId`) |
| `src/cli/canvasTypes.ts` | `canvas-types` command group |
| `src/cli/program.ts` | Commander program definition |
| `src/chat/index.ts` | AI chat sessions |
| `src/cron/types.ts` | Cron job types |

## Cloud Function APIs

| API | Base URL |
|-----|----------|
| canvasApi | `https://us-central1-myndhyve.cloudfunctions.net/canvasApi` |
| agentApi | `https://us-central1-myndhyve.cloudfunctions.net/agentApi` |
| aiProxy | `https://us-central1-myndhyve.cloudfunctions.net/aiProxy` |
| promptApi | `https://us-central1-myndhyve.cloudfunctions.net/promptApi` |

## Dependencies

- `@hapi/boom` and `pino` are direct dependencies required by `@whiskeysockets/baileys` (WhatsApp SDK). They are directly imported in `src/channels/whatsapp/session.ts` for Baileys error handling and logging.
