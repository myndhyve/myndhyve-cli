import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock variables — available inside vi.mock() factories
// ---------------------------------------------------------------------------

const { mockExecFileAsync, mockExistsSync, mockHomedir, mockSleep } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockHomedir: vi.fn(() => '/Users/testuser'),
  mockSleep: vi.fn((_ms: number) => Promise.resolve()),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:util', () => ({ promisify: () => mockExecFileAsync }));
vi.mock('node:os', () => ({ homedir: () => mockHomedir() }));
vi.mock('node:fs', () => ({ existsSync: (...args: unknown[]) => mockExistsSync(...args) }));
vi.mock('../../../utils/backoff.js', () => ({ sleep: (ms: number) => mockSleep(ms) }));
vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import {
  getChatDbPath,
  coreDataTimestampToDate,
  queryChatDb,
  getMaxRowId,
  queryNewMessages,
  queryAttachments,
  normalizeIMessage,
  pollIMessages,
} from '../receive.js';

import type { ChatDbMessageRow, ChatDbAttachmentRow } from '../types.js';
import { CORE_DATA_EPOCH_OFFSET, NANOSECOND_DIVISOR } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessageRow(overrides: Partial<ChatDbMessageRow> = {}): ChatDbMessageRow {
  return {
    rowid: 100,
    text: 'Hello there',
    date: 700_000_000_000_000_000, // ~22.18 years after 2001
    sender: '+15551234567',
    chat_identifier: '+15551234567',
    display_name: null,
    group_id: null,
    associated_message_guid: null,
    cache_has_attachments: 0,
    guid: 'msg-guid-abc-123',
    ...overrides,
  };
}

function makeAttachmentRow(overrides: Partial<ChatDbAttachmentRow> = {}): ChatDbAttachmentRow {
  return {
    message_id: 100,
    filename: '/Users/testuser/Library/Messages/Attachments/photo.jpg',
    mime_type: 'image/jpeg',
    total_bytes: 102400,
    transfer_name: 'photo.jpg',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockExecFileAsync.mockReset();
  mockExistsSync.mockReset();
  mockHomedir.mockReset();
  mockSleep.mockReset();

  mockHomedir.mockReturnValue('/Users/testuser');
  mockSleep.mockImplementation(() => Promise.resolve());
  // Default: return empty result so the poll loop never blows up on unexpected calls
  mockExecFileAsync.mockResolvedValue({ stdout: '[]', stderr: '' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// getChatDbPath()
// ============================================================================

describe('getChatDbPath()', () => {
  it('returns correct path using homedir + Library/Messages/chat.db', () => {
    mockHomedir.mockReturnValue('/Users/alice');

    const result = getChatDbPath();

    expect(result).toBe('/Users/alice/Library/Messages/chat.db');
  });

  it('uses the current homedir value', () => {
    mockHomedir.mockReturnValue('/home/bob');

    const result = getChatDbPath();

    expect(result).toBe('/home/bob/Library/Messages/chat.db');
  });
});

// ============================================================================
// coreDataTimestampToDate()
// ============================================================================

describe('coreDataTimestampToDate()', () => {
  it('converts zero timestamp to Core Data epoch (2001-01-01T00:00:00Z)', () => {
    const result = coreDataTimestampToDate(0);

    expect(result.toISOString()).toBe('2001-01-01T00:00:00.000Z');
  });

  it('converts a known Core Data timestamp to correct Date', () => {
    // 1 second after epoch = 1_000_000_000 nanoseconds
    const oneSecondNano = NANOSECOND_DIVISOR;
    const result = coreDataTimestampToDate(oneSecondNano);

    // 2001-01-01T00:00:01Z
    const expected = new Date((CORE_DATA_EPOCH_OFFSET + 1) * 1000);
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('converts a recent timestamp correctly', () => {
    // ~23 years after 2001-01-01 in nanoseconds ≈ 2024
    const secondsSinceEpoch = 23 * 365.25 * 24 * 3600; // ~23 years
    const nanoseconds = secondsSinceEpoch * NANOSECOND_DIVISOR;
    const result = coreDataTimestampToDate(nanoseconds);

    const expectedUnix = (secondsSinceEpoch + CORE_DATA_EPOCH_OFFSET) * 1000;
    expect(result.getTime()).toBeCloseTo(expectedUnix, -2); // close to ~ms
  });
});

// ============================================================================
// queryChatDb()
// ============================================================================

describe('queryChatDb()', () => {
  it('calls sqlite3 CLI with correct args (-json, -readonly, dbPath, query)', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '[]', stderr: '' });

    await queryChatDb('/path/to/chat.db', 'SELECT 1;');

    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'sqlite3',
      ['-json', '-readonly', '/path/to/chat.db', 'SELECT 1;'],
      { timeout: 10_000 },
    );
  });

  it('parses JSON output from sqlite3', async () => {
    const rows = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
    mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify(rows), stderr: '' });

    const result = await queryChatDb('/path/to/chat.db', 'SELECT * FROM users;');

    expect(result).toEqual(rows);
  });

  it('returns empty array for empty output', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const result = await queryChatDb('/path/to/chat.db', 'SELECT * FROM empty_table;');

    expect(result).toEqual([]);
  });

  it('returns empty array for whitespace-only output', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '  \n  ', stderr: '' });

    const result = await queryChatDb('/path/to/chat.db', 'SELECT * FROM empty_table;');

    expect(result).toEqual([]);
  });

  it('throws on sqlite3 "no such table" error with schema mismatch message', async () => {
    mockExecFileAsync.mockRejectedValue(new Error('Error: no such table: message'));

    await expect(queryChatDb('/path/to/chat.db', 'SELECT * FROM message;'))
      .rejects.toThrow('Messages database schema mismatch');
  });

  it('re-throws other sqlite3 errors as-is', async () => {
    const originalError = new Error('database is locked');
    mockExecFileAsync.mockRejectedValue(originalError);

    await expect(queryChatDb('/path/to/chat.db', 'SELECT 1;'))
      .rejects.toBe(originalError);
  });

  it('re-throws non-Error rejection values', async () => {
    mockExecFileAsync.mockRejectedValue('some string error');

    await expect(queryChatDb('/path/to/chat.db', 'SELECT 1;'))
      .rejects.toBe('some string error');
  });
});

