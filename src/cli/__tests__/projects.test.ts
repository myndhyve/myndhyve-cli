import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Command } from 'commander';

// ── Hoisted mock variables ─────────────────────────────────────────────────────

const {
  mockRequireAuth,
  mockTruncate,
  mockFormatRelativeTime,
  mockFormatTableRow,
  mockPrintError,
  mockListProjects,
  mockGetProject,
  mockCreateProject,
  mockDeleteProjectById,
  mockListSystemHyves,
  mockGetSystemHyve,
  mockIsValidSystemHyveId,
  mockSetActiveContext,
  mockOraStart,
  mockOraSucceed,
  mockOraFail,
  mockOraStop,
  mockExecFile,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockTruncate: vi.fn(),
  mockFormatRelativeTime: vi.fn(),
  mockFormatTableRow: vi.fn(),
  mockPrintError: vi.fn(),
  mockListProjects: vi.fn(),
  mockGetProject: vi.fn(),
  mockCreateProject: vi.fn(),
  mockDeleteProjectById: vi.fn(),
  mockListSystemHyves: vi.fn(),
  mockGetSystemHyve: vi.fn(),
  mockIsValidSystemHyveId: vi.fn(),
  mockSetActiveContext: vi.fn(),
  mockOraStart: vi.fn(),
  mockOraSucceed: vi.fn(),
  mockOraFail: vi.fn(),
  mockOraStop: vi.fn(),
  mockExecFile: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  truncate: (...args: unknown[]) => mockTruncate(...args),
  formatRelativeTime: (...args: unknown[]) => mockFormatRelativeTime(...args),
  formatTableRow: (...args: unknown[]) => mockFormatTableRow(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/projects.js', () => ({
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  getProject: (...args: unknown[]) => mockGetProject(...args),
  createProject: (...args: unknown[]) => mockCreateProject(...args),
  deleteProjectById: (...args: unknown[]) => mockDeleteProjectById(...args),
}));

vi.mock('../../api/hyves.js', () => ({
  listSystemHyves: (...args: unknown[]) => mockListSystemHyves(...args),
  getSystemHyve: (...args: unknown[]) => mockGetSystemHyve(...args),
  isValidSystemHyveId: (...args: unknown[]) => mockIsValidSystemHyveId(...args),
}));

