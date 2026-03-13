import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock dependencies BEFORE importing ───────────────────────────────────────

vi.mock('../../auth/index.js', () => ({
  getToken: vi.fn(),
}));

vi.mock('../streaming.js', () => ({
  streamChat: vi.fn(),
  AI_PROXY_URL: 'https://test.api/aiProxyStreamV2',
  StreamError: class StreamError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'StreamError';
      this.code = code;
    }
  },
}));

vi.mock('../history.js', () => ({
  saveConversation: vi.fn(),
  loadConversation: vi.fn(),
  generateSessionId: vi.fn(),
  generateTitle: vi.fn(),
}));

vi.mock('../../api/prompts.js', () => ({
  fetchCanvasTypeSystemPrompt: vi.fn(),
}));

import { getToken } from '../../auth/index.js';
import { streamChat } from '../streaming.js';
import {
  saveConversation,
  loadConversation,
  generateSessionId,
  generateTitle,
} from '../history.js';
import { fetchCanvasTypeSystemPrompt } from '../../api/prompts.js';
import {
  createSession,
  resolveSystemPrompt,
  persistSession,
  sendMessage,
  type ChatSession,
} from '../index.js';

// ── Cast mocks ───────────────────────────────────────────────────────────────

const mockGetToken = getToken as ReturnType<typeof vi.fn>;
const mockStreamChat = streamChat as ReturnType<typeof vi.fn>;
const mockSaveConversation = saveConversation as ReturnType<typeof vi.fn>;
const mockLoadConversation = loadConversation as ReturnType<typeof vi.fn>;
const mockGenerateSessionId = generateSessionId as ReturnType<typeof vi.fn>;
const mockGenerateTitle = generateTitle as ReturnType<typeof vi.fn>;
const mockFetchCanvasTypeSystemPrompt = fetchCanvasTypeSystemPrompt as ReturnType<typeof vi.fn>;

// ── Reset between tests ─────────────────────────────────────────────────────

beforeEach(() => {
  mockGetToken.mockReset();
  mockStreamChat.mockReset();
  mockSaveConversation.mockReset();
  mockLoadConversation.mockReset();
  mockGenerateSessionId.mockReset();
  mockGenerateTitle.mockReset();
  mockFetchCanvasTypeSystemPrompt.mockReset();

  // Defaults
  mockGenerateSessionId.mockReturnValue('chat_test_abc123');
  mockGenerateTitle.mockImplementation((msg: string) =>
    msg.length > 60 ? msg.slice(0, 57) + '...' : msg
  );
  // Default: API returns null (use fallback)
  mockFetchCanvasTypeSystemPrompt.mockResolvedValue(null);
});

// ============================================================================
// createSession()
// ============================================================================

