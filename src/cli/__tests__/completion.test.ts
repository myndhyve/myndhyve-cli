import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';
import { registerCompletionCommand } from '../completion.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerCompletionCommand(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('registerCompletionCommand', () => {
  let stdoutWriteSpy: MockInstance;
  let stderrWriteSpy: MockInstance;
  let consoleErrSpy: MockInstance;

  beforeEach(() => {
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    consoleErrSpy.mockRestore();
    process.exitCode = undefined;
  });

  // ==========================================================================
  // COMMAND STRUCTURE
  // ==========================================================================

  describe('command structure', () => {
    it('registers the completion command on the program', () => {
      const program = new Command();
      registerCompletionCommand(program);
      const completion = program.commands.find((c) => c.name() === 'completion');
      expect(completion).toBeDefined();
    });
  });

  // ==========================================================================
  // COMPLETION BASH
  // ==========================================================================

  describe('completion bash', () => {
    it('outputs bash completion script to stdout', async () => {
      await run(['completion', 'bash']);

      expect(stdoutWriteSpy).toHaveBeenCalled();
      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('###-begin-myndhyve-cli-completions-###');
      expect(output).toContain('###-end-myndhyve-cli-completions-###');
    });

    it('contains bash function name _myndhyve_cli_completions', async () => {
      await run(['completion', 'bash']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('_myndhyve_cli_completions()');
    });

    it('includes all top-level commands', async () => {
      await run(['completion', 'bash']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      const topLevelCommands = ['auth', 'chat', 'projects', 'hyves', 'messaging', 'workflows', 'relay', 'dev'];
      for (const cmd of topLevelCommands) {
        expect(output).toContain(cmd);
      }
    });

    it('includes messaging level-3 subcommands for connectors', async () => {
      await run(['completion', 'bash']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      const connectorSubcmds = ['list', 'status', 'test', 'enable', 'disable'];
      // The connectors case contains these subcommands
      for (const sub of connectorSubcmds) {
        expect(output).toContain(sub);
      }
    });

    it('includes complete command for bash', async () => {
      await run(['completion', 'bash']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('complete -F _myndhyve_cli_completions myndhyve-cli');
    });
  });

  // ==========================================================================
  // COMPLETION ZSH
  // ==========================================================================

  describe('completion zsh', () => {
    it('outputs zsh completion script to stdout', async () => {
      await run(['completion', 'zsh']);

      expect(stdoutWriteSpy).toHaveBeenCalled();
      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output.length).toBeGreaterThan(0);
    });

    it('contains #compdef myndhyve-cli', async () => {
      await run(['completion', 'zsh']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('#compdef myndhyve-cli');
    });

    it('includes messaging sub-subcommands for connectors', async () => {
      await run(['completion', 'zsh']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain("'list[List connectors]'");
      expect(output).toContain("'status[Show connector status]'");
      expect(output).toContain("'test[Test a connector]'");
      expect(output).toContain("'enable[Enable a connector]'");
      expect(output).toContain("'disable[Disable a connector]'");
    });

    it('includes all top-level command descriptions', async () => {
      await run(['completion', 'zsh']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain("'auth:Authenticate with MyndHyve'");
      expect(output).toContain("'chat:Chat with AI agents'");
      expect(output).toContain("'projects:Manage projects'");
    });

    it('includes the zsh function invocation', async () => {
      await run(['completion', 'zsh']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('_myndhyve-cli "$@"');
    });
  });

  // ==========================================================================
  // COMPLETION FISH
  // ==========================================================================

  describe('completion fish', () => {
    it('outputs fish completion script to stdout', async () => {
      await run(['completion', 'fish']);

      expect(stdoutWriteSpy).toHaveBeenCalled();
      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output.length).toBeGreaterThan(0);
    });

    it('contains complete -c myndhyve-cli', async () => {
      await run(['completion', 'fish']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('complete -c myndhyve-cli');
    });

    it('includes connector subcommands', async () => {
      await run(['completion', 'fish']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain("'__fish_seen_subcommand_from connectors'");
      expect(output).toContain("-a 'list' -d 'List connectors'");
      expect(output).toContain("-a 'status' -d 'Show status'");
      expect(output).toContain("-a 'test' -d 'Test a connector'");
      expect(output).toContain("-a 'enable' -d 'Enable a connector'");
      expect(output).toContain("-a 'disable' -d 'Disable a connector'");
    });

    it('includes top-level commands with descriptions', async () => {
      await run(['completion', 'fish']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain("-a 'auth' -d 'Authenticate with MyndHyve'");
      expect(output).toContain("-a 'chat' -d 'Chat with AI agents'");
      expect(output).toContain("-a 'dev' -d 'Developer tools'");
    });

    it('disables file completions by default', async () => {
      await run(['completion', 'fish']);

      const output = stdoutWriteSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('complete -c myndhyve-cli -f');
    });
  });

  // ==========================================================================
  // INVALID SHELL
  // ==========================================================================

  describe('invalid shell', () => {
    it('sets exitCode=2 for unknown shell', async () => {
      await run(['completion', 'powershell']);

      expect(process.exitCode).toBe(2);
    });

    it('prints error message to stderr for unknown shell', async () => {
      await run(['completion', 'powershell']);

      const output = consoleErrSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Unknown shell: powershell');
      expect(output).toContain('Supported: bash, zsh, fish');
    });

    it('does not write to stdout for unknown shell', async () => {
      await run(['completion', 'powershell']);

      expect(stdoutWriteSpy).not.toHaveBeenCalled();
    });
  });
});
