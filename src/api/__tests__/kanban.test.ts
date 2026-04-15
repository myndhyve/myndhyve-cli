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
          canvasTypeId: 'campaign-studio',
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
      `workspaces/ws-personal-${userId}/kanbanBoards`,
      { pageSize: 50 }
    );
    expect(boards).toHaveLength(2);

    expect(boards[0]).toEqual<BoardSummary>({
      id: 'board-1',
      name: 'Sprint Board',
      canvasTypeId: 'campaign-studio',
      columnCount: 5,
      taskCount: 2,
      createdAt: '2024-06-01T00:00:00Z',
      updatedAt: '2024-06-02T00:00:00Z',
    });

    expect(boards[1].columnCount).toBe(2);
    expect(boards[1].taskCount).toBe(0);
  });

  it('filters by canvasTypeId client-side', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { id: 'board-1', name: 'LP Board', canvasTypeId: 'campaign-studio', columns: [], tasks: {} },
        { id: 'board-2', name: 'App Board', canvasTypeId: 'app-builder', columns: [], tasks: {} },
        { id: 'board-3', name: 'LP Board 2', canvasTypeId: 'campaign-studio', columns: [], tasks: {} },
      ],
    });

    const boards = await listBoards(userId, { canvasTypeId: 'campaign-studio' });

    expect(boards).toHaveLength(2);
    expect(boards[0].id).toBe('board-1');
    expect(boards[1].id).toBe('board-3');
  });

  it('returns empty array when no boards exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const boards = await listBoards(userId);

    expect(boards).toEqual([]);
  });

  it('returns empty array when canvasTypeId filter matches nothing', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        { id: 'board-1', name: 'Board', canvasTypeId: 'app-builder', columns: [], tasks: {} },
      ],
    });

    const boards = await listBoards(userId, { canvasTypeId: 'nonexistent' });

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
      canvasTypeId: 'campaign-studio',
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
      `workspaces/ws-personal-${userId}/kanbanBoards`,
      boardId
    );

    expect(board).not.toBeNull();
    // Summary fields
    expect(board!.id).toBe('board-123');
    expect(board!.name).toBe('Sprint Board');
    expect(board!.canvasTypeId).toBe('campaign-studio');
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
    expect(path).toBe(`workspaces/ws-personal-${userId}/kanbanBoards`);
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

  it('passes canvasTypeId and description when provided', async () => {
    mockCreateDocument.mockImplementation(
      (_path: string, _id: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: boardId, ...data })
    );

    await createBoard(userId, boardId, {
      name: 'LP Tasks',
      canvasTypeId: 'campaign-studio',
      description: 'Tasks for the landing page',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.canvasTypeId).toBe('campaign-studio');
    expect(data.description).toBe('Tasks for the landing page');
  });

  it('sets canvasTypeId to null when not provided', async () => {
    mockCreateDocument.mockImplementation(
      (_path: string, _id: string, data: Record<string, unknown>) =>
        Promise.resolve({ id: boardId, ...data })
    );

    await createBoard(userId, boardId, { name: 'No Canvas Type' });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.canvasTypeId).toBeNull();
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
    expect(path).toBe(`workspaces/ws-personal-${userId}/kanbanBoards`);
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
      `workspaces/ws-personal-${userId}/kanbanBoards`,
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
  const canvasTypeId = 'app-builder';

  function mockBoardWithCanvas() {
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'Task Board',
      canvasTypeId,
      columns: DEFAULT_COLUMNS,
      config: DEFAULT_BOARD_CONFIG,
      swimlanes: [],
      ownerId: userId,
    });
  }

  it('reads tasks from canvases/{canvasTypeId}/tasks subcollection', async () => {
    mockBoardWithCanvas();
    mockListDocuments.mockResolvedValue({
      documents: [
        {
          id: 't-1',
          boardId,
          title: 'First Task',
          status: 'todo',
          priority: 'high',
          kind: 'task',
          assignedTo: 'agent-1',
          labels: ['frontend'],
          dueDate: '2024-07-01T00:00:00Z',
          createdAt: '2024-06-01T00:00:00Z',
        },
        {
          id: 't-2',
          boardId,
          title: 'Second Task',
          status: 'doing',
          priority: 'medium',
          kind: 'feature',
          labels: [],
        },
      ],
    });

    const tasks = await listTasks(userId, boardId);

    // listDocuments should be called against the canvas-tasks subcollection.
    expect(mockListDocuments).toHaveBeenCalledWith(
      `canvases/${canvasTypeId}/tasks`,
      expect.objectContaining({ pageSize: expect.any(Number) }),
    );

    expect(tasks).toHaveLength(2);
    const task1 = tasks.find((t) => t.id === 't-1')!;
    expect(task1).toEqual<TaskSummary>({
      id: 't-1',
      boardId,
      canvasTypeId,
      title: 'First Task',
      status: 'todo',
      priority: 'high',
      kind: 'task',
      assignee: 'agent-1',
      labels: ['frontend'],
      dueDate: '2024-07-01T00:00:00Z',
      createdAt: '2024-06-01T00:00:00Z',
    });

    const task2 = tasks.find((t) => t.id === 't-2')!;
    expect(task2.kind).toBe('feature');
    expect(task2.canvasTypeId).toBe(canvasTypeId);
  });

  it('filters tasks by boardId — sibling boards on the same canvas type are excluded', async () => {
    mockBoardWithCanvas();
    mockListDocuments.mockResolvedValue({
      documents: [
        { id: 't-mine', boardId, title: 'Mine', status: 'todo', priority: 'medium', labels: [] },
        { id: 't-other', boardId: 'some-other-board', title: 'Other', status: 'todo', priority: 'medium', labels: [] },
        { id: 't-no-board', title: 'Unscoped', status: 'todo', priority: 'medium', labels: [] },
      ],
    });

    const tasks = await listTasks(userId, boardId);
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain('t-mine');
    expect(ids).toContain('t-no-board'); // no boardId → kept
    expect(ids).not.toContain('t-other');
  });

  it('filters by status when status option is provided', async () => {
    mockBoardWithCanvas();
    mockListDocuments.mockResolvedValue({
      documents: [
        { id: 't-1', boardId, title: 'Done', status: 'done', priority: 'low', labels: [] },
        { id: 't-2', boardId, title: 'Todo', status: 'todo', priority: 'medium', labels: [] },
        { id: 't-3', boardId, title: 'Done 2', status: 'done', priority: 'high', labels: [] },
      ],
    });

    const doneTasks = await listTasks(userId, boardId, { status: 'done' });
    expect(doneTasks).toHaveLength(2);
    expect(doneTasks.every((t) => t.status === 'done')).toBe(true);
  });

  it('returns empty array when the board does not exist', async () => {
    mockGetDocument.mockResolvedValue(null);
    const tasks = await listTasks(userId, 'nonexistent-board');
    expect(tasks).toEqual([]);
    expect(mockListDocuments).not.toHaveBeenCalled();
  });

  it('returns empty array when the board has no canvasTypeId', async () => {
    mockGetDocument.mockResolvedValue({
      id: boardId,
      name: 'Orphaned',
      columns: DEFAULT_COLUMNS,
      config: DEFAULT_BOARD_CONFIG,
      swimlanes: [],
      ownerId: userId,
    });
    const tasks = await listTasks(userId, boardId);
    expect(tasks).toEqual([]);
    expect(mockListDocuments).not.toHaveBeenCalled();
  });

  it('returns empty array when the canvas-tasks collection is empty', async () => {
    mockBoardWithCanvas();
    mockListDocuments.mockResolvedValue({ documents: [] });
    const tasks = await listTasks(userId, boardId);
    expect(tasks).toEqual([]);
  });

  it('defaults task fields when the doc is sparse', async () => {
    mockBoardWithCanvas();
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 't-sparse', boardId }],
    });

    const tasks = await listTasks(userId, boardId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Untitled');
    expect(tasks[0].status).toBe('backlog');
    expect(tasks[0].priority).toBe('medium');
    expect(tasks[0].labels).toEqual([]);
  });

  it('uses name field as a title fallback', async () => {
    mockBoardWithCanvas();
    mockListDocuments.mockResolvedValue({
      documents: [{ id: 't-named', boardId, name: 'Named Task' }],
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
  const canvasTypeId = 'app-builder';

  function mockBoardWithCanvas() {
    // First getDocument call resolves the board (to find its canvasTypeId);
    // second resolves the task itself.
    mockGetDocument.mockResolvedValueOnce({
      id: boardId,
      name: 'Board',
      canvasTypeId,
      columns: [],
      ownerId: userId,
    });
  }

  it('returns full task detail and reads the new TaskPromptSpec fields', async () => {
    mockBoardWithCanvas();
    mockGetDocument.mockResolvedValueOnce({
      id: 'task-abc',
      boardId,
      title: 'Implement Feature',
      status: 'doing',
      priority: 'high',
      kind: 'feature',
      goal: 'Ship the auth endpoint',
      assignedTo: 'agent-code',
      labels: ['backend', 'api'],
      dueDate: '2024-07-15T00:00:00Z',
      createdAt: '2024-06-10T00:00:00Z',
      description: 'Build the REST endpoint',
      promptText: 'Create a REST API endpoint for user management',
      contextRefs: [
        { type: 'document', id: 'doc-123' },
        { type: 'workflow', id: 'wf-456' },
      ],
      parentTaskId: 'feature-root',
      dependencies: ['task-prep'],
      acceptanceCriteria: ['Returns 200 on valid input', '4xx on auth fail'],
      requiresApproval: true,
      lastExecutionResult: { status: 'running', progress: 50 },
      createdBy: 'user-gettask',
      updatedAt: '2024-06-12T00:00:00Z',
    });

    const task = await getTask(userId, boardId, 'task-abc');

    // Two getDocument calls: one for board, one for task in canvas-tasks subcollection.
    expect(mockGetDocument).toHaveBeenCalledTimes(2);
    expect(mockGetDocument).toHaveBeenLastCalledWith(
      `canvases/${canvasTypeId}/tasks`,
      'task-abc',
    );

    expect(task).not.toBeNull();
    expect(task!.id).toBe('task-abc');
    expect(task!.canvasTypeId).toBe(canvasTypeId);
    expect(task!.boardId).toBe(boardId);
    expect(task!.kind).toBe('feature');
    expect(task!.goal).toBe('Ship the auth endpoint');
    expect(task!.assignee).toBe('agent-code'); // mapped from assignedTo
    expect(task!.prompt).toBe('Create a REST API endpoint for user management'); // mapped from promptText
    expect(task!.parentTaskId).toBe('feature-root');
    expect(task!.dependencies).toEqual(['task-prep']);
    expect(task!.acceptanceCriteria).toEqual([
      'Returns 200 on valid input',
      '4xx on auth fail',
    ]);
    expect(task!.requiresApproval).toBe(true);
    expect(task!.executionResult).toEqual({ status: 'running', progress: 50 }); // from lastExecutionResult
  });

  it('returns null when the board does not exist', async () => {
    mockGetDocument.mockResolvedValueOnce(null);
    const task = await getTask(userId, 'nonexistent-board', 'task-1');
    expect(task).toBeNull();
    // Should NOT proceed to fetch the task doc.
    expect(mockGetDocument).toHaveBeenCalledTimes(1);
  });

  it('returns null when the task does not exist in the canvas-tasks collection', async () => {
    mockBoardWithCanvas();
    mockGetDocument.mockResolvedValueOnce(null);
    const task = await getTask(userId, boardId, 'ghost-task');
    expect(task).toBeNull();
  });

  it('returns null when the board has no canvasTypeId', async () => {
    mockGetDocument.mockResolvedValueOnce({
      id: boardId,
      name: 'Orphan',
      columns: [],
      ownerId: userId,
    });
    const task = await getTask(userId, boardId, 'task-1');
    expect(task).toBeNull();
    expect(mockGetDocument).toHaveBeenCalledTimes(1); // task fetch skipped
  });

  it('maps sparse task data with defaults', async () => {
    mockBoardWithCanvas();
    mockGetDocument.mockResolvedValueOnce({ id: 'task-sparse', boardId });
    const task = await getTask(userId, boardId, 'task-sparse');

    expect(task).not.toBeNull();
    expect(task!.id).toBe('task-sparse');
    expect(task!.canvasTypeId).toBe(canvasTypeId);
    expect(task!.title).toBe('Untitled');
    expect(task!.status).toBe('backlog');
    expect(task!.priority).toBe('medium');
    expect(task!.labels).toEqual([]);
    expect(task!.parentTaskId).toBeUndefined();
    expect(task!.dependencies).toBeUndefined();
    expect(task!.requiresApproval).toBeUndefined();
  });

  it('propagates errors from getDocument', async () => {
    mockGetDocument.mockRejectedValue(new Error('Network error'));
    await expect(getTask(userId, boardId, 'task-1')).rejects.toThrow('Network error');
  });
});
