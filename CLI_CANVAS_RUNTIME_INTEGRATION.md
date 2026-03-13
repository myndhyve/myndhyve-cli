# MyndHyve CLI Canvas Runtime Integration

## Overview

The MyndHyve CLI has been updated to support the new Canvas Runtime architecture, providing full parity with the web interface for canvas session management, queue control, and agent interaction.

## Installation and Setup

1. **Install the CLI**:
   ```bash
   npm install -g @myndhyve/cli
   ```

2. **Authenticate**:
   ```bash
   myndhyve-cli login
   ```

3. **Set active project**:
   ```bash
   myndhyve-cli use <project-id>
   ```

## Canvas Session Management

### Create Canvas Session

Create a new canvas session with CLI defaults (followup mode for sequential processing):

```bash
myndhyve-cli canvas session create --canvas=<canvas-id> --type=<canvas-type>
```

**Options**:
- `--tenant <tenant>`: Tenant ID (default: "default")
- `--project <project>`: Project ID (uses active project if not specified)
- `--canvas <canvas>`: Canvas ID (required)
- `--type <type>`: Canvas type (default: "landing-page")
- `--surface <surface>`: Surface type (default: "cli")
- `--scope <scope>`: Session scope (default: "main")
- `--title <title>`: Session title
- `--agent <agent>`: Primary agent ID
- `--queue-mode <mode>`: Queue mode (default: "followup")

**Example**:
```bash
myndhyve-cli canvas session create \
  --canvas=landing-page-123 \
  --type=landing-page \
  --title="Marketing Page Optimization" \
  --queue-mode=followup
```

### Use Canvas Session

Activate an existing canvas session:

```bash
myndhyve-cli canvas session use <session-key>
```

The session key is stored in CLI context for subsequent commands.

### Session History

View session message history:

```bash
myndhyve-cli canvas session history [--session=<session-key>] [--limit=50] [--offset=0]
```

### Reset Session

Reset a canvas session (clear messages and state):

```bash
myndhyve-cli canvas session reset [--session=<session-key>]
```

## Queue Management

### Get Queue Status

View current queue status and events:

```bash
myndhyve-cli canvas queue get [--session=<session-key>]
```

**Output Example**:
```
📊 Queue Status: default/proj-123/landing-page-123/cli/main
🔄 Queue Mode: followup
🔒 Is Locked: No
📋 Queued Events: 2

Queued Events:
  1. workflow_trigger (high) - user - 2024-03-12 14:30:00
  2. workflow_trigger (medium) - agent - 2024-03-12 14:31:00
```

### Set Queue Mode

Change the queue processing mode:

```bash
myndhyve-cli canvas queue set <mode> [--session=<session-key>]
```

**Queue Modes**:
- `collect`: Debounce events, process in batches (default for web)
- `followup`: Sequential processing, wait for active runs (default for CLI)
- `steer`: Inject into active runs when possible (interactive editing)
- `interrupt`: Cancel active run, process immediately (admin only)

**Example**:
```bash
myndhyve-cli canvas queue set collect
```

## Agent Interaction

### Send Message to Agent

Send a message to the canvas agent (uses interrupt mode for immediate processing):

```bash
myndhyve-cli canvas agent send "Review this landing page for conversion optimization" [--session=<session-key>]
```

### Steer Active Run

Inject steering data into an active agent run:

```bash
myndhyve-cli canvas agent steer "Focus on mobile responsiveness" [--session=<session-key>]
```

### Cancel Active Run

Cancel the currently active agent run:

```bash
myndhyve-cli canvas agent cancel [--session=<session-key>]
```

## Run Management (Future Implementation)

These commands are planned for future implementation:

```bash
# Get run status
myndhyve-cli canvas run status <run-id>

# Get run logs
myndhyve-cli canvas run logs <run-id>

# Get execution trace
myndhyve-cli canvas run trace <run-id>
```

## Scheduling (Future Implementation)

These commands are planned for future implementation:

```bash
# Set heartbeat interval
myndhyve-cli canvas heartbeat set --canvas=<canvas-id> --every=30

# Add cron schedule
myndhyve-cli canvas cron add "0 7 * * *" "Generate daily CRO audit" --canvas=<canvas-id>
```

## CLI Context Integration

The CLI automatically manages canvas session context:

