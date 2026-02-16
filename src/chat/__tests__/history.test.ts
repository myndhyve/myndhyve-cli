import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock node:fs and node:os BEFORE importing history ────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import {
  saveConversation,
  loadConversation,
  listConversations,
  getLatestConversation,
  deleteConversation,
  clearAllConversations,
  generateSessionId,
  generateTitle,
} from '../history.js';
import type { Conversation } from '../history.js';

// ── Cast mocks ───────────────────────────────────────────────────────────────

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>;
const mockUnlinkSync = unlinkSync as ReturnType<typeof vi.fn>;
const mockReaddirSync = readdirSync as ReturnType<typeof vi.fn>;
const mockMkdirSync = mkdirSync as ReturnType<typeof vi.fn>;

// ── Helpers ──────────────────────────────────────────────────────────────────

const CONVERSATIONS_DIR = '/mock-home/.myndhyve-cli/conversations';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    sessionId: 'chat_test123_abc456',
    title: 'Test conversation',
    messages: [
      {
        role: 'user',
        content: 'Hello',
        timestamp: '2025-01-15T10:00:00.000Z',
      },
      {
        role: 'assistant',
        content: 'Hi there!',
        timestamp: '2025-01-15T10:00:01.000Z',
      },
    ],
    createdAt: '2025-01-15T10:00:00.000Z',
    updatedAt: '2025-01-15T10:00:01.000Z',
    ...overrides,
  };
}

// ── Reset between tests ────────────────────────────────────────────────────

beforeEach(() => {
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockUnlinkSync.mockReset();
  mockReaddirSync.mockReset();
  mockMkdirSync.mockReset();
  (homedir as ReturnType<typeof vi.fn>).mockReturnValue('/mock-home');
});

// ============================================================================
// saveConversation()
// ============================================================================

describe('saveConversation()', () => {
  it('saves valid conversation with restricted permissions (0o600)', () => {
    mockExistsSync.mockReturnValue(true); // dir exists

    const conv = makeConversation();
    saveConversation(conv);

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [path, content, options] = mockWriteFileSync.mock.calls[0];
    expect(path).toBe(`${CONVERSATIONS_DIR}/chat_test123_abc456.json`);
    expect(options).toEqual({ mode: 0o600 });

    // Verify written JSON parses back correctly
    const parsed = JSON.parse(content as string);
    expect(parsed.sessionId).toBe('chat_test123_abc456');
    expect(parsed.title).toBe('Test conversation');
    expect(parsed.messages).toHaveLength(2);
  });

  it('creates conversations directory if it does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    saveConversation(makeConversation());

    expect(mockMkdirSync).toHaveBeenCalledWith(
      CONVERSATIONS_DIR,
      { recursive: true }
    );
  });

  it('sanitizes sessionId to prevent path traversal', () => {
    mockExistsSync.mockReturnValue(true);

    const conv = makeConversation({ sessionId: '../../../etc/passwd' });
    saveConversation(conv);

    const [path] = mockWriteFileSync.mock.calls[0];
    // Slashes and dots should be replaced with underscores
    expect(path).not.toContain('../');
    expect(path).not.toContain('..');
    expect(path).toBe(`${CONVERSATIONS_DIR}/_________etc_passwd.json`);
  });

  it('throws on invalid conversation data', () => {
    mockExistsSync.mockReturnValue(true);

    // @ts-expect-error — intentionally passing invalid data to test Zod validation
    expect(() => saveConversation({ sessionId: '', title: 'Bad' })).toThrow();
  });

  it('saves conversation with optional fields (hyveId, model, provider)', () => {
    mockExistsSync.mockReturnValue(true);

    const conv = makeConversation({
      hyveId: 'landing-page',
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      agentId: 'agent-123',
    });
    saveConversation(conv);

    const [, content] = mockWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed.hyveId).toBe('landing-page');
    expect(parsed.model).toBe('claude-opus-4-6');
    expect(parsed.provider).toBe('anthropic');
    expect(parsed.agentId).toBe('agent-123');
  });
});

