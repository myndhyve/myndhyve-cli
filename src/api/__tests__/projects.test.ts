import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock firestore module ───────────────────────────────────────────────────

vi.mock('../firestore.js', () => ({
  getDocument: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  updateDocument: vi.fn(),
  runQuery: vi.fn(),
}));

// ── Mock logger ─────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Import module under test (after mocks) ──────────────────────────────────

import {
  listProjects,
  getProject,
  createProject,
  deleteProjectById,
  updateProject,
} from '../projects.js';

import {
  getDocument,
  createDocument,
  deleteDocument,
  updateDocument,
  runQuery,
} from '../firestore.js';

const mockGetDocument = getDocument as ReturnType<typeof vi.fn>;
const mockCreateDocument = createDocument as ReturnType<typeof vi.fn>;
const mockDeleteDocument = deleteDocument as ReturnType<typeof vi.fn>;
const mockUpdateDocument = updateDocument as ReturnType<typeof vi.fn>;
const mockRunQuery = runQuery as ReturnType<typeof vi.fn>;

// ── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetDocument.mockReset();
  mockCreateDocument.mockReset();
  mockDeleteDocument.mockReset();
  mockUpdateDocument.mockReset();
  mockRunQuery.mockReset();
});

// ── Test data fixtures ──────────────────────────────────────────────────────

const USER_ID = 'user_abc123';

/** Returns a raw Firestore-like document as returned by the firestore module. */
function makeRawProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'proj_test123_abc456',
    name: 'My Test Project',
    slug: 'my-test-project',
    hyveId: 'app-builder',
    ownerId: USER_ID,
    ownerType: 'user',
    type: 'general',
    status: 'draft',
    description: 'A test project',
    tags: ['test', 'demo'],
    collaboratorIds: [],
    settings: {
      collaborationEnabled: false,
      versionHistoryEnabled: true,
      autoSaveInterval: 30000,
    },
    metadata: {
      createdBy: USER_ID,
      createdAt: '2025-01-15T10:00:00.000Z',
      updatedAt: '2025-01-15T12:00:00.000Z',
      visibility: 'private',
      documentCount: 0,
      workflowCount: 0,
      artifactCount: 0,
    },
    ...overrides,
  };
}

// ============================================================================
// listProjects
// ============================================================================

