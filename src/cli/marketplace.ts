/**
 * MyndHyve CLI — Marketplace Commands
 *
 * Commander subcommand group for marketplace operations:
 *   myndhyve-cli marketplace search [query]
 *   myndhyve-cli marketplace featured
 *   myndhyve-cli marketplace info <listing-id>
 *   myndhyve-cli marketplace install <listing-id>
 *   myndhyve-cli marketplace uninstall <pack-id>
 *   myndhyve-cli marketplace update <pack-id>
 *   myndhyve-cli marketplace installed
 *   myndhyve-cli marketplace publish --file <path>
 *   myndhyve-cli marketplace purchases
 */

import type { Command } from 'commander';
import {
  searchMarketplace,
  getFeaturedListings,
  getListingDetails,
  installPack,
  uninstallPack,
  updateInstalledPack,
  getInstalledPacks,
  publishPack,
  getPurchases,
  type PublishRequest,
  type PackListingSummary,
} from '../api/marketplace.js';
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

export function registerMarketplaceCommands(program: Command): void {
  const marketplace = program
    .command('marketplace')
    .description('Browse, install, and publish marketplace packs')
    .addHelpText('after', `
Examples:
  $ myndhyve-cli marketplace search "landing page"
  $ myndhyve-cli marketplace featured
  $ myndhyve-cli marketplace install <listing-id>
  $ myndhyve-cli marketplace installed
  $ myndhyve-cli marketplace publish --file pack.json`);

  // ── Search ──────────────────────────────────────────────────────────

  marketplace
    .command('search [query]')
    .description('Search the marketplace for packs')
    .option('--type <packType>', 'Filter by pack type')
    .option('--category <category>', 'Filter by category')
    .option('--pricing <pricing>', 'Filter by pricing (free, paid, subscription)')
    .option('--sort-by <sortBy>', 'Sort by (relevance, downloads, rating, newest, updated)', 'relevance')
    .option('--page <page>', 'Page number', '1')
    .option('--limit <limit>', 'Results per page', '20')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (query: string | undefined, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Searching marketplace...', stream: process.stderr }).start();

      try {
        const result = await searchMarketplace({
          q: query,
          packType: opts.type,
          category: opts.category,
          pricing: opts.pricing,
          sortBy: opts.sortBy,
          page: parseInt(opts.page, 10),
          limit: parseInt(opts.limit, 10),
        });

        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.listings.length === 0) {
          console.log('\n  No packs found.');
          if (query) {
            console.log(`  Try a different search term or browse with: myndhyve-cli marketplace featured\n`);
          }
          return;
        }

        console.log(`\n  Marketplace Results (${result.total} total, page ${result.page})\n`);
        printListingTable(result.listings);
      } catch (error) {
        spinner.stop();
        printError('Failed to search marketplace', error);
      }
    });

  // ── Featured ────────────────────────────────────────────────────────

  marketplace
    .command('featured')
    .description('Show featured marketplace packs')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading featured packs...', stream: process.stderr }).start();

      try {
        const result = await getFeaturedListings();
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result.listings, null, 2));
          return;
        }

        if (result.listings.length === 0) {
          console.log('\n  No featured packs available.\n');
          return;
        }

        console.log(`\n  Featured Packs (${result.listings.length})\n`);
        printListingTable(result.listings);
      } catch (error) {
        spinner.stop();
        printError('Failed to load featured packs', error);
      }
    });

  // ── Info ─────────────────────────────────────────────────────────────

  marketplace
    .command('info <listing-id>')
    .description('Show detailed information about a marketplace listing')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (listingId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading listing...', stream: process.stderr }).start();

      try {
        const listing = await getListingDetails(listingId);
        spinner.stop();

        if (!listing) {
          printErrorResult({
            code: 'NOT_FOUND',
            message: `Listing "${listingId}" not found.`,
          });
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(listing, null, 2));
          return;
        }

        const pricingStr = listing.pricing.type === 'free'
          ? 'Free'
          : `${listing.pricing.currency || 'USD'} ${listing.pricing.price?.toFixed(2) || '0.00'}`;

        console.log(`\n  ${listing.name}`);
        console.log('  ' + '\u2500'.repeat(50));
        console.log(`  ID:            ${listing.id}`);
        console.log(`  Type:          ${listing.packType}`);
        console.log(`  Version:       ${listing.version}`);
        console.log(`  Category:      ${listing.category}`);
        console.log(`  Pricing:       ${pricingStr}`);
        console.log(`  Rating:        ${listing.stats.rating.toFixed(1)}/5 (${listing.stats.reviewCount} reviews)`);
        console.log(`  Downloads:     ${listing.stats.downloads.toLocaleString()}`);
        console.log(`  Publisher:     ${listing.publisherName || listing.publisherId}`);
        console.log(`  License:       ${listing.license}`);

        if (listing.tags.length > 0) {
          console.log(`  Tags:          ${listing.tags.join(', ')}`);
        }
        if (listing.repository) {
          console.log(`  Repository:    ${listing.repository}`);
        }
        if (listing.website) {
          console.log(`  Website:       ${listing.website}`);
        }

        console.log('');
        console.log(`  ${listing.shortDescription}`);

        if (listing.description && listing.description !== listing.shortDescription) {
          console.log('');
          console.log(`  ${listing.description}`);
        }

        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to load listing', error);
      }
    });

  // ── Install ─────────────────────────────────────────────────────────

  marketplace
    .command('install <listing-id>')
    .description('Install a pack from the marketplace')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (listingId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Installing pack...', stream: process.stderr }).start();

      try {
        const result = await installPack(listingId);
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.success) {
          console.log(`\n  Pack installed successfully!`);
          console.log(`  Pack ID:  ${result.packId}`);
          console.log(`  Version:  ${result.version}`);
          if (result.message) {
            console.log(`  ${result.message}`);
          }
          if (result.warnings && result.warnings.length > 0) {
            for (const warning of result.warnings) {
              console.log(`  Warning: ${warning}`);
            }
          }
          console.log('');
        } else {
          printErrorResult({
            code: 'INSTALL_FAILED',
            message: result.message || 'Installation failed.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to install pack', error);
      }
    });

  // ── Uninstall ───────────────────────────────────────────────────────

  marketplace
    .command('uninstall <pack-id>')
    .description('Uninstall a pack')
    .option('--force', 'Skip confirmation prompt')
    .action(async (packId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      if (!opts.force) {
        const readline = await import('node:readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`\n  Uninstall pack "${packId}"? [y/N] `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('  Cancelled.\n');
          return;
        }
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Uninstalling pack...', stream: process.stderr }).start();

      try {
        const result = await uninstallPack(packId);
        spinner.stop();

        if (result.success) {
          console.log(`\n  Pack "${packId}" uninstalled.\n`);
        } else {
          printErrorResult({
            code: 'UNINSTALL_FAILED',
            message: result.error || 'Uninstall failed.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to uninstall pack', error);
      }
    });

  // ── Update ──────────────────────────────────────────────────────────

  marketplace
    .command('update <pack-id>')
    .description('Update an installed pack to the latest version')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (packId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Updating pack...', stream: process.stderr }).start();

      try {
        const result = await updateInstalledPack(packId);
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.success) {
          console.log(`\n  Pack updated successfully!`);
          console.log(`  Pack ID:  ${result.packId}`);
          console.log(`  Version:  ${result.version}`);
          if (result.message) {
            console.log(`  ${result.message}`);
          }
          console.log('');
        } else {
          printErrorResult({
            code: 'UPDATE_FAILED',
            message: result.message || 'Update failed.',
          });
          process.exitCode = ExitCode.GENERAL_ERROR;
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to update pack', error);
      }
    });

  // ── Installed ───────────────────────────────────────────────────────

  marketplace
    .command('installed')
    .description('List all installed packs')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading installed packs...', stream: process.stderr }).start();

      try {
        const result = await getInstalledPacks();
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result.packs, null, 2));
          return;
        }

        if (result.packs.length === 0) {
          console.log('\n  No packs installed.');
          console.log('  Browse available packs with: myndhyve-cli marketplace search\n');
          return;
        }

        console.log(`\n  Installed Packs (${result.packs.length})\n`);

        const cols: Array<[string, number]> = [
          ['Pack ID', 24],
          ['Name', 26],
          ['Type', 16],
          ['Version', 12],
          ['Update', 10],
        ];
        console.log(formatTableRow(cols));
        console.log('  ' + '\u2500'.repeat(Math.min(88, (process.stdout.columns || 88) - 4)));

        for (const pack of result.packs) {
          const updateIndicator = pack.hasUpdate ? 'Yes' : '\u2014';
          console.log(formatTableRow([
            [pack.packId, 24],
            [pack.name, 26],
            [pack.packType, 16],
            [pack.installedVersion, 12],
            [updateIndicator, 10],
          ]));
        }

        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to list installed packs', error);
      }
    });

  // ── Publish ─────────────────────────────────────────────────────────

  marketplace
    .command('publish')
    .description('Publish a pack to the marketplace')
    .requiredOption('--file <path>', 'Path to publish manifest JSON file')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      // Read and parse the publish manifest
      let request: PublishRequest;
      try {
        const fs = await import('node:fs');
        const content = fs.readFileSync(opts.file, 'utf-8');
        request = JSON.parse(content) as PublishRequest;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printErrorResult({
          code: 'INVALID_FILE',
          message: `Failed to read publish manifest: ${message}`,
          suggestion: 'Ensure the file exists and contains valid JSON matching the PublishRequest schema.',
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
        return;
      }

      // Validate required fields before sending to API
      const requiredFields = ['name', 'packType', 'category', 'pricing', 'license'] as const;
      const missing = requiredFields.filter((f) => !(f in request) || !request[f]);
      if (missing.length > 0) {
        printErrorResult({
          code: 'INVALID_MANIFEST',
          message: `Publish manifest missing required fields: ${missing.join(', ')}`,
          suggestion: 'See the PublishRequest schema for all required fields.',
        });
        process.exitCode = ExitCode.GENERAL_ERROR;
        return;
      }

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Publishing pack...', stream: process.stderr }).start();

      try {
        const result = await publishPack(request);
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.success) {
          console.log(`\n  Pack published successfully!`);
          console.log(`  Listing ID:  ${result.listingId}`);
          console.log(`  Version:     ${result.version}`);
          if (result.message) {
            console.log(`  ${result.message}`);
          }
          console.log('');
        } else {
          if (result.errors && result.errors.length > 0) {
            console.error(`\n  Publish failed with validation errors:\n`);
            for (const err of result.errors) {
              console.error(`    - ${err.field}: ${err.message}`);
            }
            console.error('');
          } else {
            printErrorResult({
              code: 'PUBLISH_FAILED',
              message: result.message || 'Publish failed.',
            });
          }
          process.exitCode = ExitCode.GENERAL_ERROR;
        }
      } catch (error) {
        spinner.stop();
        printError('Failed to publish pack', error);
      }
    });

  // ── Purchases ───────────────────────────────────────────────────────

  marketplace
    .command('purchases')
    .description('List your marketplace purchases')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      const ora = (await import('ora')).default;
      const spinner = ora({ text: 'Loading purchases...', stream: process.stderr }).start();

      try {
        const result = await getPurchases();
        spinner.stop();

        if (opts.format === 'json') {
          console.log(JSON.stringify(result.purchases, null, 2));
          return;
        }

        if (result.purchases.length === 0) {
          console.log('\n  No purchases yet.\n');
          return;
        }

        console.log(`\n  Purchases (${result.purchases.length})\n`);

        const cols: Array<[string, number]> = [
          ['Name', 28],
          ['Type', 16],
          ['Amount', 12],
          ['Purchased', 14],
        ];
        console.log(formatTableRow(cols));
        console.log('  ' + '\u2500'.repeat(Math.min(70, (process.stdout.columns || 70) - 4)));

        for (const purchase of result.purchases) {
          const amount = `${purchase.currency} ${purchase.amount.toFixed(2)}`;
          const date = formatRelativeTime(purchase.purchasedAt);

          console.log(formatTableRow([
            [purchase.name, 28],
            [purchase.packType, 16],
            [amount, 12],
            [date, 14],
          ]));
        }

        console.log('');
      } catch (error) {
        spinner.stop();
        printError('Failed to load purchases', error);
      }
    });
}

// ============================================================================
// HELPERS
// ============================================================================

function printListingTable(listings: PackListingSummary[]): void {
  const cols: Array<[string, number]> = [
    ['ID', 24],
    ['Name', 26],
    ['Type', 16],
    ['Rating', 10],
    ['Downloads', 12],
    ['Pricing', 10],
  ];
  console.log(formatTableRow(cols));
  console.log('  ' + '\u2500'.repeat(Math.min(98, (process.stdout.columns || 98) - 4)));

  for (const listing of listings) {
    const rating = `${listing.stats.rating.toFixed(1)}/5`;
    const downloads = listing.stats.downloads.toLocaleString();
    const pricing = listing.pricing.type === 'free'
      ? 'Free'
      : `$${listing.pricing.price?.toFixed(2) || '?'}`;

    console.log(formatTableRow([
      [listing.id, 24],
      [listing.name, 26],
      [listing.packType, 16],
      [rating, 10],
      [downloads, 12],
      [pricing, 10],
    ]));
  }

  console.log('');
}