### Context Structure
```typescript
{
  projectId: string,
  projectName: string,
  canvasTypeId: string,
  canvasTypeName?: string,
  canvasId?: string,        // NEW: Active canvas ID
  sessionKey?: string,     // NEW: Active session key
  setAt: string
}
```

### Session Key Format
```
tenantId/projectId/canvasId/surface/sessionScope
```

**Examples**:
- `default/proj-123/landing-page-123/cli/main`
- `default/proj-123/landing-page-123/web/main`
- `default/proj-123/landing-page-123/cron/daily-audit`

## Usage Patterns

### Typical Canvas Workflow

1. **Set up context**:
   ```bash
   myndhyve-cli use proj-123
   ```

2. **Create canvas session**:
   ```bash
   myndhyve-cli canvas session create --canvas=lp-123 --type=landing-page
   ```

3. **Send initial request**:
   ```bash
   myndhyve-cli canvas agent send "Optimize this landing page for conversions"
   ```

4. **Check queue status**:
   ```bash
   myndhyve-cli canvas queue get
   ```

5. **Steer if needed**:
   ```bash
   myndhyve-cli canvas agent steer "Focus on mobile first design"
   ```

6. **Review history**:
   ```bash
   myndhyve-cli canvas session history
   ```

### Batch Processing Mode

Switch to collect mode for batch processing of multiple edits:

```bash
myndhyve-cli canvas queue set collect

# Send multiple changes quickly
myndhyve-cli canvas agent send "Update headline to focus on benefits"
myndhyve-cli canvas agent send "Add social proof section"
myndhyve-cli canvas agent send "Improve CTA button color"

# Events will be debounced and processed together
```

### Interactive Mode

Switch to steer mode for real-time direction:

```bash
myndhyve-cli canvas queue set steer

# Send steering messages to active run
myndhyve-cli canvas agent steer "Make the hero section more compelling"
myndhyve-cli canvas agent steer "Add urgency to the CTA"
```

## Error Handling

The CLI provides comprehensive error handling:

- **Authentication errors**: Prompts to run `myndhyve-cli login`
- **Context errors**: Guides to set active project or canvas
- **API errors**: Shows detailed error messages from the runtime
- **Validation errors**: Provides clear usage instructions

## Environment Variables

Configure the CLI behavior with environment variables:

```bash
# API base URL (default: https://us-central1-myndhyve.cloudfunctions.net)
export MYNDHYVE_API_BASE_URL="https://api.myndhyve.ai"

# Debug logging
export DEBUG="myndhyve-cli:*"
```

## Integration with Web Runtime

The CLI provides full runtime parity with the web interface:

### Session Continuity
- Start work in web, continue in CLI
- Same session key works across both surfaces
- Queue state synchronized in real-time

### Queue Mode Coordination
- Web defaults to `collect` for collaborative editing
- CLI defaults to `followup` for sequential automation
- Mode changes are synchronized across surfaces

### Agent Context
- Primary agent settings shared
- Specialist agent configuration synchronized
- Sub-agent runs visible in both interfaces

## Troubleshooting

### Common Issues

1. **"No active project"**:
   ```bash
   myndhyve-cli use <project-id>
   ```

2. **"No session specified"**:
   ```bash
   myndhyve-cli canvas session use <session-key>
   # Or create a new session first
   ```

3. **"Not authenticated"**:
   ```bash
   myndhyve-cli login
   ```

4. **API connection issues**:
   ```bash
   export MYNDHYVE_API_BASE_URL="https://api.myndhyve.ai"
   ```

### Debug Mode

Enable debug logging for troubleshooting:

```bash
DEBUG=myndhyve-cli:* myndhyve-cli canvas queue get
```

## Future Enhancements

Planned CLI enhancements include:

1. **Full run management**: Status, logs, and traces for workflow runs
2. **Scheduling commands**: Heartbeat and cron configuration
3. **Sub-agent commands**: Spawn and monitor specialist agents
4. **Real-time streaming**: Live updates for active runs
5. **Bulk operations**: Process multiple canvases or sessions
6. **Configuration management**: CLI-specific canvas settings

## API Reference

The CLI uses the same Canvas Runtime API as the web interface:

- **Base URL**: `/canvas-api/v1/`
- **Authentication**: Firebase ID tokens
- **Rate limiting**: Same limits as web interface
- **Error handling**: Consistent error format

For detailed API documentation, see the Canvas Runtime API specification.
