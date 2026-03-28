/**
 * MyndHyve CLI — CMS Commands
 *
 * Commander subcommand group for CMS page management and engagement:
 *   myndhyve-cli cms pages [--published] [--limit N]
 *   myndhyve-cli cms page <slug>
 *   myndhyve-cli cms create --title "..." [--slug ...] [--type ...]
 *   myndhyve-cli cms delete <pageId>
 *   myndhyve-cli cms comments <pageId>
 *   myndhyve-cli cms export [--output file.json]
 *   myndhyve-cli cms import <file.json> [--overwrite]
 *   myndhyve-cli cms blog-terms
 *   myndhyve-cli cms blog-authors
 *   myndhyve-cli cms podcast-terms
 *   myndhyve-cli cms podcast-hosts
 *   myndhyve-cli cms feeds
 */

import type { Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import {
  listPublishedPages,
  listManagedPages,
  getPublishedPage,
  createPage,
  deletePage,
  listComments,
  exportContent,
  importContent,
  listBlogTerms,
  listBlogAuthors,
  listPodcastTerms,
  listPodcastHosts,
  getBlogFeedUrl,
  getPodcastFeedUrl,
  getSitemapUrl,
  type CmsExportResult,
  type CmsTaxonomyTerm,
} from '../api/cms.js';
import { requireAuth, truncate, printError } from './helpers.js';
import { ExitCode } from '../utils/output.js';

// ============================================================================
// REGISTER
// ============================================================================

export function registerCmsCommands(program: Command): void {
  const cms = program
    .command('cms')
    .description('Manage CMS pages, blog, podcast, and engagement');

  // ── List Pages ────────────────────────────────────────────────────────

  cms
    .command('pages')
    .description('List CMS pages')
    .option('--published', 'Show only published pages (public API)')
    .option('--type <pageType>', 'Filter by page type')
    .option('--limit <n>', 'Max results', '25')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const limit = parseInt(opts.limit, 10) || 25;

        const result = opts.published
          ? await listPublishedPages({ pageType: opts.type, limit })
          : await listManagedPages({ limit });

        const pages = result.pages;

        if (opts.format === 'json') {
          console.log(JSON.stringify(pages, null, 2));
          return;
        }

        if (pages.length === 0) {
          console.log('\n  No pages found.');
          console.log('  Create one: myndhyve-cli cms create --title "My Page"');
          console.log('');
          return;
        }

        const label = opts.published ? 'Published Pages' : 'All Pages';
        console.log(`\n  ${label} (${pages.length})\n`);
        console.log(
          '  ' +
          'ID'.padEnd(24) +
          'Title'.padEnd(30) +
          'Status'.padEnd(12) +
          'Slug'.padEnd(24) +
          'Updated'
        );
        console.log('  ' + '-'.repeat(100));

        for (const page of pages) {
          console.log(
            '  ' +
            truncate(page.id, 22).padEnd(24) +
            truncate(page.title, 28).padEnd(30) +
            (page.status || '-').padEnd(12) +
            truncate(page.slug, 22).padEnd(24) +
            (page.updatedAt ? new Date(page.updatedAt).toLocaleDateString() : '-')
          );
        }
        console.log('');
      } catch (err) {
        printError('Failed to list pages', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Get Page ──────────────────────────────────────────────────────────

  cms
    .command('page <slug>')
    .description('Get a published page by slug')
    .option('--format <format>', 'Output format (summary, json)', 'summary')
    .action(async (slug: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const page = await getPublishedPage(slug);

        if (!page) {
          console.log(`\n  Page "${slug}" not found or not published.\n`);
          process.exitCode = ExitCode.NOT_FOUND;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(page, null, 2));
          return;
        }

        console.log(`\n  ${page.title}`);
        console.log(`  ${'─'.repeat(60)}`);
        console.log(`  ID:          ${page.id}`);
        console.log(`  Slug:        ${page.slug}`);
        console.log(`  Status:      ${page.status}`);
        if (page.pageType) console.log(`  Type:        ${page.pageType}`);
        if (page.description) console.log(`  Description: ${truncate(page.description, 50)}`);
        console.log(`  Sections:    ${page.sections?.length ?? 0}`);
        if (page.publishedAt) console.log(`  Published:   ${new Date(page.publishedAt).toLocaleString()}`);
        if (page.seo?.title) console.log(`  SEO Title:   ${page.seo.title}`);
        console.log('');
      } catch (err) {
        printError('Failed to get page', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Create Page ───────────────────────────────────────────────────────

  cms
    .command('create')
    .description('Create a new CMS page')
    .requiredOption('--title <title>', 'Page title')
    .option('--slug <slug>', 'URL slug (auto-generated from title if omitted)')
    .option('--type <pageType>', 'Page type (e.g., blog, landing)')
    .option('--description <desc>', 'Page description')
    .option('--format <format>', 'Output format (summary, json)', 'summary')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const page = await createPage({
          title: opts.title,
          slug: opts.slug,
          pageType: opts.type,
          description: opts.description,
        });

        if (opts.format === 'json') {
          console.log(JSON.stringify(page, null, 2));
          return;
        }

        console.log(`\n  Created page: ${page.title}`);
        console.log(`  ID:   ${page.id}`);
        console.log(`  Slug: ${page.slug}`);
        console.log('');
      } catch (err) {
        printError('Failed to create page', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Delete Page ───────────────────────────────────────────────────────

  cms
    .command('delete <pageId>')
    .description('Delete a CMS page')
    .action(async (pageId: string) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        await deletePage(pageId);
        console.log(`\n  Deleted page: ${pageId}\n`);
      } catch (err) {
        printError('Failed to delete page', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Comments ──────────────────────────────────────────────────────────

  cms
    .command('comments <pageId>')
    .description('List comments for a CMS page')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (pageId: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const comments = await listComments(pageId);

        if (opts.format === 'json') {
          console.log(JSON.stringify(comments, null, 2));
          return;
        }

        if (comments.length === 0) {
          console.log(`\n  No comments on page ${pageId}.\n`);
          return;
        }

        console.log(`\n  Comments (${comments.length})\n`);
        for (const c of comments) {
          const author = c.authorName || c.authorId;
          const date = c.createdAt ? new Date(c.createdAt).toLocaleString() : '';
          const statusTag = c.status !== 'approved' ? ` [${c.status}]` : '';
          console.log(`  ${author} — ${date}${statusTag}`);
          console.log(`    ${truncate(c.content, 72)}`);
          console.log('');
        }
      } catch (err) {
        printError('Failed to list comments', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Export ─────────────────────────────────────────────────────────────

  cms
    .command('export')
    .description('Export all CMS content to JSON')
    .option('--output <file>', 'Output file path (prints to stdout if omitted)')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const data = await exportContent();

        const json = JSON.stringify(data, null, 2);

        if (opts.output) {
          await writeFile(opts.output, json, 'utf-8');
          console.log(`\n  Exported ${data.pages.length} pages to ${opts.output}\n`);
        } else {
          console.log(json);
        }
      } catch (err) {
        printError('Failed to export CMS content', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Import ─────────────────────────────────────────────────────────────

  cms
    .command('import <file>')
    .description('Import CMS content from JSON file')
    .option('--overwrite', 'Overwrite existing pages with same slug')
    .action(async (file: string, opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const raw = await readFile(file, 'utf-8');
        const data = JSON.parse(raw) as CmsExportResult;

        const result = await importContent(data, { overwrite: opts.overwrite });
        console.log(`\n  Imported: ${result.imported}, Skipped: ${result.skipped}\n`);
      } catch (err) {
        printError('Failed to import CMS content', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Blog Terms ────────────────────────────────────────────────────────

  cms
    .command('blog-terms')
    .description('List blog taxonomy terms')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const grouped = await listBlogTerms();

        if (opts.format === 'json') {
          console.log(JSON.stringify(grouped, null, 2));
          return;
        }

        const taxonomies = Object.keys(grouped);
        if (taxonomies.length === 0) {
          console.log('\n  No blog terms found.\n');
          return;
        }

        console.log('\n  Blog Terms\n');
        printGroupedTerms(grouped);
        console.log('');
      } catch (err) {
        printError('Failed to list blog terms', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Blog Authors ──────────────────────────────────────────────────────

  cms
    .command('blog-authors')
    .description('List blog authors')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const authors = await listBlogAuthors();

        if (opts.format === 'json') {
          console.log(JSON.stringify(authors, null, 2));
          return;
        }

        if (authors.length === 0) {
          console.log('\n  No blog authors found.\n');
          return;
        }

        console.log('\n  Blog Authors\n');
        printContributors(authors);
        console.log('');
      } catch (err) {
        printError('Failed to list blog authors', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Podcast Terms ──────────────────────────────────────────────────────

  cms
    .command('podcast-terms')
    .description('List podcast taxonomy terms')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const grouped = await listPodcastTerms();

        if (opts.format === 'json') {
          console.log(JSON.stringify(grouped, null, 2));
          return;
        }

        const taxonomies = Object.keys(grouped);
        if (taxonomies.length === 0) {
          console.log('\n  No podcast terms found.\n');
          return;
        }

        console.log('\n  Podcast Terms\n');
        printGroupedTerms(grouped);
        console.log('');
      } catch (err) {
        printError('Failed to list podcast terms', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Podcast Hosts ──────────────────────────────────────────────────────

  cms
    .command('podcast-hosts')
    .description('List podcast hosts')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      const auth = requireAuth();
      if (!auth) return;

      try {
        const hosts = await listPodcastHosts();

        if (opts.format === 'json') {
          console.log(JSON.stringify(hosts, null, 2));
          return;
        }

        if (hosts.length === 0) {
          console.log('\n  No podcast hosts found.\n');
          return;
        }

        console.log('\n  Podcast Hosts\n');
        printContributors(hosts);
        console.log('');
      } catch (err) {
        printError('Failed to list podcast hosts', err);
        process.exitCode = ExitCode.GENERAL_ERROR;
      }
    });

  // ── Feeds ──────────────────────────────────────────────────────────────

  cms
    .command('feeds')
    .description('Show RSS feed and sitemap URLs')
    .option('--format <format>', 'Output format (table, json)', 'table')
    .action(async (opts) => {
      if (opts.format === 'json') {
        console.log(JSON.stringify({
          blog: getBlogFeedUrl(),
          podcast: getPodcastFeedUrl(),
          sitemap: getSitemapUrl(),
        }, null, 2));
        return;
      }

      console.log('\n  RSS Feeds & Sitemap\n');
      console.log(`  Blog RSS:     ${getBlogFeedUrl()}`);
      console.log(`  Podcast RSS:  ${getPodcastFeedUrl()}`);
      console.log(`  Sitemap:      ${getSitemapUrl()}`);
      console.log('');
    });
}

// ============================================================================
// HELPERS
// ============================================================================

/** Print taxonomy terms grouped by taxonomy slug. */
function printGroupedTerms(grouped: Record<string, CmsTaxonomyTerm[]>): void {
  for (const [taxonomy, terms] of Object.entries(grouped)) {
    console.log(`  ${taxonomy}`);
    console.log('  ' + 'Name'.padEnd(28) + 'Slug'.padEnd(24) + 'Posts');
    console.log('  ' + '-'.repeat(56));
    for (const t of terms) {
      console.log('  ' + truncate(t.name, 26).padEnd(28) + truncate(t.slug, 22).padEnd(24) + String(t.postCount));
    }
    console.log('');
  }
}

/** Print contributors (authors or hosts). */
function printContributors(contributors: Array<{ slug: string; name: string; postCount: number }>): void {
  console.log('  ' + 'Slug'.padEnd(24) + 'Name'.padEnd(28) + 'Posts');
  console.log('  ' + '-'.repeat(56));
  for (const c of contributors) {
    console.log('  ' + truncate(c.slug, 22).padEnd(24) + truncate(c.name, 26).padEnd(28) + String(c.postCount));
  }
}