// ============================================================================
// getMaxRowId()
// ============================================================================

describe('getMaxRowId()', () => {
  it('returns max_rowid from query result', async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: JSON.stringify([{ max_rowid: 42 }]),
      stderr: '',
    });

    const result = await getMaxRowId('/path/to/chat.db');

    expect(result).toBe(42);
  });

  it('returns 0 when table is empty (null result)', async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: JSON.stringify([{ max_rowid: null }]),
      stderr: '',
    });

    const result = await getMaxRowId('/path/to/chat.db');

    expect(result).toBe(0);
  });

  it('returns 0 when query returns no rows', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const result = await getMaxRowId('/path/to/chat.db');

    expect(result).toBe(0);
  });
});

// ============================================================================
// queryNewMessages()
// ============================================================================

describe('queryNewMessages()', () => {
  it('passes correct SQL query with sinceRowId filter', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '[]', stderr: '' });

    await queryNewMessages('/path/to/chat.db', 500);

    expect(mockExecFileAsync).toHaveBeenCalledOnce();
    const query = mockExecFileAsync.mock.calls[0][1][3] as string;
    expect(query).toContain('m.ROWID > 500');
    expect(query).toContain('m.is_from_me = 0');
    expect(query).toContain('ORDER BY m.ROWID ASC');
    expect(query).toContain('LIMIT 100');
  });

  it('returns typed ChatDbMessageRow array', async () => {
    const rows: ChatDbMessageRow[] = [makeMessageRow({ rowid: 501 }), makeMessageRow({ rowid: 502 })];
    mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify(rows), stderr: '' });

    const result = await queryNewMessages('/path/to/chat.db', 500);

    expect(result).toHaveLength(2);
    expect(result[0].rowid).toBe(501);
    expect(result[1].rowid).toBe(502);
  });
});

// ============================================================================
// queryAttachments()
// ============================================================================

