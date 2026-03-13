import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockLoadCredentials,
  mockCreateRun,
  mockGetAgent,
  mockListCrmEntities,
  mockExecSync,
} = vi.hoisted(() => ({
  mockLoadCredentials: vi.fn(),
  mockCreateRun: vi.fn(),
  mockGetAgent: vi.fn(),
  mockListCrmEntities: vi.fn(),
  mockExecSync: vi.fn(),
}));

vi.mock('../../auth/credentials.js', () => ({
  loadCredentials: () => mockLoadCredentials(),
}));

vi.mock('../../api/workflows.js', () => ({
  createRun: (...args: unknown[]) => mockCreateRun(...args),
}));

vi.mock('../../api/agents.js', () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
}));

vi.mock('../../api/crm.js', () => ({
  listCrmEntities: (...args: unknown[]) => mockListCrmEntities(...args),
  CRM_COLLECTIONS: ['contacts', 'deals', 'tasks'],
}));

vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Import SUT ────────────────────────────────────────────────────────────────

import { executeAction } from '../executor.js';
import type { SchedulerConfig, JobAction } from '../types.js';
import { DEFAULT_SCHEDULER_CONFIG } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const configWithShell: SchedulerConfig = { ...DEFAULT_SCHEDULER_CONFIG, allowShell: true };
const configNoShell: SchedulerConfig = { ...DEFAULT_SCHEDULER_CONFIG, allowShell: false };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CronExecutor', () => {
  beforeEach(() => {
    mockLoadCredentials.mockReset();
    mockCreateRun.mockReset();
    mockGetAgent.mockReset();
    mockListCrmEntities.mockReset();
    mockExecSync.mockReset();

    mockLoadCredentials.mockReturnValue({ uid: 'user-123' });
  });

  // ── Auth ──────────────────────────────────────────────────────────────

  describe('auth', () => {
    it('throws when not authenticated', async () => {
      mockLoadCredentials.mockReturnValue(null);
      const action: JobAction = { type: 'workflow', workflowId: 'wf-1', canvasTypeId: 'lp' };

      await expect(executeAction(action, DEFAULT_SCHEDULER_CONFIG)).rejects.toThrow(
        'Not authenticated',
      );
    });
  });

  // ── Workflow ──────────────────────────────────────────────────────────

  describe('workflow action', () => {
    it('calls createRun and returns result', async () => {
      mockCreateRun.mockResolvedValue({ id: 'run-xyz', status: 'queued' });

      const action: JobAction = {
        type: 'workflow',
        workflowId: 'wf-1',
        canvasTypeId: 'landing-page',
        input: { key: 'val' },
      };

      const result = await executeAction(action, DEFAULT_SCHEDULER_CONFIG);

      expect(result).toContain('run-xyz');
      expect(result).toContain('queued');
      expect(mockCreateRun).toHaveBeenCalledWith(
        'user-123',
        'landing-page',
        'wf-1',
        { triggerType: 'schedule', inputData: { key: 'val' } },
      );
    });
  });

  // ── Agent ─────────────────────────────────────────────────────────────

  describe('agent action', () => {
    it('verifies agent exists and returns summary', async () => {
      mockGetAgent.mockResolvedValue({ name: 'My Agent' });

      const action: JobAction = {
        type: 'agent',
        agentId: 'agent-1',
        message: 'Run daily report',
      };

      const result = await executeAction(action, DEFAULT_SCHEDULER_CONFIG);

      expect(result).toContain('agent-1');
      expect(result).toContain('Run daily report');
    });

    it('throws when agent not found', async () => {
      mockGetAgent.mockResolvedValue(null);

      const action: JobAction = {
        type: 'agent',
        agentId: 'agent-missing',
        message: 'Hello',
      };

      await expect(executeAction(action, DEFAULT_SCHEDULER_CONFIG)).rejects.toThrow(
        'Agent "agent-missing" not found',
      );
    });
  });

  // ── CRM Sync ──────────────────────────────────────────────────────────

  describe('crm-sync action', () => {
    it('checks all collections when none specified', async () => {
      mockListCrmEntities.mockResolvedValue([]);

      const action: JobAction = { type: 'crm-sync' };
      const result = await executeAction(action, DEFAULT_SCHEDULER_CONFIG);

      expect(result).toContain('3 collections accessible');
      expect(mockListCrmEntities).toHaveBeenCalledTimes(3);
    });

    it('checks only specified collections', async () => {
      mockListCrmEntities.mockResolvedValue([]);

      const action: JobAction = {
        type: 'crm-sync',
        collections: ['contacts', 'deals'],
      };

      const result = await executeAction(action, DEFAULT_SCHEDULER_CONFIG);
      expect(result).toContain('2 collections accessible');
    });

    it('throws when all collections fail', async () => {
      mockListCrmEntities.mockRejectedValue(new Error('Network error'));

      const action: JobAction = { type: 'crm-sync' };
      await expect(executeAction(action, DEFAULT_SCHEDULER_CONFIG)).rejects.toThrow(
        'all 3 collections unreachable',
      );
    });

    it('reports partial failures', async () => {
      let callCount = 0;
      mockListCrmEntities.mockImplementation(() => {
        callCount++;
        if (callCount === 2) return Promise.reject(new Error('fail'));
        return Promise.resolve([]);
      });

      const action: JobAction = { type: 'crm-sync' };
      const result = await executeAction(action, DEFAULT_SCHEDULER_CONFIG);

      expect(result).toContain('2 collections accessible');
      expect(result).toContain('1 failed');
    });
  });

  // ── Shell ─────────────────────────────────────────────────────────────

  describe('shell action', () => {
    it('executes command when allowShell is true', () => {
      mockExecSync.mockReturnValue('Hello World\n');

      const action: JobAction = { type: 'shell', command: 'echo "Hello World"' };
      const result = executeAction(action, configWithShell);

      // executeShell is sync but executeAction returns Promise
      return expect(result).resolves.toBe('Hello World');
    });

    it('rejects when allowShell is false', async () => {
      const action: JobAction = { type: 'shell', command: 'echo hi' };
      await expect(executeAction(action, configNoShell)).rejects.toThrow(
        'Shell actions are disabled',
      );
    });

    it('truncates long output to 500 chars', async () => {
      const longOutput = 'x'.repeat(600) + '\n';
      mockExecSync.mockReturnValue(longOutput);

      const action: JobAction = { type: 'shell', command: 'cat bigfile' };
      const result = await executeAction(action, configWithShell);
      expect(result.length).toBeLessThanOrEqual(503); // 500 + '...'
    });
  });

  // ── HTTP ──────────────────────────────────────────────────────────────

  describe('http action', () => {
    it('makes request and returns status summary', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const action: JobAction = {
        type: 'http',
        url: 'https://api.example.com/health',
        method: 'GET',
      };

      const result = await executeAction(action, DEFAULT_SCHEDULER_CONFIG);
      expect(result).toContain('200');
      expect(result).toContain('OK');

      vi.unstubAllGlobals();
    });

    it('throws on non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue('Server crash'),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const action: JobAction = {
        type: 'http',
        url: 'https://api.example.com/fail',
        method: 'POST',
      };

      await expect(executeAction(action, DEFAULT_SCHEDULER_CONFIG)).rejects.toThrow(
        'HTTP POST https://api.example.com/fail failed: 500',
      );

      vi.unstubAllGlobals();
    });
  });
});
