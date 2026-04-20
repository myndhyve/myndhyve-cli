import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';

const {
  mockRequireAuth,
  mockPrintError,
  mockGetActiveContext,
  mockGetToken,
  mockListDocumentRecords,
  mockGetDocumentRecord,
  mockImportDocumentMarkdown,
  mockCreateDocumentRecord,
  mockDeleteDocumentRecord,
  mockListAllDocumentThemes,
  mockReadFileSync,
  mockWriteFileSync,
  mockPrintErrorResult,
  mockPrintSuccess,
  mockInquirerPrompt,
  mockFetch,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockPrintError: vi.fn(),
  mockGetActiveContext: vi.fn(),
  mockGetToken: vi.fn(),
  mockListDocumentRecords: vi.fn(),
  mockGetDocumentRecord: vi.fn(),
  mockImportDocumentMarkdown: vi.fn(),
  mockCreateDocumentRecord: vi.fn(),
  mockDeleteDocumentRecord: vi.fn(),
  mockListAllDocumentThemes: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockPrintErrorResult: vi.fn(),
  mockPrintSuccess: vi.fn(),
  mockInquirerPrompt: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('../helpers.js', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  printError: (...args: unknown[]) => mockPrintError(...args),
  truncate: (s: string) => s,
  formatRelativeTime: () => '2m ago',
}));

vi.mock('../../context.js', () => ({
  getActiveContext: (...args: unknown[]) => mockGetActiveContext(...args),
}));

vi.mock('../../auth/index.js', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

vi.mock('../../api/documents.js', async () => {
  const actual = await vi.importActual<typeof import('../../api/documents.js')>(
    '../../api/documents.js',
  );
  return {
    ...actual,
    listDocumentRecords: (...args: unknown[]) => mockListDocumentRecords(...args),
    getDocumentRecord: (...args: unknown[]) => mockGetDocumentRecord(...args),
    importDocumentMarkdown: (...args: unknown[]) => mockImportDocumentMarkdown(...args),
    createDocumentRecord: (...args: unknown[]) => mockCreateDocumentRecord(...args),
    deleteDocumentRecord: (...args: unknown[]) => mockDeleteDocumentRecord(...args),
    listAllDocumentThemes: (...args: unknown[]) => mockListAllDocumentThemes(...args),
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  };
});

vi.mock('inquirer', () => ({
  default: { prompt: (...args: unknown[]) => mockInquirerPrompt(...args) },
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4 },
  printErrorResult: (...args: unknown[]) => mockPrintErrorResult(...args),
  printResult: (_data: unknown, formatter?: () => void) => {
    if (formatter) formatter();
  },
  printSuccess: (...args: unknown[]) => mockPrintSuccess(...args),
}));

import { registerDocumentsCommands } from '../documents.js';

const AUTH = { uid: 'user-1', email: 't@t.com' };
const CONTEXT_OK = {
  projectId: 'p1',
  projectName: 'Test project',
  canvasTypeId: 'documents',
  canvasId: 'canvas-1',
  workspaceId: 'ws-1',
  setAt: '2026-04-19T12:00:00Z',
};

function makeProgram(): Command {
  const program = new Command();
  registerDocumentsCommands(program);
  return program;
}

describe('documents CLI — context guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
  });

  it('rejects when no active context is set', async () => {
    mockGetActiveContext.mockReturnValue(null);
    await makeProgram().parseAsync(['documents', 'list'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NO_ACTIVE_CONTEXT' }),
    );
    expect(mockListDocumentRecords).not.toHaveBeenCalled();
  });

  it('rejects when active context lacks a workspaceId', async () => {
    mockGetActiveContext.mockReturnValue({ ...CONTEXT_OK, workspaceId: undefined });
    await makeProgram().parseAsync(['documents', 'list'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NO_WORKSPACE' }),
    );
  });

  it('rejects when canvas type is not documents', async () => {
    mockGetActiveContext.mockReturnValue({ ...CONTEXT_OK, canvasTypeId: 'slides' });
    await makeProgram().parseAsync(['documents', 'list'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'WRONG_CANVAS_TYPE' }),
    );
  });

  it('rejects when no canvasId', async () => {
    mockGetActiveContext.mockReturnValue({ ...CONTEXT_OK, canvasId: undefined });
    await makeProgram().parseAsync(['documents', 'list'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NO_CANVAS' }),
    );
  });
});

