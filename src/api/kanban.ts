/**
 * MyndHyve CLI — Kanban API
 *
 * Operations for kanban boards and tasks via Firestore REST API.
 * Boards are user-scoped at `users/{userId}/kanban/{boardId}`.
 */

import {
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
} from './firestore.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('KanbanAPI');

// ============================================================================
// TYPES
// ============================================================================

/** Task status values (canonical). */
export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'doing'
  | 'review'
  | 'done'
  | 'blocked';

/** Task priority values. */
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

/** Board view mode. */
export type BoardViewMode = 'board' | 'list' | 'timeline';

/** Board column definition. */
export interface BoardColumn {
  id: string;
  name: string;
  color: string;
  order: number;
  wipLimit?: number;
  statusMapping: TaskStatus;
  collapsed?: boolean;
}

/** Board swimlane definition. */
export interface Swimlane {
  id: string;
  name: string;
  color?: string;
  order: number;
  filterType: 'label' | 'agent' | 'priority' | 'kind' | 'custom';
  filterValue: string;
  collapsed?: boolean;
}

/** Board configuration. */
export interface BoardConfig {
  showBacklog: boolean;
  autoArchiveDone: boolean;
  enableSwimlanes: boolean;
  defaultView: BoardViewMode;
  groupBy: string;
}

/** Board summary for list display. */
export interface BoardSummary {
  id: string;
  name: string;
  canvasTypeId?: string;
  columnCount: number;
  taskCount: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Full board detail. */
export interface BoardDetail extends BoardSummary {
  ownerId: string;
  description?: string;
  columns: BoardColumn[];
  swimlanes: Swimlane[];
  config: BoardConfig;
  workflowRunId?: string;
}

/** Kanban task summary. */
export interface TaskSummary {
  id: string;
  boardId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee?: string;
  labels: string[];
  dueDate?: string;
  createdAt?: string;
}

/** Full task detail. */
export interface TaskDetail extends TaskSummary {
  description?: string;
  prompt?: string;
  contextRefs?: Array<{ type: string; id: string }>;
  executionResult?: Record<string, unknown>;
  createdBy?: string;
  updatedAt?: string;
}

// ============================================================================
// BOARD API
// ============================================================================

/**
 * List kanban boards for a user.
 */
export async function listBoards(
  userId: string,
  options?: { canvasTypeId?: string }
): Promise<BoardSummary[]> {
  const path = `users/${userId}/kanban`;

  log.debug('Listing boards', { userId, options });

  const { documents } = await listDocuments(path, { pageSize: 50 });

  let boards = documents.map(toBoardSummary);

  if (options?.canvasTypeId) {
    boards = boards.filter(
      (b) => (b as BoardSummary & { canvasTypeId?: string }).canvasTypeId === options.canvasTypeId
    );
  }

  return boards;
}

/**
 * Get a board by ID.
 */
export async function getBoard(
  userId: string,
  boardId: string
): Promise<BoardDetail | null> {
  const path = `users/${userId}/kanban`;

  log.debug('Getting board', { userId, boardId });

  const doc = await getDocument(path, boardId);
  if (!doc) return null;

  return toBoardDetail(doc);
}

/**
 * Create a new board.
 */
export async function createBoard(
  userId: string,
  boardId: string,
  data: {
    name: string;
    canvasTypeId?: string;
    description?: string;
    columns?: BoardColumn[];
  }
): Promise<BoardDetail> {
  const path = `users/${userId}/kanban`;

  log.debug('Creating board', { userId, boardId });

  const now = new Date().toISOString();
  const boardData: Record<string, unknown> = {
    name: data.name,
    hyveId: data.canvasTypeId || null,
    description: data.description || '',
    ownerId: userId,
    columns: data.columns || DEFAULT_COLUMNS,
    swimlanes: [],
    config: DEFAULT_BOARD_CONFIG,
    tasks: {},
    createdAt: now,
    updatedAt: now,
  };

  const doc = await createDocument(path, boardId, boardData);
  return toBoardDetail(doc);
}

/**
 * Update a board.
 */
export async function updateBoard(
  userId: string,
  boardId: string,
  data: Record<string, unknown>
): Promise<BoardDetail> {
  const path = `users/${userId}/kanban`;

  log.debug('Updating board', { userId, boardId });

  const updateData = { ...data, updatedAt: new Date().toISOString() };
  const doc = await updateDocument(path, boardId, updateData);
  return toBoardDetail(doc);
}

/**
 * Delete a board.
 */
export async function deleteBoard(
  userId: string,
  boardId: string
): Promise<void> {
  const path = `users/${userId}/kanban`;

  log.debug('Deleting board', { userId, boardId });

  await deleteDocument(path, boardId);
}

// ============================================================================
// TASK API (tasks are embedded in board document or subcollection)
// ============================================================================

/**
 * List tasks in a board.
 * Tasks may be stored as a map in the board document or as a subcollection.
 */
export async function listTasks(
  userId: string,
  boardId: string,
  options?: { status?: TaskStatus }
): Promise<TaskSummary[]> {
  log.debug('Listing tasks', { userId, boardId, options });

  // Tasks are stored as a map inside the board document
  const board = await getBoard(userId, boardId);
  if (!board) return [];

  // Get tasks from the raw board document
  const doc = await getDocument(`users/${userId}/kanban`, boardId);
  if (!doc) return [];

  const tasksMap = (doc.tasks || {}) as Record<string, Record<string, unknown>>;
  let tasks = Object.entries(tasksMap).map(([id, task]) =>
    toTaskSummary({ ...task, id }, boardId)
  );

  if (options?.status) {
    tasks = tasks.filter((t) => t.status === options.status);
  }

  return tasks;
}

/**
 * Get a task by ID.
 */
export async function getTask(
  userId: string,
  boardId: string,
  taskId: string
): Promise<TaskDetail | null> {
  log.debug('Getting task', { userId, boardId, taskId });

  const doc = await getDocument(`users/${userId}/kanban`, boardId);
  if (!doc) return null;

  const tasksMap = (doc.tasks || {}) as Record<string, Record<string, unknown>>;
  const task = tasksMap[taskId];
  if (!task) return null;

  return toTaskDetail({ ...task, id: taskId }, boardId);
}

// ============================================================================
// DEFAULTS
// ============================================================================

const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: 'col-backlog', name: 'Backlog', color: '#94a3b8', order: 0, statusMapping: 'backlog' },
  { id: 'col-todo', name: 'To Do', color: '#60a5fa', order: 1, statusMapping: 'todo' },
  { id: 'col-doing', name: 'In Progress', color: '#f59e0b', order: 2, statusMapping: 'doing', wipLimit: 3 },
  { id: 'col-review', name: 'Review', color: '#a78bfa', order: 3, statusMapping: 'review', wipLimit: 2 },
  { id: 'col-done', name: 'Done', color: '#10b981', order: 4, statusMapping: 'done' },
];

