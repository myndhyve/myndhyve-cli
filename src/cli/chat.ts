/**
 * MyndHyve CLI — Chat Command
 *
 * Interactive AI chat from the terminal with streaming responses.
 *
 * Modes:
 *   Interactive:  myndhyve-cli chat [--hyve=X] [--model=Y]
 *   One-shot:     myndhyve-cli chat "Build me a landing page"
 *   Pipe:         echo "question" | myndhyve-cli chat --pipe
 *   Resume:       myndhyve-cli chat --resume [sessionId]
 *   History:      myndhyve-cli chat --history
 */

import type { Command } from 'commander';
import { createInterface } from 'node:readline';

// ============================================================================
// CHAT COMMAND
// ============================================================================

interface ChatOptions {
  hyve?: string;
  agent?: string;
  model?: string;
  provider?: string;
  temperature?: string;
  resume?: string | boolean;
  history?: boolean;
  pipe?: boolean;
  system?: string;
}

async function chatCommand(
  messageArg: string | undefined,
  options: ChatOptions
): Promise<void> {
  const chalk = (await import('chalk')).default;

  // ── History Mode ──────────────────────────────────────────────────
  if (options.history) {
    await showHistory(chalk);
    return;
  }

  // ── Pipe Mode ─────────────────────────────────────────────────────
  if (options.pipe) {
    await pipeMode(options);
    return;
  }

  // ── One-Shot Mode (positional argument) ───────────────────────────
  if (messageArg) {
    await oneShotMode(messageArg, options, chalk);
    return;
  }

  // ── Interactive Mode (default) ────────────────────────────────────
  await interactiveMode(options, chalk);
}

// ============================================================================
// INTERACTIVE MODE
// ============================================================================

type ChalkInstance = typeof import('chalk').default;

async function interactiveMode(
  options: ChatOptions,
  chalk: ChalkInstance
): Promise<void> {
  const {
    createSession,
    sendMessage,
    getLatestConversation,
  } = await import('../chat/index.js');
  const { isAuthenticated } = await import('../auth/index.js');

  // Check auth
  if (!isAuthenticated()) {
    console.error(
      chalk.red(
        '\n  Not authenticated. Run `myndhyve-cli auth login` first.\n'
      )
    );
    process.exitCode = 1;
    return;
  }

  // Resolve resume session
  let resumeSessionId: string | undefined;
  if (options.resume) {
    if (typeof options.resume === 'string') {
      resumeSessionId = options.resume;
    } else {
      // --resume without value: resume latest
      const latest = getLatestConversation();
      if (latest) {
        resumeSessionId = latest.sessionId;
      } else {
        console.log(chalk.yellow('\n  No previous conversations found.\n'));
      }
    }
  }

  // Create session
  const session = createSession({
    hyveId: options.hyve,
    agentId: options.agent,
    provider: options.provider,
    model: options.model,
    temperature: options.temperature ? parseFloat(options.temperature) : undefined,
    systemPrompt: options.system,
    resumeSessionId,
  });

  // Print header
  const agentLabel = session.hyveId
    ? session.hyveId
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    : 'AI Assistant';

  console.log();
  console.log(chalk.bold.cyan(`  MyndHyve AI Chat — ${agentLabel}`));
  console.log(
    chalk.dim(`  Model: ${session.model} | Provider: ${session.provider}`)
  );
  console.log(chalk.dim('  Type /help for commands, Ctrl+C to exit'));

  // Show resumed context
  if (resumeSessionId && session.messages.length > 0) {
    const userMsgCount = session.messages.filter(
      (m) => m.role === 'user'
    ).length;
    console.log(
      chalk.dim(`  Resumed session with ${userMsgCount} message${userMsgCount === 1 ? '' : 's'}`)
    );
  }

  console.log();

  // Setup readline
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.green('You: '),
    terminal: true,
  });

  rl.prompt();

  rl.on('line', async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const handled = await handleSlashCommand(
        trimmed,
        session,
        chalk,
        rl
      );
      if (handled === 'exit') {
        rl.close();
        return;
      }
      rl.prompt();
      return;
    }

    // Send message with streaming
    console.log();
    process.stdout.write(chalk.bold.blue('AI: '));

    try {
      await sendMessage(session, trimmed, {
        onDelta(delta) {
          process.stdout.write(delta);
        },
      });

      console.log(); // End the streaming line
      console.log();
    } catch (error) {
      console.log(); // End any partial output
      const message =
        error instanceof Error ? error.message : String(error);

      if (message.includes('Rate limit')) {
        console.error(chalk.yellow(`\n  Rate limited. Please wait and try again.\n`));
      } else if (message.includes('Not authenticated')) {
        console.error(
          chalk.red(
            `\n  Session expired. Run \`myndhyve-cli auth login\` to re-authenticate.\n`
          )
        );
      } else {
        console.error(chalk.red(`\n  Error: ${message}\n`));
      }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.dim('\n  Goodbye!\n'));
    // Let the event loop drain naturally instead of process.exit()
    // so pending I/O (e.g., persistSession writes) can complete (#3)
  });
}