describe('queryAttachments()', () => {
  it('passes correct SQL with message ID list', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '[]', stderr: '' });

    await queryAttachments('/path/to/chat.db', [100, 200, 300]);

    expect(mockExecFileAsync).toHaveBeenCalledOnce();
    const query = mockExecFileAsync.mock.calls[0][1][3] as string;
    expect(query).toContain('IN (100,200,300)');
    expect(query).toContain('message_attachment_join');
  });

  it('returns typed ChatDbAttachmentRow array', async () => {
    const rows: ChatDbAttachmentRow[] = [
      makeAttachmentRow({ message_id: 100 }),
      makeAttachmentRow({ message_id: 200, mime_type: 'video/mp4' }),
    ];
    mockExecFileAsync.mockResolvedValue({ stdout: JSON.stringify(rows), stderr: '' });

    const result = await queryAttachments('/path/to/chat.db', [100, 200]);

    expect(result).toHaveLength(2);
    expect(result[0].message_id).toBe(100);
    expect(result[1].mime_type).toBe('video/mp4');
  });
});

// ============================================================================
// normalizeIMessage()
// ============================================================================

describe('normalizeIMessage()', () => {
  it('normalizes a basic 1:1 text message', () => {
    const row = makeMessageRow();

    const result = normalizeIMessage(row);

    expect(result).not.toBeNull();
    expect(result!.text).toBe('Hello there');
    expect(result!.isGroup).toBe(false);
    expect(result!.groupName).toBeUndefined();
  });

  it('sets correct channel to "imessage"', () => {
    const row = makeMessageRow();

    const result = normalizeIMessage(row);

    expect(result!.channel).toBe('imessage');
  });

  it('uses guid as platformMessageId', () => {
    const row = makeMessageRow({ guid: 'unique-msg-guid-xyz' });

    const result = normalizeIMessage(row);

    expect(result!.platformMessageId).toBe('unique-msg-guid-xyz');
  });

  it('sets conversationId to chat_identifier', () => {
    const row = makeMessageRow({ chat_identifier: '+15559876543' });

    const result = normalizeIMessage(row);

    expect(result!.conversationId).toBe('+15559876543');
  });

  it('sets peerId to sender', () => {
    const row = makeMessageRow({ sender: '+15559876543' });

    const result = normalizeIMessage(row);

    expect(result!.peerId).toBe('+15559876543');
  });

  it('normalizes a group message (sets isGroup, groupName)', () => {
    const row = makeMessageRow({
      group_id: 'chat123456789',
      display_name: 'Team Chat',
      chat_identifier: 'chat123456789',
    });

    const result = normalizeIMessage(row);

    expect(result).not.toBeNull();
    expect(result!.isGroup).toBe(true);
    expect(result!.groupName).toBe('Team Chat');
  });

  it('returns null for empty message (no text, no attachments)', () => {
    const row = makeMessageRow({ text: null });

    const result = normalizeIMessage(row);

    expect(result).toBeNull();
  });

  it('returns null for empty string text with no attachments', () => {
    const row = makeMessageRow({ text: '' });

    const result = normalizeIMessage(row);

    expect(result).toBeNull();
  });

  it('converts Core Data timestamp to ISO string correctly', () => {
    // 0 nanoseconds = Core Data epoch = 2001-01-01T00:00:00.000Z
    const row = makeMessageRow({ date: 0 });

    const result = normalizeIMessage(row);

    expect(result!.timestamp).toBe('2001-01-01T00:00:00.000Z');
  });

  it('includes attachments when present', () => {
    const row = makeMessageRow({ text: 'See this' });
    const attachments: ChatDbAttachmentRow[] = [
      makeAttachmentRow({ filename: '/path/to/image.jpg', mime_type: 'image/jpeg' }),
    ];

    const result = normalizeIMessage(row, attachments);

    expect(result!.media).toBeDefined();
    expect(result!.media).toHaveLength(1);
    expect(result!.media![0].ref).toBe('/path/to/image.jpg');
    expect(result!.media![0].mimeType).toBe('image/jpeg');
    expect(result!.media![0].kind).toBe('image');
  });

  it('classifies image MIME types correctly', () => {
    const row = makeMessageRow();
    const attachments: ChatDbAttachmentRow[] = [
      makeAttachmentRow({ mime_type: 'image/png', filename: '/f.png' }),
    ];

    const result = normalizeIMessage(row, attachments);

    expect(result!.media![0].kind).toBe('image');
  });

  it('classifies video MIME types correctly', () => {
    const row = makeMessageRow();
    const attachments: ChatDbAttachmentRow[] = [
      makeAttachmentRow({ mime_type: 'video/mp4', filename: '/f.mp4' }),
    ];

    const result = normalizeIMessage(row, attachments);

    expect(result!.media![0].kind).toBe('video');
  });

  it('classifies audio MIME types correctly', () => {
    const row = makeMessageRow();
    const attachments: ChatDbAttachmentRow[] = [
      makeAttachmentRow({ mime_type: 'audio/mpeg', filename: '/f.mp3' }),
    ];

    const result = normalizeIMessage(row, attachments);

    expect(result!.media![0].kind).toBe('audio');
  });

  it('classifies unknown MIME types as document', () => {
    const row = makeMessageRow();
    const attachments: ChatDbAttachmentRow[] = [
      makeAttachmentRow({ mime_type: 'application/pdf', filename: '/f.pdf' }),
    ];

    const result = normalizeIMessage(row, attachments);

    expect(result!.media![0].kind).toBe('document');
  });

  it('classifies null MIME type as document', () => {
    const row = makeMessageRow();
    const attachments: ChatDbAttachmentRow[] = [
      makeAttachmentRow({ mime_type: null, filename: '/unknown' }),
    ];

    const result = normalizeIMessage(row, attachments);

    expect(result!.media![0].kind).toBe('document');
  });

  it('skips attachments without filenames', () => {
    const row = makeMessageRow();
    const attachments: ChatDbAttachmentRow[] = [
      makeAttachmentRow({ filename: null }),
      makeAttachmentRow({ filename: '/path/to/real.jpg', mime_type: 'image/jpeg' }),
    ];

    const result = normalizeIMessage(row, attachments);

    expect(result!.media).toHaveLength(1);
    expect(result!.media![0].ref).toBe('/path/to/real.jpg');
  });

  it('sets media to undefined when no valid attachments are present', () => {
    const row = makeMessageRow();
    const attachments: ChatDbAttachmentRow[] = [
      makeAttachmentRow({ filename: null }), // skipped — no filename
    ];

    const result = normalizeIMessage(row, attachments);

    expect(result!.media).toBeUndefined();
  });

  it('returns non-null for media-only message (no text but has attachment)', () => {
    const row = makeMessageRow({ text: null });
    const attachments: ChatDbAttachmentRow[] = [
      makeAttachmentRow({ filename: '/path/to/photo.png', mime_type: 'image/png' }),
    ];

    const result = normalizeIMessage(row, attachments);

    expect(result).not.toBeNull();
    expect(result!.text).toBe('');
    expect(result!.media).toHaveLength(1);
  });

  it('includes fileName, size, and mimeType from attachment', () => {
    const row = makeMessageRow();
    const attachments: ChatDbAttachmentRow[] = [
      makeAttachmentRow({
        filename: '/path/to/doc.pdf',
        mime_type: 'application/pdf',
        total_bytes: 2048,
        transfer_name: 'important-doc.pdf',
      }),
    ];

    const result = normalizeIMessage(row, attachments);

    expect(result!.media![0]).toEqual({
      kind: 'document',
      ref: '/path/to/doc.pdf',
      mimeType: 'application/pdf',
      fileName: 'important-doc.pdf',
      size: 2048,
    });
  });

  it('sets peerDisplay to undefined (Messages.app does not expose contact names)', () => {
    const row = makeMessageRow();

    const result = normalizeIMessage(row);

    expect(result!.peerDisplay).toBeUndefined();
  });
});

