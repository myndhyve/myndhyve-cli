import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';

const {
  mockRequireAuth,
  mockPrintError,
  mockGetActiveContext,
  mockListDecks,
  mockGetDeck,
  mockImportDeckMarkdown,
  mockCreateDeck,
  mockDeleteDeck,
  mockListAllThemes,
  mockReadFileSync,
  mockWriteFileSync,
  mockMkdtempSync,
  mockRmSync,
  mockPrintErrorResult,
  mockPrintSuccess,
  mockSpawn,
  mockInquirerPrompt,
} = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockPrintError: vi.fn(),
  mockGetActiveContext: vi.fn(),
  mockListDecks: vi.fn(),
  mockGetDeck: vi.fn(),
  mockImportDeckMarkdown: vi.fn(),
  mockCreateDeck: vi.fn(),
  mockDeleteDeck: vi.fn(),
  mockListAllThemes: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdtempSync: vi.fn(),
  mockRmSync: vi.fn(),
  mockPrintErrorResult: vi.fn(),
  mockPrintSuccess: vi.fn(),
  mockSpawn: vi.fn(),
  mockInquirerPrompt: vi.fn(),
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

vi.mock('../../api/slides.js', () => ({
  listDecks: (...args: unknown[]) => mockListDecks(...args),
  getDeck: (...args: unknown[]) => mockGetDeck(...args),
  importDeckMarkdown: (...args: unknown[]) => mockImportDeckMarkdown(...args),
  createDeck: (...args: unknown[]) => mockCreateDeck(...args),
  deleteDeck: (...args: unknown[]) => mockDeleteDeck(...args),
  listAllThemes: (...args: unknown[]) => mockListAllThemes(...args),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    mkdtempSync: (...args: unknown[]) => mockMkdtempSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
  };
});

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: (...args: unknown[]) => mockSpawn(...args),
  };
});

vi.mock('inquirer', () => ({
  default: { prompt: (...args: unknown[]) => mockInquirerPrompt(...args) },
}));

vi.mock('../../utils/output.js', () => ({
  ExitCode: { SUCCESS: 0, GENERAL_ERROR: 1, USAGE_ERROR: 2, NOT_FOUND: 3, UNAUTHORIZED: 4 },
  printErrorResult: (...args: unknown[]) => mockPrintErrorResult(...args),
  printResult: (data: unknown, formatter?: () => void) => {
    if (formatter) formatter();
  },
  printSuccess: (...args: unknown[]) => mockPrintSuccess(...args),
}));

import { registerSlidesCommands } from '../slides.js';

const AUTH = { uid: 'user-1', email: 't@t.com' };
const CONTEXT_OK = {
  projectId: 'p1',
  projectName: 'Test project',
  canvasTypeId: 'slides',
  canvasId: 'canvas-1',
  workspaceId: 'ws-1',
  setAt: '2026-04-19T12:00:00Z',
};

function makeProgram(): Command {
  const program = new Command();
  registerSlidesCommands(program);
  return program;
}

describe('slides CLI — context guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
  });

  it('rejects when no active context is set', async () => {
    mockGetActiveContext.mockReturnValue(null);
    await makeProgram().parseAsync(['slides', 'list'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NO_ACTIVE_CONTEXT' }),
    );
    expect(mockListDecks).not.toHaveBeenCalled();
  });

  it('rejects when active context lacks a workspaceId', async () => {
    mockGetActiveContext.mockReturnValue({ ...CONTEXT_OK, workspaceId: undefined });
    await makeProgram().parseAsync(['slides', 'list'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NO_WORKSPACE' }),
    );
  });

  it('rejects when canvas type is not slides', async () => {
    mockGetActiveContext.mockReturnValue({ ...CONTEXT_OK, canvasTypeId: 'app-builder' });
    await makeProgram().parseAsync(['slides', 'list'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'WRONG_CANVAS_TYPE' }),
    );
  });

  it('rejects when no canvasId', async () => {
    mockGetActiveContext.mockReturnValue({ ...CONTEXT_OK, canvasId: undefined });
    await makeProgram().parseAsync(['slides', 'list'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NO_CANVAS' }),
    );
  });
});

