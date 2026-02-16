/**
 * MyndHyve CLI — Main Entry Point
 *
 * Initializes channel plugins and launches the Commander CLI.
 */

import { createProgram } from './cli/program.js';

// ── Channel Plugin Registration ──────────────────────────────────────────────
// Channel plugins register themselves at import time.
import './channels/whatsapp/index.js';
import './channels/signal/index.js';
import './channels/imessage/index.js';

// ── CLI ──────────────────────────────────────────────────────────────────────

const program = createProgram();
program.parse(process.argv);