describe('documents list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
  });

  it('lists documents using the active workspaceId + canvasId', async () => {
    mockListDocumentRecords.mockResolvedValue([
      { id: 'doc-1', title: 'Q4 Report', themeId: 'serif', version: 3, bytes: 4096 },
    ]);
    await makeProgram().parseAsync(['documents', 'list'], { from: 'user' });
    expect(mockListDocumentRecords).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      canvasId: 'canvas-1',
    });
  });

  it('prints an empty-state hint when the canvas has no documents', async () => {
    mockListDocumentRecords.mockResolvedValue([]);
    await makeProgram().parseAsync(['documents', 'list'], { from: 'user' });
    expect(mockListDocumentRecords).toHaveBeenCalledOnce();
  });
});

describe('documents show', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
  });

  it('fetches the document by id', async () => {
    mockGetDocumentRecord.mockResolvedValue({
      id: 'doc-1',
      workspaceId: 'ws-1',
      canvasId: 'canvas-1',
      title: 'Q4 Report',
      themeId: 'serif',
      markdown: '# Q4\n',
      chrome: { pageSize: 'letter', showPageNumbers: true },
      version: 3,
    });
    await makeProgram().parseAsync(['documents', 'show', 'doc-1'], { from: 'user' });
    expect(mockGetDocumentRecord).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', canvasId: 'canvas-1' },
      'doc-1',
    );
  });

  it('surfaces DOC_NOT_FOUND when the doc does not exist', async () => {
    mockGetDocumentRecord.mockResolvedValue(null);
    await makeProgram().parseAsync(['documents', 'show', 'nope'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DOC_NOT_FOUND' }),
    );
  });
});

describe('documents export (md)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
    mockGetDocumentRecord.mockResolvedValue({
      id: 'doc-1',
      title: 'Doc',
      markdown: '# Hello',
      themeId: 'default',
      version: 1,
    });
  });

  it('writes markdown to stdout by default', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await makeProgram().parseAsync(['documents', 'export', 'doc-1'], { from: 'user' });
    expect(writeSpy).toHaveBeenCalledWith('# Hello');
    writeSpy.mockRestore();
  });

  it('writes markdown to a file when --output is supplied', async () => {
    await makeProgram().parseAsync(
      ['documents', 'export', 'doc-1', '--output', 'out.md'],
      { from: 'user' },
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('out.md'),
      '# Hello',
      'utf8',
    );
  });

  it('rejects an unknown format', async () => {
    await makeProgram().parseAsync(
      ['documents', 'export', 'doc-1', '--format', 'zip'],
      { from: 'user' },
    );
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNSUPPORTED_FORMAT' }),
    );
  });
});

describe('documents import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
  });

  it('reads the file + calls importDocumentMarkdown with updateTime precondition', async () => {
    mockReadFileSync.mockReturnValue('# New body');
    mockImportDocumentMarkdown.mockResolvedValue({
      ok: true,
      document: { id: 'doc-1', title: 'Doc', version: 2 },
    });
    await makeProgram().parseAsync(
      ['documents', 'import', 'doc-1', 'local.md'],
      { from: 'user' },
    );
    expect(mockImportDocumentMarkdown).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', canvasId: 'canvas-1' },
      expect.objectContaining({ documentId: 'doc-1', markdown: '# New body' }),
    );
    expect(mockPrintSuccess).toHaveBeenCalled();
  });

  it('rejects a file that exceeds the 900 KB ceiling', async () => {
    mockReadFileSync.mockReturnValue('x'.repeat(1_000_000));
    await makeProgram().parseAsync(
      ['documents', 'import', 'doc-1', 'huge.md'],
      { from: 'user' },
    );
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SIZE_EXCEEDED' }),
    );
    expect(mockImportDocumentMarkdown).not.toHaveBeenCalled();
  });

  it('surfaces conflict when a concurrent edit has moved the version', async () => {
    mockReadFileSync.mockReturnValue('# body');
    mockImportDocumentMarkdown.mockResolvedValue({ ok: false, reason: 'conflict' });
    await makeProgram().parseAsync(
      ['documents', 'import', 'doc-1', 'local.md'],
      { from: 'user' },
    );
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
  });

  it('surfaces not-found when the doc does not exist', async () => {
    mockReadFileSync.mockReturnValue('# body');
    mockImportDocumentMarkdown.mockResolvedValue({ ok: false, reason: 'not-found' });
    await makeProgram().parseAsync(
      ['documents', 'import', 'doc-1', 'local.md'],
      { from: 'user' },
    );
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DOC_NOT_FOUND' }),
    );
  });
});