describe('createSession()', () => {
  it('creates a session with default values', async () => {
    const session = await createSession();

    expect(session.sessionId).toBe('chat_test_abc123');
    expect(session.provider).toBe('anthropic');
    expect(session.model).toBe('claude-sonnet');
    expect(session.temperature).toBe(0.7);
    expect(session.messages).toEqual([]);
    expect(session.canvasTypeId).toBeUndefined();
    expect(session.systemPrompt).toContain('MyndHyve AI');
    expect(session.createdAt).toBeTruthy();
    expect(mockGenerateSessionId).toHaveBeenCalledOnce();
  });

  it('uses API prompt when available', async () => {
    mockFetchCanvasTypeSystemPrompt.mockResolvedValue('You are the Landing Page AI from Firestore.');

    const session = await createSession({
      canvasTypeId: 'landing-page',
      model: 'gpt-4o',
      provider: 'openai',
      temperature: 0.3,
    });

    expect(session.systemPrompt).toBe('You are the Landing Page AI from Firestore.');
    expect(mockFetchCanvasTypeSystemPrompt).toHaveBeenCalledWith('landing-page');
  });

  it('falls back to default when API returns null', async () => {
    mockFetchCanvasTypeSystemPrompt.mockResolvedValue(null);

    const session = await createSession({ canvasTypeId: 'landing-page' });

    expect(session.systemPrompt).toContain('MyndHyve AI');
  });

  it('resumes an existing session when resumeSessionId is found', async () => {
    const existingConversation = {
      sessionId: 'chat_existing_xyz',
      title: 'Old Chat',
      canvasTypeId: 'app-builder',
      model: 'claude-sonnet',
      provider: 'anthropic',
      messages: [
        { role: 'user', content: 'Hello', timestamp: '2025-01-01T00:00:00.000Z' },
        {
          role: 'assistant',
          content: 'Hi there!',
          timestamp: '2025-01-01T00:00:01.000Z',
        },
      ],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:01.000Z',
    };

    mockLoadConversation.mockReturnValue(existingConversation);

    const session = await createSession({ resumeSessionId: 'chat_existing_xyz' });

    expect(session.sessionId).toBe('chat_existing_xyz');
    expect(session.canvasTypeId).toBe('app-builder');
    expect(session.provider).toBe('anthropic');
    expect(session.model).toBe('claude-sonnet');
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].content).toBe('Hello');
    expect(session.createdAt).toBe('2025-01-01T00:00:00.000Z');
    // Should NOT generate a new session ID
    expect(mockGenerateSessionId).not.toHaveBeenCalled();
    expect(mockLoadConversation).toHaveBeenCalledWith('chat_existing_xyz');
  });

  it('falls back to new session when resume ID is not found', async () => {
    mockLoadConversation.mockReturnValue(null);

    const session = await createSession({ resumeSessionId: 'nonexistent_session' });

    expect(mockLoadConversation).toHaveBeenCalledWith('nonexistent_session');
    // Should fall through to creating a new session
    expect(session.sessionId).toBe('chat_test_abc123');
    expect(session.messages).toEqual([]);
    expect(mockGenerateSessionId).toHaveBeenCalledOnce();
  });

  it('uses default model based on provider', async () => {
    const openaiSession = await createSession({ provider: 'openai' });
    expect(openaiSession.model).toBe('gpt-4o');

    const geminiSession = await createSession({ provider: 'gemini' });
    expect(geminiSession.model).toBe('gemini-2.5-flash');

    const minimaxSession = await createSession({ provider: 'minimax' });
    expect(minimaxSession.model).toBe('minimax-m2.5');
  });

  it('uses custom system prompt when provided, overriding API', async () => {
    mockFetchCanvasTypeSystemPrompt.mockResolvedValue('API prompt');
    const customPrompt = 'You are a custom bot.';
    const session = await createSession({
      canvasTypeId: 'app-builder',
      systemPrompt: customPrompt,
    });

    expect(session.systemPrompt).toBe(customPrompt);
    // Should not even call the API when custom prompt is provided
    expect(mockFetchCanvasTypeSystemPrompt).not.toHaveBeenCalled();
  });

  it('uses custom system prompt when resuming session', async () => {
    mockLoadConversation.mockReturnValue({
      sessionId: 'chat_resume_1',
      title: 'Resumed',
      canvasTypeId: 'landing-page',
      model: 'claude-sonnet',
      provider: 'anthropic',
      messages: [],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });

    const customPrompt = 'Custom override prompt';
    const session = await createSession({
      resumeSessionId: 'chat_resume_1',
      systemPrompt: customPrompt,
    });

    expect(session.systemPrompt).toBe(customPrompt);
  });

  it('sets temperature to 0 when explicitly provided as 0', async () => {
    const session = await createSession({ temperature: 0 });

    expect(session.temperature).toBe(0);
  });
});

// ============================================================================
// resolveSystemPrompt()
// ============================================================================

