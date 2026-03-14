/**
 * MyndHyve CLI — Pack Storage Commands
 *
 * Commander subcommand group for pack content management:
 *   myndhyve-cli packs upload --pack-id <id> --version <ver> --content <file>
 *   myndhyve-cli packs download <pack-id> [version]
 *   myndhyve-cli packs versions <pack-id>
 *   myndhyve-cli packs manifest <pack-id> <version>
 *   myndhyve-cli packs delete-version <pack-id> <version>
 *   myndhyve-cli packs download-url <pack-id> [version]
 */

import type { Command } from 'commander';
import {
  uploadPackContent,
  getPackContent,
  listPackVersions,
  getPackManifest,
  deletePackVersion,
  getPackDownloadUrl,
  formatBytes,
} from '../api/packStorage.js';
import {
  requireAuth,
  formatRelativeTime,
  formatTableRow,
  printError,
} from './helpers.js';
import { ExitCode, printErrorResult } from '../utils/output.js';

// ============================================================================
// REGISTER
// ============================================================================

export function registerPackCommands(program: Command): void {
  const packs = program
    .command('packs')
    .description('Manage pack storage (upload, download, version)')
    .addHelpText('after', `
Examples:
  $ myndhyve-cli packs upload --pack-id my-pack --version 1.0.0 --content pack.json
  $ myndhyve-cli packs download my-pack
  $ myndhyve-cli packs versions my-pack
  $ myndhyve-cli packs manifest my-pack 1.0.0
  $ myndhyve-cli packs download-url my-pack 1.0.0`);

  // ── Upload ──────────────────────────────────────────────────────────

  packs
    .command('upload')
    .description('Upload pack content from a JSON file')
    .requiredOption('--pack-id <packId>', 'Pack identifier')
    .requiredOption('--version <version>', 'Semantic version (e.g., 1.0.0)')
    .requiredOption('--content <file>', 'Path to JSON content file')
    .option('--changelog <text>', 'Changelog for this version')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      // Read and parse the content file
      let content: unknown;
      try {
        const fs = await import('node:fs');
        const raw = fs.readFileSync(opts.content, 'utf-8');
        content = JSON.parse(raw);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printErrorResult({
          code: 'INVALID_FILE',
          message: `Failed to read content file: ${message}`,
          suggestion: 'Ensure the file exists and contains valid JSON.',
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
        return;
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Uploading pack content...', stream: process.stderr }).start();

      try {
        const result = await uploadPackContent(opts.packId, opts.version, content, {
          changelog: opts.changelog,
        });

        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.success) {
          console.log(`\n  Pack uploaded successfully!`);
          console.log(`  Pack ID:   ${result.packId}`);
          console.log(`  Version:   ${result.version}`);
          if (result.checksum) console.log(`  Checksum:  ${result.checksum}`);
          if (result.size) console.log(`  Size:      ${formatBytes(result.size)}`);
          console.log('');
        } else {
          printErrorResult({
            code: result.errorCode || 'UPLOAD_FAILED',
            message: result.error || 'Upload failed.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to upload pack', error);
      }
    });

  // ── Download ────────────────────────────────────────────────────────

  packs
    .command('download <pack-id> [version]')
    .description('Download pack content (prints to stdout by default)')
    .option('--output <file>', 'Write content to file instead of stdout')
    .option('--format <format>', 'Output format (table, json)', 'json')
    .action(async (packId: string, version: string | undefined, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Downloading pack content...', stream: process.stderr }).start();

      try {
        const result = await getPackContent(packId, version);
        spinner.stop();

        if (!result.success || !result.content) {
          printErrorResult({
            code: result.errorCode || 'DOWNLOAD_FAILED',
            message: result.error || 'Failed to retrieve pack content.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
          return;
        }

        const json = JSON.stringify(result.content, null, 2);

        if (opts.output) {
          const fs = await import('node:fs');
          fs.writeFileSync(opts.output, json, 'utf-8');
          console.log(`\n  Pack content written to ${opts.output}`);
          console.log(`  Pack ID:  ${result.packId}`);
          console.log(`  Version:  ${result.version}\n`);
        } else {
          process.stdout.write(json + '\n');
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to download pack', error);
      }
    });

  // ── Versions ────────────────────────────────────────────────────────

  packs
    .command('versions <pack-id>')
    .description('List all versions of a pack')
    .option('--limit <limit>', 'Maximum number of versions', '20')
    .option('--changelog', 'Include changelogs')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (packId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading versions...', stream: process.stderr }).start();

      try {
        const result = await listPackVersions(packId, {
          limit: parseInt(opts.limit, 10),
          includeChangelog: opts.changelog,
        });

        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result.versions || [], null, 2));
          return;
        }

        const versions = result.versions || [];
        if (versions.length === 0) {
          console.log(`\n  No versions found for pack "${packId}".\n`);
          return;
        }

        console.log(`\n  Versions for "${packId}" (${versions.length})\n`);

        const cols: Array<[string, number]> = [
          ['Version', 14],
          ['Size', 12],
          ['Downloads', 12],
          ['Published', 16],
        ];
        console.log(formatTableRow(cols));
        console.log('  ' + '\u2500'.repeat(Math.min(54, (process.stdout.columns || 54) - 4)));

        for (const ver of versions) {
          console.log(formatTableRow([
            [ver.version, 14],
            [formatBytes(ver.size), 12],
            [ver.downloads.toLocaleString(), 12],
            [formatRelativeTime(ver.publishedAt), 16],
          ]));

          if (opts.changelog && ver.changelog) {
            console.log(`      ${ver.changelog}`);
          }
        }

        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to list versions', error);
      }
    });

  // ── Manifest ────────────────────────────────────────────────────────

  packs
    .command('manifest <pack-id> <version>')
    .description('Show the manifest for a specific pack version')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (packId: string, version: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading manifest...', stream: process.stderr }).start();

      try {
        const result = await getPackManifest(packId, version);
        spinner.stop();

        if (!result.success || !result.manifest) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Manifest not found for ${packId}@${version}.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(result.manifest, null, 2));
          return;
        }

        const m = result.manifest;
        console.log(`\n  Pack Manifest: ${m.name}`);
        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  Pack ID:       ${m.packId}`);
        console.log(`  Version:       ${m.version}`);
        console.log(`  Type:          ${m.packType}`);
        console.log(`  Size:          ${formatBytes(m.size)}`);
        console.log(`  Checksum:      ${m.checksum}`);
        console.log(`  Components:    ${m.componentCount}`);
        console.log(`  Publisher:     ${m.publisherId}`);

        if (m.dependencies.length > 0) {
          console.log(`  Dependencies:  ${m.dependencies.join(', ')}`);
        }
        if (m.minPlatformVersion) {
          console.log(`  Min Platform:  ${m.minPlatformVersion}`);
        }
        console.log(`  Created:       ${formatRelativeTime(m.createdAt)}`);
        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to load manifest', error);
      }
    });

  // ── Delete Version ──────────────────────────────────────────────────

  packs
    .command('delete-version <pack-id> <version>')
    .description('Delete a specific version of a pack')
    .option('--force', 'Skip confirmation prompt')
    .action(async (packId: string, version: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!opts.force) {
        const readline = await import('node:readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`\n  Delete ${packId}@${version}? This cannot be undone. [y/N] `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('  Cancelled.\n');
          return;
        }
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Deleting version...', stream: process.stderr }).start();

      try {
        const result = await deletePackVersion(packId, version);
        spinner.stop();

        if (result.success) {
          console.log(`\n  Version ${version} of "${packId}" deleted.\n`);
        } else {
          printErrorResult({
            code: result.errorCode || 'DELETE_FAILED',
            message: result.error || 'Delete failed.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to delete version', error);
      }
    });

  // ── Download URL ────────────────────────────────────────────────────

  packs
    .command('download-url <pack-id> [version]')
    .description('Get a signed download URL for a pack version')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (packId: string, version: string | undefined, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Generating download URL...', stream: process.stderr }).start();

      try {
        const result = await getPackDownloadUrl(packId, version);
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.success && result.url) {
          console.log(`\n  Download URL for "${packId}":`);
          console.log(`  ${result.url}`);
          if (result.expiresAt) {
            console.log(`  Expires: ${result.expiresAt}`);
          }
          console.log('');
        } else {
          printErrorResult({
            code: result.errorCode || 'URL_FAILED',
            message: result.error || 'Failed to generate download URL.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to get download URL', error);
      }
    });
}