describe('slides list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
  });

  it('lists decks using the active workspaceId + canvasId', async () => {
    mockListDecks.mockResolvedValue([
      { id: 'deck-1', title: 'Q4 Review', themeId: 'default', slideCount: 5, version: 3 },
    ]);
    await makeProgram().parseAsync(['slides', 'list'], { from: 'user' });
    expect(mockListDecks).toHaveBeenCalledWith({ workspaceId: 'ws-1', canvasId: 'canvas-1' });
  });
});

describe('slides show', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
  });

  it('prints deck metadata when the deck exists', async () => {
    mockGetDeck.mockResolvedValue({
      id: 'deck-1',
      canvasId: 'canvas-1',
      title: 'Q4',
      themeId: 'myndhyve',
      markdown: '# A\n\n---\n\n# B',
      slideOffsets: [6],
      aspectRatio: '16:9',
      version: 2,
    });
    await makeProgram().parseAsync(['slides', 'show', 'deck-1'], { from: 'user' });
    expect(mockGetDeck).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', canvasId: 'canvas-1' },
      'deck-1',
    );
    expect(mockPrintErrorResult).not.toHaveBeenCalled();
  });

  it('surfaces a NOT_FOUND error when the deck is missing', async () => {
    mockGetDeck.mockResolvedValue(null);
    await makeProgram().parseAsync(['slides', 'show', 'missing'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DECK_NOT_FOUND' }),
    );
  });
});

describe('slides export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
  });

  it('writes to the file passed via --output', async () => {
    mockGetDeck.mockResolvedValue({
      id: 'deck-1',
      canvasId: 'canvas-1',
      title: 'Q4',
      themeId: 'default',
      markdown: '# hello',
      slideOffsets: [],
      aspectRatio: '16:9',
      version: 1,
    });
    await makeProgram().parseAsync(
      ['slides', 'export', 'deck-1', '--output', '/tmp/out.md'],
      { from: 'user' },
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/\/tmp\/out\.md$/),
      '# hello',
      'utf8',
    );
  });
});

describe('slides import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
    mockReadFileSync.mockReturnValue('# imported content');
  });

  it('passes the deck id + file markdown + uid to importDeckMarkdown', async () => {
    mockImportDeckMarkdown.mockResolvedValue({
      ok: true,
      deck: {
        id: 'deck-1',
        markdown: '# imported content',
        slideOffsets: [],
        version: 4,
      },
    });
    await makeProgram().parseAsync(
      ['slides', 'import', 'deck-1', 'deck.md', '--theme', 'gaia'],
      { from: 'user' },
    );
    expect(mockImportDeckMarkdown).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', canvasId: 'canvas-1' },
      {
        deckId: 'deck-1',
        markdown: '# imported content',
        themeId: 'gaia',
        updatedBy: 'user-1',
      },
    );
  });

  it('surfaces a DECK_VERSION_CONFLICT on concurrent edit', async () => {
    mockImportDeckMarkdown.mockResolvedValue({ ok: false, reason: 'conflict' });
    await makeProgram().parseAsync(
      ['slides', 'import', 'deck-1', 'deck.md'],
      { from: 'user' },
    );
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DECK_VERSION_CONFLICT' }),
    );
  });

  it('surfaces DECK_NOT_FOUND when the target deck is missing', async () => {
    mockImportDeckMarkdown.mockResolvedValue({ ok: false, reason: 'not-found' });
    await makeProgram().parseAsync(
      ['slides', 'import', 'missing', 'deck.md'],
      { from: 'user' },
    );
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DECK_NOT_FOUND' }),
    );
  });
});

