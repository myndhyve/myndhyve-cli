# MyndHyve CLI

## Project Context

This CLI project (`/Users/david/dev/myndhyve-cli`) is an extension of the main MyndHyve project at `/Users/david/dev/myndhyve`. The CLI serves as the command-line interface for interacting with MyndHyve cloud services, managing relay agents, messaging channels, AI chat, projects, and workflows.

When making changes, be aware that the CLI depends on APIs and services defined in the main MyndHyve project. Consult `/Users/david/dev/myndhyve` for backend context when needed.

## Dependencies

- `@hapi/boom` and `pino` are direct dependencies required by `@whiskeysockets/baileys` (WhatsApp SDK). They are directly imported in `src/channels/whatsapp/session.ts` for Baileys error handling and logging.
