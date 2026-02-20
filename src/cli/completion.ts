/**
 * MyndHyve CLI — Shell Completions
 *
 * Generates shell completion scripts for bash, zsh, and fish.
 *   myndhyve-cli completion bash
 *   myndhyve-cli completion zsh
 *   myndhyve-cli completion fish
 */

import type { Command } from 'commander';

// ============================================================================
// COMPLETION SCRIPTS
// ============================================================================

function bashCompletion(): string {
  return `###-begin-myndhyve-cli-completions-###
_myndhyve_cli_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # Top-level commands
  commands="auth chat projects hyves messaging workflows relay dev status use unuse whoami completion update"

  # Subcommands by parent
  case "\${COMP_WORDS[1]}" in
    auth)
      COMPREPLY=( $(compgen -W "login logout status token" -- "$cur") )
      return 0
      ;;
    relay)
      COMPREPLY=( $(compgen -W "setup start stop status login logout logs uninstall" -- "$cur") )
      return 0
      ;;
    projects)
      COMPREPLY=( $(compgen -W "list create info open delete" -- "$cur") )
      return 0
      ;;
    hyves)
      COMPREPLY=( $(compgen -W "list info docs" -- "$cur") )
      return 0
      ;;
    messaging)
      case "\${COMP_WORDS[2]}" in
        connectors)
          COMPREPLY=( $(compgen -W "list status test enable disable" -- "$cur") )
          return 0
          ;;
        policies)
          COMPREPLY=( $(compgen -W "get set" -- "$cur") )
          return 0
          ;;
        routing)
          COMPREPLY=( $(compgen -W "list add remove" -- "$cur") )
          return 0
          ;;
        sessions)
          COMPREPLY=( $(compgen -W "list inspect close" -- "$cur") )
          return 0
          ;;
        identity)
          COMPREPLY=( $(compgen -W "list link unlink" -- "$cur") )
          return 0
          ;;
        *)
          COMPREPLY=( $(compgen -W "connectors policies routing logs sessions identity" -- "$cur") )
          return 0
          ;;
      esac
      ;;
    workflows)
      COMPREPLY=( $(compgen -W "list info run runs status logs artifacts approve reject revise" -- "$cur") )
      return 0
      ;;
    dev)
      COMPREPLY=( $(compgen -W "doctor ping envelope webhook config" -- "$cur") )
      return 0
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
      return 0
      ;;
  esac

  # Global flags
  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "--help --version --json --quiet --verbose --debug --no-color" -- "$cur") )
    return 0
  fi

  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
  return 0
}
complete -F _myndhyve_cli_completions myndhyve-cli
###-end-myndhyve-cli-completions-###`;
}