describe('resolveSystemPrompt()', () => {
  it('returns API prompt when available', async () => {
    mockFetchCanvasTypeSystemPrompt.mockResolvedValue('Firestore prompt for app-builder');

    const prompt = await resolveSystemPrompt('app-builder');

    expect(prompt).toBe('Firestore prompt for app-builder');
    expect(mockFetchCanvasTypeSystemPrompt).toHaveBeenCalledWith('app-builder');
  });

  it('returns default prompt when API returns null', async () => {
    mockFetchCanvasTypeSystemPrompt.mockResolvedValue(null);

    const prompt = await resolveSystemPrompt('unknown-hyve');

    expect(prompt).toContain('MyndHyve AI');
    expect(prompt).toContain('helpful and knowledgeable assistant');
  });

  it('returns default prompt when API throws (error is swallowed)', async () => {
    mockFetchCanvasTypeSystemPrompt.mockRejectedValue(new Error('Network error'));

    // .resolves asserts the promise resolves (not rejects) — catching the regression
    await expect(resolveSystemPrompt('app-builder')).resolves.toContain('MyndHyve AI');
  });

  it('falls back to default when API throws during createSession', async () => {
    mockFetchCanvasTypeSystemPrompt.mockRejectedValue(new Error('DNS failure'));

    const session = await createSession({ canvasTypeId: 'landing-page' });

    expect(session.systemPrompt).toContain('MyndHyve AI');
  });

  it('returns default prompt when no canvas type is specified', async () => {
    const promptUndefined = await resolveSystemPrompt(undefined);
    const promptNoArg = await resolveSystemPrompt();

    expect(promptUndefined).toContain('MyndHyve AI');
    expect(promptNoArg).toContain('MyndHyve AI');
    expect(promptUndefined).toBe(promptNoArg);
    // Should not call API when no canvasTypeId
    expect(mockFetchCanvasTypeSystemPrompt).not.toHaveBeenCalled();
  });
});

// ============================================================================
// persistSession()
// ============================================================================

