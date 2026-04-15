/**
 * MyndHyve CLI — Kanban API
 *
 * Operations for kanban boards and tasks via Firestore REST API.
 * Boards are stored at `workspaces/{workspaceId}/kanbanBoards/{boardId}`.
 */

import {
  getDocument,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
} from './firestore.js';
import { createLogger } from '../utils/logger.js';
import { resolveCollectionPath, resolveDocumentPath } from '../utils/workspacePaths.js';

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

/** Task kind — feature is a parent that decomposes into subtasks; task is atomic. */
export type TaskKind = 'task' | 'feature';

/** Kanban task summary. */
export interface TaskSummary {
  id: string;
  boardId?: string;
  canvasTypeId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** 'feature' parents have child tasks via `parentTaskId`. */
  kind?: TaskKind;
  assignee?: string;
  labels: string[];
  dueDate?: string;
  createdAt?: string;
}

/** Full task detail. */
export interface TaskDetail extends TaskSummary {
  /** Human-readable goal — what success looks like. */
  goal?: string;
  description?: string;
  /** The actual prompt text sent to the LLM. */
  prompt?: string;
  contextRefs?: Array<{ type: string; id: string }>;
  /** Parent feature task id when this task was decomposed from a feature. */
  parentTaskId?: string;
  /** Tasks this task depends on. */
  dependencies?: string[];
  /** Acceptance criteria checklist. */
  acceptanceCriteria?: string[];
  /** Whether the task requires human approval before execution. */
  requiresApproval?: boolean;
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
  const path = resolveCollectionPath(userId, 'kanbanBoards');

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
  const path = resolveCollectionPath(userId, 'kanbanBoards');

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
  const path = resolveCollectionPath(userId, 'kanbanBoards');

  log.debug('Creating board', { userId, boardId });

  const now = new Date().toISOString();
  const boardData: Record<string, unknown> = {
    name: data.name,
    canvasTypeId: data.canvasTypeId || null,
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
  const path = resolveCollectionPath(userId, 'kanbanBoards');

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
  const path = resolveCollectionPath(userId, 'kanbanBoards');

  log.debug('Deleting board', { userId, boardId });

  await deleteDocument(path, boardId);
}

// ============================================================================
// TASK API
//
// Tasks live at `canvases/{canvasTypeId}/tasks/{taskId}` (workflow-native
// kanban, post `KanbanBoardConnected` consolidation in the main app). They
// are NOT embedded in board documents — boards are workspace-scoped, tasks
// are canvas-scoped. Each task carries its own `boardId` field for filtering.
// ============================================================================

/** Top-level tasks collection path for a canvas type. */
function getCanvasTasksPath(canvasTypeId: string): string {
  return `canvases/${canvasTypeId}/tasks`;
}

/**
 * List tasks for a board. Resolves the board's `canvasTypeId`, queries the
 * canvas-scoped tasks collection, and filters by `boardId`.
 */
export async function listTasks(
  userId: string,
  boardId: string,
  options?: { status?: TaskStatus }
): Promise<TaskSummary[]> {
  log.debug('Listing tasks', { userId, boardId, options });

  const board = await getBoard(userId, boardId);
  if (!board?.canvasTypeId) {
    log.warn('Board has no canvasTypeId — cannot resolve task collection', { boardId });
    return [];
  }

  const { documents } = await listDocuments(getCanvasTasksPath(board.canvasTypeId), { pageSize: 200 });
  let tasks = documents
    .map((doc) => toTaskSummary(doc, board.canvasTypeId!))
    .filter((t) => t.boardId === boardId || !t.boardId);

  if (options?.status) {
    tasks = tasks.filter((t) => t.status === options.status);
  }

  return tasks;
}

/**
 * Get a task by ID. `boardId` is used to resolve the canvas type — the task
 * itself is fetched directly from the canvas-tasks collection.
 */
export async function getTask(
  userId: string,
  boardId: string,
  taskId: string
): Promise<TaskDetail | null> {
  log.debug('Getting task', { userId, boardId, taskId });

  const board = await getBoard(userId, boardId);
  if (!board?.canvasTypeId) {
    log.warn('Board has no canvasTypeId — cannot resolve task collection', { boardId });
    return null;
  }

  const doc = await getDocument(getCanvasTasksPath(board.canvasTypeId), taskId);
  if (!doc) return null;

  return toTaskDetail(doc, board.canvasTypeId);
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
    canvasTypeId: doc.canvasTypeId as string | undefined,
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
  canvasTypeId: string
): TaskSummary {
  return {
    id: task.id as string,
    boardId: task.boardId as string | undefined,
    canvasTypeId,
    title: (task.title as string) || (task.name as string) || 'Untitled',
    status: (task.status as TaskStatus) || 'backlog',
    priority: (task.priority as TaskPriority) || 'medium',
    kind: task.kind as TaskKind | undefined,
    assignee: (task.assignedTo as string | undefined) ?? (task.assignee as string | undefined),
    labels: (task.labels as string[]) || [],
    dueDate: task.dueDate as string | undefined,
    createdAt: task.createdAt as string | undefined,
  };
}

function toTaskDetail(
  task: Record<string, unknown>,
  canvasTypeId: string
): TaskDetail {
  const summary = toTaskSummary(task, canvasTypeId);
  return {
    ...summary,
    goal: task.goal as string | undefined,
    description: task.description as string | undefined,
    // The main app stores the prompt under `promptText`; legacy docs may use `prompt`.
    prompt: (task.promptText as string | undefined) ?? (task.prompt as string | undefined),
    contextRefs: task.contextRefs as Array<{ type: string; id: string }> | undefined,
    parentTaskId: task.parentTaskId as string | undefined,
    dependencies: task.dependencies as string[] | undefined,
    acceptanceCriteria: task.acceptanceCriteria as string[] | undefined,
    requiresApproval: task.requiresApproval as boolean | undefined,
    executionResult: (task.lastExecutionResult as Record<string, unknown> | undefined) ??
      (task.executionResult as Record<string, unknown> | undefined),
    createdBy: task.createdBy as string | undefined,
    updatedAt: task.updatedAt as string | undefined,
  };
}