describe('listProjects', () => {
  it('calls runQuery with ownerId filter', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listProjects(USER_ID);

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [collection, filters, options] = mockRunQuery.mock.calls[0];
    expect(collection).toBe('projects');
    expect(filters).toEqual([
      { field: 'ownerId', op: 'EQUAL', value: USER_ID },
    ]);
    expect(options).toEqual({
      orderBy: 'metadata.updatedAt',
      orderDirection: 'DESCENDING',
      limit: 100,
    });
  });

  it('adds hyveId filter when option provided', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listProjects(USER_ID, { hyveId: 'app-builder' });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toEqual([
      { field: 'ownerId', op: 'EQUAL', value: USER_ID },
      { field: 'hyveId', op: 'EQUAL', value: 'app-builder' },
    ]);
  });

  it('adds status filter when option provided', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listProjects(USER_ID, { status: 'active' });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toEqual([
      { field: 'ownerId', op: 'EQUAL', value: USER_ID },
      { field: 'status', op: 'EQUAL', value: 'active' },
    ]);
  });

  it('combines hyveId and status filters', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listProjects(USER_ID, { hyveId: 'landing-page', status: 'draft' });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toHaveLength(3);
    expect(filters[0]).toEqual({ field: 'ownerId', op: 'EQUAL', value: USER_ID });
    expect(filters[1]).toEqual({ field: 'hyveId', op: 'EQUAL', value: 'landing-page' });
    expect(filters[2]).toEqual({ field: 'status', op: 'EQUAL', value: 'draft' });
  });

  it('returns ProjectSummary[] with correct shape', async () => {
    const rawDocs = [
      makeRawProject({ id: 'proj_1', name: 'First Project' }),
      makeRawProject({ id: 'proj_2', name: 'Second Project', status: 'active' }),
    ];
    mockRunQuery.mockResolvedValue(rawDocs);

    const results = await listProjects(USER_ID);

    expect(results).toHaveLength(2);

    // Verify first result shape
    expect(results[0]).toEqual({
      id: 'proj_1',
      name: 'First Project',
      slug: 'my-test-project',
      hyveId: 'app-builder',
      status: 'draft',
      type: 'general',
      description: 'A test project',
      tags: ['test', 'demo'],
      createdAt: '2025-01-15T10:00:00.000Z',
      updatedAt: '2025-01-15T12:00:00.000Z',
    });

    // Verify second result
    expect(results[1].id).toBe('proj_2');
    expect(results[1].name).toBe('Second Project');
    expect(results[1].status).toBe('active');
  });

  it('returns summary without detail-only fields (ownerId, settings, etc.)', async () => {
    mockRunQuery.mockResolvedValue([makeRawProject()]);

    const results = await listProjects(USER_ID);

    const summary = results[0];
    // Summary should NOT contain detail-only fields
    expect(summary).not.toHaveProperty('ownerId');
    expect(summary).not.toHaveProperty('ownerType');
    expect(summary).not.toHaveProperty('collaboratorIds');
    expect(summary).not.toHaveProperty('settings');
    expect(summary).not.toHaveProperty('metadata');
    expect(summary).not.toHaveProperty('thumbnailUrl');
    expect(summary).not.toHaveProperty('color');
    expect(summary).not.toHaveProperty('icon');
    expect(summary).not.toHaveProperty('archived');
  });

  it('handles empty results', async () => {
    mockRunQuery.mockResolvedValue([]);

    const results = await listProjects(USER_ID);

    expect(results).toEqual([]);
    expect(results).toHaveLength(0);
  });

  it('extracts createdAt and updatedAt from metadata', async () => {
    const raw = makeRawProject({
      metadata: {
        createdAt: '2025-03-01T08:00:00.000Z',
        updatedAt: '2025-03-15T16:30:00.000Z',
      },
    });
    mockRunQuery.mockResolvedValue([raw]);

    const results = await listProjects(USER_ID);

    expect(results[0].createdAt).toBe('2025-03-01T08:00:00.000Z');
    expect(results[0].updatedAt).toBe('2025-03-15T16:30:00.000Z');
  });
});

// ============================================================================
// getProject
// ============================================================================

describe('getProject', () => {
  it('returns ProjectDetail for existing project', async () => {
    const raw = makeRawProject();
    mockGetDocument.mockResolvedValue(raw);

    const result = await getProject('proj_test123_abc456');

    expect(mockGetDocument).toHaveBeenCalledWith('projects', 'proj_test123_abc456');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('proj_test123_abc456');
    expect(result!.name).toBe('My Test Project');
  });

  it('returns null for non-existent project', async () => {
    mockGetDocument.mockResolvedValue(null);

    const result = await getProject('proj_nonexistent');

    expect(result).toBeNull();
  });

  it('maps Firestore fields to ProjectDetail correctly', async () => {
    const raw = makeRawProject({
      thumbnailUrl: 'https://example.com/thumb.png',
      color: '#FF5500',
      icon: 'rocket',
      archived: true,
    });
    mockGetDocument.mockResolvedValue(raw);

    const result = await getProject('proj_test123_abc456');

    expect(result).toEqual({
      // Summary fields
      id: 'proj_test123_abc456',
      name: 'My Test Project',
      slug: 'my-test-project',
      hyveId: 'app-builder',
      status: 'draft',
      type: 'general',
      description: 'A test project',
      tags: ['test', 'demo'],
      createdAt: '2025-01-15T10:00:00.000Z',
      updatedAt: '2025-01-15T12:00:00.000Z',
      // Detail-only fields
      ownerId: USER_ID,
      ownerType: 'user',
      collaboratorIds: [],
      settings: {
        collaborationEnabled: false,
        versionHistoryEnabled: true,
        autoSaveInterval: 30000,
      },
      metadata: {
        createdBy: USER_ID,
        createdAt: '2025-01-15T10:00:00.000Z',
        updatedAt: '2025-01-15T12:00:00.000Z',
        visibility: 'private',
        documentCount: 0,
        workflowCount: 0,
        artifactCount: 0,
      },
      thumbnailUrl: 'https://example.com/thumb.png',
      color: '#FF5500',
      icon: 'rocket',
      archived: true,
    });
  });

  it('applies defaults for missing optional fields', async () => {
    // Minimal document with no optional fields
    const raw: Record<string, unknown> = {
      id: 'proj_minimal',
    };
    mockGetDocument.mockResolvedValue(raw);

    const result = await getProject('proj_minimal');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('Untitled');
    expect(result!.slug).toBe('');
    expect(result!.hyveId).toBe('');
    expect(result!.status).toBe('draft');
    expect(result!.type).toBe('general');
    expect(result!.ownerId).toBe('');
    expect(result!.ownerType).toBe('user');
    expect(result!.collaboratorIds).toEqual([]);
    expect(result!.settings).toEqual({});
    expect(result!.metadata).toEqual({});
    expect(result!.thumbnailUrl).toBeUndefined();
    expect(result!.color).toBeUndefined();
    expect(result!.icon).toBeUndefined();
    expect(result!.archived).toBeUndefined();
  });
});

