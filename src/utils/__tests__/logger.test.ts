import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { createLogger, setLogLevel, getLogLevel } from '../logger.js';

describe('logger', () => {
  let stdoutSpy: MockInstance;
  let stderrSpy: MockInstance;

  beforeEach(() => {
    // Reset log level before each test
    setLogLevel('debug');
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel('info'); // restore default
  });

  describe('createLogger', () => {
    it('returns object with debug/info/warn/error methods', () => {
      const log = createLogger('TestScope');
      expect(typeof log.debug).toBe('function');
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
    });
  });

  describe('log level filtering', () => {
    it('respects log level: debug messages skipped when level=info', () => {
      setLogLevel('info');
      const log = createLogger('TestScope');

      log.debug('This should be skipped');
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('shows debug messages when level=debug', () => {
      setLogLevel('debug');
      const log = createLogger('TestScope');

      log.debug('This should appear');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('shows info messages when level=info', () => {
      setLogLevel('info');
      const log = createLogger('TestScope');

      log.info('Info message');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('shows warn messages when level=warn', () => {
      setLogLevel('warn');
      const log = createLogger('TestScope');

      log.info('This should be skipped');
      log.warn('This should appear');
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });

    it('shows only error messages when level=error', () => {
      setLogLevel('error');
      const log = createLogger('TestScope');

      log.debug('Skipped');
      log.info('Skipped');
      log.warn('Skipped');
      log.error('This should appear');

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('setLogLevel / getLogLevel', () => {
    it('round-trips the log level', () => {
      setLogLevel('debug');
      expect(getLogLevel()).toBe('debug');

      setLogLevel('warn');
      expect(getLogLevel()).toBe('warn');

      setLogLevel('error');
      expect(getLogLevel()).toBe('error');

      setLogLevel('info');
      expect(getLogLevel()).toBe('info');
    });
  });

  describe('output destination', () => {
    it('all log levels write to stderr (keeps stdout clean for data)', () => {
      const log = createLogger('TestScope');

      log.error('An error occurred');
      log.info('An info message');
      log.warn('A warning message');

      // All output goes to stderr to keep stdout clean for piped data
      expect(stderrSpy).toHaveBeenCalledTimes(3);
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('debug messages also go to stderr', () => {
      setLogLevel('debug');
      const log = createLogger('TestScope');
      log.debug('A debug message');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).not.toHaveBeenCalled();
    });
  });

  describe('output formatting', () => {
    it('includes scope name in output', () => {
      const log = createLogger('MyModule');
      log.info('Test message');

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('[MyModule]');
    });

    it('includes the message text in output', () => {
      const log = createLogger('Scope');
      log.info('Hello world');

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('Hello world');
    });

    it('includes level tag in output', () => {
      const log = createLogger('Scope');
      log.info('Test');

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('INFO');
    });

    it('includes formatted data in output', () => {
      const log = createLogger('Scope');
      log.info('Test', { key: 'value', count: 42 });

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('key=value');
      expect(output).toContain('count=42');
    });

    it('formats object values as JSON', () => {
      const log = createLogger('Scope');
      log.info('Test', { nested: { a: 1 } });

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('nested={"a":1}');
    });

    it('handles empty data object without crashing', () => {
      const log = createLogger('Scope');
      log.info('Test', {});

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('Test');
    });

    it('ends output with newline', () => {
      const log = createLogger('Scope');
      log.info('Test');

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toMatch(/\n$/);
    });
  });

  describe('Error objects in error()', () => {
    it('handles Error objects and includes error message', () => {
      const log = createLogger('Scope');
      const err = new Error('Something broke');

      log.error('Operation failed', err);

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('Operation failed');
      expect(output).toContain('Something broke');
    });

    it('includes stack trace when log level is debug', () => {
      setLogLevel('debug');
      const log = createLogger('Scope');
      const err = new Error('Stack test');

      log.error('Op failed', err);

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('Stack test');
      // Stack traces include "at" lines
      expect(output).toContain('at ');
    });

    it('does not include stack trace when log level is not debug', () => {
      setLogLevel('info');
      const log = createLogger('Scope');
      const err = new Error('No stack please');

      log.error('Op failed', err);

      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain('No stack please');
      // Should not contain stack frames after "at"
      // The message is included, but stack lines should not be
      const lines = output.split('\n').filter((l: string) => l.trim().startsWith('at '));
      expect(lines).toHaveLength(0);
    });
  });
});