describe('slides create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
  });

  it('creates a deck when no existing deck has the id', async () => {
    mockGetDeck.mockResolvedValue(null);
    mockCreateDeck.mockResolvedValue({
      id: 'new-deck',
      title: 'Hello',
      themeId: 'default',
      aspectRatio: '16:9',
      version: 0,
    });
    await makeProgram().parseAsync(
      ['slides', 'create', 'new-deck', '--title', 'Hello'],
      { from: 'user' },
    );
    expect(mockCreateDeck).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', canvasId: 'canvas-1' },
      expect.objectContaining({ id: 'new-deck', title: 'Hello', updatedBy: 'user-1' }),
    );
  });

  it('rejects when a deck with that id already exists', async () => {
    mockGetDeck.mockResolvedValue({ id: 'existing' });
    await makeProgram().parseAsync(
      ['slides', 'create', 'existing', '--title', 'x'],
      { from: 'user' },
    );
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DECK_EXISTS' }),
    );
    expect(mockCreateDeck).not.toHaveBeenCalled();
  });

  it('seeds markdown from --from when provided', async () => {
    mockGetDeck.mockResolvedValue(null);
    mockReadFileSync.mockReturnValue('# seed');
    mockCreateDeck.mockResolvedValue({
      id: 'seeded',
      title: 'Seeded',
      themeId: 'default',
      aspectRatio: '16:9',
      version: 0,
    });
    await makeProgram().parseAsync(
      ['slides', 'create', 'seeded', '--title', 'Seeded', '--from', 'seed.md'],
      { from: 'user' },
    );
    expect(mockCreateDeck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ markdown: '# seed' }),
    );
  });
});

describe('slides delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
    mockGetDeck.mockResolvedValue({
      id: 'deck-1',
      title: 'Q4 Review',
      slideOffsets: [6],
      version: 3,
    });
    mockDeleteDeck.mockResolvedValue(undefined);
  });

  it('deletes a deck after inquirer confirmation', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: true,
    });
    mockInquirerPrompt.mockResolvedValue({ confirm: true });
    await makeProgram().parseAsync(['slides', 'delete', 'deck-1'], { from: 'user' });
    expect(mockInquirerPrompt).toHaveBeenCalledTimes(1);
    expect(mockDeleteDeck).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', canvasId: 'canvas-1' },
      'deck-1',
    );
  });

  it('aborts deletion when the user declines the confirm prompt', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: true,
    });
    mockInquirerPrompt.mockResolvedValue({ confirm: false });
    await makeProgram().parseAsync(['slides', 'delete', 'deck-1'], { from: 'user' });
    expect(mockDeleteDeck).not.toHaveBeenCalled();
  });

  it('bypasses the prompt with --yes', async () => {
    mockInquirerPrompt.mockResolvedValue({ confirm: false });
    await makeProgram().parseAsync(['slides', 'delete', 'deck-1', '--yes'], { from: 'user' });
    expect(mockInquirerPrompt).not.toHaveBeenCalled();
    expect(mockDeleteDeck).toHaveBeenCalled();
  });

  it('refuses to delete non-interactively without --yes', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    });
    await makeProgram().parseAsync(['slides', 'delete', 'deck-1'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CONFIRMATION_REQUIRED' }),
    );
    expect(mockDeleteDeck).not.toHaveBeenCalled();
  });

  it('surfaces DECK_NOT_FOUND when the deck is missing', async () => {
    mockGetDeck.mockResolvedValue(null);
    await makeProgram().parseAsync(['slides', 'delete', 'missing', '--yes'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DECK_NOT_FOUND' }),
    );
    expect(mockDeleteDeck).not.toHaveBeenCalled();
  });
});

