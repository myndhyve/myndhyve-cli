import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock firestore module ───────────────────────────────────────────────────

vi.mock('../firestore.js', () => ({
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  runQuery: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { getDocument, listDocuments, runQuery } from '../firestore.js';
import {
  SYSTEM_HYVES,
  listSystemHyves,
  getSystemHyve,
  isValidSystemHyveId,
  listHyveDocuments,
  getHyveDocument,
} from '../hyves.js';
import type { HyveDocumentSummary, HyveDocumentDetail as _HyveDocumentDetail } from '../hyves.js';

// ── Cast mocks ──────────────────────────────────────────────────────────────

const mockGetDocument = getDocument as ReturnType<typeof vi.fn>;
const mockListDocuments = listDocuments as ReturnType<typeof vi.fn>;
const mockRunQuery = runQuery as ReturnType<typeof vi.fn>;

// ── Reset between tests ─────────────────────────────────────────────────────

beforeEach(() => {
  mockGetDocument.mockReset();
  mockListDocuments.mockReset();
  mockRunQuery.mockReset();
});

// ============================================================================
// SYSTEM HYVE FUNCTIONS (pure data — no mocks needed)
// ============================================================================

describe('listSystemHyves()', () => {
  it('returns only public hyves by default', () => {
    const hyves = listSystemHyves();

    expect(hyves.length).toBeGreaterThan(0);
    for (const hyve of hyves) {
      expect(hyve.visibility).toBe('public');
    }
    // hyve-maker is internal, should not be present
    expect(hyves.find((h) => h.hyveId === 'hyve-maker')).toBeUndefined();
  });

  it('includes internal hyves when includeInternal=true', () => {
    const hyves = listSystemHyves(true);

    expect(hyves.length).toBe(SYSTEM_HYVES.length);
    const hyveMaker = hyves.find((h) => h.hyveId === 'hyve-maker');
    expect(hyveMaker).toBeDefined();
    expect(hyveMaker!.visibility).toBe('internal');
  });

  it('returns a copy, not the original array', () => {
    const hyves1 = listSystemHyves(true);
    const hyves2 = listSystemHyves(true);

    expect(hyves1).not.toBe(hyves2);
    expect(hyves1).toEqual(hyves2);
  });

  it('includes expected public hyves', () => {
    const hyves = listSystemHyves();
    const ids = hyves.map((h) => h.hyveId);

    expect(ids).toContain('app-builder');
    expect(ids).toContain('slides');
    expect(ids).toContain('drawings');
    expect(ids).toContain('landing-page');
    expect(ids).toContain('cad');
  });

  it('each hyve has all required fields', () => {
    const hyves = listSystemHyves(true);

    for (const hyve of hyves) {
      expect(hyve.hyveId).toBeTruthy();
      expect(hyve.name).toBeTruthy();
      expect(hyve.description).toBeTruthy();
      expect(hyve.icon).toBeTruthy();
      expect(hyve.primaryColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(hyve.visibility).toMatch(/^(public|internal)$/);
      expect(Array.isArray(hyve.tags)).toBe(true);
      expect(hyve.tags.length).toBeGreaterThan(0);
    }
  });
});

describe('getSystemHyve()', () => {
  it('returns hyve metadata for valid ID', () => {
    const hyve = getSystemHyve('app-builder');

    expect(hyve).not.toBeNull();
    expect(hyve!.hyveId).toBe('app-builder');
    expect(hyve!.name).toBe('App Builder');
    expect(hyve!.icon).toBe('Layers');
  });

  it('returns null for invalid ID', () => {
    expect(getSystemHyve('nonexistent')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getSystemHyve('')).toBeNull();
  });

  it('returns internal hyves too', () => {
    const hyve = getSystemHyve('hyve-maker');

    expect(hyve).not.toBeNull();
    expect(hyve!.visibility).toBe('internal');
  });

  it('returns correct metadata for each known hyve', () => {
    const expected = [
      { id: 'app-builder', name: 'App Builder' },
      { id: 'slides', name: 'Slides' },
      { id: 'drawings', name: 'Drawings' },
      { id: 'hyve-maker', name: 'Hyve Maker' },
      { id: 'cad', name: 'CAD Designer' },
      { id: 'landing-page', name: 'Landing Page Canvas' },
    ];

    for (const { id, name } of expected) {
      const hyve = getSystemHyve(id);
      expect(hyve).not.toBeNull();
      expect(hyve!.name).toBe(name);
    }
  });
});

describe('isValidSystemHyveId()', () => {
  it('returns true for valid system hyve IDs', () => {
    expect(isValidSystemHyveId('app-builder')).toBe(true);
    expect(isValidSystemHyveId('slides')).toBe(true);
    expect(isValidSystemHyveId('drawings')).toBe(true);
    expect(isValidSystemHyveId('hyve-maker')).toBe(true);
    expect(isValidSystemHyveId('cad')).toBe(true);
    expect(isValidSystemHyveId('landing-page')).toBe(true);
  });

  it('returns false for invalid IDs', () => {
    expect(isValidSystemHyveId('nonexistent')).toBe(false);
    expect(isValidSystemHyveId('')).toBe(false);
    expect(isValidSystemHyveId('App-Builder')).toBe(false); // case-sensitive
    expect(isValidSystemHyveId('APP_BUILDER')).toBe(false);
  });
});

// ============================================================================
// listHyveDocuments()
// ============================================================================

describe('listHyveDocuments()', () => {
  const userId = 'user-abc123';

  it('lists all documents without filters using listDocuments', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        {
          id: 'doc-1',
          hyveId: 'app-builder',
          name: 'My App',
          slug: 'my-app',
          status: 'draft',
          pinned: false,
          tags: ['frontend'],
          createdAt: '2024-01-15T10:00:00Z',
          updatedAt: '2024-01-15T12:00:00Z',
        },
        {
          id: 'doc-2',
          hyveId: 'slides',
          name: 'My Deck',
          slug: 'my-deck',
          status: 'published',
          pinned: true,
          tags: ['marketing'],
        },
      ],
    });

    const results = await listHyveDocuments(userId);

    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockListDocuments).toHaveBeenCalledWith(
      `users/${userId}/hyveDocuments`,
      { pageSize: 100 }
    );
    expect(mockRunQuery).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('doc-1');
    expect(results[1].id).toBe('doc-2');
  });

  it('filters by hyveId using runQuery', async () => {
    mockRunQuery.mockResolvedValue([
      {
        id: 'doc-1',
        hyveId: 'app-builder',
        name: 'My App',
        slug: 'my-app',
        status: 'draft',
        pinned: false,
        tags: [],
      },
    ]);

    const results = await listHyveDocuments(userId, { hyveId: 'app-builder' });

    expect(mockRunQuery).toHaveBeenCalledOnce();
    const [collectionPath, filters, options] = mockRunQuery.mock.calls[0];
    expect(collectionPath).toBe(`users/${userId}/hyveDocuments`);
    expect(filters).toEqual([
      { field: 'hyveId', op: 'EQUAL', value: 'app-builder' },
    ]);
    expect(options).toEqual({ limit: 100 });
    expect(mockListDocuments).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].hyveId).toBe('app-builder');
  });

  it('filters by status using runQuery', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listHyveDocuments(userId, { status: 'published' });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toEqual([
      { field: 'status', op: 'EQUAL', value: 'published' },
    ]);
  });

  it('filters by pinned using runQuery', async () => {
    mockRunQuery.mockResolvedValue([
      {
        id: 'doc-pinned',
        hyveId: 'slides',
        name: 'Pinned Deck',
        slug: 'pinned-deck',
        status: 'draft',
        pinned: true,
        tags: [],
      },
    ]);

    const results = await listHyveDocuments(userId, { pinned: true });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toEqual([
      { field: 'pinned', op: 'EQUAL', value: true },
    ]);
    expect(results[0].pinned).toBe(true);
  });

  it('handles pinned=false filter correctly', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listHyveDocuments(userId, { pinned: false });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toEqual([
      { field: 'pinned', op: 'EQUAL', value: false },
    ]);
  });

  it('combines multiple filters', async () => {
    mockRunQuery.mockResolvedValue([]);

    await listHyveDocuments(userId, {
      hyveId: 'app-builder',
      status: 'draft',
      pinned: true,
    });

    const [, filters] = mockRunQuery.mock.calls[0];
    expect(filters).toHaveLength(3);
    expect(filters).toEqual([
      { field: 'hyveId', op: 'EQUAL', value: 'app-builder' },
      { field: 'status', op: 'EQUAL', value: 'draft' },
      { field: 'pinned', op: 'EQUAL', value: true },
    ]);
  });

  it('returns HyveDocumentSummary[] with correct shape', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        {
          id: 'doc-shape',
          hyveId: 'landing-page',
          name: 'Landing',
          slug: 'landing',
          status: 'published',
          pinned: true,
          tags: ['marketing', 'lead-gen'],
          createdAt: '2024-03-01T00:00:00Z',
          updatedAt: '2024-03-02T00:00:00Z',
          lastOpenedAt: '2024-03-03T00:00:00Z',
        },
      ],
    });

    const [doc] = await listHyveDocuments(userId);

    expect(doc).toEqual<HyveDocumentSummary>({
      id: 'doc-shape',
      hyveId: 'landing-page',
      name: 'Landing',
      slug: 'landing',
      status: 'published',
      pinned: true,
      tags: ['marketing', 'lead-gen'],
      createdAt: '2024-03-01T00:00:00Z',
      updatedAt: '2024-03-02T00:00:00Z',
      lastOpenedAt: '2024-03-03T00:00:00Z',
    });
  });

  it('applies defaults for missing fields in summary', async () => {
    mockListDocuments.mockResolvedValue({
      documents: [
        {
          id: 'doc-sparse',
          // All other fields missing
        },
      ],
    });

    const [doc] = await listHyveDocuments(userId);

    expect(doc.id).toBe('doc-sparse');
    expect(doc.hyveId).toBe('');
    expect(doc.name).toBe('Untitled');
    expect(doc.slug).toBe('');
    expect(doc.status).toBe('draft');
    expect(doc.pinned).toBe(false);
    expect(doc.tags).toEqual([]);
    expect(doc.createdAt).toBeUndefined();
    expect(doc.updatedAt).toBeUndefined();
    expect(doc.lastOpenedAt).toBeUndefined();
  });

  it('returns empty array when no documents exist', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    const results = await listHyveDocuments(userId);

    expect(results).toEqual([]);
  });

  it('returns empty array from query when no matches', async () => {
    mockRunQuery.mockResolvedValue([]);

    const results = await listHyveDocuments(userId, { hyveId: 'nonexistent' });

    expect(results).toEqual([]);
  });

  it('passes empty options object without triggering query', async () => {
    mockListDocuments.mockResolvedValue({ documents: [] });

    await listHyveDocuments(userId, {});

    // No filters set, should use listDocuments
    expect(mockListDocuments).toHaveBeenCalledOnce();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });
});

