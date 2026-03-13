import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockTruncate,
  mockPrintError,
  mockListBoards,
  mockGetBoard,
  mockCreateBoard,
  mockDeleteBoard,
  mockListTasks,
  mockGetTask,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockTruncate: vi.fn((...args: unknown[]) => args[0]),
  mockPrintError: vi.fn(),
  mockListBoards: vi.fn(),
  mockGetBoard: vi.fn(),
  mockCreateBoard: vi.fn(),
  mockDeleteBoard: vi.fn(),
  mockListTasks: vi.fn(),
  mockGetTask: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  truncate: (...args: unknown[]) => mockTruncate(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/kanban.js', () => ({
  listBoards: (...args: unknown[]) => mockListBoards(...args),
  getBoard: (...args: unknown[]) => mockGetBoard(...args),
  createBoard: (...args: unknown[]) => mockCreateBoard(...args),
  deleteBoard: (...args: unknown[]) => mockDeleteBoard(...args),
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  getTask: (...args: unknown[]) => mockGetTask(...args),
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4, SIGINT: 130 },
  printErrorResult: (...args: unknown[]) => {
    const err = args[0] as { code: string; message: string; suggestion?: string };
    process.stderr.write(`\n  Error: ${err.message}\n`);
    if (err.suggestion) process.stderr.write(`  ${err.suggestion}\n`);
    process.stderr.write('\n');
  },
}));

import { registerKanbanCommands } from '../kanban.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const AUTH_USER = { uid: 'user_abc', email: 'test@test.com' };

const SAMPLE_BOARD_SUMMARY = {
  id: 'board-abc',
  name: 'Sprint Board',
  canvasTypeId: 'landing-page',
  columnCount: 5,
  taskCount: 12,
  createdAt: '2026-02-01T10:00:00Z',
  updatedAt: '2026-03-01T10:00:00Z',
};

const SAMPLE_BOARD_SUMMARY_2 = {
  id: 'board-def',
  name: 'Product Backlog',
  canvasTypeId: undefined,
  columnCount: 3,
  taskCount: 0,
  createdAt: '2026-02-15T10:00:00Z',
  updatedAt: '2026-02-15T10:00:00Z',
};

const SAMPLE_BOARD_DETAIL = {
  id: 'board-abc',
  name: 'Sprint Board',
  canvasTypeId: 'landing-page',
  description: 'Current sprint tasks',
  ownerId: 'user_abc',
  columnCount: 5,
  taskCount: 12,
  columns: [
    { id: 'col-1', name: 'Backlog', color: '#94a3b8', order: 0, statusMapping: 'backlog' },
    { id: 'col-2', name: 'To Do', color: '#60a5fa', order: 1, statusMapping: 'todo' },
    { id: 'col-3', name: 'In Progress', color: '#f59e0b', order: 2, statusMapping: 'doing', wipLimit: 3 },
  ],
  swimlanes: [
    { id: 'lane-1', name: 'Frontend', order: 0, filterType: 'label', filterValue: 'frontend' },
  ],
  config: {
    showBacklog: true,
    autoArchiveDone: false,
    enableSwimlanes: true,
    defaultView: 'board',
    groupBy: 'status',
  },
  workflowRunId: 'run-xyz',
};

const SAMPLE_TASK_SUMMARY = {
  id: 'task-001',
  boardId: 'board-abc',
  title: 'Fix auth bug',
  status: 'doing',
  priority: 'high',
  assignee: 'david',
  labels: ['bug', 'auth'],
  dueDate: '2026-03-10',
  createdAt: '2026-03-01T10:00:00Z',
};

const SAMPLE_TASK_SUMMARY_2 = {
  id: 'task-002',
  boardId: 'board-abc',
  title: 'Add kanban tests',
  status: 'todo',
  priority: 'medium',
  assignee: undefined,
  labels: [],
  createdAt: '2026-03-02T10:00:00Z',
};

const SAMPLE_TASK_DETAIL = {
  ...SAMPLE_TASK_SUMMARY,
  description: 'Token refresh fails after 30 minutes of inactivity',
  prompt: 'Investigate the token refresh flow and fix the timeout',
  contextRefs: [
    { type: 'file', id: 'src/auth/refresh.ts' },
    { type: 'doc', id: 'doc-auth-spec' },
  ],
  createdBy: 'user_abc',
  updatedAt: '2026-03-05T10:00:00Z',
};

