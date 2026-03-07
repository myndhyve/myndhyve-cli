import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock firestore module ───────────────────────────────────────────────────

vi.mock('../firestore.js', () => ({
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
} from '../firestore.js';
import {
  listBoards,
  getBoard,
  createBoard,
  updateBoard,
  deleteBoard,
  listTasks,
  getTask,
} from '../kanban.js';
import type {
  BoardSummary,
  BoardDetail,
  TaskSummary,
  TaskDetail,
} from '../kanban.js';

// ── Cast mocks ──────────────────────────────────────────────────────────────

const mockGetDocument = getDocument as ReturnType<typeof vi.fn>;
const mockListDocuments = listDocuments as ReturnType<typeof vi.fn>;
const mockCreateDocument = createDocument as ReturnType<typeof vi.fn>;
const mockUpdateDocument = updateDocument as ReturnType<typeof vi.fn>;
const mockDeleteDocument = deleteDocument as ReturnType<typeof vi.fn>;

// ── Reset between tests ─────────────────────────────────────────────────────

beforeEach(() => {
  mockGetDocument.mockReset();
  mockListDocuments.mockReset();
  mockCreateDocument.mockReset();
  mockUpdateDocument.mockReset();
  mockDeleteDocument.mockReset();
});

// ── Test data ────────────────────────────────────────────────────────────────

const DEFAULT_COLUMNS = [
  { id: 'col-backlog', name: 'Backlog', color: '#94a3b8', order: 0, statusMapping: 'backlog' },
  { id: 'col-todo', name: 'To Do', color: '#60a5fa', order: 1, statusMapping: 'todo' },
  { id: 'col-doing', name: 'In Progress', color: '#f59e0b', order: 2, statusMapping: 'doing', wipLimit: 3 },
  { id: 'col-review', name: 'Review', color: '#a78bfa', order: 3, statusMapping: 'review', wipLimit: 2 },
  { id: 'col-done', name: 'Done', color: '#10b981', order: 4, statusMapping: 'done' },
];

const DEFAULT_BOARD_CONFIG = {
  showBacklog: true,
  autoArchiveDone: false,
  enableSwimlanes: false,
  defaultView: 'board',
  groupBy: 'status',
};

// ============================================================================
// listBoards()
// ============================================================================

describe('listBoards()', () => {
  const userId = 'user-abc';

  it('returns board summaries with columnCount and taskCount', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        {
          id: 'board-1',
          name: 'Sprint Board',
          hyveId: 'landing-page',
          columns: DEFAULT_COLUMNS,
          tasks: { t1: { title: 'Task 1' }, t2: { title: 'Task 2' } },
          createdAt: '2024-06-01T00:00:00Z',
          updatedAt: '2024-06-02T00:00:00Z',
        },
        {
          id: 'board-2',
          name: 'Roadmap',
          columns: [{ id: 'c1' }, { id: 'c2' }],
          tasks: {},
        },
      ],
    });

    const boards = await listBoards(userId);

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockListDocuments).toHaveBeenCalledWith(
      `users/${userId}/kanban`,
      { pageSize: 50 }
    );
    expect(boards).toHaveLength(2);

    expect(boards[0]).toEqual<BoardSummary>({
      id: 'board-1',
      name: 'Sprint Board',
      hyveId: 'landing-page',
      columnCount: 5,
      taskCount: 2,
      createdAt: '2024-06-01T00:00:00Z',
      updatedAt: '2024-06-02T00:00:00Z',
    });

    expect(boards[1].columnCount).toBe(2);
    expect(boards[1].taskCount).toBe(0);
  });

  it('filters by hyveId client-side', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { id: 'board-1', name: 'LP Board', hyveId: 'landing-page', columns: [], tasks: {} },
        { id: 'board-2', name: 'App Board', hyveId: 'app-builder', columns: [], tasks: {} },
        { id: 'board-3', name: 'LP Board 2', hyveId: 'landing-page', columns: [], tasks: {} },
      ],
    });

    const boards = await listBoards(userId, { hyveId: 'landing-page' });

    expect(boards).toHaveLength(2);
    expect(boards[0].id).toBe('board-1');
    expect(boards[1].id).toBe('board-3');
  });

  it('returns empty array when no boards exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const boards = await listBoards(userId);

    expect(boards).toEqual([]);
  });

  it('returns empty array when hyveId filter matches nothing', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { id: 'board-1', name: 'Board', hyveId: 'app-builder', columns: [], tasks: {} },
      ],
    });

    const boards = await listBoards(userId, { hyveId: 'nonexistent' });

    expect(boards).toEqual([]);
  });

  it('defaults name to "Untitled Board" when missing', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'board-no-name', columns: [], tasks: {} }],
    });

    const boards = await listBoards(userId);

    expect(boards[0].name).toBe('Untitled Board');
  });

  it('computes taskCount from tasks map keys', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        {
          id: 'board-many',
          name: 'Busy',
          columns: [],
          tasks: { a: {}, b: {}, c: {}, d: {}, e: {} },
        },
      ],
    });

    const boards = await listBoards(userId);

    expect(boards[0].taskCount).toBe(5);
  });

  it('handles board with no tasks field gracefully', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 'board-notasks', name: 'Empty', columns: [] }],
    });

    const boards = await listBoards(userId);

    expect(boards[0].taskCount).toBe(0);
  });
});

