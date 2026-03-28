import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';

const {
  mockRequireAuth,
  mockPrintError,
  mockListLaunchStudios,
  mockGetLaunchStudio,
  mockCreateLaunchStudio,
  mockDeleteLaunchStudio,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockPrintError: vi.fn(),
  mockListLaunchStudios: vi.fn(),
  mockGetLaunchStudio: vi.fn(),
  mockCreateLaunchStudio: vi.fn(),
  mockDeleteLaunchStudio: vi.fn(),
}));

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  formatRelativeTime: () => '2m ago',
  formatTableRow: (cols: Array<[string, number]>) => cols.map(([v]) => v).join(' | '),
  printError: (...args: unknown[]) => mockPrintError(...args),
}));

vi.mock('../../api/launch-studios.js', () => ({
  listLaunchStudios: (...args: unknown[]) => mockListLaunchStudios(...args),
  getLaunchStudio: (...args: unknown[]) => mockGetLaunchStudio(...args),
  createLaunchStudio: (...args: unknown[]) => mockCreateLaunchStudio(...args),
  deleteLaunchStudio: (...args: unknown[]) => mockDeleteLaunchStudio(...args),
  FLOW_TEMPLATES: [
    { id: 'ai-saas-launch', name: 'AI SaaS Launch', description: 'Full launch', canvasTypeIds: ['app-builder', 'slides'], bestFor: 'SaaS' },
    { id: 'ai-pitch-prep', name: 'AI Pitch Prep', description: 'Pitch deck', canvasTypeIds: ['app-builder', 'slides'], bestFor: 'Fundraise' },
  ],
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4, SIGINT: 130 },
  printErrorResult: vi.fn(),
}));

import { registerLaunchCommands } from '../launch.js';

const AUTH = { uid: 'user-1', email: 'test@test.com' };

const SAMPLE_STUDIO = {
  id: 'ls-123',
  name: 'My AI App',
  flowTemplateId: 'ai-saas-launch',
  status: 'draft',
  steps: [
    { id: 'step-0', canvasTypeId: 'app-builder', status: 'completed' },
    { id: 'step-1', canvasTypeId: 'slides', status: 'pending' },
  ],
  prdId: 'prd-1',
  brandId: null,
  boardId: null,
  sharedArtifactRefs: [
    { artifactId: 'a1', sourceProjectId: 'p1', sourceCanvasTypeId: 'app-builder', artifactTypeId: 'prd', label: 'PRD' },
  ],
  createdAt: '2026-03-28T00:00:00Z',
  updatedAt: '2026-03-28T00:00:00Z',
};

function createTestProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerLaunchCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = createTestProgram();
  await program.parseAsync(['node', 'test', ...args]);
}

describe('launch commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    process.exitCode = undefined;
  });

  describe('launch list', () => {
    it('shows empty message when no studios', async () => {
      mockListLaunchStudios.mockResolvedValue([]);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['launch', 'list']);
      expect(mockListLaunchStudios).toHaveBeenCalledWith('user-1');
      spy.mockRestore();
    });

    it('lists studios with counts', async () => {
      mockListLaunchStudios.mockResolvedValue([SAMPLE_STUDIO]);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['launch', 'list']);
      expect(mockListLaunchStudios).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('requires auth', async () => {
      mockRequireAuth.mockReturnValue(null);
      await run(['launch', 'list']);
      expect(mockListLaunchStudios).not.toHaveBeenCalled();
    });
  });

  describe('launch start', () => {
    it('creates a studio with valid flow', async () => {
      mockCreateLaunchStudio.mockResolvedValue(SAMPLE_STUDIO);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['launch', 'start', '--flow', 'ai-saas-launch', '--name', 'Test']);
      expect(mockCreateLaunchStudio).toHaveBeenCalledWith('user-1', expect.objectContaining({
        name: 'Test',
        flowTemplateId: 'ai-saas-launch',
      }));
      spy.mockRestore();
    });

    it('rejects invalid flow template', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['launch', 'start', '--flow', 'bad-flow', '--name', 'Test']);
      expect(mockCreateLaunchStudio).not.toHaveBeenCalled();
      expect(mockPrintError).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('launch status', () => {
    it('shows studio status with step details', async () => {
      mockGetLaunchStudio.mockResolvedValue(SAMPLE_STUDIO);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['launch', 'status', 'ls-123']);
      expect(mockGetLaunchStudio).toHaveBeenCalledWith('user-1', 'ls-123');
      spy.mockRestore();
    });

    it('handles not found', async () => {
      mockGetLaunchStudio.mockResolvedValue(null);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['launch', 'status', 'ls-nonexistent']);
      expect(mockPrintError).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('shows summary when no ID given', async () => {
      mockListLaunchStudios.mockResolvedValue([SAMPLE_STUDIO]);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['launch', 'status']);
      expect(mockListLaunchStudios).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('launch artifacts', () => {
    it('lists shared artifacts', async () => {
      mockGetLaunchStudio.mockResolvedValue(SAMPLE_STUDIO);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['launch', 'artifacts', 'ls-123']);
      expect(mockGetLaunchStudio).toHaveBeenCalledWith('user-1', 'ls-123');
      spy.mockRestore();
    });
  });

  describe('launch delete', () => {
    it('deletes a studio', async () => {
      mockDeleteLaunchStudio.mockResolvedValue(undefined);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['launch', 'delete', 'ls-123']);
      expect(mockDeleteLaunchStudio).toHaveBeenCalledWith('user-1', 'ls-123');
      spy.mockRestore();
    });
  });

  describe('launch templates', () => {
    it('lists flow templates', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run(['launch', 'templates']);
      // Should print without errors — auth not required for templates
      spy.mockRestore();
    });
  });
});