function zshCompletion(): string {
  return `#compdef myndhyve-cli

_myndhyve-cli() {
  local -a commands
  commands=(
    'auth:Authenticate with MyndHyve'
    'chat:Chat with AI agents'
    'projects:Manage projects'
    'hyves:Explore system hyves'
    'messaging:Manage messaging connectors, policies, and routing'
    'workflows:Manage and run workflows'
    'relay:Bridge messaging platforms to MyndHyve'
    'dev:Developer tools and diagnostics'
    'status:Show overall CLI status'
    'use:Set active project context'
    'unuse:Clear active project context'
    'whoami:Show current context'
    'completion:Generate shell completions'
    'update:Check for updates'
  )

  _arguments -C \\
    '--help[Show help]' \\
    '--version[Show version]' \\
    '--json[Output as JSON]' \\
    '--quiet[Suppress non-essential output]' \\
    '--verbose[Show detailed output]' \\
    '--debug[Show debug diagnostics]' \\
    '--no-color[Disable colored output]' \\
    '1:command:->command' \\
    '*::arg:->args'

  case "$state" in
    command)
      _describe 'command' commands
      ;;
    args)
      case "\${words[1]}" in
        auth)
          _values 'subcommand' \\
            'login[Sign in to MyndHyve]' \\
            'logout[Sign out and clear credentials]' \\
            'status[Show auth status]' \\
            'token[Print auth token to stdout]'
          ;;
        relay)
          _values 'subcommand' \\
            'setup[Register a new relay device]' \\
            'start[Start the relay agent]' \\
            'stop[Stop the relay daemon]' \\
            'status[Show relay status]' \\
            'login[Re-authenticate with platform]' \\
            'logout[Clear platform credentials]' \\
            'logs[View relay logs]' \\
            'uninstall[Remove all relay data]'
          ;;
        projects)
          _values 'subcommand' \\
            'list[List projects]' \\
            'create[Create a new project]' \\
            'info[Show project details]' \\
            'open[Open project in browser]' \\
            'delete[Delete a project]'
          ;;
        messaging)
          case "\${words[2]}" in
            connectors)
              _values 'subcommand' \\
                'list[List connectors]' \\
                'status[Show connector status]' \\
                'test[Test a connector]' \\
                'enable[Enable a connector]' \\
                'disable[Disable a connector]'
              ;;
            policies)
              _values 'subcommand' \\
                'get[Show policy]' \\
                'set[Update policy]'
              ;;
            routing)
              _values 'subcommand' \\
                'list[List routing rules]' \\
                'add[Add a routing rule]' \\
                'remove[Remove a routing rule]'
              ;;
            sessions)
              _values 'subcommand' \\
                'list[List sessions]' \\
                'inspect[Inspect a session]' \\
                'close[Close a session]'
              ;;
            identity)
              _values 'subcommand' \\
                'list[List identities]' \\
                'link[Link a peer]' \\
                'unlink[Unlink a peer]'
              ;;
            *)
              _values 'subcommand' \\
                'connectors[Manage messaging connectors]' \\
                'policies[Manage messaging policies]' \\
                'routing[Manage routing rules]' \\
                'logs[View delivery logs]' \\
                'sessions[View active sessions]' \\
                'identity[Manage cross-channel identity]'
              ;;
          esac
          ;;
        workflows)
          _values 'subcommand' \\
            'list[List workflows]' \\
            'info[Show workflow details]' \\
            'run[Execute a workflow]' \\
            'runs[List workflow runs]' \\
            'status[Show run status]' \\
            'logs[View run logs]' \\
            'artifacts[View run artifacts]' \\
            'approve[Approve a waiting run]' \\
            'reject[Reject a waiting run]' \\
            'revise[Request revisions on a run]'
          ;;
        dev)
          _values 'subcommand' \\
            'doctor[Run health checks]' \\
            'ping[Test cloud connectivity]' \\
            'envelope[Test messaging envelopes]' \\
            'webhook[Test webhook payloads]' \\
            'config[Manage configuration]'
          ;;
        completion)
          _values 'shell' 'bash' 'zsh' 'fish'
          ;;
      esac
      ;;
  esac
}

_myndhyve-cli "$@"`;
}