// ============================================================================
// loadConversation()
// ============================================================================

describe('loadConversation()', () => {
  it('loads valid conversation from disk', () => {
    const conv = makeConversation();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(conv));

    const result = loadConversation('chat_test123_abc456');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('chat_test123_abc456');
    expect(result!.title).toBe('Test conversation');
    expect(result!.messages).toHaveLength(2);
    expect(result!.messages[0].role).toBe('user');
  });

  it('returns null for non-existent file', () => {
    mockExistsSync.mockReturnValue(false);

    const result = loadConversation('nonexistent-session');

    expect(result).toBeNull();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('returns null for invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not valid json {{{');

    const result = loadConversation('corrupt-session');

    expect(result).toBeNull();
  });

  it('returns null when schema validation fails', () => {
    mockExistsSync.mockReturnValue(true);
    // Valid JSON but missing required fields
    mockReadFileSync.mockReturnValue(JSON.stringify({ sessionId: 'x' }));

    const result = loadConversation('bad-schema');

    expect(result).toBeNull();
  });
});

// ============================================================================
// listConversations()
// ============================================================================

describe('listConversations()', () => {
  it('returns sorted summaries (most recent first)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['old.json', 'new.json', 'readme.txt']);

    const oldConv = makeConversation({
      sessionId: 'old',
      title: 'Old conversation',
      updatedAt: '2025-01-10T10:00:00.000Z',
    });
    const newConv = makeConversation({
      sessionId: 'new',
      title: 'New conversation',
      hyveId: 'app-builder',
      updatedAt: '2025-01-20T10:00:00.000Z',
    });

    mockReadFileSync.mockImplementation((path: string) => {
      if ((path as string).includes('old.json')) return JSON.stringify(oldConv);
      if ((path as string).includes('new.json')) return JSON.stringify(newConv);
      throw new Error('unexpected path');
    });

    const result = listConversations();

    expect(result).toHaveLength(2);
    // Most recent first
    expect(result[0].sessionId).toBe('new');
    expect(result[0].title).toBe('New conversation');
    expect(result[0].hyveId).toBe('app-builder');
    expect(result[0].messageCount).toBe(2);
    expect(result[1].sessionId).toBe('old');
    expect(result[1].title).toBe('Old conversation');
  });

  it('returns empty array when conversations directory does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = listConversations();

    expect(result).toEqual([]);
    expect(mockReaddirSync).not.toHaveBeenCalled();
  });

  it('skips invalid files without throwing', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['valid.json', 'corrupt.json']);

    const validConv = makeConversation({ sessionId: 'valid' });

    mockReadFileSync.mockImplementation((path: string) => {
      if ((path as string).includes('valid.json'))
        return JSON.stringify(validConv);
      return 'not json';
    });

    const result = listConversations();

    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe('valid');
  });

  it('filters out non-JSON files', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['readme.txt', 'notes.md', '.gitkeep']);

    const result = listConversations();

    expect(result).toEqual([]);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });
});

// ============================================================================
// getLatestConversation()
// ============================================================================

describe('getLatestConversation()', () => {
  it('returns most recently updated conversation', () => {
    // First call: existsSync for listConversations dir check
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['older.json', 'newer.json']);

    const olderConv = makeConversation({
      sessionId: 'older',
      title: 'Older',
      updatedAt: '2025-01-01T10:00:00.000Z',
    });
    const newerConv = makeConversation({
      sessionId: 'newer',
      title: 'Newer',
      updatedAt: '2025-01-20T10:00:00.000Z',
    });

    mockReadFileSync.mockImplementation((path: string) => {
      if ((path as string).includes('older.json'))
        return JSON.stringify(olderConv);
      if ((path as string).includes('newer.json'))
        return JSON.stringify(newerConv);
      throw new Error('unexpected path');
    });

    const result = getLatestConversation();

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('newer');
    expect(result!.title).toBe('Newer');
  });

  it('returns null when no conversations exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = getLatestConversation();

    expect(result).toBeNull();
  });
});

