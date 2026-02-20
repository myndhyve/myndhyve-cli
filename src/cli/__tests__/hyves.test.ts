import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockTruncate,
  mockPrintError,
  mockListSystemHyves,
  mockGetSystemHyve,
  mockListHyveDocuments,
  mockGetProject,
  mockGetActiveContext,
  mockSetActiveContext,
  mockClearActiveContext,
  mockGetAuthStatus,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockTruncate: vi.fn(),
  mockPrintError: vi.fn(),
  mockListSystemHyves: vi.fn(),
  mockGetSystemHyve: vi.fn(),
  mockListHyveDocuments: vi.fn(),
  mockGetProject: vi.fn(),
  mockGetActiveContext: vi.fn(),
  mockSetActiveContext: vi.fn(),
  mockClearActiveContext: vi.fn(),
  mockGetAuthStatus: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  truncate: (...args: unknown[]) => mockTruncate(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/hyves.js', () => ({
  listSystemHyves: (...args: unknown[]) => mockListSystemHyves(...args),
  getSystemHyve: (...args: unknown[]) => mockGetSystemHyve(...args),
  listHyveDocuments: (...args: unknown[]) => mockListHyveDocuments(...args),
}));

vi.mock('../../api/projects.js', () => ({
  getProject: (...args: unknown[]) => mockGetProject(...args),
}));

vi.mock('../../context.js', () => ({
  getActiveContext: (...args: unknown[]) => mockGetActiveContext(...args),
  setActiveContext: (...args: unknown[]) => mockSetActiveContext(...args),
  clearActiveContext: (...args: unknown[]) => mockClearActiveContext(...args),
}));