// ============================================================================
// createProject
// ============================================================================

describe('createProject', () => {
  beforeEach(() => {
    // Mock createDocument to return whatever data it receives (+ id)
    mockCreateDocument.mockImplementation(
      async (_collection: string, docId: string, data: Record<string, unknown>) => ({
        ...data,
        id: docId,
      })
    );
  });

  it('creates project with correct fields', async () => {
    const result = await createProject(USER_ID, {
      name: 'My New App',
      hyveId: 'app-builder',
    });

    expect(mockCreateDocument).toHaveBeenCalledOnce();
    const [collection, _projectId, data] = mockCreateDocument.mock.calls[0];

    expect(collection).toBe('projects');
    expect(data.name).toBe('My New App');
    expect(data.hyveId).toBe('app-builder');
    expect(data.ownerId).toBe(USER_ID);
    expect(data.ownerType).toBe('user');
    expect(data.status).toBe('draft');
    expect(data.collaborators).toEqual({});
    expect(data.collaboratorIds).toEqual([]);

    // Result is a ProjectDetail
    expect(result.name).toBe('My New App');
    expect(result.hyveId).toBe('app-builder');
    expect(result.ownerId).toBe(USER_ID);
  });

  it('generates project ID with proj_ prefix', async () => {
    await createProject(USER_ID, {
      name: 'Test',
      hyveId: 'landing-page',
    });

    const [, projectId] = mockCreateDocument.mock.calls[0];
    expect(projectId).toMatch(/^proj_[a-z0-9]+_[a-z0-9]+$/);
  });

  it('generates slug from name', async () => {
    await createProject(USER_ID, {
      name: 'My Awesome Landing Page',
      hyveId: 'landing-page',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.slug).toBe('my-awesome-landing-page');
  });

  it('applies default settings', async () => {
    await createProject(USER_ID, {
      name: 'Settings Test',
      hyveId: 'app-builder',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.settings).toEqual({
      collaborationEnabled: false,
      versionHistoryEnabled: true,
      autoSaveInterval: 30000,
    });
  });

  it('applies default metadata with timestamps and counts', async () => {
    await createProject(USER_ID, {
      name: 'Metadata Test',
      hyveId: 'app-builder',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    const metadata = data.metadata as Record<string, unknown>;

    expect(metadata.createdBy).toBe(USER_ID);
    expect(metadata.visibility).toBe('private');
    expect(metadata.documentCount).toBe(0);
    expect(metadata.workflowCount).toBe(0);
    expect(metadata.artifactCount).toBe(0);

    // Timestamps should be ISO strings
    expect(typeof metadata.createdAt).toBe('string');
    expect(typeof metadata.updatedAt).toBe('string');
    // createdAt and updatedAt should be the same on creation
    expect(metadata.createdAt).toBe(metadata.updatedAt);
  });

  it('uses default type "general" when not specified', async () => {
    await createProject(USER_ID, {
      name: 'No Type',
      hyveId: 'app-builder',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.type).toBe('general');
  });

  it('uses custom type when specified', async () => {
    await createProject(USER_ID, {
      name: 'Custom Type',
      hyveId: 'app-builder',
      type: 'website',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.type).toBe('website');
  });

  it('sets description to empty string when not provided', async () => {
    await createProject(USER_ID, {
      name: 'No Desc',
      hyveId: 'app-builder',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.description).toBe('');
  });

  it('includes description when provided', async () => {
    await createProject(USER_ID, {
      name: 'With Desc',
      hyveId: 'app-builder',
      description: 'A detailed description of this project',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.description).toBe('A detailed description of this project');
  });

  it('sets tags to empty array when not provided', async () => {
    await createProject(USER_ID, {
      name: 'No Tags',
      hyveId: 'app-builder',
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.tags).toEqual([]);
  });

  it('includes tags when provided', async () => {
    await createProject(USER_ID, {
      name: 'With Tags',
      hyveId: 'app-builder',
      tags: ['marketing', 'saas', 'landing-page'],
    });

    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.tags).toEqual(['marketing', 'saas', 'landing-page']);
  });

  it('returns a valid ProjectDetail', async () => {
    const result = await createProject(USER_ID, {
      name: 'Return Value Test',
      hyveId: 'app-builder',
      description: 'Testing return',
      tags: ['test'],
    });

    // ProjectDetail shape
    expect(result.id).toMatch(/^proj_/);
    expect(result.name).toBe('Return Value Test');
    expect(result.slug).toBe('return-value-test');
    expect(result.hyveId).toBe('app-builder');
    expect(result.ownerId).toBe(USER_ID);
    expect(result.status).toBe('draft');
    expect(result.description).toBe('Testing return');
    expect(result.tags).toEqual(['test']);
    expect(result.collaboratorIds).toEqual([]);
    expect(result.settings).toBeDefined();
    expect(result.metadata).toBeDefined();
  });
});

// ============================================================================
// deleteProjectById
// ============================================================================

describe('deleteProjectById', () => {
  it('calls deleteDocument with correct collection and id', async () => {
    mockDeleteDocument.mockResolvedValue(undefined);

    await deleteProjectById('proj_to_delete');

    expect(mockDeleteDocument).toHaveBeenCalledOnce();
    expect(mockDeleteDocument).toHaveBeenCalledWith('projects', 'proj_to_delete');
  });

  it('propagates errors from deleteDocument', async () => {
    mockDeleteDocument.mockRejectedValue(new Error('Permission denied'));

    await expect(deleteProjectById('proj_forbidden')).rejects.toThrow('Permission denied');
  });
});

// ============================================================================
// updateProject
// ============================================================================

describe('updateProject', () => {
  beforeEach(() => {
    // Mock updateDocument to return a merged result
    mockUpdateDocument.mockImplementation(
      async (_collection: string, docId: string, data: Record<string, unknown>) => ({
        ...makeRawProject({ id: docId }),
        ...data,
      })
    );
  });

  it('updates name field with updateMask', async () => {
    await updateProject('proj_123', { name: 'Updated Name' });

    expect(mockUpdateDocument).toHaveBeenCalledOnce();
    const [collection, docId, data, fieldPaths] = mockUpdateDocument.mock.calls[0];

    expect(collection).toBe('projects');
    expect(docId).toBe('proj_123');
    expect(data.name).toBe('Updated Name');
    expect(fieldPaths).toContain('name');
  });

  it('updates description field', async () => {
    await updateProject('proj_123', { description: 'New description' });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(data.description).toBe('New description');
    expect(fieldPaths).toContain('description');
  });

  it('updates status field', async () => {
    await updateProject('proj_123', { status: 'active' });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(data.status).toBe('active');
    expect(fieldPaths).toContain('status');
  });

  it('updates tags field', async () => {
    await updateProject('proj_123', { tags: ['new-tag', 'another'] });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(data.tags).toEqual(['new-tag', 'another']);
    expect(fieldPaths).toContain('tags');
  });

  it('always updates metadata.updatedAt timestamp', async () => {
    await updateProject('proj_123', { name: 'Test' });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(data['metadata.updatedAt']).toBeDefined();
    expect(typeof data['metadata.updatedAt']).toBe('string');
    expect(fieldPaths).toContain('metadata.updatedAt');
  });

  it('handles partial update (name only)', async () => {
    await updateProject('proj_123', { name: 'Only Name' });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(fieldPaths).toEqual(['name', 'metadata.updatedAt']);
    expect(data.name).toBe('Only Name');
    expect(data.description).toBeUndefined();
    expect(data.status).toBeUndefined();
    expect(data.tags).toBeUndefined();
  });

  it('handles partial update (status only)', async () => {
    await updateProject('proj_123', { status: 'archived' });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(fieldPaths).toEqual(['status', 'metadata.updatedAt']);
    expect(data.status).toBe('archived');
    expect(data.name).toBeUndefined();
  });

  it('handles multiple fields at once', async () => {
    await updateProject('proj_123', {
      name: 'Updated',
      description: 'New desc',
      status: 'active',
      tags: ['a', 'b'],
    });

    const [, , data, fieldPaths] = mockUpdateDocument.mock.calls[0];
    expect(fieldPaths).toEqual([
      'name',
      'description',
      'status',
      'tags',
      'metadata.updatedAt',
    ]);
    expect(data.name).toBe('Updated');
    expect(data.description).toBe('New desc');
    expect(data.status).toBe('active');
    expect(data.tags).toEqual(['a', 'b']);
  });

  it('returns ProjectDetail from updateDocument result', async () => {
    const result = await updateProject('proj_123', { name: 'Updated' });

    expect(result).toBeDefined();
    expect(result.id).toBe('proj_123');
    expect(result.name).toBeDefined();
    // Should have full detail shape
    expect(result).toHaveProperty('ownerId');
    expect(result).toHaveProperty('settings');
    expect(result).toHaveProperty('metadata');
  });

  it('metadata.updatedAt is a valid ISO timestamp', async () => {
    await updateProject('proj_123', { name: 'Timestamp Test' });

    const [, , data] = mockUpdateDocument.mock.calls[0];
    const timestamp = data['metadata.updatedAt'] as string;

    // Should parse as a valid date
    const parsed = new Date(timestamp);
    expect(parsed.getTime()).not.toBeNaN();
    // Should be recent (within the last 5 seconds)
    expect(Date.now() - parsed.getTime()).toBeLessThan(5000);
  });
});

// ============================================================================
// Helper functions: toSlug
// ============================================================================

describe('toSlug (tested via createProject)', () => {
  beforeEach(() => {
    mockCreateDocument.mockImplementation(
      async (_collection: string, docId: string, data: Record<string, unknown>) => ({
        ...data,
        id: docId,
      })
    );
  });

  it('converts name to lowercase', async () => {
    await createProject(USER_ID, { name: 'UPPERCASE', hyveId: 'test' });
    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.slug).toBe('uppercase');
  });

  it('replaces spaces with hyphens', async () => {
    await createProject(USER_ID, { name: 'hello world', hyveId: 'test' });
    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.slug).toBe('hello-world');
  });

  it('replaces special characters with hyphens', async () => {
    await createProject(USER_ID, { name: 'Hello, World! (2025)', hyveId: 'test' });
    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.slug).toBe('hello-world-2025');
  });

  it('removes leading and trailing hyphens', async () => {
    await createProject(USER_ID, { name: '---test---', hyveId: 'test' });
    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.slug).toBe('test');
  });

  it('collapses consecutive special chars into single hyphen', async () => {
    await createProject(USER_ID, { name: 'hello   ///   world', hyveId: 'test' });
    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.slug).toBe('hello-world');
  });

  it('truncates slug to 60 characters', async () => {
    const longName = 'a'.repeat(100);
    await createProject(USER_ID, { name: longName, hyveId: 'test' });
    const [, , data] = mockCreateDocument.mock.calls[0];
    expect((data.slug as string).length).toBeLessThanOrEqual(60);
  });

  it('handles names with only special characters', async () => {
    await createProject(USER_ID, { name: '!!!@@@###', hyveId: 'test' });
    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.slug).toBe('');
  });

  it('preserves numbers in slug', async () => {
    await createProject(USER_ID, { name: 'Version 2 Release 3', hyveId: 'test' });
    const [, , data] = mockCreateDocument.mock.calls[0];
    expect(data.slug).toBe('version-2-release-3');
  });
});

// ============================================================================
// Helper functions: toProjectSummary (tested via listProjects)
// ============================================================================

describe('toProjectSummary (tested via listProjects)', () => {
  it('handles missing name (defaults to "Untitled")', async () => {
    mockRunQuery.mockResolvedValue([{ id: 'proj_1' }]);

    const results = await listProjects(USER_ID);

    expect(results[0].name).toBe('Untitled');
  });

  it('handles missing slug (defaults to empty string)', async () => {
    mockRunQuery.mockResolvedValue([{ id: 'proj_1', name: 'Test' }]);

    const results = await listProjects(USER_ID);

    expect(results[0].slug).toBe('');
  });

  it('handles missing hyveId (defaults to empty string)', async () => {
    mockRunQuery.mockResolvedValue([{ id: 'proj_1', name: 'Test' }]);

    const results = await listProjects(USER_ID);

    expect(results[0].hyveId).toBe('');
  });

  it('handles missing status (defaults to "draft")', async () => {
    mockRunQuery.mockResolvedValue([{ id: 'proj_1', name: 'Test' }]);

    const results = await listProjects(USER_ID);

    expect(results[0].status).toBe('draft');
  });

  it('handles missing type (defaults to "general")', async () => {
    mockRunQuery.mockResolvedValue([{ id: 'proj_1', name: 'Test' }]);

    const results = await listProjects(USER_ID);

    expect(results[0].type).toBe('general');
  });

  it('handles missing metadata (timestamps undefined)', async () => {
    mockRunQuery.mockResolvedValue([{ id: 'proj_1', name: 'Test' }]);

    const results = await listProjects(USER_ID);

    expect(results[0].createdAt).toBeUndefined();
    expect(results[0].updatedAt).toBeUndefined();
  });

  it('handles null metadata (timestamps undefined)', async () => {
    mockRunQuery.mockResolvedValue([{ id: 'proj_1', name: 'Test', metadata: null }]);

    const results = await listProjects(USER_ID);

    expect(results[0].createdAt).toBeUndefined();
    expect(results[0].updatedAt).toBeUndefined();
  });

  it('passes through description and tags as optional', async () => {
    mockRunQuery.mockResolvedValue([
      { id: 'proj_1', name: 'No extras' },
    ]);

    const results = await listProjects(USER_ID);

    expect(results[0].description).toBeUndefined();
    expect(results[0].tags).toBeUndefined();
  });
});

// ============================================================================
// Helper functions: toProjectDetail (tested via getProject)
// ============================================================================

describe('toProjectDetail (tested via getProject)', () => {
  it('handles missing collaboratorIds (defaults to empty array)', async () => {
    mockGetDocument.mockResolvedValue({ id: 'proj_1', name: 'Test' });

    const result = await getProject('proj_1');

    expect(result!.collaboratorIds).toEqual([]);
  });

  it('handles missing settings (defaults to empty object)', async () => {
    mockGetDocument.mockResolvedValue({ id: 'proj_1', name: 'Test' });

    const result = await getProject('proj_1');

    expect(result!.settings).toEqual({});
  });

  it('handles missing metadata (defaults to empty object)', async () => {
    mockGetDocument.mockResolvedValue({ id: 'proj_1', name: 'Test' });

    const result = await getProject('proj_1');

    expect(result!.metadata).toEqual({});
  });

  it('handles optional fields being undefined', async () => {
    mockGetDocument.mockResolvedValue({ id: 'proj_1', name: 'Test' });

    const result = await getProject('proj_1');

    expect(result!.thumbnailUrl).toBeUndefined();
    expect(result!.color).toBeUndefined();
    expect(result!.icon).toBeUndefined();
    expect(result!.archived).toBeUndefined();
  });

  it('includes summary fields in detail', async () => {
    const raw = makeRawProject();
    mockGetDocument.mockResolvedValue(raw);

    const result = await getProject('proj_test123_abc456');

    // Summary fields should be present in detail
    expect(result!.id).toBeDefined();
    expect(result!.name).toBeDefined();
    expect(result!.slug).toBeDefined();
    expect(result!.hyveId).toBeDefined();
    expect(result!.status).toBeDefined();
    expect(result!.type).toBeDefined();
  });

  it('preserves existing optional values', async () => {
    const raw = makeRawProject({
      thumbnailUrl: 'https://cdn.example.com/image.jpg',
      color: '#00FF00',
      icon: 'star',
      archived: false,
    });
    mockGetDocument.mockResolvedValue(raw);

    const result = await getProject('proj_test123_abc456');

    expect(result!.thumbnailUrl).toBe('https://cdn.example.com/image.jpg');
    expect(result!.color).toBe('#00FF00');
    expect(result!.icon).toBe('star');
    expect(result!.archived).toBe(false);
  });
});