// ============================================================================
// getHyveDocument()
// ============================================================================

describe('getHyveDocument()', () => {
  const userId = 'user-xyz';
  const documentId = 'doc-123';

  it('returns HyveDocumentDetail for existing document', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'doc-123',
      hyveId: 'app-builder',
      name: 'My App',
      slug: 'my-app',
      status: 'draft',
      pinned: true,
      tags: ['react', 'typescript'],
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T12:00:00Z',
      lastOpenedAt: '2024-01-16T08:00:00Z',
      ownerId: 'user-xyz',
      ownerType: 'user',
      description: 'A test application project',
      visibility: 'private',
      version: 3,
      collaboratorIds: ['user-a', 'user-b'],
      activeWorkflowId: 'wf-456',
      settings: { theme: 'dark', autoSave: true },
    });

    const doc = await getHyveDocument(userId, documentId);

    expect(mockGetDocument).toHaveBeenCalledOnce();
    expect(mockGetDocument).toHaveBeenCalledWith(
      `users/${userId}/hyveDocuments`,
      documentId
    );

    expect(doc).not.toBeNull();
    expect(doc!.id).toBe('doc-123');
    expect(doc!.hyveId).toBe('app-builder');
    expect(doc!.name).toBe('My App');
    expect(doc!.slug).toBe('my-app');
    expect(doc!.status).toBe('draft');
    expect(doc!.pinned).toBe(true);
    expect(doc!.tags).toEqual(['react', 'typescript']);
    expect(doc!.ownerId).toBe('user-xyz');
    expect(doc!.ownerType).toBe('user');
    expect(doc!.description).toBe('A test application project');
    expect(doc!.visibility).toBe('private');
    expect(doc!.version).toBe(3);
    expect(doc!.collaboratorIds).toEqual(['user-a', 'user-b']);
    expect(doc!.activeWorkflowId).toBe('wf-456');
    expect(doc!.settings).toEqual({ theme: 'dark', autoSave: true });
  });

  it('returns null for non-existent document', async () => {
    mockGetDocument.mockResolvedValue(null);

    const doc = await getHyveDocument(userId, 'nonexistent-doc');

    expect(doc).toBeNull();
  });

  it('maps fields correctly with defaults for missing fields', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'doc-minimal',
      // Only id provided, everything else missing
    });

    const doc = await getHyveDocument(userId, 'doc-minimal');

    expect(doc).not.toBeNull();
    // Summary fields — defaults
    expect(doc!.id).toBe('doc-minimal');
    expect(doc!.hyveId).toBe('');
    expect(doc!.name).toBe('Untitled');
    expect(doc!.slug).toBe('');
    expect(doc!.status).toBe('draft');
    expect(doc!.pinned).toBe(false);
    expect(doc!.tags).toEqual([]);
    // Detail fields — defaults
    expect(doc!.ownerId).toBe('');
    expect(doc!.ownerType).toBe('user');
    expect(doc!.description).toBeUndefined();
    expect(doc!.visibility).toBe('private');
    expect(doc!.version).toBe(1);
    expect(doc!.collaboratorIds).toEqual([]);
    expect(doc!.activeWorkflowId).toBeUndefined();
    expect(doc!.settings).toBeUndefined();
  });

  it('detail extends summary (has all summary fields)', async () => {
    mockGetDocument.mockResolvedValue({
      id: 'doc-ext',
      hyveId: 'slides',
      name: 'Presentation',
      slug: 'presentation',
      status: 'published',
      pinned: false,
      tags: ['design'],
      createdAt: '2024-06-01T00:00:00Z',
      updatedAt: '2024-06-02T00:00:00Z',
      lastOpenedAt: '2024-06-03T00:00:00Z',
      ownerId: 'user-xyz',
      ownerType: 'team',
      visibility: 'shared',
      version: 5,
      collaboratorIds: [],
    });

    const doc = await getHyveDocument(userId, 'doc-ext');

    // Verify summary fields are present in the detail result
    expect(doc!.id).toBe('doc-ext');
    expect(doc!.hyveId).toBe('slides');
    expect(doc!.name).toBe('Presentation');
    expect(doc!.slug).toBe('presentation');
    expect(doc!.status).toBe('published');
    expect(doc!.pinned).toBe(false);
    expect(doc!.tags).toEqual(['design']);
    expect(doc!.createdAt).toBe('2024-06-01T00:00:00Z');
    expect(doc!.updatedAt).toBe('2024-06-02T00:00:00Z');
    expect(doc!.lastOpenedAt).toBe('2024-06-03T00:00:00Z');

    // Verify detail-specific fields
    expect(doc!.ownerId).toBe('user-xyz');
    expect(doc!.ownerType).toBe('team');
    expect(doc!.visibility).toBe('shared');
    expect(doc!.version).toBe(5);
    expect(doc!.collaboratorIds).toEqual([]);
  });

  it('propagates errors from getDocument', async () => {
    mockGetDocument.mockRejectedValue(new Error('Network error'));

    await expect(getHyveDocument(userId, documentId)).rejects.toThrow(
      'Network error'
    );
  });
});