describe('persistSession()', () => {
  it('saves conversation with generated title from first user message', () => {
    const session: ChatSession = {
      sessionId: 'chat_persist_1',
      canvasTypeId: 'app-builder',
      provider: 'anthropic',
      model: 'claude-sonnet',
      temperature: 0.7,
      systemPrompt: 'You are an assistant.',
      messages: [
        { role: 'user', content: 'Build me a todo app', timestamp: '2025-01-01T00:00:00.000Z' },
        {
          role: 'assistant',
          content: 'Sure! Let me help.',
          timestamp: '2025-01-01T00:00:01.000Z',
        },
      ],
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    persistSession(session);

    expect(mockGenerateTitle).toHaveBeenCalledWith('Build me a todo app');
    expect(mockSaveConversation).toHaveBeenCalledOnce();

    const savedConversation = mockSaveConversation.mock.calls[0][0];
    expect(savedConversation.sessionId).toBe('chat_persist_1');
    expect(savedConversation.title).toBe('Build me a todo app');
    expect(savedConversation.canvasTypeId).toBe('app-builder');
    expect(savedConversation.model).toBe('claude-sonnet');
    expect(savedConversation.provider).toBe('anthropic');
    expect(savedConversation.messages).toHaveLength(2);
    expect(savedConversation.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(savedConversation.updatedAt).toBeTruthy();
  });

  it('uses "New Chat" title when session has no messages', () => {
    const session: ChatSession = {
      sessionId: 'chat_empty_1',
      provider: 'anthropic',
      model: 'claude-sonnet',
      temperature: 0.7,
      systemPrompt: 'You are an assistant.',
      messages: [],
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    persistSession(session);

    expect(mockGenerateTitle).not.toHaveBeenCalled();
    expect(mockSaveConversation).toHaveBeenCalledOnce();
    expect(mockSaveConversation.mock.calls[0][0].title).toBe('New Chat');
  });

  it('uses "New Chat" fallback when no user message exists', () => {
    const session: ChatSession = {
      sessionId: 'chat_no_user_1',
      provider: 'anthropic',
      model: 'claude-sonnet',
      temperature: 0.7,
      systemPrompt: 'You are an assistant.',
      messages: [
        {
          role: 'assistant',
          content: 'Hello! How can I help?',
          timestamp: '2025-01-01T00:00:00.000Z',
        },
      ],
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    persistSession(session);

    // generateTitle should be called with 'New Chat' fallback
    expect(mockGenerateTitle).toHaveBeenCalledWith('New Chat');
  });

  it('caps persisted messages at 500 for large sessions (#5)', () => {
    const messages = Array.from({ length: 600 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `Message ${i}`,
      timestamp: `2025-01-01T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
    }));

    const session: ChatSession = {
      sessionId: 'chat_large_1',
      provider: 'anthropic',
      model: 'claude-sonnet',
      temperature: 0.7,
      systemPrompt: 'You are an assistant.',
      messages,
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    persistSession(session);

    expect(mockSaveConversation).toHaveBeenCalledOnce();
    const saved = mockSaveConversation.mock.calls[0][0];
    // Should cap at 500 messages
    expect(saved.messages).toHaveLength(500);
    // Should keep the most recent (last 500)
    expect(saved.messages[0].content).toBe('Message 100');
    expect(saved.messages[499].content).toBe('Message 599');
    // Original session should not be mutated
    expect(session.messages).toHaveLength(600);
  });

  it('does not throw when saveConversation fails', () => {
    mockSaveConversation.mockImplementation(() => {
      throw new Error('Disk full');
    });

    const session: ChatSession = {
      sessionId: 'chat_fail_1',
      provider: 'anthropic',
      model: 'claude-sonnet',
      temperature: 0.7,
      systemPrompt: 'You are an assistant.',
      messages: [
        { role: 'user', content: 'Hello', timestamp: '2025-01-01T00:00:00.000Z' },
      ],
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    // Should not throw despite saveConversation failing
    expect(() => persistSession(session)).not.toThrow();
  });
});

// ============================================================================
// sendMessage()
// ============================================================================

describe('sendMessage()', () => {
  it('adds user message to session history and streams response', async () => {
    mockGetToken.mockResolvedValue('test-firebase-token');
    mockStreamChat.mockImplementation(async (_req: unknown, callbacks: { onComplete: (content: string) => void }) => {
      // Simulate streaming completion
      callbacks.onComplete('AI response text');
      return () => {};
    });

    const session: ChatSession = {
      sessionId: 'chat_send_1',
      provider: 'anthropic',
      model: 'claude-sonnet',
      temperature: 0.7,
      systemPrompt: 'You are an assistant.',
      messages: [],
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    const result = await sendMessage(session, 'What is TypeScript?');

    expect(result).toBe('AI response text');
    // User message should be in session history
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[0].content).toBe('What is TypeScript?');
    // Assistant message should be in session history
    expect(session.messages[1].role).toBe('assistant');
    expect(session.messages[1].content).toBe('AI response text');
    // Should persist the session
    expect(mockSaveConversation).toHaveBeenCalledOnce();
  });

  it('calls streamChat with correct request shape', async () => {
    mockGetToken.mockResolvedValue('my-token');
    mockStreamChat.mockImplementation(async (_req: unknown, callbacks: { onComplete: (content: string) => void }) => {
      callbacks.onComplete('Done');
      return () => {};
    });

    const session: ChatSession = {
      sessionId: 'chat_send_2',
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.5,
      systemPrompt: 'Custom prompt',
      messages: [],
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    await sendMessage(session, 'Hello');

    expect(mockStreamChat).toHaveBeenCalledOnce();
    const [request] = mockStreamChat.mock.calls[0];
    expect(request.url).toBe('https://test.api/aiProxyStreamV2');
    expect(request.token).toBe('my-token');
    expect(request.body.provider).toBe('openai');
    expect(request.body.model).toBe('gpt-4o');
    expect(request.body.systemPrompt).toBe('Custom prompt');
    expect(request.body.temperature).toBe(0.5);
    expect(request.body.messages).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('rejects and rolls back user message when authentication fails', async () => {
    mockGetToken.mockRejectedValue(new Error('Not authenticated'));

    const session: ChatSession = {
      sessionId: 'chat_auth_fail',
      provider: 'anthropic',
      model: 'claude-sonnet',
      temperature: 0.7,
      systemPrompt: 'You are an assistant.',
      messages: [],
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    await expect(
      sendMessage(session, 'Hello')
    ).rejects.toThrow('Not authenticated');

    // User message should be rolled back on auth failure (#4)
    expect(session.messages).toHaveLength(0);
    // Stream should not have been called
    expect(mockStreamChat).not.toHaveBeenCalled();
  });
});