function fishCompletion(): string {
  return `# Fish completions for myndhyve-cli

# Disable file completions by default
complete -c myndhyve-cli -f

# Top-level commands
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'auth' -d 'Authenticate with MyndHyve'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'chat' -d 'Chat with AI agents'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'projects' -d 'Manage projects'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'hyves' -d 'List system hyves'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'messaging' -d 'Manage messaging'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'workflows' -d 'Manage workflows'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'relay' -d 'Bridge messaging platforms'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'dev' -d 'Developer tools'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'status' -d 'Show CLI status'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'use' -d 'Set active project'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'unuse' -d 'Clear active project'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'whoami' -d 'Show current context'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'completion' -d 'Generate shell completions'
complete -c myndhyve-cli -n '__fish_use_subcommand' -a 'update' -d 'Check for updates'

# Global flags
complete -c myndhyve-cli -l help -d 'Show help'
complete -c myndhyve-cli -l version -d 'Show version'
complete -c myndhyve-cli -l json -d 'Output as JSON'
complete -c myndhyve-cli -s q -l quiet -d 'Suppress non-essential output'
complete -c myndhyve-cli -l verbose -d 'Show detailed output'
complete -c myndhyve-cli -l debug -d 'Show debug diagnostics'
complete -c myndhyve-cli -l no-color -d 'Disable colored output'

# auth subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from auth' -a 'login' -d 'Sign in'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from auth' -a 'logout' -d 'Sign out'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from auth' -a 'status' -d 'Show auth status'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from auth' -a 'token' -d 'Print auth token'

# relay subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from relay' -a 'setup' -d 'Register relay device'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from relay' -a 'start' -d 'Start relay agent'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from relay' -a 'stop' -d 'Stop relay daemon'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from relay' -a 'status' -d 'Show relay status'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from relay' -a 'login' -d 'Re-authenticate'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from relay' -a 'logout' -d 'Clear credentials'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from relay' -a 'logs' -d 'View logs'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from relay' -a 'uninstall' -d 'Remove all data'

# projects subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from projects' -a 'list' -d 'List projects'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from projects' -a 'create' -d 'Create project'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from projects' -a 'info' -d 'Show details'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from projects' -a 'open' -d 'Open in browser'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from projects' -a 'delete' -d 'Delete project'

# hyves subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from hyves' -a 'list' -d 'List system hyves'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from hyves' -a 'info' -d 'Show hyve details'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from hyves' -a 'docs' -d 'List hyve documents'

# messaging subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from messaging' -a 'connectors' -d 'Manage connectors'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from messaging' -a 'policies' -d 'Manage policies'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from messaging' -a 'routing' -d 'Manage routing'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from messaging' -a 'logs' -d 'View delivery logs'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from messaging' -a 'sessions' -d 'View sessions'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from messaging' -a 'identity' -d 'Manage identity'

# messaging connectors subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from connectors' -a 'list' -d 'List connectors'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from connectors' -a 'status' -d 'Show status'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from connectors' -a 'test' -d 'Test a connector'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from connectors' -a 'enable' -d 'Enable a connector'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from connectors' -a 'disable' -d 'Disable a connector'

# messaging policies subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from policies' -a 'get' -d 'Show policy'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from policies' -a 'set' -d 'Update policy'

# messaging routing subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from routing' -a 'list' -d 'List rules'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from routing' -a 'add' -d 'Add a rule'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from routing' -a 'remove' -d 'Remove a rule'

# messaging sessions subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from sessions' -a 'list' -d 'List sessions'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from sessions' -a 'inspect' -d 'Inspect a session'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from sessions' -a 'close' -d 'Close a session'

# messaging identity subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from identity' -a 'list' -d 'List identities'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from identity' -a 'link' -d 'Link a peer'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from identity' -a 'unlink' -d 'Unlink a peer'

# workflows subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from workflows' -a 'list' -d 'List workflows'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from workflows' -a 'info' -d 'Show details'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from workflows' -a 'run' -d 'Execute workflow'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from workflows' -a 'runs' -d 'List runs'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from workflows' -a 'status' -d 'Show run status'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from workflows' -a 'logs' -d 'View run logs'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from workflows' -a 'artifacts' -d 'View artifacts'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from workflows' -a 'approve' -d 'Approve run'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from workflows' -a 'reject' -d 'Reject run'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from workflows' -a 'revise' -d 'Request revisions'

# dev subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from dev' -a 'doctor' -d 'Run health checks'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from dev' -a 'ping' -d 'Test connectivity'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from dev' -a 'envelope' -d 'Test envelopes'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from dev' -a 'webhook' -d 'Test webhooks'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from dev' -a 'config' -d 'Manage config'

# completion subcommands
complete -c myndhyve-cli -n '__fish_seen_subcommand_from completion' -a 'bash' -d 'Bash completions'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from completion' -a 'zsh' -d 'Zsh completions'
complete -c myndhyve-cli -n '__fish_seen_subcommand_from completion' -a 'fish' -d 'Fish completions'`;
}

// ============================================================================
// COMMAND
// ============================================================================

async function completionCommand(shell: string): Promise<void> {
  switch (shell) {
    case 'bash':
      process.stdout.write(bashCompletion() + '\n');
      break;
    case 'zsh':
      process.stdout.write(zshCompletion() + '\n');
      break;
    case 'fish':
      process.stdout.write(fishCompletion() + '\n');
      break;
    default:
      console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
      process.exitCode = 2;
  }
}

// ============================================================================
// REGISTER
// ============================================================================

export function registerCompletionCommand(program: Command): void {
  program
    .command('completion')
    .description('Generate shell completion scripts')
    .argument('<shell>', 'Shell type: bash, zsh, or fish')
    .addHelpText('after', `
Examples:
  # Bash (add to ~/.bashrc)
  eval "$(myndhyve-cli completion bash)"

  # Zsh (add to ~/.zshrc)
  eval "$(myndhyve-cli completion zsh)"

  # Fish
  myndhyve-cli completion fish | source
  myndhyve-cli completion fish > ~/.config/fish/completions/myndhyve-cli.fish`)
    .action(completionCommand);
}