// ============================================================================
// deleteConversation()
// ============================================================================

describe('deleteConversation()', () => {
  it('removes file and returns true', () => {
    mockExistsSync.mockReturnValue(true);

    const result = deleteConversation('chat_test123_abc456');

    expect(result).toBe(true);
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      `${CONVERSATIONS_DIR}/chat_test123_abc456.json`
    );
  });

  it('returns false for non-existent conversation', () => {
    mockExistsSync.mockReturnValue(false);

    const result = deleteConversation('does-not-exist');

    expect(result).toBe(false);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});

// ============================================================================
// clearAllConversations()
// ============================================================================

describe('clearAllConversations()', () => {
  it('removes all JSON files and returns count', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      'conv1.json',
      'conv2.json',
      'conv3.json',
      'readme.txt',
    ]);

    const result = clearAllConversations();

    expect(result).toBe(3);
    expect(mockUnlinkSync).toHaveBeenCalledTimes(3);
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      `${CONVERSATIONS_DIR}/conv1.json`
    );
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      `${CONVERSATIONS_DIR}/conv2.json`
    );
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      `${CONVERSATIONS_DIR}/conv3.json`
    );
  });

  it('returns 0 when directory does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = clearAllConversations();

    expect(result).toBe(0);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it('skips files that cannot be deleted without throwing', () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['ok.json', 'locked.json']);
    mockUnlinkSync.mockImplementation((path: string) => {
      if ((path as string).includes('locked.json')) {
        throw new Error('EACCES: permission denied');
      }
    });

    // Should not throw
    const result = clearAllConversations();

    expect(result).toBe(2); // Returns total file count, not successful deletes
    expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// generateSessionId()
// ============================================================================

describe('generateSessionId()', () => {
  it('produces IDs with "chat_" prefix', () => {
    const id = generateSessionId();

    expect(id).toMatch(/^chat_/);
  });

  it('produces unique IDs across multiple calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(generateSessionId());
    }

    // All 50 should be unique
    expect(ids.size).toBe(50);
  });

  it('produces IDs with expected format (chat_timestamp_random)', () => {
    const id = generateSessionId();

    // Format: chat_{base36timestamp}_{base36random}
    const parts = id.split('_');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('chat');
    // Timestamp and random parts should be non-empty alphanumeric
    expect(parts[1]).toMatch(/^[a-z0-9]+$/);
    expect(parts[2]).toMatch(/^[a-z0-9]+$/);
  });
});

// ============================================================================
// generateTitle()
// ============================================================================

describe('generateTitle()', () => {
  it('truncates long messages to 60 characters with ellipsis', () => {
    const longMessage =
      'This is a very long message that should be truncated because it exceeds the sixty character limit';

    const title = generateTitle(longMessage);

    expect(title).toHaveLength(60);
    expect(title).toMatch(/\.\.\.$/);
    expect(title).toBe(longMessage.slice(0, 57) + '...');
  });

  it('returns short messages as-is', () => {
    const shortMessage = 'Hello world';

    const title = generateTitle(shortMessage);

    expect(title).toBe('Hello world');
  });

  it('returns exactly 60-char messages without truncation', () => {
    const exact = 'a'.repeat(60);

    const title = generateTitle(exact);

    expect(title).toBe(exact);
    expect(title).toHaveLength(60);
  });

  it('collapses newlines into spaces', () => {
    const multiline = 'Line one\nLine two\nLine three';

    const title = generateTitle(multiline);

    expect(title).toBe('Line one Line two Line three');
    expect(title).not.toContain('\n');
  });

  it('collapses multiple whitespace into single space', () => {
    const messy = '  Hello   world   how   are   you  ';

    const title = generateTitle(messy);

    expect(title).toBe('Hello world how are you');
  });

  it('handles empty string', () => {
    const title = generateTitle('');

    expect(title).toBe('');
  });
});