describe('slides themes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
  });

  it('runs with only workspaceId required (no canvas type guard)', async () => {
    mockGetActiveContext.mockReturnValue({
      ...CONTEXT_OK,
      canvasTypeId: 'app-builder',
      canvasId: undefined,
    });
    mockListAllThemes.mockResolvedValue([
      { id: 'default', name: 'default', isBuiltIn: true, description: 'Marp default' },
    ]);
    await makeProgram().parseAsync(['slides', 'themes'], { from: 'user' });
    expect(mockListAllThemes).toHaveBeenCalledWith('ws-1');
    expect(mockPrintErrorResult).not.toHaveBeenCalled();
  });

  it('surfaces NO_WORKSPACE when the active context has no workspaceId', async () => {
    mockGetActiveContext.mockReturnValue({ ...CONTEXT_OK, workspaceId: undefined });
    await makeProgram().parseAsync(['slides', 'themes'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NO_WORKSPACE' }),
    );
    expect(mockListAllThemes).not.toHaveBeenCalled();
  });

  it('separates built-ins from workspace custom themes in output', async () => {
    mockListAllThemes.mockResolvedValue([
      { id: 'default', name: 'default', isBuiltIn: true },
      { id: 'gaia', name: 'gaia', isBuiltIn: true },
      { id: 'team-alpha', name: 'team-alpha', isBuiltIn: false, description: 'Brand theme' },
    ]);
    await makeProgram().parseAsync(['slides', 'themes'], { from: 'user' });
    expect(mockListAllThemes).toHaveBeenCalledTimes(1);
  });
});

describe('slides present', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockReturnValue(AUTH);
    mockGetActiveContext.mockReturnValue(CONTEXT_OK);
    mockGetDeck.mockResolvedValue({
      id: 'deck-1',
      title: 'Q4',
      markdown: '# Hello',
      slideOffsets: [],
      version: 1,
    });
    mockMkdtempSync.mockReturnValue('/tmp/myndhyve-slides-abc');
    // Default child behaviour: resolve with exit code 0.
    mockSpawn.mockImplementation(() => {
      const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
      return {
        on(evt: string, cb: (...a: unknown[]) => void) {
          (handlers[evt] ||= []).push(cb);
          // Fire exit on the next tick with code 0 so the promise resolves.
          if (evt === 'exit') {
            queueMicrotask(() => cb(0));
          }
          return this;
        },
      };
    });
  });

  it('spawns npx -y @marp-team/marp-cli by default', async () => {
    await makeProgram().parseAsync(['slides', 'present', 'deck-1'], { from: 'user' });
    expect(mockSpawn).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining(['-y', '@marp-team/marp-cli', '--server']),
      expect.objectContaining({ stdio: 'inherit' }),
    );
  });

  it('uses a local marp binary when --marp is supplied', async () => {
    await makeProgram().parseAsync(
      ['slides', 'present', 'deck-1', '--marp', '/usr/local/bin/marp'],
      { from: 'user' },
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/local/bin/marp',
      expect.arrayContaining(['--server']),
      expect.objectContaining({ stdio: 'inherit' }),
    );
  });

  it('writes the deck markdown to the temp directory', async () => {
    await makeProgram().parseAsync(['slides', 'present', 'deck-1'], { from: 'user' });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/deck-1\.md$/),
      '# Hello',
      'utf8',
    );
  });

  it('honours --port when assembling the argv', async () => {
    await makeProgram().parseAsync(
      ['slides', 'present', 'deck-1', '--port', '9090'],
      { from: 'user' },
    );
    const [, argv] = mockSpawn.mock.calls[0];
    expect(argv).toContain('9090');
  });

  it('surfaces MARP_NOT_FOUND when spawn emits ENOENT', async () => {
    mockSpawn.mockImplementation(() => {
      return {
        on(evt: string, cb: (err: NodeJS.ErrnoException) => void) {
          if (evt === 'error') {
            const err = new Error('ENOENT') as NodeJS.ErrnoException;
            err.code = 'ENOENT';
            queueMicrotask(() => cb(err));
          }
          return this;
        },
      };
    });
    await makeProgram().parseAsync(['slides', 'present', 'deck-1'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'MARP_NOT_FOUND' }),
    );
  });

  it('surfaces DECK_NOT_FOUND if the deck is missing', async () => {
    mockGetDeck.mockResolvedValue(null);
    await makeProgram().parseAsync(['slides', 'present', 'missing'], { from: 'user' });
    expect(mockPrintErrorResult).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DECK_NOT_FOUND' }),
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
