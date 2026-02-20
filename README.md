# @myndhyve/cli

[![CI](https://github.com/myndhyve/myndhyve-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/myndhyve/myndhyve-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

The MyndHyve CLI is the primary developer interface for MyndHyve. Authenticate, chat with AI agents, manage projects, automate workflows, control messaging connectors, and bridge device-bound platforms — all from the terminal.

## Requirements

- **Node.js 20+**
- **MyndHyve account**
- **Platform-specific prerequisites** for relay channels (see below)

## Installation

```bash
npm install -g @myndhyve/cli
```

## Quick Start

```bash
# 1. Authenticate with MyndHyve
myndhyve-cli auth login

# 2. List your projects
myndhyve-cli projects list

# 3. Set active project context
myndhyve-cli use <project-id>

# 4. Start an AI chat session
myndhyve-cli chat
```

## Commands

```
myndhyve-cli
├── auth                         # Authentication
│   ├── login                    # Authenticate with MyndHyve
│   ├── logout                   # Clear stored credentials
│   ├── status                   # Show current auth state
│   └── token                    # Print access token (for scripting)
│
├── chat [agent] [--hyve=X]      # Interactive AI chat session
│
├── projects                     # Project management
│   ├── list                     # List all projects
│   ├── create                   # Create a new project
│   ├── open <id>                # Open project in browser
│   ├── delete <id>              # Delete a project
│   └── info <id>                # Show project details
│
├── hyves                        # Hyve management
│   ├── list                     # List available hyves
│   └── info <id>                # Show hyve details
│
├── use <project-id>             # Set active project context
├── unuse                        # Clear active context
├── whoami                       # Show user + active project
│
├── messaging                    # Cloud messaging operations
│   ├── connectors list          # List messaging connectors
│   ├── connectors status <id>   # Show connector status
│   ├── connectors test <id>     # Send a test message
│   ├── connectors enable <id>   # Enable a connector
│   ├── connectors disable <id>  # Disable a connector
│   ├── policies get <id>        # Get connector policies
│   ├── policies set <id>        # Set connector policies
│   ├── routing list             # List routing rules
│   ├── routing add              # Add a routing rule
│   ├── routing remove <id>      # Remove a routing rule
│   ├── logs [--since=1h]        # Query delivery logs
│   ├── sessions list            # List active sessions
│   ├── sessions inspect <key>   # Inspect a session
│   ├── sessions close <key>     # Close a session
│   ├── identity list            # List identities
│   ├── identity link <id>       # Link a peer to identity
│   └── identity unlink <id>     # Unlink a peer
│
├── workflows                    # Workflow automation
│   ├── list                     # List workflows for a hyve
│   ├── info <id>                # Show workflow details
│   ├── run <id> [--input=JSON]  # Trigger a workflow run
│   ├── runs [--status=X]        # List workflow runs
│   ├── status <runId>           # Show run status
│   ├── logs <runId> [--follow]  # Stream run event logs
│   ├── artifacts list <runId>   # List run artifacts
│   ├── artifacts get <id>       # Download an artifact
│   ├── approve <runId>          # Approve a pending run
│   ├── reject <runId>           # Reject a pending run
│   └── revise <runId>           # Request revision on a run
│
├── relay                        # Device-bound messaging relay
│   ├── setup                    # Register a new relay device
│   ├── start [--daemon]         # Start the relay agent
│   ├── stop                     # Stop the relay daemon
│   ├── status                   # Show relay device status
│   ├── login                    # Authenticate with platform
│   ├── logout                   # Clear credentials
│   ├── logs [--follow]          # View relay daemon logs
│   └── uninstall                # Remove all relay data
│
└── dev                          # Developer tools
    ├── doctor                   # Check environment health
    ├── ping                     # Test cloud connectivity
    ├── envelope create          # Create a test envelope
    ├── envelope validate        # Validate an envelope
    ├── webhook test             # Generate a test webhook event
    ├── webhook events           # List available event types
    └── config export|import     # Manage CLI config
```

### Global Options

| Option | Description |
|--------|-------------|
| `--json` | Machine-readable JSON output (scriptable) |
| `--verbose` | Show debug-level logging |
| `--help` | Show help for any command |
| `--version` | Show CLI version |

### auth

```bash
# Browser-based login
myndhyve-cli auth login

# Check authentication state
myndhyve-cli auth status

# Print token for scripting (e.g., curl -H "Authorization: Bearer $(myndhyve-cli auth token)")
myndhyve-cli auth token
```

### chat

```bash
# Start an interactive AI chat
myndhyve-cli chat

# Chat with a specific agent
myndhyve-cli chat marketing-advisor

# Chat within a specific hyve context
myndhyve-cli chat --hyve landing-page
```

### workflows

```bash
# List workflows for a hyve
myndhyve-cli workflows list --hyve landing-page

# Trigger a workflow run with input
myndhyve-cli workflows run copy-generator --input '{"prompt": "Write hero copy"}'

# Stream run logs in real time
myndhyve-cli workflows logs run-abc --follow

# Approve a human-in-the-loop checkpoint
myndhyve-cli workflows approve run-abc
```

### messaging

```bash
# List your connectors
myndhyve-cli messaging connectors list

# Query recent delivery logs
myndhyve-cli messaging logs --since 1h

# Test a connector
myndhyve-cli messaging connectors test whatsapp-prod
```

### dev

```bash
# Run environment diagnostics
myndhyve-cli dev doctor

# Test connectivity to MyndHyve Cloud
myndhyve-cli dev ping

# Create and validate test envelopes
myndhyve-cli dev envelope create --channel whatsapp --text "Hello"
myndhyve-cli dev envelope validate < envelope.json

# Generate mock webhook events
myndhyve-cli dev webhook test --channel signal --event message
```

## Supported Relay Platforms

### WhatsApp

Uses [Baileys](https://github.com/WhiskeySockets/Baileys) (unofficial WhatsApp Web API).

**Prerequisites:** None beyond Node.js.

**Authentication:** Scan a QR code in your terminal during `myndhyve-cli relay login`.

> **Warning:** WhatsApp bridging uses an unofficial API. Your WhatsApp account may be at risk of being banned. Use a secondary number if possible.

### Signal

Uses [signal-cli](https://github.com/AsamK/signal-cli) JSON-RPC bridge.

**Prerequisites:**
```bash
# macOS
brew install signal-cli

# Linux (snap)
sudo snap install signal-cli

# Other: Download from github.com/AsamK/signal-cli/releases
```

**Authentication:** Register or link your Signal account during `myndhyve-cli relay login`.

### iMessage

Uses the `imsg` RPC tool for macOS Messages.app integration.

**Prerequisites:**
```bash
# macOS only
brew install --cask imsg
```

**Platform:** macOS only. Requires an active Apple ID signed into Messages.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                       @myndhyve/cli                      │
│                                                          │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌───────────┐  │
│  │  Auth   │ │   Chat   │ │ Projects  │ │ Workflows │  │
│  └────┬────┘ └────┬─────┘ └─────┬─────┘ └─────┬─────┘  │
│       └──────┬────┴─────────────┴──────────────┘        │
│              ▼                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │           MyndHyve API Client                    │   │
│  │  POST /auth    POST /chat    GET /projects       │   │
│  │  GET /hyves    POST /runs    GET /connectors     │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         ▼                               │
│           MyndHyve Cloud Functions                      │
│     (hyveApi, aiProxy, messagingGateway)                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Relay Agent (Device-Bound)               │   │
│  │  ┌──────────┐ ┌────────┐ ┌─────────────┐        │   │
│  │  │ WhatsApp │ │ Signal │ │  iMessage   │        │   │
│  │  │(Baileys) │ │(signal │ │(AppleScript/│        │   │
│  │  │          │ │  -cli) │ │  imsg RPC)  │        │   │
│  │  └────┬─────┘ └───┬────┘ └──────┬──────┘        │   │
│  │       └──────┬────┴──────────────┘               │   │
│  │              ▼                                    │   │
│  │   ┌──────────────────────┐                       │   │
│  │   │  Message Normalizer  │                       │   │
│  │   │ → ChatIngressEnvelope│                       │   │
│  │   └──────────┬───────────┘                       │   │
│  └──────────────┼────────────────────────────────────┘  │
│                 ▼                                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │        Relay Protocol Client                     │   │
│  │  POST /inbound   POST /heartbeat                 │   │
│  │  GET  /outbound  POST /ack                       │   │
│  └──────────────────┬───────────────────────────────┘   │
│                     ▼                                    │
│         MyndHyve Cloud Functions                        │
│      (messagingRelayGateway)                            │
└──────────────────────────────────────────────────────────┘
```

## Configuration

Config is stored at `~/.myndhyve-cli/config.json`:

```json
{
  "server": {
    "baseUrl": "https://us-central1-myndhyve.cloudfunctions.net/messagingRelayGateway"
  },
  "reconnect": {
    "maxAttempts": "Infinity",
    "initialDelayMs": 1000,
    "maxDelayMs": 300000
  },
  "heartbeat": {
    "intervalSeconds": 30
  },
  "outbound": {
    "pollIntervalSeconds": 5,
    "maxPerPoll": 10
  },
  "logging": {
    "level": "info"
  }
}
```

## Data Directory

All CLI data is stored in `~/.myndhyve-cli/`:

```
~/.myndhyve-cli/
├── config.json          # Configuration
├── context.json         # Active project context (from `use`)
├── device.json          # Device registration (relayId, token)
├── relay.pid            # Daemon PID file
├── logs/
│   └── relay.log        # Daemon log file
└── auth/
    ├── credentials.json # MyndHyve auth tokens
    └── {channel}/       # Platform-specific auth state
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `auth login` hangs | Check firewall/proxy settings, try `--verbose` |
| Daemon won't start | Check `myndhyve-cli relay status`, ensure no stale PID file |
| WhatsApp QR code not showing | Ensure terminal supports Unicode, try `--verbose` |
| Signal: "command not found" | Install signal-cli and ensure it's in PATH |
| iMessage: "not supported" | iMessage only works on macOS with Apple ID |
| Connection drops | Check network, daemon auto-reconnects with backoff |
| Activation code expired | Run `myndhyve-cli relay setup` again to get a new code |

## Development

```bash
# Install dependencies
npm install

# Build (generates dist/index.js + dist/index.d.ts)
npm run build

# Run tests (1,700+ test cases)
npm test

# Type check
npm run typecheck

# Watch mode
npm run dev
```

### Release Process

```bash
# 1. Bump version
npm version patch  # or minor, major

# 2. Push with tag — GitHub Actions publishes to npm
git push && git push --tags
```

## License

[MIT](LICENSE)