vi.mock('../../context.js', () => ({
  setActiveContext: (...args: unknown[]) => mockSetActiveContext(...args),
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

vi.mock('ora', () => {
  const spinner = {
    start: (...args: unknown[]) => { mockOraStart(...args); return spinner; },
    succeed: (...args: unknown[]) => { mockOraSucceed(...args); return spinner; },
    fail: (...args: unknown[]) => { mockOraFail(...args); return spinner; },
    stop: (...args: unknown[]) => { mockOraStop(...args); return spinner; },
    text: '',
  };
  return { default: () => spinner };
});

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import { registerProjectCommands } from '../projects.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const AUTH_USER = { uid: 'user_abc', email: 'test@test.com' };

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerProjectCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

// ── Mock data ──────────────────────────────────────────────────────────────────

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

const SAMPLE_PROJECT_2 = {
  ...SAMPLE_PROJECT,
  id: 'proj-2',
  name: 'Another Project',
  slug: 'another-project',
  hyveId: 'landing-page',
  status: 'draft',
};

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('registerProjectCommands', () => {
  let consoleSpy: MockInstance;
  let consoleErrSpy: MockInstance;
  let stderrWriteSpy: MockInstance;

  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockTruncate.mockReset();
    mockFormatRelativeTime.mockReset();
    mockFormatTableRow.mockReset();
    mockPrintError.mockReset();
    mockListProjects.mockReset();
    mockGetProject.mockReset();
    mockCreateProject.mockReset();
    mockDeleteProjectById.mockReset();
    mockListSystemHyves.mockReset();
    mockGetSystemHyve.mockReset();
    mockIsValidSystemHyveId.mockReset();
    mockSetActiveContext.mockReset();
    mockOraStart.mockReset();
    mockOraSucceed.mockReset();
    mockOraFail.mockReset();
    mockOraStop.mockReset();
    mockExecFile.mockReset();

    // Default: auth success
    mockRequireAuth.mockReturnValue(AUTH_USER);

    // truncate passthrough
    mockTruncate.mockImplementation((s: string) => s);

    // formatRelativeTime passthrough
    mockFormatRelativeTime.mockImplementation((s: string) => s);

    // formatTableRow: join columns
    mockFormatTableRow.mockImplementation((cols: Array<[string, number]>) => cols.map(([s]) => s).join(' '));

    // isValidSystemHyveId defaults to true
    mockIsValidSystemHyveId.mockReturnValue(true);

    // getSystemHyve default
    mockGetSystemHyve.mockReturnValue({ name: 'App Builder', hyveId: 'app-builder' });

    // listSystemHyves default
    mockListSystemHyves.mockReturnValue([
      { hyveId: 'app-builder', name: 'App Builder' },
      { hyveId: 'landing-page', name: 'Landing Page' },
    ]);

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
    it('registers the projects command group on the program', () => {
      const program = new Command();
      registerProjectCommands(program);
      const projects = program.commands.find((c) => c.name() === 'projects');
      expect(projects).toBeDefined();
    });

    it('registers all subcommands under projects', () => {
      const program = new Command();
      registerProjectCommands(program);
      const projects = program.commands.find((c) => c.name() === 'projects')!;
      const subNames = projects.commands.map((c) => c.name());

      expect(subNames).toContain('list');
      expect(subNames).toContain('create');
      expect(subNames).toContain('info');
      expect(subNames).toContain('open');
      expect(subNames).toContain('delete');
    });
  });

  // ==========================================================================
  // AUTHENTICATION
  // ==========================================================================

  describe('authentication', () => {
    it('returns early when auth fails for projects list', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['projects', 'list']);

      expect(mockListProjects).not.toHaveBeenCalled();
    });

    it('returns early when auth fails for projects create', async () => {
      mockRequireAuth.mockReturnValue(null);

      await run(['projects', 'create', 'Test', '--hyve', 'app-builder']);

      expect(mockCreateProject).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // PROJECTS LIST
  // ==========================================================================

  describe('projects list', () => {
    it('shows hint message when result is empty', async () => {
      mockListProjects.mockResolvedValue([]);

      await run(['projects', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No projects found');
      expect(output).toContain('myndhyve-cli projects create');
    });

    it('shows table with projects', async () => {
      mockListProjects.mockResolvedValue([SAMPLE_PROJECT, SAMPLE_PROJECT_2]);

      await run(['projects', 'list']);

      expect(mockListProjects).toHaveBeenCalledWith('user_abc', {
        hyveId: undefined,
        status: undefined,
      });
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Projects (2)');
      expect(output).toContain('proj-1');
    });

    it('shows hyve name from getSystemHyve', async () => {
      mockListProjects.mockResolvedValue([SAMPLE_PROJECT]);

      await run(['projects', 'list']);

      expect(mockGetSystemHyve).toHaveBeenCalledWith('app-builder');
    });

    it('formats updated timestamp using formatRelativeTime', async () => {
      mockListProjects.mockResolvedValue([SAMPLE_PROJECT]);

      await run(['projects', 'list']);

      expect(mockFormatRelativeTime).toHaveBeenCalledWith('2025-01-15T10:00:00Z');
    });

    it('uses em-dash when updatedAt is missing', async () => {
      mockListProjects.mockResolvedValue([{ ...SAMPLE_PROJECT, updatedAt: undefined }]);

      await run(['projects', 'list']);

      expect(mockFormatRelativeTime).not.toHaveBeenCalled();
    });

    it('outputs JSON format', async () => {
      const results = [SAMPLE_PROJECT];
      mockListProjects.mockResolvedValue(results);

      await run(['projects', 'list', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(results);
    });

    it('passes --hyve filter to API', async () => {
      mockListProjects.mockResolvedValue([]);

      await run(['projects', 'list', '--hyve', 'app-builder']);

      expect(mockListProjects).toHaveBeenCalledWith('user_abc', {
        hyveId: 'app-builder',
        status: undefined,
      });
    });

    it('passes --status filter to API', async () => {
      mockListProjects.mockResolvedValue([]);

      await run(['projects', 'list', '--status', 'draft']);

      expect(mockListProjects).toHaveBeenCalledWith('user_abc', {
        hyveId: undefined,
        status: 'draft',
      });
    });

    it('calls printError on API failure', async () => {
      mockListProjects.mockRejectedValue(new Error('Network error'));

      await run(['projects', 'list']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list projects', expect.any(Error));
    });

    it('stops spinner on success', async () => {
      mockListProjects.mockResolvedValue([]);

      await run(['projects', 'list']);

      expect(mockOraStop).toHaveBeenCalled();
    });

    it('stops spinner on error', async () => {
      mockListProjects.mockRejectedValue(new Error('Fail'));

      await run(['projects', 'list']);

      expect(mockOraStop).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // PROJECTS CREATE
  // ==========================================================================

  describe('projects create', () => {
    it('creates a project with valid hyve', async () => {
      mockCreateProject.mockResolvedValue({
        id: 'proj-new',
        name: 'My App',
        slug: 'my-app',
        hyveId: 'app-builder',
      });

      await run(['projects', 'create', 'My App', '--hyve', 'app-builder']);

      expect(mockCreateProject).toHaveBeenCalledWith('user_abc', {
        name: 'My App',
        hyveId: 'app-builder',
        description: undefined,
        type: 'general',
        tags: undefined,
      });

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Project created successfully');
      expect(output).toContain('proj-new');
      expect(output).toContain('My App');
    });

    it('shows error for invalid hyve ID', async () => {
      mockIsValidSystemHyveId.mockReturnValue(false);

      await run(['projects', 'create', 'Bad', '--hyve', 'invalid-hyve']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Unknown hyve "invalid-hyve"');
      expect(process.exitCode).toBe(3); // NOT_FOUND
      expect(mockCreateProject).not.toHaveBeenCalled();
    });

    it('passes description and tags to createProject', async () => {
      mockCreateProject.mockResolvedValue({
        id: 'proj-new',
        name: 'Tagged',
        slug: 'tagged',
        hyveId: 'app-builder',
      });

      await run([
        'projects', 'create', 'Tagged',
        '--hyve', 'app-builder',
        '--description', 'A description',
        '--tags', 'a,b,c',
      ]);

      expect(mockCreateProject).toHaveBeenCalledWith('user_abc', {
        name: 'Tagged',
        hyveId: 'app-builder',
        description: 'A description',
        type: 'general',
        tags: ['a', 'b', 'c'],
      });
    });

    it('sets active context with --use flag', async () => {
      mockCreateProject.mockResolvedValue({
        id: 'proj-new',
        name: 'Active',
        slug: 'active',
        hyveId: 'app-builder',
      });

      await run(['projects', 'create', 'Active', '--hyve', 'app-builder', '--use']);

      expect(mockSetActiveContext).toHaveBeenCalledWith({
        projectId: 'proj-new',
        projectName: 'Active',
        hyveId: 'app-builder',
        hyveName: 'App Builder',
      });

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Active');
    });

    it('does not set active context without --use flag', async () => {
      mockCreateProject.mockResolvedValue({
        id: 'proj-new',
        name: 'Not Active',
        slug: 'not-active',
        hyveId: 'app-builder',
      });

      await run(['projects', 'create', 'Not Active', '--hyve', 'app-builder']);

      expect(mockSetActiveContext).not.toHaveBeenCalled();
    });

    it('outputs JSON format', async () => {
      const project = {
        id: 'proj-j',
        name: 'JSON Proj',
        slug: 'json-proj',
        hyveId: 'app-builder',
      };
      mockCreateProject.mockResolvedValue(project);

      await run(['projects', 'create', 'JSON Proj', '--hyve', 'app-builder', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(project);
    });

    it('calls printError on API failure', async () => {
      mockCreateProject.mockRejectedValue(new Error('Quota exceeded'));

      await run(['projects', 'create', 'Fail', '--hyve', 'app-builder']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to create project', expect.any(Error));
    });

    it('passes custom --type to createProject', async () => {
      mockCreateProject.mockResolvedValue({
        id: 'proj-t',
        name: 'Typed',
        slug: 'typed',
        hyveId: 'app-builder',
      });

      await run(['projects', 'create', 'Typed', '--hyve', 'app-builder', '--type', 'app']);

      expect(mockCreateProject).toHaveBeenCalledWith('user_abc', expect.objectContaining({
        type: 'app',
      }));
    });
  });

  // ==========================================================================
  // PROJECTS INFO
  // ==========================================================================

  describe('projects info', () => {
    it('shows project details', async () => {
      mockGetProject.mockResolvedValue(SAMPLE_PROJECT);

      await run(['projects', 'info', 'proj-1']);

      expect(mockGetProject).toHaveBeenCalledWith('proj-1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Test Project');
      expect(output).toContain('ID:            proj-1');
      expect(output).toContain('Slug:          test-project');
      expect(output).toContain('Hyve:          App Builder');
      expect(output).toContain('Type:          general');
      expect(output).toContain('Status:        in_progress');
      expect(output).toContain('Description:   A test project');
      expect(output).toContain('Tags:          test');
    });

    it('shows metadata fields', async () => {
      mockGetProject.mockResolvedValue(SAMPLE_PROJECT);

      await run(['projects', 'info', 'proj-1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Visibility:    private');
      expect(output).toContain('Documents:     5');
      expect(output).toContain('Workflows:     2');
      expect(output).toContain('Artifacts:     1');
      expect(output).toContain('Collaborators: 1');
    });

    it('shows NOT_FOUND error for missing project', async () => {
      mockGetProject.mockResolvedValue(null);

      await run(['projects', 'info', 'not-found']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Project "not-found" not found');
      expect(process.exitCode).toBe(3); // NOT_FOUND
    });

    it('outputs JSON format', async () => {
      mockGetProject.mockResolvedValue(SAMPLE_PROJECT);

      await run(['projects', 'info', 'proj-1', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(JSON.parse(output)).toEqual(SAMPLE_PROJECT);
    });

    it('omits description when not present', async () => {
      mockGetProject.mockResolvedValue({ ...SAMPLE_PROJECT, description: undefined });

      await run(['projects', 'info', 'proj-1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Description:');
    });

    it('omits tags when empty', async () => {
      mockGetProject.mockResolvedValue({ ...SAMPLE_PROJECT, tags: [] });

      await run(['projects', 'info', 'proj-1']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Tags:');
    });

    it('calls printError on API failure', async () => {
      mockGetProject.mockRejectedValue(new Error('Server error'));

      await run(['projects', 'info', 'proj-1']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to get project info', expect.any(Error));
    });
  });

  // ==========================================================================
  // PROJECTS OPEN
  // ==========================================================================

  describe('projects open', () => {
    it('shows URL for valid project', async () => {
      mockGetProject.mockResolvedValue(SAMPLE_PROJECT);

      await run(['projects', 'open', 'proj-1']);

      expect(mockGetProject).toHaveBeenCalledWith('proj-1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Opening');
      expect(output).toContain('Test Project');
      expect(output).toContain('https://app.myndhyve.com/hyve/app-builder/docs/proj-1');
    });

    it('shows NOT_FOUND error for missing project', async () => {
      mockGetProject.mockResolvedValue(null);

      await run(['projects', 'open', 'not-found']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Project "not-found" not found');
      expect(process.exitCode).toBe(3); // NOT_FOUND
    });

    it('calls execFile to open browser', async () => {
      mockGetProject.mockResolvedValue(SAMPLE_PROJECT);

      await run(['projects', 'open', 'proj-1']);

      expect(mockExecFile).toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockGetProject.mockRejectedValue(new Error('Timeout'));

      await run(['projects', 'open', 'proj-1']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to open project', expect.any(Error));
    });
  });

  // ==========================================================================
  // PROJECTS DELETE
  // ==========================================================================

  describe('projects delete', () => {
    it('deletes project with --force flag', async () => {
      mockGetProject.mockResolvedValue(SAMPLE_PROJECT);
      mockDeleteProjectById.mockResolvedValue(undefined);

      await run(['projects', 'delete', 'proj-1', '--force']);

      expect(mockGetProject).toHaveBeenCalledWith('proj-1');
      expect(mockDeleteProjectById).toHaveBeenCalledWith('proj-1');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Test Project');
      expect(output).toContain('deleted');
    });

    it('shows NOT_FOUND error for missing project', async () => {
      mockGetProject.mockResolvedValue(null);

      await run(['projects', 'delete', 'not-found', '--force']);

      const output = stderrWriteSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Project "not-found" not found');
      expect(process.exitCode).toBe(3); // NOT_FOUND
      expect(mockDeleteProjectById).not.toHaveBeenCalled();
    });

    it('calls printError on API failure', async () => {
      mockGetProject.mockResolvedValue(SAMPLE_PROJECT);
      mockDeleteProjectById.mockRejectedValue(new Error('Permission denied'));

      await run(['projects', 'delete', 'proj-1', '--force']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to delete project', expect.any(Error));
    });
  });
});
