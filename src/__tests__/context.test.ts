import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock dependencies BEFORE importing context ──────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}));

vi.mock('../config/loader.js', () => ({
  getCliDir: vi.fn(() => '/mock-home/.myndhyve-cli'),
  ensureCliDir: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { getCliDir, ensureCliDir } from '../config/loader.js';
import {
  getActiveContext,
  setActiveContext,
  clearActiveContext,
  hasActiveContext,
} from '../context.js';
import type { ActiveContext } from '../context.js';

// ── Cast mocks ──────────────────────────────────────────────────────────────

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;
const mockUnlinkSync = unlinkSync as ReturnType<typeof vi.fn>;
const mockGetCliDir = getCliDir as ReturnType<typeof vi.fn>;
const mockEnsureCliDir = ensureCliDir as ReturnType<typeof vi.fn>;

// ── Reset between tests ─────────────────────────────────────────────────────

beforeEach(() => {
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockUnlinkSync.mockReset();
  mockGetCliDir.mockReset();
  mockEnsureCliDir.mockReset();

  // Restore default mocks
  mockGetCliDir.mockReturnValue('/mock-home/.myndhyve-cli');
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const CONTEXT_PATH = '/mock-home/.myndhyve-cli/context.json';

const validContext: ActiveContext = {
  projectId: 'proj-123',
  projectName: 'My Project',
  hyveId: 'app-builder',
  hyveName: 'App Builder',
  setAt: '2024-06-15T10:30:00.000Z',
};

// ============================================================================
// getActiveContext()
// ============================================================================

describe('getActiveContext()', () => {
  it('returns null when no context file exists', () => {
    mockExistsSync.mockReturnValue(false);

    const result = getActiveContext();

    expect(result).toBeNull();
    expect(mockExistsSync).toHaveBeenCalledWith(CONTEXT_PATH);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('returns parsed context when file exists with valid data', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(validContext));

    const result = getActiveContext();

    expect(result).not.toBeNull();
    expect(result!.projectId).toBe('proj-123');
    expect(result!.projectName).toBe('My Project');
    expect(result!.hyveId).toBe('app-builder');
    expect(result!.hyveName).toBe('App Builder');
    expect(result!.setAt).toBe('2024-06-15T10:30:00.000Z');
  });

  it('reads from the correct path', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(validContext));

    getActiveContext();

    expect(mockReadFileSync).toHaveBeenCalledWith(CONTEXT_PATH, 'utf-8');
  });

  it('returns context without optional hyveName', () => {
    const contextNoHyveName = {
      projectId: 'proj-456',
      projectName: 'Another Project',
      hyveId: 'slides',
      setAt: '2024-07-01T00:00:00.000Z',
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(contextNoHyveName));

    const result = getActiveContext();

    expect(result).not.toBeNull();
    expect(result!.projectId).toBe('proj-456');
    expect(result!.hyveName).toBeUndefined();
  });

  it('returns null and clears file when context is corrupt JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not valid json {{{');

    const result = getActiveContext();

    expect(result).toBeNull();
    // clearActiveContext should have been called (which calls unlinkSync)
    expect(mockUnlinkSync).toHaveBeenCalledWith(CONTEXT_PATH);
  });

  it('returns null and clears file when context fails Zod validation', () => {
    // Missing required fields (projectId, projectName, hyveId, setAt)
    const invalidContext = {
      projectId: 'proj-123',
      // projectName is missing
      hyveId: 'app-builder',
      setAt: '2024-06-15T10:30:00.000Z',
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(invalidContext));

    const result = getActiveContext();

    expect(result).toBeNull();
    expect(mockUnlinkSync).toHaveBeenCalledWith(CONTEXT_PATH);
  });

  it('returns null and clears when projectId is empty string', () => {
    const emptyProjectId = {
      projectId: '',
      projectName: 'Test',
      hyveId: 'slides',
      setAt: '2024-01-01T00:00:00.000Z',
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(emptyProjectId));

    const result = getActiveContext();

    // Zod .min(1) should reject empty string
    expect(result).toBeNull();
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('returns null and clears when readFileSync throws', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = getActiveContext();

    expect(result).toBeNull();
    expect(mockUnlinkSync).toHaveBeenCalledWith(CONTEXT_PATH);
  });
});

// ============================================================================
// setActiveContext()
// ============================================================================

describe('setActiveContext()', () => {
  it('writes context to disk with correct path and permissions (0o600)', () => {
    const input = {
      projectId: 'proj-new',
      projectName: 'New Project',
      hyveId: 'landing-page',
      hyveName: 'Landing Page Canvas',
    };

    const result = setActiveContext(input);

    expect(mockEnsureCliDir).toHaveBeenCalledOnce();
    expect(mockWriteFileSync).toHaveBeenCalledOnce();

    const [path, content, options] = mockWriteFileSync.mock.calls[0];
    expect(path).toBe(CONTEXT_PATH);
    expect(options).toEqual({ mode: 0o600 });

    // Verify written content is valid JSON with all fields
    const parsed = JSON.parse(content as string);
    expect(parsed.projectId).toBe('proj-new');
    expect(parsed.projectName).toBe('New Project');
    expect(parsed.hyveId).toBe('landing-page');
    expect(parsed.hyveName).toBe('Landing Page Canvas');
    expect(parsed.setAt).toBeTruthy();

    // Verify return value matches written content
    expect(result.projectId).toBe('proj-new');
    expect(result.projectName).toBe('New Project');
    expect(result.hyveId).toBe('landing-page');
    expect(result.hyveName).toBe('Landing Page Canvas');
  });

  it('returns the saved context with setAt timestamp', () => {
    const before = new Date().toISOString();

    const result = setActiveContext({
      projectId: 'proj-time',
      projectName: 'Time Test',
      hyveId: 'app-builder',
    });

    const after = new Date().toISOString();

    expect(result.setAt).toBeTruthy();
    // setAt should be between before and after
    expect(result.setAt >= before).toBe(true);
    expect(result.setAt <= after).toBe(true);
  });

  it('writes pretty-printed JSON (2-space indent)', () => {
    setActiveContext({
      projectId: 'proj-pretty',
      projectName: 'Pretty Print',
      hyveId: 'slides',
    });

    const [, content] = mockWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    // Verify it was formatted with 2-space indent
    expect(content).toBe(JSON.stringify(parsed, null, 2));
  });

  it('works without optional hyveName', () => {
    const result = setActiveContext({
      projectId: 'proj-no-hyve-name',
      projectName: 'No Hyve Name',
      hyveId: 'drawings',
    });

    expect(result.hyveName).toBeUndefined();
    expect(result.projectId).toBe('proj-no-hyve-name');
  });

  it('validates context with Zod before writing (rejects invalid)', () => {
    // Force invalid data to exercise the Zod parse guard.
    // Empty projectId should fail .min(1) validation.
    expect(() => {
      setActiveContext({
        projectId: '',
        projectName: 'Test',
        hyveId: 'app-builder',
      });
    }).toThrow();

    // writeFileSync should NOT have been called
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('validates context with Zod (rejects missing required fields)', () => {
    expect(() => {
      setActiveContext({
        projectId: 'proj-123',
        projectName: '',
        hyveId: 'app-builder',
      });
    }).toThrow();

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('calls ensureCliDir before writing', () => {
    const callOrder: string[] = [];
    mockEnsureCliDir.mockImplementation(() => callOrder.push('ensureCliDir'));
    mockWriteFileSync.mockImplementation(() => callOrder.push('writeFileSync'));

    setActiveContext({
      projectId: 'proj-order',
      projectName: 'Order Test',
      hyveId: 'cad',
    });

    expect(callOrder).toEqual(['ensureCliDir', 'writeFileSync']);
  });
});

// ============================================================================
// clearActiveContext()
// ============================================================================

describe('clearActiveContext()', () => {
  it('deletes the context file if it exists', () => {
    mockExistsSync.mockReturnValue(true);

    clearActiveContext();

    expect(mockExistsSync).toHaveBeenCalledWith(CONTEXT_PATH);
    expect(mockUnlinkSync).toHaveBeenCalledOnce();
    expect(mockUnlinkSync).toHaveBeenCalledWith(CONTEXT_PATH);
  });

  it('does nothing if file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    clearActiveContext();

    expect(mockExistsSync).toHaveBeenCalledWith(CONTEXT_PATH);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});

// ============================================================================
// hasActiveContext()
// ============================================================================

describe('hasActiveContext()', () => {
  it('returns true when valid context exists', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(validContext));

    expect(hasActiveContext()).toBe(true);
  });

  it('returns false when no context file exists', () => {
    mockExistsSync.mockReturnValue(false);

    expect(hasActiveContext()).toBe(false);
  });

  it('returns false when context file exists but is corrupt', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('broken json');

    expect(hasActiveContext()).toBe(false);
  });

  it('returns false when context file exists but fails validation', () => {
    const invalidContext = { projectId: 'p', hyveId: 'h' }; // missing projectName and setAt
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(invalidContext));

    expect(hasActiveContext()).toBe(false);
  });
});
