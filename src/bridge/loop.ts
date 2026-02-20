/**
 * MyndHyve CLI — Bridge Main Loop
 *
 * Runs the three concurrent loops that make the bridge work:
 * 1. Heartbeat — updates session presence in Firestore every 15s
 * 2. File watcher — detects local file changes and pushes to Firestore
 * 3. Firestore poller — pulls remote changes and writes to local files
 *
 * Also monitors for pending build requests.
 */

import { createLogger } from '../utils/logger.js';
import { FileWatcher } from './watcher.js';
import { createIgnoreMatcher } from './ignore.js';
import { sendHeartbeat, markOffline, getSession, queryPendingBuilds } from './session.js';
import { pushLocalChange, pullRemoteChanges } from './sync.js';
import { executeBuildRequest } from './builder.js';
import type { BridgeLocalConfig } from './types.js';
import { HEARTBEAT_INTERVAL_MS, POLL_INTERVAL_MS } from './types.js';

const log = createLogger('BridgeLoop');

/**
 * Run the bridge loop in the foreground. Blocks until SIGTERM/SIGINT.
 */
export async function runBridgeLoop(
  projectRoot: string,
  config: BridgeLocalConfig
): Promise<void> {
  const { sessionId } = config;
  log.info('Starting bridge loop', { sessionId, projectRoot });

  // Verify session exists
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`Bridge session ${sessionId} not found. Re-link with: myndhyve-cli bridge link`);
  }

  // Set up ignore patterns
  const ignoreMatcher = await createIgnoreMatcher(
    projectRoot,
    (session.ignorePatterns as string[]) || []
  );

  // Start file watcher
  const watcher = new FileWatcher({
    rootPath: projectRoot,
    ignoreMatcher,
  });

  watcher.on('change', (event) => {
    pushLocalChange(sessionId, projectRoot, event).catch((err) => {
      log.error('Push failed', {
        path: event.relativePath,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  watcher.on('error', (err) => {
    log.error('Watcher error', { error: err.message });
  });

  watcher.start();

  // Mark online
  await sendHeartbeat(sessionId, 'online');
  log.info('Bridge online', { sessionId, project: config.projectId });
  console.log(`  Bridge online — syncing ${config.projectId}`);
  console.log('  Press Ctrl+C to stop.\n');

  // Set up intervals
  const heartbeatTimer = setInterval(async () => {
    try {
      await sendHeartbeat(sessionId, 'online');
    } catch (err) {
      log.warn('Heartbeat failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, HEARTBEAT_INTERVAL_MS);

  const pollTimer = setInterval(async () => {
    try {
      const pulled = await pullRemoteChanges(sessionId, projectRoot, watcher);
      if (pulled > 0) {
        log.info(`Pulled ${pulled} remote change(s)`);
      }
    } catch (err) {
      log.warn('Poll failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, POLL_INTERVAL_MS);

  // Build request poller (check every 5s)
  const buildPollTimer = setInterval(async () => {
    try {
      const pending = await queryPendingBuilds(sessionId);
      for (const build of pending) {
        await executeBuildRequest(sessionId, projectRoot, build);
      }
    } catch (err) {
      log.debug('Build poll failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, 5_000);

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down bridge...');
    console.log('\n  Shutting down bridge...');

    clearInterval(heartbeatTimer);
    clearInterval(pollTimer);
    clearInterval(buildPollTimer);
    watcher.stop();

    try {
      await markOffline(sessionId);
    } catch {
      // Best effort — if Firestore is unreachable, that's OK
    }

    log.info('Bridge stopped');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Keep the process alive
  await new Promise(() => {
    // Never resolves — runs until signal
  });
}