describe('documents create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
  });

  it('creates a doc with the supplied title and theme', async () => {
    mockCreateDocumentRecord.mockResolvedValue({
      id: 'doc-2',
      title: 'Fresh Doc',
      themeId: 'serif',
    });
    await makeProgram().parseAsync(
      ['documents', 'create', 'doc-2', '--title', 'Fresh Doc', '--theme', 'serif'],
      { from: 'user' },
    );
    expect(mockCreateDocumentRecord).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', canvasId: 'canvas-1' },
      expect.objectContaining({ id: 'doc-2', title: 'Fresh Doc', themeId: 'serif' }),
    );
  });

  it('seeds markdown from --from when provided', async () => {
    mockReadFileSync.mockReturnValue('# Seeded body');
    mockCreateDocumentRecord.mockResolvedValue({
      id: 'doc-3',
      title: 'Seeded',
      themeId: 'default',
    });
    await makeProgram().parseAsync(
      ['documents', 'create', 'doc-3', '--title', 'Seeded', '--from', 'seed.md'],
      { from: 'user' },
    );
    expect(mockCreateDocumentRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ markdown: '# Seeded body' }),
    );
  });
});

describe('documents delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
  });

  it('prompts for confirmation when stdin is TTY and no --yes', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mockInquirerPrompt.mockResolvedValue({ confirm: true });
    mockDeleteDocumentRecord.mockResolvedValue(undefined);
    await makeProgram().parseAsync(['documents', 'delete', 'doc-1'], { from: 'user' });
    expect(mockInquirerPrompt).toHaveBeenCalled();
    expect(mockDeleteDocumentRecord).toHaveBeenCalled();
  });

  it('aborts when the user says no', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mockInquirerPrompt.mockResolvedValue({ confirm: false });
    await makeProgram().parseAsync(['documents', 'delete', 'doc-1'], { from: 'user' });
    expect(mockDeleteDocumentRecord).not.toHaveBeenCalled();
  });

  it('bypasses the prompt with --yes', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mockDeleteDocumentRecord.mockResolvedValue(undefined);
    await makeProgram().parseAsync(
      ['documents', 'delete', 'doc-1', '--yes'],
      { from: 'user' },
    );
    expect(mockInquirerPrompt).not.toHaveBeenCalled();
    expect(mockDeleteDocumentRecord).toHaveBeenCalled();
  });

  it('refuses to delete without confirm in a non-interactive shell', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    await makeProgram().parseAsync(['documents', 'delete', 'doc-1'], { from: 'user' });
    expect(mockInquirerPrompt).not.toHaveBeenCalled();
    expect(mockDeleteDocumentRecord).not.toHaveBeenCalled();
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NON_INTERACTIVE' }),
    );
  });
});

describe('documents themes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
  });

  it('shows built-in + custom themes for the active workspace', async () => {
    mockListAllDocumentThemes.mockResolvedValue({
      builtIn: [
        { id: 'default', name: 'Default', description: 'Serif, US-Letter.', builtIn: true },
        { id: 'serif', name: 'Serif', description: 'Academic.', builtIn: true },
      ],
      custom: [],
    });
    await makeProgram().parseAsync(['documents', 'themes'], { from: 'user' });
    expect(mockListAllDocumentThemes).toHaveBeenCalledWith('ws-1');
  });

  it('prints the no-customs message when the workspace has none', async () => {
    mockListAllDocumentThemes.mockResolvedValue({
      builtIn: [
        { id: 'default', name: 'Default', builtIn: true },
      ],
      custom: [],
    });
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '));
    });
    await makeProgram().parseAsync(['documents', 'themes'], { from: 'user' });
    logSpy.mockRestore();
    expect(logs.some((l) => l.includes('No workspace custom themes uploaded'))).toBe(true);
  });
});