vi.mock('../../auth/index.js', () => ({
  getAuthStatus: (...args: unknown[]) => mockGetAuthStatus(...args),
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

import { registerHyveCommands, registerContextCommands } from '../hyves.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const AUTH_USER = { uid: 'user_abc', email: 'test@test.com' };

const SAMPLE_HYVE = {
  hyveId: 'app-builder',
  name: 'App Builder',
  description: 'Build applications',
  icon: '\u{1F3D7}\uFE0F',
  visibility: 'public',
  primaryColor: '#4285F4',
  tags: ['apps', 'development'],
};

const SAMPLE_HYVE_2 = {
  hyveId: 'landing-page',
  name: 'Landing Page',
  description: 'Create landing pages',
  icon: '\u{1F680}',
  visibility: 'public',
  primaryColor: '#34A853',
  tags: ['marketing', 'web'],
};

const SAMPLE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  hyveId: 'app-builder',
  ownerId: 'user_abc',
  type: 'general',
  status: 'in_progress',
  description: 'A test project',
  tags: ['test'],
  collaboratorIds: ['user_abc'],
  metadata: { documentCount: 5, workflowCount: 2, artifactCount: 1, visibility: 'private' },
  updatedAt: '2025-01-15T10:00:00Z',
};

const SAMPLE_DOC = {
  id: 'doc-1',
  name: 'My Document',
  hyveId: 'app-builder',
  status: 'active',
  pinned: false,
};

const SAMPLE_DOC_PINNED = {
  id: 'doc-2',
  name: 'Important Doc',
  hyveId: 'landing-page',
  status: 'active',
  pinned: true,
};

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerHyveCommands(program);
  registerContextCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('registerHyveCommands & registerContextCommands', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;
  let stderrWriteSpy: MockInstance;

  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockTruncate.mockReset();
    mockPrintError.mockReset();
    mockListSystemHyves.mockReset();
    mockGetSystemHyve.mockReset();
    mockListHyveDocuments.mockReset();
    mockGetProject.mockReset();
    mockGetActiveContext.mockReset();
    mockSetActiveContext.mockReset();
    mockClearActiveContext.mockReset();
    mockGetAuthStatus.mockReset();

    // Default: auth success
    mockRequireAuth.mockReturnValue(AUTH_USER);

    // truncate passthrough
    mockTruncate.mockImplementation((s: string) => s);

    // getAuthStatus default
    mockGetAuthStatus.mockReturnValue({
      authenticated: true,
      email: 'test@test.com',
      uid: 'user_abc',
      source: 'credentials',
      expired: false,
    });

    // getActiveContext default: no active project
    mockGetActiveContext.mockReturnValue(null);

    // listSystemHyves default
    mockListSystemHyves.mockReturnValue([SAMPLE_HYVE, SAMPLE_HYVE_2]);

    // getSystemHyve default
    mockGetSystemHyve.mockImplementation((hyveId: string) => {
      if (hyveId === 'app-builder') return SAMPLE_HYVE;
      if (hyveId === 'landing-page') return SAMPLE_HYVE_2;
      return null;
    });

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
    it('registers the hyves command group on the program', () => {
      const program = new Command();
      registerHyveCommands(program);
      const hyves = program.commands.find((c) => c.name() === 'hyves');
      expect(hyves).toBeDefined();
    });

    it('registers all subcommands under hyves', () => {
      const program = new Command();
      registerHyveCommands(program);
      const hyves = program.commands.find((c) => c.name() === 'hyves')!;
      const subNames = hyves.commands.map((c) => c.name());

      expect(subNames).toContain('list');
      expect(subNames).toContain('info');
      expect(subNames).toContain('docs');
    });

    it('registers use, unuse, and whoami as top-level commands', () => {
      const program = new Command();
      registerContextCommands(program);
      const names = program.commands.map((c) => c.name());

      expect(names).toContain('use');
      expect(names).toContain('unuse');
      expect(names).toContain('whoami');
    });
  });

  // ==========================================================================
  // HYVES LIST
  // ==========================================================================

  describe('hyves list', () => {
    it('shows table with hyves', () => {
      run(['hyves', 'list']);

      expect(mockListSystemHyves).toHaveBeenCalledWith(undefined);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('System Hyves (2)');
      expect(output).toContain('app-builder');
      expect(output).toContain('App Builder');
      expect(output).toContain('landing-page');
    });

    it('outputs JSON format', () => {
      run(['hyves', 'list', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual([SAMPLE_HYVE, SAMPLE_HYVE_2]);
    });

    it('passes --all flag to listSystemHyves', () => {
      run(['hyves', 'list', '--all']);

      expect(mockListSystemHyves).toHaveBeenCalledWith(true);
    });

    it('calls truncate on description', () => {
      run(['hyves', 'list']);

      expect(mockTruncate).toHaveBeenCalledWith('Build applications', 50);
      expect(mockTruncate).toHaveBeenCalledWith('Create landing pages', 50);
    });
  });

  // ==========================================================================
  // HYVES INFO
  // ==========================================================================

  describe('hyves info', () => {
    it('shows detailed hyve information', () => {
      run(['hyves', 'info', 'app-builder']);

      expect(mockGetSystemHyve).toHaveBeenCalledWith('app-builder');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('App Builder');
      expect(output).toContain('ID:          app-builder');
      expect(output).toContain('Description: Build applications');
      expect(output).toContain('Visibility:  public');
      expect(output).toContain('Color:       #4285F4');
      expect(output).toContain('Tags:        apps, development');
    });

    it('shows create hint', () => {
      run(['hyves', 'info', 'app-builder']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('myndhyve-cli projects create');
      expect(output).toContain('--hyve=app-builder');
    });

    it('shows NOT_FOUND error for unknown hyve', () => {
      mockGetSystemHyve.mockReturnValue(null);

      run(['hyves', 'info', 'invalid-hyve']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Unknown hyve "invalid-hyve"');
      expect(process.exitCode).toBe(3); // NOT_FOUND
    });

    it('outputs JSON format', () => {
      run(['hyves', 'info', 'app-builder', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(SAMPLE_HYVE);
    });

    it('shows suggestion when hyve not found', () => {
      mockGetSystemHyve.mockReturnValue(null);

      run(['hyves', 'info', 'bad-id']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('myndhyve-cli hyves list');
    });
  });

  // ==========================================================================
  // HYVES DOCS
  // ==========================================================================

  describe('hyves docs', () => {
    it('shows documents list', async () => {
      mockListHyveDocuments.mockResolvedValue([SAMPLE_DOC, SAMPLE_DOC_PINNED]);

      await run(['hyves', 'docs']);

      expect(mockListHyveDocuments).toHaveBeenCalledWith('user_abc', {
        hyveId: undefined,
        pinned: undefined,
      });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Hyve Documents (2)');
      expect(output).toContain('doc-1');
      expect(output).toContain('My Document');
    });

    it('shows hint when document list is empty', async () => {
      mockListHyveDocuments.mockResolvedValue([]);

      await run(['hyves', 'docs']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No hyve documents found');
      expect(output).toContain('Create a project first');
    });

    it('outputs JSON format', async () => {
      const docs = [SAMPLE_DOC];
      mockListHyveDocuments.mockResolvedValue(docs);

      await run(['hyves', 'docs', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(docs);
    });

    it('passes --hyve filter to API', async () => {
      mockListHyveDocuments.mockResolvedValue([]);

      await run(['hyves', 'docs', '--hyve', 'app-builder']);

      expect(mockListHyveDocuments).toHaveBeenCalledWith('user_abc', {
        hyveId: 'app-builder',
        pinned: undefined,
      });
    });

    it('passes --pinned filter to API', async () => {
      mockListHyveDocuments.mockResolvedValue([]);

      await run(['hyves', 'docs', '--pinned']);

      expect(mockListHyveDocuments).toHaveBeenCalledWith('user_abc', {
        hyveId: undefined,
        pinned: true,
      });
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['hyves', 'docs']);

      expect(mockListHyveDocuments).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockListHyveDocuments.mockRejectedValue(new Error('Timeout'));

      await run(['hyves', 'docs']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list hyve documents', expect.any(Error));
    });

    it('calls truncate on document names', async () => {
      mockListHyveDocuments.mockResolvedValue([SAMPLE_DOC]);

      await run(['hyves', 'docs']);

      expect(mockTruncate).toHaveBeenCalledWith('My Document', 26);
    });
  });

  // ==========================================================================
  // USE (Set Active Project)
  // ==========================================================================

  describe('use', () => {
    it('sets active context for valid project', async () => {
      mockGetProject.mockResolvedValue(SAMPLE_PROJECT);

      await run(['use', 'proj-1']);

      expect(mockGetProject).toHaveBeenCalledWith('proj-1');
      expect(mockSetActiveContext).toHaveBeenCalledWith({
        projectId: 'proj-1',
        projectName: 'Test Project',
        hyveId: 'app-builder',
        hyveName: 'App Builder',
      });

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Active project set');
      expect(output).toContain('Test Project');
      expect(output).toContain('proj-1');
      expect(output).toContain('App Builder');
    });

    it('shows NOT_FOUND error for missing project', async () => {
      mockGetProject.mockResolvedValue(null);

      await run(['use', 'not-found']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Project "not-found" not found');
      expect(process.exitCode).toBe(3); // NOT_FOUND
      expect(mockSetActiveContext).not.toHaveBeenCalled();
    });

    it('shows UNAUTHORIZED error when user does not own project', async () => {
      mockGetProject.mockResolvedValue({ ...SAMPLE_PROJECT, ownerId: 'other_user' });

      await run(['use', 'proj-1']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('You do not own project');
      expect(process.exitCode).toBe(4); // UNAUTHORIZED
      expect(mockSetActiveContext).not.toHaveBeenCalled();
    });

    it('returns early when auth fails', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['use', 'proj-1']);

      expect(mockGetProject).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockGetProject.mockRejectedValue(new Error('Network error'));

      await run(['use', 'proj-1']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to set active project', expect.any(Error));
    });
  });

  // ==========================================================================
  // UNUSE (Clear Active Project)
  // ==========================================================================

  describe('unuse', () => {
    it('clears active context', async () => {
      await run(['unuse']);

      expect(mockClearActiveContext).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Active project cleared');
    });
  });

  // ==========================================================================
  // WHOAMI
  // ==========================================================================

  describe('whoami', () => {
    it('shows authenticated user with active project', () => {
      mockGetActiveContext.mockReturnValue({
        projectId: 'proj-1',
        projectName: 'Test Project',
        hyveId: 'app-builder',
        hyveName: 'App Builder',
      });

      run(['whoami']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('test@test.com');
      expect(output).toContain('user_abc');
      expect(output).toContain('credentials');
      expect(output).toContain('Active');
      expect(output).toContain('Test Project');
      expect(output).toContain('proj-1');
      expect(output).toContain('App Builder');
    });

    it('shows authenticated user without active project', () => {
      mockGetActiveContext.mockReturnValue(null);

      run(['whoami']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('test@test.com');
      expect(output).toContain('No active project');
      expect(output).toContain('myndhyve-cli use <project-id>');
    });

    it('shows not authenticated message', () => {
      mockGetAuthStatus.mockReturnValue({
        authenticated: false,
        email: undefined,
        uid: undefined,
        source: undefined,
        expired: false,
      });

      run(['whoami']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Not authenticated');
      expect(output).toContain('myndhyve-cli auth login');
    });

    it('shows expired status when token is expired', () => {
      mockGetAuthStatus.mockReturnValue({
        authenticated: true,
        email: 'test@test.com',
        uid: 'user_abc',
        source: 'credentials',
        expired: true,
      });

      run(['whoami']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Expired');
    });

    it('shows env token source', () => {
      mockGetAuthStatus.mockReturnValue({
        authenticated: true,
        email: undefined,
        uid: 'user_abc',
        source: 'env',
        expired: false,
      });

      run(['whoami']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('MYNDHYVE_TOKEN');
    });

    it('outputs JSON format', () => {
      mockGetActiveContext.mockReturnValue({
        projectId: 'proj-1',
        projectName: 'Test Project',
        hyveId: 'app-builder',
        hyveName: 'App Builder',
      });

      run(['whoami', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed.auth).toBeDefined();
      expect(parsed.auth.authenticated).toBe(true);
      expect(parsed.auth.email).toBe('test@test.com');
      expect(parsed.auth.uid).toBe('user_abc');
      expect(parsed.activeProject).toBeDefined();
      expect(parsed.activeProject.projectId).toBe('proj-1');
    });

    it('outputs JSON with null activeProject when no context', () => {
      mockGetActiveContext.mockReturnValue(null);

      run(['whoami', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const parsed = JSON.parse(output);
      expect(parsed.activeProject).toBeNull();
    });
  });
});