const DEFAULT_BOARD_CONFIG: BoardConfig = {
  showBacklog: true,
  autoArchiveDone: false,
  enableSwimlanes: false,
  defaultView: 'board',
  groupBy: 'status',
};

// ============================================================================
// HELPERS
// ============================================================================

function toBoardSummary(doc: Record<string, unknown>): BoardSummary {
  const columns = (doc.columns || []) as unknown[];
  const tasks = doc.tasks as Record<string, unknown> | undefined;

  return {
    id: doc.id as string,
    name: (doc.name as string) || 'Untitled Board',
    canvasTypeId: doc.hyveId as string | undefined,
    columnCount: columns.length,
    taskCount: tasks ? Object.keys(tasks).length : 0,
    createdAt: doc.createdAt as string | undefined,
    updatedAt: doc.updatedAt as string | undefined,
  };
}

function toBoardDetail(doc: Record<string, unknown>): BoardDetail {
  const summary = toBoardSummary(doc);
  const config = (doc.config || {}) as Record<string, unknown>;

  return {
    ...summary,
    ownerId: (doc.ownerId as string) || '',
    description: doc.description as string | undefined,
    columns: (doc.columns as BoardColumn[]) || DEFAULT_COLUMNS,
    swimlanes: (doc.swimlanes as Swimlane[]) || [],
    config: {
      showBacklog: (config.showBacklog as boolean) ?? true,
      autoArchiveDone: (config.autoArchiveDone as boolean) ?? false,
      enableSwimlanes: (config.enableSwimlanes as boolean) ?? false,
      defaultView: (config.defaultView as BoardViewMode) || 'board',
      groupBy: (config.groupBy as string) || 'status',
    },
    workflowRunId: doc.workflowRunId as string | undefined,
  };
}

function toTaskSummary(
  task: Record<string, unknown>,
  boardId: string
): TaskSummary {
  return {
    id: task.id as string,
    boardId,
    title: (task.title as string) || (task.name as string) || 'Untitled',
    status: (task.status as TaskStatus) || 'backlog',
    priority: (task.priority as TaskPriority) || 'medium',
    assignee: task.assignee as string | undefined,
    labels: (task.labels as string[]) || [],
    dueDate: task.dueDate as string | undefined,
    createdAt: task.createdAt as string | undefined,
  };
}

function toTaskDetail(
  task: Record<string, unknown>,
  boardId: string
): TaskDetail {
  const summary = toTaskSummary(task, boardId);
  return {
    ...summary,
    description: task.description as string | undefined,
    prompt: task.prompt as string | undefined,
    contextRefs: task.contextRefs as Array<{ type: string; id: string }> | undefined,
    executionResult: task.executionResult as Record<string, unknown> | undefined,
    createdBy: task.createdBy as string | undefined,
    updatedAt: task.updatedAt as string | undefined,
  };
}