// ============================================================================
// getBoard()
// ============================================================================

describe('getBoard()', () => {
  const userId = 'user-xyz';
  const boardId = 'board-123';

  it('returns full board detail for existing board', async () => {
    const swimlanes = [
      { id: 'sw-1', name: 'High Priority', order: 0, filterType: 'priority', filterValue: 'high' },
    ];

    mockGetDocument.mockResolvedValue({
      id: 'board-123',
      name: 'Sprint Board',
      hyveId: 'landing-page',
      ownerId: 'user-xyz',
      description: 'Current sprint tasks',
      columns: DEFAULT_COLUMNS,
      swimlanes,
      config: {
        showBacklog: false,
        autoArchiveDone: true,
        enableSwimlanes: true,
        defaultView: 'list',
        groupBy: 'priority',
      },
      tasks: { t1: {}, t2: {}, t3: {} },
      workflowRunId: 'run-456',
      createdAt: '2024-06-01T00:00:00Z',
      updatedAt: '2024-06-02T00:00:00Z',
    });

    const board = await getBoard(userId, boardId);

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${userId}/kanban`,
      boardId
    );

    expect(board).not.toBeNull();
    // Summary fields
    expect(board!.id).toBe('board-123');
    expect(board!.name).toBe('Sprint Board');
    expect(board!.hyveId).toBe('landing-page');
    expect(board!.columnCount).toBe(5);
    expect(board!.taskCount).toBe(3);
    expect(board!.createdAt).toBe('2024-06-01T00:00:00Z');
    expect(board!.updatedAt).toBe('2024-06-02T00:00:00Z');
    // Detail fields
    expect(board!.ownerId).toBe('user-xyz');
    expect(board!.description).toBe('Current sprint tasks');
    expect(board!.columns).toEqual(DEFAULT_COLUMNS);
    expect(board!.swimlanes).toEqual(swimlanes);
    expect(board!.config).toEqual({
      showBacklog: false,
      autoArchiveDone: true,
      enableSwimlanes: true,
      defaultView: 'list',
      groupBy: 'priority',
    });
    expect(board!.workflowRunId).toBe('run-456');
  });

  it('returns null for non-existent board', async () => {
    mockGetDocument.mockResolvedValue(null);

    const board = await getBoard(userId, 'nonexistent');

    expect(board).toBeNull();
  });

  it('applies default config values when config is empty', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'board-minimal',
      name: 'Minimal',
      columns: [],
      config: {},
      tasks: {},
    });

    const board = await getBoard(userId, 'board-minimal');

    expect(board).not.toBeNull();
    expect(board!.config).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('defaults ownerId to empty string when missing', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'board-no-owner',
      name: 'Orphan',
      columns: [],
      tasks: {},
    });

    const board = await getBoard(userId, 'board-no-owner');

    expect(board!.ownerId).toBe('');
  });

  it('defaults columns to DEFAULT_COLUMNS when missing', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'board-no-cols',
      name: 'No Columns',
      tasks: {},
    });

    const board = await getBoard(userId, 'board-no-cols');

    expect(board!.columns).toEqual(DEFAULT_COLUMNS);
  });

  it('defaults swimlanes to empty array when missing', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'board-no-swim',
      name: 'No Swimlanes',
      columns: [],
      tasks: {},
    });

    const board = await getBoard(userId, 'board-no-swim');

    expect(board!.swimlanes).toEqual([]);
  });
});

// ============================================================================
// createBoard()
// ============================================================================

describe('createBoard()', () => {
  const userId = 'user-creator';
  const boardId = 'board-new';

  it('creates board with DEFAULT_COLUMNS and DEFAULT_BOARD_CONFIG', async () => {
    mockCreateDocument.mockImplementation(
      (_path: string, _id: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: boardId, ...data })
    );

    const board = await createBoard(userId, boardId, { name: 'New Board' });

    expect(mockCreateDocument).toHaveBeenCalledOnce();
    const [path, id, data] = mockCreateDocument.mock.calls[0];
    expect(path).toBe(`users/${userId}/kanban`);
    expect(id).toBe(boardId);

    // Verify defaults
    expect(data.columns).toEqual(DEFAULT_COLUMNS);
    expect(data.config).toEqual(DEFAULT_BOARD_CONFIG);
    expect(data.tasks).toEqual({});
    expect(data.swimlanes).toEqual([]);

    // Verify returned detail
    expect(board.id).toBe(boardId);
    expect(board.name).toBe('New Board');
    expect(board.columns).toEqual(DEFAULT_COLUMNS);
    expect(board.config).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('sets ownerId to userId', async () => {
    mockCreateDocument.mockImplementation(
      (_path: string, _id: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: boardId, ...data })
    );

    const board = await createBoard(userId, boardId, { name: 'Mine' });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.ownerId).toBe(userId);
    expect(board.ownerId).toBe(userId);
  });

  it('sets createdAt and updatedAt timestamps', async () => {
    mockCreateDocument.mockImplementation(
      (_path: string, _id: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: boardId, ...data })
    );

    const before = new Date().toISOString();
    const board = await createBoard(userId, boardId, { name: 'Timestamped' });
    const after = new Date().toISOString();

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.createdAt).toBeDefined();
    expect(data.updatedAt).toBeDefined();
    expect(data.createdAt).toBe(data.updatedAt);
    // Timestamps fall within the test window
    expect(data.createdAt >= before).toBe(true);
    expect(data.createdAt <= after).toBe(true);

    expect(board.createdAt).toBe(data.createdAt);
  });

  it('passes hyveId and description when provided', async () => {
    mockCreateDocument.mockImplementation(
      (_path: string, _id: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: boardId, ...data })
    );

    await createBoard(userId, boardId, {
      name: 'LP Tasks',
      hyveId: 'landing-page',
      description: 'Tasks for the landing page',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.hyveId).toBe('landing-page');
    expect(data.description).toBe('Tasks for the landing page');
  });

  it('sets hyveId to null when not provided', async () => {
    mockCreateDocument.mockImplementation(
      (_path: string, _id: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: boardId, ...data })
    );

    await createBoard(userId, boardId, { name: 'No Hyve' });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.hyveId).toBeNull();
  });

  it('uses custom columns when provided', async () => {
    const customColumns = [
      { id: 'c1', name: 'Open', color: '#fff', order: 0, statusMapping: 'todo' as const },
      { id: 'c2', name: 'Closed', color: '#000', order: 1, statusMapping: 'done' as const },
    ];

    mockCreateDocument.mockImplementation(
      (_path: string, _id: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: boardId, ...data })
    );

    const board = await createBoard(userId, boardId, {
      name: 'Custom',
      columns: customColumns,
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.columns).toEqual(customColumns);
    expect(board.columns).toEqual(customColumns);
  });
});

// ============================================================================
// updateBoard()
// ============================================================================

describe('updateBoard()', () => {
  const userId = 'user-updater';
  const boardId = 'board-upd';

  it('sets updatedAt and passes data to updateDocument', async () => {
    mockUpdateDocument.mockImplementation(
      (_path: string, _id: string, data: Record<string, unknown>) =>
        Promise.resolve({
          id: boardId,
          name: 'Renamed Board',
          columns: DEFAULT_COLUMNS,
          tasks: {},
          config: DEFAULT_BOARD_CONFIG,
          swimlanes: [],
          ownerId: userId,
          ...data,
        })
    );

    const before = new Date().toISOString();
    const board = await updateBoard(userId, boardId, { name: 'Renamed Board' });
    const after = new Date().toISOString();

    expect(mockUpdateDocument).toHaveBeenCalledOnce();
    const [path, id, data] = mockUpdateDocument.mock.calls[0];
    expect(path).toBe(`users/${userId}/kanban`);
    expect(id).toBe(boardId);
    expect(data.name).toBe('Renamed Board');
    expect(data.updatedAt).toBeDefined();
    expect(data.updatedAt >= before).toBe(true);
    expect(data.updatedAt <= after).toBe(true);

    expect(board.name).toBe('Renamed Board');
  });

  it('does not overwrite user-provided fields', async () => {
    mockUpdateDocument.mockImplementation(
      (_path: string, _id: string, data: Record<string, unknown>) =>
        Promise.resolve({
          id: boardId,
          columns: [],
          tasks: {},
          config: DEFAULT_BOARD_CONFIG,
          swimlanes: [],
          ownerId: userId,
          ...data,
        })
    );

    await updateBoard(userId, boardId, {
      description: 'Updated desc',
      config: { showBacklog: false },
    });

    const [, , data] = mockUpdateDocument.mock.calls[0];
    expect(data.description).toBe('Updated desc');
    expect(data.config).toEqual({ showBacklog: false });
  });
});

// ============================================================================
// deleteBoard()
// ============================================================================

describe('deleteBoard()', () => {
  const userId = 'user-deleter';
  const boardId = 'board-del';

  it('calls deleteDocument with correct path and boardId', async () => {
    mockDeleteDocument.mockResolvedValue(undefined);

    await deleteBoard(userId, boardId);

    expect(mockDeleteDocument).toHaveBeenCalledOnce();
    expect(mockDeleteDocument).toHaveBeenCalledWith(
      `users/${userId}/kanban`,
      boardId
    );
  });

  it('propagates errors from deleteDocument', async () => {
    mockDeleteDocument.mockRejectedValue(new Error('Permission denied'));

    await expect(deleteBoard(userId, boardId)).rejects.toThrow(
      'Permission denied'
    );
  });
});

// ============================================================================
// listTasks()
// ============================================================================

describe('listTasks()', () => {
  const userId = 'user-tasks';
  const boardId = 'board-tasks';

  it('extracts tasks from board document tasks map', async () => {
    // getBoard() calls getDocument once, then listTasks calls getDocument again
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'Task Board',
      columns: DEFAULT_COLUMNS,
      config: DEFAULT_BOARD_CONFIG,
      swimlanes: [],
      ownerId: userId,
      tasks: {
        't-1': {
          title: 'First Task',
          status: 'todo',
          priority: 'high',
          assignee: 'agent-1',
          labels: ['frontend'],
          dueDate: '2024-07-01T00:00:00Z',
          createdAt: '2024-06-01T00:00:00Z',
        },
        't-2': {
          title: 'Second Task',
          status: 'doing',
          priority: 'medium',
          labels: [],
        },
      },
    });

    const tasks = await listTasks(userId, boardId);

    expect(tasks).toHaveLength(2);

    const task1 = tasks.find((t) => t.id === 't-1')!;
    expect(task1).toBeDefined();
    expect(task1).toEqual<TaskSummary>({
      id: 't-1',
      boardId,
      title: 'First Task',
      status: 'todo',
      priority: 'high',
      assignee: 'agent-1',
      labels: ['frontend'],
      dueDate: '2024-07-01T00:00:00Z',
      createdAt: '2024-06-01T00:00:00Z',
    });

    const task2 = tasks.find((t) => t.id === 't-2')!;
    expect(task2).toBeDefined();
    expect(task2.boardId).toBe(boardId);
    expect(task2.status).toBe('doing');
    expect(task2.priority).toBe('medium');
  });

  it('filters tasks by status', async () => {
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'Board',
      columns: DEFAULT_COLUMNS,
      config: DEFAULT_BOARD_CONFIG,
      swimlanes: [],
      ownerId: userId,
      tasks: {
        't-1': { title: 'Done Task', status: 'done', priority: 'low', labels: [] },
        't-2': { title: 'Todo Task', status: 'todo', priority: 'medium', labels: [] },
        't-3': { title: 'Another Done', status: 'done', priority: 'high', labels: [] },
        't-4': { title: 'Blocked Task', status: 'blocked', priority: 'critical', labels: [] },
      },
    });

    const doneTasks = await listTasks(userId, boardId, { status: 'done' });

    expect(doneTasks).toHaveLength(2);
    expect(doneTasks.every((t) => t.status === 'done')).toBe(true);
  });

  it('returns empty array when board does not exist', async () => {
    mockGetDocument.mockResolvedValue(null);

    const tasks = await listTasks(userId, 'nonexistent-board');

    expect(tasks).toEqual([]);
  });

  it('returns empty array when board has no tasks', async () => {
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'Empty Board',
      columns: DEFAULT_COLUMNS,
      config: DEFAULT_BOARD_CONFIG,
      swimlanes: [],
      ownerId: userId,
      tasks: {},
    });

    const tasks = await listTasks(userId, boardId);

    expect(tasks).toEqual([]);
  });

  it('returns empty array when tasks field is missing entirely', async () => {
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'No Tasks Field',
      columns: DEFAULT_COLUMNS,
      config: DEFAULT_BOARD_CONFIG,
      swimlanes: [],
      ownerId: userId,
    });

    const tasks = await listTasks(userId, boardId);

    expect(tasks).toEqual([]);
  });

  it('defaults task fields when sparse task data', async () => {
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'Board',
      columns: [],
      config: DEFAULT_BOARD_CONFIG,
      swimlanes: [],
      ownerId: userId,
      tasks: {
        't-sparse': {},
      },
    });

    const tasks = await listTasks(userId, boardId);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Untitled');
    expect(tasks[0].status).toBe('backlog');
    expect(tasks[0].priority).toBe('medium');
    expect(tasks[0].labels).toEqual([]);
  });

  it('uses name field as fallback when title is missing', async () => {
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'Board',
      columns: [],
      config: DEFAULT_BOARD_CONFIG,
      swimlanes: [],
      ownerId: userId,
      tasks: {
        't-named': { name: 'Named Task' },
      },
    });

    const tasks = await listTasks(userId, boardId);

    expect(tasks[0].title).toBe('Named Task');
  });
});

// ============================================================================
// getTask()
// ============================================================================

describe('getTask()', () => {
  const userId = 'user-gettask';
  const boardId = 'board-gt';

  it('returns full task detail for existing task', async () => {
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'Board',
      columns: [],
      tasks: {
        'task-abc': {
          title: 'Implement Feature',
          status: 'doing',
          priority: 'high',
          assignee: 'agent-code',
          labels: ['backend', 'api'],
          dueDate: '2024-07-15T00:00:00Z',
          createdAt: '2024-06-10T00:00:00Z',
          description: 'Build the REST endpoint',
          prompt: 'Create a REST API endpoint for user management',
          contextRefs: [
            { type: 'document', id: 'doc-123' },
            { type: 'workflow', id: 'wf-456' },
          ],
          executionResult: { status: 'running', progress: 50 },
          createdBy: 'user-gettask',
          updatedAt: '2024-06-12T00:00:00Z',
        },
      },
    });

    const task = await getTask(userId, boardId, 'task-abc');

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${userId}/kanban`,
      boardId
    );

    expect(task).not.toBeNull();
    // Summary fields
    expect(task!.id).toBe('task-abc');
    expect(task!.boardId).toBe(boardId);
    expect(task!.title).toBe('Implement Feature');
    expect(task!.status).toBe('doing');
    expect(task!.priority).toBe('high');
    expect(task!.assignee).toBe('agent-code');
    expect(task!.labels).toEqual(['backend', 'api']);
    expect(task!.dueDate).toBe('2024-07-15T00:00:00Z');
    expect(task!.createdAt).toBe('2024-06-10T00:00:00Z');
    // Detail fields
    expect(task!.description).toBe('Build the REST endpoint');
    expect(task!.prompt).toBe('Create a REST API endpoint for user management');
    expect(task!.contextRefs).toEqual([
      { type: 'document', id: 'doc-123' },
      { type: 'workflow', id: 'wf-456' },
    ]);
    expect(task!.executionResult).toEqual({ status: 'running', progress: 50 });
    expect(task!.createdBy).toBe('user-gettask');
    expect(task!.updatedAt).toBe('2024-06-12T00:00:00Z');
  });

  it('returns null when board does not exist', async () => {
    mockGetDocument.mockResolvedValue(null);

    const task = await getTask(userId, 'nonexistent-board', 'task-1');

    expect(task).toBeNull();
  });

  it('returns null when task does not exist in board', async () => {
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'Board',
      columns: [],
      tasks: {
        'task-other': { title: 'Other Task', status: 'todo', priority: 'low', labels: [] },
      },
    });

    const task = await getTask(userId, boardId, 'nonexistent-task');

    expect(task).toBeNull();
  });

  it('returns null when board has no tasks map', async () => {
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'Empty Board',
      columns: [],
    });

    const task = await getTask(userId, boardId, 'task-1');

    expect(task).toBeNull();
  });

  it('maps sparse task data with defaults', async () => {
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'Board',
      columns: [],
      tasks: {
        'task-sparse': {},
      },
    });

    const task = await getTask(userId, boardId, 'task-sparse');

    expect(task).not.toBeNull();
    expect(task!.id).toBe('task-sparse');
    expect(task!.boardId).toBe(boardId);
    expect(task!.title).toBe('Untitled');
    expect(task!.status).toBe('backlog');
    expect(task!.priority).toBe('medium');
    expect(task!.labels).toEqual([]);
    expect(task!.description).toBeUndefined();
    expect(task!.prompt).toBeUndefined();
    expect(task!.contextRefs).toBeUndefined();
    expect(task!.executionResult).toBeUndefined();
    expect(task!.createdBy).toBeUndefined();
    expect(task!.updatedAt).toBeUndefined();
  });

  it('propagates errors from getDocument', async () => {
    mockGetDocument.mockRejectedValue(new Error('Network error'));

    await expect(getTask(userId, boardId, 'task-1')).rejects.toThrow(
      'Network error'
    );
  });
});