const SAMPLE_CREATED_BOARD = {
  id: 'board-new123',
  name: 'New Board',
  canvasTypeId: 'app-builder',
  description: 'A fresh board',
  ownerId: 'user_abc',
  columnCount: 5,
  taskCount: 0,
  columns: [
    { id: 'col-backlog', name: 'Backlog', color: '#94a3b8', order: 0, statusMapping: 'backlog' },
    { id: 'col-todo', name: 'To Do', color: '#60a5fa', order: 1, statusMapping: 'todo' },
    { id: 'col-doing', name: 'In Progress', color: '#f59e0b', order: 2, statusMapping: 'doing', wipLimit: 3 },
    { id: 'col-review', name: 'Review', color: '#a78bfa', order: 3, statusMapping: 'review', wipLimit: 2 },
    { id: 'col-done', name: 'Done', color: '#10b981', order: 4, statusMapping: 'done' },
  ],
  swimlanes: [],
  config: { showBacklog: true, autoArchiveDone: false, enableSwimlanes: false, defaultView: 'board', groupBy: 'status' },
};

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerKanbanCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('registerKanbanCommands', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;
  let stderrWriteSpy: MockInstance;

  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockTruncate.mockReset();
    mockPrintError.mockReset();
    mockListBoards.mockReset();
    mockGetBoard.mockReset();
    mockCreateBoard.mockReset();
    mockDeleteBoard.mockReset();
    mockListTasks.mockReset();
    mockGetTask.mockReset();

    // Default: auth success
    mockRequireAuth.mockReturnValue(AUTH_USER);

    // truncate passthrough
    mockTruncate.mockImplementation((...args: unknown[]) => args[0]);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    process.exitCode = undefined;
  });

  // ==========================================================================
  // COMMAND REGISTRATION
  // ==========================================================================

  describe('command registration', () => {
    it('registers the kanban command group on the program', () => {
      const program = new Command();
      registerKanbanCommands(program);
      const kanban = program.commands.find((c) => c.name() === 'kanban');
      expect(kanban).toBeDefined();
    });

    it('registers all subcommands under kanban', () => {
      const program = new Command();
      registerKanbanCommands(program);
      const kanban = program.commands.find((c) => c.name() === 'kanban')!;
      const subNames = kanban.commands.map((c) => c.name());

      expect(subNames).toContain('boards');
      expect(subNames).toContain('board');
      expect(subNames).toContain('create');
      expect(subNames).toContain('delete');
      expect(subNames).toContain('tasks');
      expect(subNames).toContain('task');
    });
  });

  // ==========================================================================
  // KANBAN BOARDS (list)
  // ==========================================================================

  describe('kanban boards', () => {
    it('shows table with boards including column/task counts', async () => {
      mockListBoards.mockResolvedValue([SAMPLE_BOARD_SUMMARY, SAMPLE_BOARD_SUMMARY_2]);

      await run(['kanban', 'boards']);

      expect(mockListBoards).toHaveBeenCalledWith('user_abc', { canvasTypeId: undefined });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Kanban Boards (2)');
      expect(output).toContain('board-abc');
      expect(output).toContain('Sprint Board');
      expect(output).toContain('board-def');
      expect(output).toContain('Product Backlog');
    });

    it('outputs JSON format', async () => {
      const boards = [SAMPLE_BOARD_SUMMARY];
      mockListBoards.mockResolvedValue(boards);

      await run(['kanban', 'boards', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(boards);
    });

    it('shows helpful hint when no boards exist', async () => {
      mockListBoards.mockResolvedValue([]);

      await run(['kanban', 'boards']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No kanban boards found');
      expect(output).toContain('kanban create --name');
    });

    it('passes --canvas-type filter to API', async () => {
      mockListBoards.mockResolvedValue([]);

      await run(['kanban', 'boards', '--canvas-type', 'landing-page']);

      expect(mockListBoards).toHaveBeenCalledWith('user_abc', { canvasTypeId: 'landing-page' });
    });

    it('calls truncate on board id and name', async () => {
      mockListBoards.mockResolvedValue([SAMPLE_BOARD_SUMMARY]);

      await run(['kanban', 'boards']);

      expect(mockTruncate).toHaveBeenCalledWith('board-abc', 22);
      expect(mockTruncate).toHaveBeenCalledWith('Sprint Board', 22);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['kanban', 'boards']);

      expect(mockListBoards).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockListBoards.mockRejectedValue(new Error('Network error'));

      await run(['kanban', 'boards']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list boards', expect.any(Error));
    });
  });

  // ==========================================================================
  // KANBAN BOARD (detail)
  // ==========================================================================

  describe('kanban board <board-id>', () => {
    it('shows detailed board info with columns, swimlanes, and config', async () => {
      mockGetBoard.mockResolvedValue(SAMPLE_BOARD_DETAIL);

      await run(['kanban', 'board', 'board-abc']);

      expect(mockGetBoard).toHaveBeenCalledWith('user_abc', 'board-abc');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Sprint Board');
      expect(output).toContain('ID:          board-abc');
      expect(output).toContain('Canvas Type: landing-page');
      expect(output).toContain('Description: Current sprint tasks');
      expect(output).toContain('Tasks:       12');
      expect(output).toContain('View:        board');
      // Columns
      expect(output).toContain('Columns:');
      expect(output).toContain('Backlog');
      expect(output).toContain('To Do');
      expect(output).toContain('In Progress');
      expect(output).toContain('(WIP: 3)');
      // Swimlanes
      expect(output).toContain('Swimlanes:');
      expect(output).toContain('Frontend');
      expect(output).toContain('label=frontend');
      // Workflow run
      expect(output).toContain('Workflow Run: run-xyz');
    });

    it('sets NOT_FOUND exitCode when board does not exist', async () => {
      mockGetBoard.mockResolvedValue(null);

      await run(['kanban', 'board', 'nonexistent']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Board "nonexistent" not found');
      expect(process.exitCode).toBe(3); // NOT_FOUND
    });

    it('outputs JSON format', async () => {
      mockGetBoard.mockResolvedValue(SAMPLE_BOARD_DETAIL);

      await run(['kanban', 'board', 'board-abc', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(SAMPLE_BOARD_DETAIL);
    });

    it('omits optional fields when absent', async () => {
      const boardNoOptionals = {
        ...SAMPLE_BOARD_DETAIL,
        canvasTypeId: undefined,
        description: undefined,
        swimlanes: [],
        workflowRunId: undefined,
      };
      mockGetBoard.mockResolvedValue(boardNoOptionals);

      await run(['kanban', 'board', 'board-abc']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Canvas Type:');
      expect(output).not.toContain('Description:');
      expect(output).not.toContain('Swimlanes:');
      expect(output).not.toContain('Workflow Run:');
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['kanban', 'board', 'board-abc']);

      expect(mockGetBoard).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockGetBoard.mockRejectedValue(new Error('Timeout'));

      await run(['kanban', 'board', 'board-abc']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get board', expect.any(Error));
    });
  });

  // ==========================================================================
  // KANBAN CREATE
  // ==========================================================================

  describe('kanban create', () => {
    it('calls createBoard with correct args and shows result', async () => {
      mockCreateBoard.mockResolvedValue(SAMPLE_CREATED_BOARD);

      await run(['kanban', 'create', '--name', 'New Board', '--canvas-type', 'app-builder', '--description', 'A fresh board']);

      expect(mockCreateBoard).toHaveBeenCalledWith(
        'user_abc',
        expect.stringMatching(/^board-/),
        {
          name: 'New Board',
          canvasTypeId: 'app-builder',
          description: 'A fresh board',
        }
      );
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Board created');
      expect(output).toContain('New Board');
    });

    it('outputs JSON format', async () => {
      mockCreateBoard.mockResolvedValue(SAMPLE_CREATED_BOARD);

      await run(['kanban', 'create', '--name', 'New Board', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(SAMPLE_CREATED_BOARD);
    });

    it('shows column names in table output', async () => {
      mockCreateBoard.mockResolvedValue(SAMPLE_CREATED_BOARD);

      await run(['kanban', 'create', '--name', 'New Board']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Columns:');
      expect(output).toContain('Backlog');
      expect(output).toContain('To Do');
      expect(output).toContain('In Progress');
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['kanban', 'create', '--name', 'New Board']);

      expect(mockCreateBoard).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockCreateBoard.mockRejectedValue(new Error('Quota exceeded'));

      await run(['kanban', 'create', '--name', 'New Board']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to create board', expect.any(Error));
    });
  });

  // ==========================================================================
  // KANBAN DELETE
  // ==========================================================================

  describe('kanban delete', () => {
    it('requires --force and sets USAGE_ERROR exitCode without it', async () => {
      await run(['kanban', 'delete', 'board-abc']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('--force');
      expect(output).toContain('board-abc');
      expect(process.exitCode).toBe(2); // USAGE_ERROR
      expect(mockDeleteBoard).not.toHaveBeenCalled();
    });

    it('calls deleteBoard with --force and shows confirmation', async () => {
      mockDeleteBoard.mockResolvedValue(undefined);

      await run(['kanban', 'delete', 'board-abc', '--force']);

      expect(mockDeleteBoard).toHaveBeenCalledWith('user_abc', 'board-abc');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('board-abc');
      expect(output).toContain('deleted');
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['kanban', 'delete', 'board-abc', '--force']);

      expect(mockDeleteBoard).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockDeleteBoard.mockRejectedValue(new Error('Permission denied'));

      await run(['kanban', 'delete', 'board-abc', '--force']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to delete board', expect.any(Error));
    });
  });

  // ==========================================================================
  // KANBAN TASKS (list)
  // ==========================================================================

  describe('kanban tasks <board-id>', () => {
    it('shows tasks table with status, priority, assignee', async () => {
      mockListTasks.mockResolvedValue([SAMPLE_TASK_SUMMARY, SAMPLE_TASK_SUMMARY_2]);

      await run(['kanban', 'tasks', 'board-abc']);

      expect(mockListTasks).toHaveBeenCalledWith('user_abc', 'board-abc', { status: undefined });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Tasks (2)');
      expect(output).toContain('task-001');
      expect(output).toContain('Fix auth bug');
      expect(output).toContain('task-002');
      expect(output).toContain('Add kanban tests');
    });

    it('outputs JSON format', async () => {
      const tasks = [SAMPLE_TASK_SUMMARY];
      mockListTasks.mockResolvedValue(tasks);

      await run(['kanban', 'tasks', 'board-abc', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(tasks);
    });

    it('shows message when no tasks exist', async () => {
      mockListTasks.mockResolvedValue([]);

      await run(['kanban', 'tasks', 'board-abc']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No tasks in board "board-abc"');
    });

    it('passes --status filter to API', async () => {
      mockListTasks.mockResolvedValue([]);

      await run(['kanban', 'tasks', 'board-abc', '--status', 'doing']);

      expect(mockListTasks).toHaveBeenCalledWith('user_abc', 'board-abc', { status: 'doing' });
    });

    it('calls truncate on task id and title', async () => {
      mockListTasks.mockResolvedValue([SAMPLE_TASK_SUMMARY]);

      await run(['kanban', 'tasks', 'board-abc']);

      expect(mockTruncate).toHaveBeenCalledWith('task-001', 20);
      expect(mockTruncate).toHaveBeenCalledWith('Fix auth bug', 28);
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['kanban', 'tasks', 'board-abc']);

      expect(mockListTasks).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockListTasks.mockRejectedValue(new Error('Connection refused'));

      await run(['kanban', 'tasks', 'board-abc']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list tasks', expect.any(Error));
    });
  });

  // ==========================================================================
  // KANBAN TASK (detail)
  // ==========================================================================

  describe('kanban task <board-id> <task-id>', () => {
    it('shows all task fields when present', async () => {
      mockGetTask.mockResolvedValue(SAMPLE_TASK_DETAIL);

      await run(['kanban', 'task', 'board-abc', 'task-001']);

      expect(mockGetTask).toHaveBeenCalledWith('user_abc', 'board-abc', 'task-001');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Fix auth bug');
      expect(output).toContain('ID:         task-001');
      expect(output).toContain('Board:      board-abc');
      expect(output).toContain('Priority:   high');
      expect(output).toContain('Assignee:   david');
      expect(output).toContain('Labels:     bug, auth');
      expect(output).toContain('Due:        2026-03-10');
      expect(output).toContain('Description:');
      expect(output).toContain('Prompt:');
      // Context refs
      expect(output).toContain('Context:');
      expect(output).toContain('file: src/auth/refresh.ts');
      expect(output).toContain('doc: doc-auth-spec');
    });

    it('sets NOT_FOUND exitCode when task does not exist', async () => {
      mockGetTask.mockResolvedValue(null);

      await run(['kanban', 'task', 'board-abc', 'nonexistent']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Task "nonexistent" not found');
      expect(output).toContain('board "board-abc"');
      expect(process.exitCode).toBe(3); // NOT_FOUND
    });

    it('outputs JSON format', async () => {
      mockGetTask.mockResolvedValue(SAMPLE_TASK_DETAIL);

      await run(['kanban', 'task', 'board-abc', 'task-001', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(SAMPLE_TASK_DETAIL);
    });

    it('shows dash for empty assignee and labels', async () => {
      const taskMinimal = {
        ...SAMPLE_TASK_DETAIL,
        assignee: undefined,
        labels: [],
        dueDate: undefined,
        description: undefined,
        prompt: undefined,
        contextRefs: undefined,
      };
      mockGetTask.mockResolvedValue(taskMinimal);

      await run(['kanban', 'task', 'board-abc', 'task-001']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Assignee:   -');
      expect(output).toContain('Labels:     -');
      expect(output).not.toContain('Due:');
      expect(output).not.toContain('Description:');
      expect(output).not.toContain('Prompt:');
      expect(output).not.toContain('Context:');
    });

    it('calls truncate on description and prompt', async () => {
      mockGetTask.mockResolvedValue(SAMPLE_TASK_DETAIL);

      await run(['kanban', 'task', 'board-abc', 'task-001']);

      expect(mockTruncate).toHaveBeenCalledWith(
        'Token refresh fails after 30 minutes of inactivity',
        60
      );
      expect(mockTruncate).toHaveBeenCalledWith(
        'Investigate the token refresh flow and fix the timeout',
        60
      );
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['kanban', 'task', 'board-abc', 'task-001']);

      expect(mockGetTask).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockGetTask.mockRejectedValue(new Error('Firestore unavailable'));

      await run(['kanban', 'task', 'board-abc', 'task-001']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get task', expect.any(Error));
    });
  });
});
