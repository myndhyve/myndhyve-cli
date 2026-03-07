/**
 * MyndHyve CLI — Kanban Commands
 *
 * Commander subcommand group for kanban board management:
 *   myndhyve-cli kanban boards [--hyve=<hyveId>]
 *   myndhyve-cli kanban board <board-id>
 *   myndhyve-cli kanban create --name="..."
 *   myndhyve-cli kanban tasks <board-id> [--status=<status>]
 *   myndhyve-cli kanban task <board-id> <task-id>
 */

import type { Command } from 'commander';
import {
  listBoards,
  getBoard,
  createBoard,
  deleteBoard,
  listTasks,
  getTask,
} from '../api/kanban.js';
import { requireAuth, truncate, printError } from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';

// ============================================================================
// REGISTER
// ============================================================================

export function registerKanbanCommands(program: Command): void {
  const kanban = program
    .command('kanban')
    .description('Manage kanban boards and tasks');

  // ── List Boards ───────────────────────────────────────────────────────

  kanban
    .command('boards')
    .description('List kanban boards')
    .option('--hyve <hyveId>', 'Filter by hyve ID')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const boards = await listBoards(auth.uid, {
          hyveId: opts.hyve,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(boards, null, 2));
          return;
        }

        if (boards.length === 0) {
          console.log('\n  No kanban boards found.');
          console.log('  Create one: myndhyve-cli kanban create --name="My Board"');
          console.log('');
          return;
        }

        console.log(`\n  Kanban Boards (${boards.length})\n`);
        console.log(
          '  ' +
            'ID'.padEnd(24) +
            'Name'.padEnd(24) +
            'Columns'.padEnd(10) +
            'Tasks'.padEnd(10) +
            'Hyve'
        );
        console.log('  ' + '\u2500'.repeat(80));

        for (const board of boards) {
          console.log(
            '  ' +
              truncate(board.id, 22).padEnd(24) +
              truncate(board.name, 22).padEnd(24) +
              String(board.columnCount).padEnd(10) +
              String(board.taskCount).padEnd(10) +
              (board.hyveId || '-')
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list boards', error);
      }
    });

  // ── Board Info ────────────────────────────────────────────────────────

  kanban
    .command('board <board-id>')
    .description('Show detailed board information')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (boardId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const board = await getBoard(auth.uid, boardId);

        if (!board) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Board "${boardId}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(board, null, 2));
          return;
        }

        console.log(`\n  ${board.name}`);
        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  ID:          ${board.id}`);
        if (board.hyveId) console.log(`  Hyve:        ${board.hyveId}`);
        if (board.description) console.log(`  Description: ${board.description}`);
        console.log(`  Tasks:       ${board.taskCount}`);
        console.log(`  View:        ${board.config.defaultView}`);

        console.log('\n  Columns:');
        for (const col of board.columns) {
          const wipStr = col.wipLimit ? ` (WIP: ${col.wipLimit})` : '';
          console.log(`    ${col.name.padEnd(16)} \u2192 ${col.statusMapping}${wipStr}`);
        }

        if (board.swimlanes.length > 0) {
          console.log('\n  Swimlanes:');
          for (const lane of board.swimlanes) {
            console.log(`    ${lane.name.padEnd(16)} ${lane.filterType}=${lane.filterValue}`);
          }
        }

        if (board.workflowRunId) {
          console.log(`\n  Workflow Run: ${board.workflowRunId}`);
        }

        console.log('');
      } catch (error) {
        printError('Failed to get board', error);
      }
    });

  // ── Create Board ──────────────────────────────────────────────────────

  kanban
    .command('create')
    .description('Create a new kanban board')
    .requiredOption('--name <name>', 'Board name')
    .option('--hyve <hyveId>', 'Associate with a hyve')
    .option('--description <desc>', 'Board description')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const boardId = `board-${Date.now().toString(36)}`;
        const board = await createBoard(auth.uid, boardId, {
          name: opts.name,
          hyveId: opts.hyve,
          description: opts.description,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(board, null, 2));
          return;
        }

        console.log(`\n  Board created:`);
        console.log(`  ID:      ${board.id}`);
        console.log(`  Name:    ${board.name}`);
        console.log(`  Columns: ${board.columns.map((c) => c.name).join(', ')}`);
        console.log('');
      } catch (error) {
        printError('Failed to create board', error);
      }
    });

  // ── Delete Board ──────────────────────────────────────────────────────

  kanban
    .command('delete <board-id>')
    .description('Delete a kanban board')
    .option('--force', 'Skip confirmation')
    .action(async (boardId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!opts.force) {
        printErrorResult({
          code: 'CONFIRMATION_REQUIRED',
          message: `Use --force to confirm deletion of board "${boardId}".`,
        });
        process.exitCode = ExitCode.USAGE_ERROR;
        return;
      }

      try {
        await deleteBoard(auth.uid, boardId);
        console.log(`\n  Board "${boardId}" deleted.`);
        console.log('');
      } catch (error) {
        printError('Failed to delete board', error);
      }
    });

  // ── List Tasks ────────────────────────────────────────────────────────

  kanban
    .command('tasks <board-id>')
    .description('List tasks in a kanban board')
    .option('--status <status>', 'Filter by status (backlog, todo, doing, review, done, blocked)')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (boardId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const tasks = await listTasks(auth.uid, boardId, {
          status: opts.status,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(tasks, null, 2));
          return;
        }

        if (tasks.length === 0) {
          console.log(`\n  No tasks in board "${boardId}".`);
          console.log('');
          return;
        }

        console.log(`\n  Tasks (${tasks.length})\n`);
        console.log(
          '  ' +
            'ID'.padEnd(22) +
            'Title'.padEnd(30) +
            'Status'.padEnd(12) +
            'Priority'.padEnd(12) +
            'Assignee'
        );
        console.log('  ' + '\u2500'.repeat(90));

        for (const task of tasks) {
          console.log(
            '  ' +
              truncate(task.id, 20).padEnd(22) +
              truncate(task.title, 28).padEnd(30) +
              formatStatus(task.status).padEnd(12) +
              task.priority.padEnd(12) +
              (task.assignee || '-')
          );
        }

        console.log('');
      } catch (error) {
        printError('Failed to list tasks', error);
      }
    });

  // ── Task Info ─────────────────────────────────────────────────────────

  kanban
    .command('task <board-id> <task-id>')
    .description('Show detailed task information')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (boardId: string, taskId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const task = await getTask(auth.uid, boardId, taskId);

        if (!task) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Task "${taskId}" not found in board "${boardId}".`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(task, null, 2));
          return;
        }

        console.log(`\n  ${task.title}`);
        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  ID:         ${task.id}`);
        console.log(`  Board:      ${task.boardId}`);
        console.log(`  Status:     ${formatStatus(task.status)}`);
        console.log(`  Priority:   ${task.priority}`);
        console.log(`  Assignee:   ${task.assignee || '-'}`);
        console.log(`  Labels:     ${task.labels.length > 0 ? task.labels.join(', ') : '-'}`);
        if (task.dueDate) console.log(`  Due:        ${task.dueDate}`);
        if (task.description) console.log(`  Description: ${truncate(task.description, 60)}`);
        if (task.prompt) console.log(`  Prompt:     ${truncate(task.prompt, 60)}`);

        if (task.contextRefs?.length) {
          console.log('  Context:');
          for (const ref of task.contextRefs) {
            console.log(`    ${ref.type}: ${ref.id}`);
          }
        }

        console.log('');
      } catch (error) {
        printError('Failed to get task', error);
      }
    });
}

// ============================================================================
// HELPERS
// ============================================================================

function formatStatus(status: string): string {
  const icons: Record<string, string> = {
    'backlog': '\u25cb backlog',
    'todo': '\u25a1 todo',
    'doing': '\u25cf doing',
    'review': '\u2691 review',
    'done': '\u2713 done',
    'blocked': '\u2717 blocked',
  };
  return icons[status] || status;
}