// ============================================================================
// pollIMessages()
// ============================================================================

describe('pollIMessages()', () => {
  it('throws when chat.db not found', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(pollIMessages(vi.fn(), AbortSignal.abort()))
      .rejects.toThrow('Messages database not found');
  });

  it('throws with helpful message about Messages.app', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(pollIMessages(vi.fn(), AbortSignal.abort()))
      .rejects.toThrow('Ensure Messages.app has been opened at least once');
  });

  it('calls getMaxRowId on start', async () => {
    const controller = new AbortController();
    mockExistsSync.mockReturnValue(true);
    // getMaxRowId query
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([{ max_rowid: 50 }]),
      stderr: '',
    });
    // Abort immediately after first poll starts
    mockSleep.mockImplementation(async () => { controller.abort(); });
    // First poll: no new messages
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '[]', stderr: '' });

    await pollIMessages(vi.fn(), controller.signal);

    // First call is getMaxRowId, verify it happened
    const firstQuery = mockExecFileAsync.mock.calls[0][1][3] as string;
    expect(firstQuery).toContain('MAX(ROWID)');
  });

  it('queries new messages each poll cycle', async () => {
    const controller = new AbortController();
    let pollCount = 0;
    mockExistsSync.mockReturnValue(true);
    // getMaxRowId
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([{ max_rowid: 50 }]),
      stderr: '',
    });
    // First poll: no messages
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '[]', stderr: '' });
    // Second poll: no messages
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '[]', stderr: '' });

    mockSleep.mockImplementation(async () => {
      pollCount++;
      if (pollCount >= 2) controller.abort();
    });

    await pollIMessages(vi.fn(), controller.signal);

    // 1 for getMaxRowId + 2 for poll cycles = 3 calls
    expect(mockExecFileAsync).toHaveBeenCalledTimes(3);
  });

  it('calls onInbound for each normalized message', async () => {
    const controller = new AbortController();
    const onInbound = vi.fn().mockResolvedValue(undefined);

    mockExistsSync.mockReturnValue(true);
    // getMaxRowId
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([{ max_rowid: 50 }]),
      stderr: '',
    });
    // First poll: two messages
    const messages: ChatDbMessageRow[] = [
      makeMessageRow({ rowid: 51, text: 'First message', guid: 'guid-1' }),
      makeMessageRow({ rowid: 52, text: 'Second message', guid: 'guid-2' }),
    ];
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify(messages),
      stderr: '',
    });

    mockSleep.mockImplementation(async () => { controller.abort(); });

    await pollIMessages(onInbound, controller.signal);

    expect(onInbound).toHaveBeenCalledTimes(2);
    expect(onInbound.mock.calls[0][0].platformMessageId).toBe('guid-1');
    expect(onInbound.mock.calls[1][0].platformMessageId).toBe('guid-2');
  });

  it('advances watermark after processing messages', async () => {
    const controller = new AbortController();
    let pollCount = 0;
    const onInbound = vi.fn().mockResolvedValue(undefined);

    mockExistsSync.mockReturnValue(true);
    // getMaxRowId
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([{ max_rowid: 50 }]),
      stderr: '',
    });
    // First poll: returns message with rowid 55
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([makeMessageRow({ rowid: 55, text: 'msg' })]),
      stderr: '',
    });
    // Second poll: should query with sinceRowId=55
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '[]', stderr: '' });

    mockSleep.mockImplementation(async () => {
      pollCount++;
      if (pollCount >= 2) controller.abort();
    });

    await pollIMessages(onInbound, controller.signal);

    // The second query (third call) should use rowid 55
    const secondPollQuery = mockExecFileAsync.mock.calls[2][1][3] as string;
    expect(secondPollQuery).toContain('m.ROWID > 55');
  });

  it('stops when signal is aborted', async () => {
    const controller = new AbortController();
    mockExistsSync.mockReturnValue(true);
    // getMaxRowId
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([{ max_rowid: 0 }]),
      stderr: '',
    });
    // Abort before any poll
    controller.abort();

    await pollIMessages(vi.fn(), controller.signal);

    // Only getMaxRowId should have been called, no poll queries
    expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
  });

  it('handles query errors gracefully (logs warning, continues)', async () => {
    const controller = new AbortController();
    let pollCount = 0;
    const onInbound = vi.fn().mockResolvedValue(undefined);

    mockExistsSync.mockReturnValue(true);
    // getMaxRowId
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([{ max_rowid: 0 }]),
      stderr: '',
    });
    // First poll: fails
    mockExecFileAsync.mockRejectedValueOnce(new Error('database is locked'));
    // Second poll: succeeds with no messages
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '[]', stderr: '' });

    mockSleep.mockImplementation(async () => {
      pollCount++;
      if (pollCount >= 2) controller.abort();
    });

    // Should not throw
    await pollIMessages(onInbound, controller.signal);

    // Should have attempted the second poll after the error
    expect(mockExecFileAsync).toHaveBeenCalledTimes(3);
  });

  it('handles onInbound errors gracefully (logs warning, continues to next message)', async () => {
    const controller = new AbortController();
    const onInbound = vi.fn()
      .mockRejectedValueOnce(new Error('forwarding failed'))
      .mockResolvedValueOnce(undefined);

    mockExistsSync.mockReturnValue(true);
    // getMaxRowId
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([{ max_rowid: 50 }]),
      stderr: '',
    });
    // First poll: two messages — first will fail, second should succeed
    const messages: ChatDbMessageRow[] = [
      makeMessageRow({ rowid: 51, text: 'Fails', guid: 'guid-fail' }),
      makeMessageRow({ rowid: 52, text: 'Succeeds', guid: 'guid-ok' }),
    ];
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify(messages),
      stderr: '',
    });

    mockSleep.mockImplementation(async () => { controller.abort(); });

    await pollIMessages(onInbound, controller.signal);

    // Both messages should have been attempted
    expect(onInbound).toHaveBeenCalledTimes(2);
    expect(onInbound.mock.calls[1][0].platformMessageId).toBe('guid-ok');
  });

  it('fetches attachments for messages with cache_has_attachments=1', async () => {
    const controller = new AbortController();
    const onInbound = vi.fn().mockResolvedValue(undefined);

    mockExistsSync.mockReturnValue(true);
    // getMaxRowId
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([{ max_rowid: 50 }]),
      stderr: '',
    });
    // First poll: message with attachment flag
    const messages: ChatDbMessageRow[] = [
      makeMessageRow({ rowid: 51, text: 'See photo', cache_has_attachments: 1 }),
    ];
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify(messages),
      stderr: '',
    });
    // Attachment query
    const attachments: ChatDbAttachmentRow[] = [
      makeAttachmentRow({ message_id: 51, filename: '/path/to/img.jpg', mime_type: 'image/jpeg' }),
    ];
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify(attachments),
      stderr: '',
    });

    mockSleep.mockImplementation(async () => { controller.abort(); });

    await pollIMessages(onInbound, controller.signal);

    // Verify attachment query was made (3rd call: getMaxRowId, queryNewMessages, queryAttachments)
    expect(mockExecFileAsync).toHaveBeenCalledTimes(3);
    const attachQuery = mockExecFileAsync.mock.calls[2][1][3] as string;
    expect(attachQuery).toContain('message_attachment_join');
    expect(attachQuery).toContain('51');

    // Verify the envelope includes the attachment
    const envelope = onInbound.mock.calls[0][0];
    expect(envelope.media).toHaveLength(1);
    expect(envelope.media[0].kind).toBe('image');
    expect(envelope.media[0].ref).toBe('/path/to/img.jpg');
  });

  it('does not fetch attachments when no messages have cache_has_attachments=1', async () => {
    const controller = new AbortController();
    const onInbound = vi.fn().mockResolvedValue(undefined);

    mockExistsSync.mockReturnValue(true);
    // getMaxRowId
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([{ max_rowid: 50 }]),
      stderr: '',
    });
    // First poll: message WITHOUT attachment flag
    const messages: ChatDbMessageRow[] = [
      makeMessageRow({ rowid: 51, text: 'No attachments', cache_has_attachments: 0 }),
    ];
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify(messages),
      stderr: '',
    });

    mockSleep.mockImplementation(async () => { controller.abort(); });

    await pollIMessages(onInbound, controller.signal);

    // Only 2 calls: getMaxRowId + queryNewMessages (no attachment query)
    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
  });

  it('skips null-normalized messages (no text, no attachments) without calling onInbound', async () => {
    const controller = new AbortController();
    const onInbound = vi.fn().mockResolvedValue(undefined);

    mockExistsSync.mockReturnValue(true);
    // getMaxRowId
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([{ max_rowid: 50 }]),
      stderr: '',
    });
    // First poll: message with no text and no attachments
    const messages: ChatDbMessageRow[] = [
      makeMessageRow({ rowid: 51, text: null, cache_has_attachments: 0 }),
    ];
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify(messages),
      stderr: '',
    });

    mockSleep.mockImplementation(async () => { controller.abort(); });

    await pollIMessages(onInbound, controller.signal);

    // normalizeIMessage returns null, so onInbound should not be called
    expect(onInbound).not.toHaveBeenCalled();
  });

  it('sleeps for IMESSAGE_POLL_INTERVAL_MS between polls', async () => {
    const controller = new AbortController();
    mockExistsSync.mockReturnValue(true);
    // getMaxRowId
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: JSON.stringify([{ max_rowid: 0 }]),
      stderr: '',
    });
    // First poll: no messages
    mockExecFileAsync.mockResolvedValueOnce({ stdout: '[]', stderr: '' });

    mockSleep.mockImplementation(async () => { controller.abort(); });

    await pollIMessages(vi.fn(), controller.signal);

    expect(mockSleep).toHaveBeenCalledWith(2000);
  });
});