// ============================================================================
// ONE-SHOT MODE
// ============================================================================

async function oneShotMode(
  message: string,
  options: ChatOptions,
  chalk: ChalkInstance
): Promise<void> {
  const { createSession, sendMessage, renderMarkdown } = await import(
    '../chat/index.js'
  );
  const ora = (await import('ora')).default;

  const session = createSession({
    hyveId: options.hyve,
    agentId: options.agent,
    provider: options.provider,
    model: options.model,
    temperature: options.temperature
      ? parseFloat(options.temperature)
      : undefined,
    systemPrompt: options.system,
  });

  const spinner = ora({
    text: chalk.dim('Thinking...'),
    stream: process.stderr, // Keep spinner on stderr so stdout has clean output
  }).start();

  let firstDelta = true;

  try {
    const content = await sendMessage(session, message, {
      onDelta(delta) {
        if (firstDelta) {
          spinner.stop();
          firstDelta = false;
        }
        process.stdout.write(delta);
      },
    });

    if (firstDelta) spinner.stop(); // In case no deltas were received
    console.log(); // Final newline

    // If output is a TTY, show formatted markdown below the raw stream
    if (process.stdout.isTTY && hasMarkdownFormatting(content)) {
      console.log();
      const formatted = await renderMarkdown(content);
      console.log(formatted);
    }
  } catch (error) {
    spinner.stop();
    const message =
      error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error: ${message}`));
    process.exitCode = 1;
  }
}

// ============================================================================
// PIPE MODE
// ============================================================================

async function pipeMode(options: ChatOptions): Promise<void> {
  const { createSession, sendMessage } = await import('../chat/index.js');

  // Read stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  input = input.trim();
  if (!input) {
    process.exitCode = 1;
    return;
  }

  const session = createSession({
    hyveId: options.hyve,
    agentId: options.agent,
    provider: options.provider,
    model: options.model,
    temperature: options.temperature
      ? parseFloat(options.temperature)
      : undefined,
    systemPrompt: options.system,
  });

  try {
    const content = await sendMessage(session, input, {
      onDelta(delta) {
        process.stdout.write(delta);
      },
    });

    // Ensure trailing newline for piped output
    if (!content.endsWith('\n')) {
      process.stdout.write('\n');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
}

// ============================================================================
// HISTORY
// ============================================================================

async function showHistory(chalk: ChalkInstance): Promise<void> {
  const { listConversations } = await import('../chat/index.js');
  const { formatTimeSince } = await import('../utils/format.js');

  const conversations = listConversations();

  console.log();
  console.log(chalk.bold.cyan('  MyndHyve — Chat History'));
  console.log();

  if (conversations.length === 0) {
    console.log(chalk.dim('  No conversations yet.'));
    console.log(
      chalk.dim('  Start chatting with `myndhyve-cli chat`')
    );
    console.log();
    return;
  }

  for (const conv of conversations.slice(0, 20)) {
    const ago = formatTimeSince(new Date(conv.updatedAt));
    const hyveLabel = conv.hyveId ? chalk.dim(` [${conv.hyveId}]`) : '';
    const msgCount = chalk.dim(`${conv.messageCount} msgs`);

    console.log(
      `  ${chalk.bold(conv.title)}${hyveLabel}`
    );
    console.log(
      `  ${chalk.dim(conv.sessionId)} · ${msgCount} · ${chalk.dim(ago + ' ago')}`
    );
    console.log();
  }

  console.log(
    chalk.dim(
      `  Resume with: myndhyve-cli chat --resume <sessionId>`
    )
  );
  console.log();
}

// ============================================================================
// SLASH COMMANDS
// ============================================================================

async function handleSlashCommand(
  input: string,
  session: import('../chat/index.js').ChatSession,
  chalk: ChalkInstance,
  _rl: ReturnType<typeof createInterface>
): Promise<'handled' | 'exit'> {
  const [command, ...args] = input.slice(1).split(' ');
  const { persistSession } = await import(
    '../chat/index.js'
  );

  switch (command) {
    case 'help':
      console.log();
      console.log(chalk.bold.cyan('  Chat Commands'));
      console.log();
      console.log(chalk.dim('  /help           ') + 'Show this help');
      console.log(chalk.dim('  /clear          ') + 'Clear conversation history');
      console.log(chalk.dim('  /history        ') + 'Show messages in this session');
      console.log(chalk.dim('  /export         ') + 'Export conversation to markdown');
      console.log(chalk.dim('  /model <name>   ') + 'Switch model');
      console.log(chalk.dim('  /info           ') + 'Show session info');
      console.log(chalk.dim('  /exit           ') + 'Exit chat');
      console.log();
      return 'handled';

    case 'clear':
      session.messages = [];
      console.log(chalk.dim('\n  Conversation cleared.\n'));
      return 'handled';

    case 'history': {
      console.log();
      if (session.messages.length === 0) {
        console.log(chalk.dim('  No messages yet.\n'));
        return 'handled';
      }
      for (const msg of session.messages) {
        if (msg.role === 'user') {
          console.log(chalk.bold.green(`  You: `) + msg.content.split('\n')[0]);
        } else if (msg.role === 'assistant') {
          const preview = msg.content.split('\n')[0].slice(0, 80);
          console.log(chalk.bold.blue(`  AI:  `) + preview + (msg.content.length > 80 ? '...' : ''));
        }
      }
      console.log();
      return 'handled';
    }

    case 'export': {
      const { writeFileSync } = await import('node:fs');
      // Sanitize sessionId to prevent path traversal (#10)
      const safeId = session.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `myndhyve-chat-${safeId}.md`;
      let markdown = `# MyndHyve Chat — ${session.sessionId}\n\n`;
      markdown += `Model: ${session.model} | Provider: ${session.provider}\n\n---\n\n`;

      for (const msg of session.messages) {
        if (msg.role === 'user') {
          markdown += `## You\n\n${msg.content}\n\n`;
        } else if (msg.role === 'assistant') {
          markdown += `## AI\n\n${msg.content}\n\n`;
        }
      }

      writeFileSync(filename, markdown);
      console.log(chalk.green(`\n  Exported to ${filename}\n`));
      return 'handled';
    }

    case 'model': {
      const newModel = args.join(' ').trim();
      if (!newModel) {
        console.log(chalk.dim(`\n  Current model: ${session.model}\n`));
        console.log(chalk.dim('  Usage: /model <name>'));
        console.log(chalk.dim('  Examples: /model gpt-4o, /model claude-sonnet\n'));
      } else {
        session.model = newModel;
        console.log(chalk.dim(`\n  Switched to model: ${chalk.bold(newModel)}\n`));
      }
      return 'handled';
    }

    case 'info':
      console.log();
      console.log(chalk.bold.cyan('  Session Info'));
      console.log(chalk.dim('  Session:  ') + session.sessionId);
      console.log(chalk.dim('  Provider: ') + session.provider);
      console.log(chalk.dim('  Model:    ') + session.model);
      console.log(chalk.dim('  Temp:     ') + session.temperature);
      if (session.hyveId) {
        console.log(chalk.dim('  Hyve:     ') + session.hyveId);
      }
      console.log(chalk.dim('  Messages: ') + session.messages.length);
      console.log();
      return 'handled';

    case 'exit':
    case 'quit':
      persistSession(session);
      return 'exit';

    default:
      console.log(chalk.yellow(`\n  Unknown command: /${command}`));
      console.log(chalk.dim('  Type /help for available commands.\n'));
      return 'handled';
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/** Quick check for markdown formatting in content. */
function hasMarkdownFormatting(text: string): boolean {
  // Multiline flag so ^ matches at line starts, not just string start (#11)
  return /^#{1,4} |```|\*\*|__|\[.*\]\(/m.test(text);
}

// ============================================================================
// REGISTER COMMAND
// ============================================================================

/**
 * Register the `chat` command on the Commander program.
 */
export function registerChatCommand(program: Command): void {
  program
    .command('chat')
    .description('Chat with MyndHyve AI agents')
    .argument('[message]', 'One-shot message (non-interactive)')
    .option('--hyve <id>', 'System hyve ID (app-builder, landing-page, hyve-maker)')
    .option('--agent <name>', 'Agent name (alias for --hyve)')
    .option('--model <id>', 'Model ID or alias (e.g., claude-sonnet, gpt-4o)')
    .option('--provider <name>', 'AI provider (anthropic, openai, gemini, minimax)')
    .option('--temperature <n>', 'Sampling temperature (0-2)')
    .option('--resume [sessionId]', 'Resume a previous conversation')
    .option('--history', 'Show conversation history')
    .option('--pipe', 'Pipe mode: read stdin, write to stdout')
    .option('--system <prompt>', 'Custom system prompt')
    .action(chatCommand);
}
