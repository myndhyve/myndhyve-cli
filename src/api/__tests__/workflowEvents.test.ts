/**
 * Tests for the SSE parser at `src/api/workflowEvents.ts`.
 *
 * Coverage:
 *   - Basic event with single `data:` line
 *   - Multi-line `data:` concatenation
 *   - Comment lines (`:`) ignored
 *   - `id:` accumulation drives `Last-Event-ID` resume
 *   - Default `event:` value is `'message'`
 *   - End-of-stream flushes in-flight event without trailing blank line
 *   - Reconnect loop: terminal-event detection cleanly closes the
 *     generator
 *   - Reconnect loop: budget exhaustion surfaces a structured error
 *     event so callers see WHY the stream stopped
 */

import { describe, it, expect, vi } from 'vitest';
import {
  streamSseEvents,
  consumeSseStreamWithReconnect,
  type ParsedSseEvent,
} from '../workflowEvents.js';

/**
 * Build a `ReadableStream<Uint8Array>` from an SSE text body. Splits
 * the source into chunks on every `\n` so the parser actually has to
 * handle partial-line buffering — emulates how a real network stream
 * would deliver the bytes.
 */
function streamFromSseText(text: string, chunksOf: 'lines' | 'one-shot' = 'lines'): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] =
    chunksOf === 'lines'
      ? text.split('\n').map((line, i, arr) => encoder.encode(i < arr.length - 1 ? line + '\n' : line))
      : [encoder.encode(text)];
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect<T>(gen: AsyncGenerator<T, void, void>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe('streamSseEvents — basic parsing', () => {
  it('parses a single event with one data line', async () => {
    const text = 'data: hello\n\n';
    const events = await collect(streamSseEvents(streamFromSseText(text)));
    expect(events).toEqual([
      { id: null, event: 'message', data: 'hello' },
    ]);
  });

  it('concatenates multi-line data: with newline separators', async () => {
    const text = 'data: line one\ndata: line two\n\n';
    const events = await collect(streamSseEvents(streamFromSseText(text)));
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('line one\nline two');
  });

  it('honors event: field', async () => {
    const text = 'event: run.started\ndata: {"runId":"r-1"}\n\n';
    const events = await collect(streamSseEvents(streamFromSseText(text)));
    expect(events[0]?.event).toBe('run.started');
    expect(events[0]?.data).toBe('{"runId":"r-1"}');
  });

  it('honors id: field', async () => {
    const text = 'id: 42\nevent: node.started\ndata: {"nodeId":"n-1"}\n\n';
    const events = await collect(streamSseEvents(streamFromSseText(text)));
    expect(events[0]?.id).toBe('42');
  });

  it('ignores comment lines starting with `:`', async () => {
    const text = ': keepalive\n: another comment\nevent: x\ndata: y\n\n';
    const events = await collect(streamSseEvents(streamFromSseText(text)));
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('x');
  });

  it('parses multiple events back-to-back', async () => {
    const text = 'event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: c\ndata: 3\n\n';
    const events = await collect(streamSseEvents(streamFromSseText(text)));
    expect(events.map((e) => e.event)).toEqual(['a', 'b', 'c']);
    expect(events.map((e) => e.data)).toEqual(['1', '2', '3']);
  });

  it('drops the single space after the colon per spec', async () => {
    const text = 'data:no-leading-space\n\ndata: with-leading-space\n\n';
    const events = await collect(streamSseEvents(streamFromSseText(text)));
    expect(events[0]?.data).toBe('no-leading-space');
    expect(events[1]?.data).toBe('with-leading-space');
  });

  it('default event field is "message" when event: line absent', async () => {
    const text = 'data: foo\n\n';
    const events = await collect(streamSseEvents(streamFromSseText(text)));
    expect(events[0]?.event).toBe('message');
  });

  it('flushes in-flight event when stream ends without trailing blank line', async () => {
    // Final event has no terminating "\n\n" — should still surface.
    const text = 'event: final\ndata: payload';
    const events = await collect(streamSseEvents(streamFromSseText(text, 'one-shot')));
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('final');
    expect(events[0]?.data).toBe('payload');
  });

  it('handles \\r\\n line terminators (legacy SSE clients)', async () => {
    const text = 'event: x\r\ndata: y\r\n\r\n';
    const events = await collect(streamSseEvents(streamFromSseText(text, 'one-shot')));
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('x');
    expect(events[0]?.data).toBe('y');
  });

  it('ignores unknown fields (forward-compat)', async () => {
    const text = 'futurefield: ignored\nevent: x\ndata: y\nretry: 5000\n\n';
    const events = await collect(streamSseEvents(streamFromSseText(text)));
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('x');
    expect(events[0]?.data).toBe('y');
  });
});

// ─── Reconnect loop ────────────────────────────────────────────────

describe('consumeSseStreamWithReconnect', () => {
  it('terminates cleanly on the first terminal event', async () => {
    const text =
      'id: 1\nevent: run.started\ndata: {"r":1}\n\n' +
      'id: 2\nevent: node.completed\ndata: {"n":1}\n\n' +
      'id: 3\nevent: run.completed\ndata: {"r":1}\n\n';
    const openStream = vi.fn(() => Promise.resolve(streamFromSseText(text)));
    const events = await collect(
      consumeSseStreamWithReconnect({
        openStream,
        isTerminalEvent: (e) => e.event === 'run.completed',
        backoff: { initialDelayMs: 1, maxDelayMs: 5, maxAttempts: 3, watchdogTimeoutMs: 1000 },
      }),
    );
    expect(events.map((e) => e.event)).toEqual(['run.started', 'node.completed', 'run.completed']);
    expect(openStream).toHaveBeenCalledTimes(1); // no reconnect needed
  });

  it('resumes from Last-Event-ID after a transient drop', async () => {
    let call = 0;
    const openStream = vi.fn((lastEventId: string | null) => {
      call += 1;
      // First call: stream that closes after id=2 without terminal.
      if (call === 1) {
        return Promise.resolve(
          streamFromSseText(
            'id: 1\nevent: a\ndata: 1\n\nid: 2\nevent: b\ndata: 2\n\n',
          ),
        );
      }
      // Second call: receives lastEventId=2, returns id=3 (terminal).
      expect(lastEventId).toBe('2');
      return Promise.resolve(
        streamFromSseText('id: 3\nevent: run.completed\ndata: {"x":1}\n\n'),
      );
    });
    const events = await collect(
      consumeSseStreamWithReconnect({
        openStream,
        isTerminalEvent: (e) => e.event === 'run.completed',
        backoff: { initialDelayMs: 1, maxDelayMs: 5, maxAttempts: 3, watchdogTimeoutMs: 1000 },
      }),
    );
    expect(events.map((e) => e.id)).toEqual(['1', '2', '3']);
    expect(openStream).toHaveBeenCalledTimes(2);
  });

  it('surfaces a sse-reconnect-budget-exhausted error event when retries run out', async () => {
    // Every stream closes immediately with no events — never reaches
    // a terminal. Budget = 2 reconnects, so 3 opens total fail.
    const openStream = vi.fn(() => Promise.resolve(streamFromSseText('', 'one-shot')));
    const events = await collect(
      consumeSseStreamWithReconnect({
        openStream,
        isTerminalEvent: (e) => e.event === 'run.completed',
        maxReconnects: 2,
        backoff: { initialDelayMs: 1, maxDelayMs: 5, maxAttempts: 2, watchdogTimeoutMs: 1000 },
      }),
    );
    // First open succeeds (no events). Then 2 reconnects = 3 opens
    // total. The 3rd close exhausts the budget and yields the error.
    expect(openStream).toHaveBeenCalledTimes(3);
    const last = events[events.length - 1];
    expect(last?.event).toBe('error');
    expect(last?.data).toContain('sse-reconnect-budget-exhausted');
  });

  it('surfaces a sse-open-failed error when openStream throws past the budget', async () => {
    const openStream = vi.fn(() => Promise.reject(new Error('connect refused')));
    const events = await collect(
      consumeSseStreamWithReconnect({
        openStream,
        maxReconnects: 1,
        backoff: { initialDelayMs: 1, maxDelayMs: 5, maxAttempts: 1, watchdogTimeoutMs: 1000 },
      }),
    );
    expect(openStream).toHaveBeenCalledTimes(2); // first attempt + 1 retry
    const last = events[events.length - 1];
    expect(last?.event).toBe('error');
    const parsed = JSON.parse(last!.data) as { kind: string };
    expect(parsed.kind).toBe('sse-open-failed');
  });

  it('honors AbortSignal and stops polling without yielding more events', async () => {
    const ctrl = new AbortController();
    // Slow stream — emits one event then hangs.
    const openStream = vi.fn(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: a\ndata: 1\n\n'));
          // Don't close — let abort fire.
        },
      });
      return Promise.resolve(stream);
    });

    const eventsPromise = (async () => {
      const out: ParsedSseEvent[] = [];
      const gen = consumeSseStreamWithReconnect({
        openStream,
        signal: ctrl.signal,
        backoff: { initialDelayMs: 1, maxDelayMs: 5, maxAttempts: 3, watchdogTimeoutMs: 1000 },
      });
      for await (const ev of gen) {
        out.push(ev);
        if (ev.event === 'a') ctrl.abort();
      }
      return out;
    })();

    const events = await eventsPromise;
    expect(events.map((e) => e.event)).toEqual(['a']);
  });
});
