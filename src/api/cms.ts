/**
 * MyndHyve CLI — CMS API
 *
 * Operations for CMS pages, content delivery, and engagement (comments,
 * reactions, shares) via the cmsApi Cloud Function.
 *
 * Cloud Function base URL: /cmsApi/v1/...
 *
 * Route groups:
 *   /v1/delivery/*     — Public, cacheable, read-only (published content)
 *   /v1/manage/*       — Authenticated, role-gated (CRUD)
 *   /v1/engagement/*   — Authenticated (comments, reactions, shares)
 */

import { getAPIClient } from './client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CmsAPI');

const CMS_API_BASE = 'https://us-central1-myndhyve.cloudfunctions.net/cmsApi';
const SEO_SITEMAP_BASE = 'https://us-central1-myndhyve.cloudfunctions.net/seoSitemap';

// ============================================================================
// TYPES — Pages
// ============================================================================

/** CMS page summary for list display. */
export interface CmsPageSummary {
  id: string;
  title: string;
  slug: string;
  status: 'draft' | 'published' | 'scheduled' | 'archived';
  pageType?: string;
  updatedAt?: string;
  publishedAt?: string;
}

/** Full CMS page detail. */
export interface CmsPageDetail extends CmsPageSummary {
  description?: string;
  sections: CmsSection[];
  seo?: CmsSeoMeta;
  chrome?: Record<string, unknown>;
  createdAt?: string;
  createdBy?: string;
}

/** CMS page section. */
export interface CmsSection {
  id: string;
  type: string;
  data: Record<string, unknown>;
  styling?: Record<string, unknown>;
  order: number;
}

/** SEO metadata for a page. */
export interface CmsSeoMeta {
  title?: string;
  description?: string;
  keywords?: string[];
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  robots?: string;
  canonicalUrl?: string;
}

// ============================================================================
// TYPES — Engagement
// ============================================================================

/** Comment on a CMS page. */
export interface CmsComment {
  id: string;
  pageId: string;
  content: string;
  authorId: string;
  authorName?: string;
  parentCommentId?: string;
  status: 'pending' | 'approved' | 'rejected' | 'spam';
  createdAt?: string;
  updatedAt?: string;
}

/** Reaction summary for a page. */
export interface CmsReactionSummary {
  pageId: string;
  counts: Record<string, number>;
  userReaction?: string;
}

// ============================================================================
// TYPES — Export/Import
// ============================================================================

/** Content export result. */
export interface CmsExportResult {
  pages: CmsPageDetail[];
  exportedAt: string;
  version: string;
}

// ============================================================================
// DELIVERY API (public, read-only)
// ============================================================================

/**
 * List published pages.
 *
 * @param options - Optional filters (pageType, limit, cursor)
 * @returns Array of page summaries
 */
export async function listPublishedPages(
  options?: { pageType?: string; limit?: number; cursor?: string }
): Promise<{ pages: CmsPageSummary[]; nextCursor?: string }> {
  const client = getAPIClient();
  const params = new URLSearchParams();
  if (options?.pageType) params.set('pageType', options.pageType);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.cursor) params.set('cursor', options.cursor);

  const qs = params.toString();
  const url = `${CMS_API_BASE}/v1/delivery/pages${qs ? `?${qs}` : ''}`;

  log.debug('Listing published pages', { options });

  const response = await client.get<{ success: boolean; data: { pages: CmsPageSummary[]; nextCursor?: string } }>(url);
  return response.data;
}

/**
 * Get a published page by slug.
 *
 * @param slug - The page slug
 * @returns Page detail or null
 */
export async function getPublishedPage(slug: string): Promise<CmsPageDetail | null> {
  const client = getAPIClient();

  log.debug('Getting published page', { slug });

  try {
    const response = await client.get<{ success: boolean; data: CmsPageDetail }>(
      `${CMS_API_BASE}/v1/delivery/pages/${encodeURIComponent(slug)}`
    );
    return response.data;
  } catch {
    return null;
  }
}

/** Taxonomy term with aggregated post count. */
export interface CmsTaxonomyTerm {
  id: string;
  name: string;
  slug: string;
  postCount: number;
}

/** Author/host with aggregated post count. */
export interface CmsContributor {
  slug: string;
  name: string;
  avatar: string;
  postCount: number;
}

/**
 * List blog taxonomy terms (grouped by taxonomy slug).
 */
export async function listBlogTerms(): Promise<Record<string, CmsTaxonomyTerm[]>> {
  const client = getAPIClient();
  const response = await client.get<{ success: boolean; data: Record<string, CmsTaxonomyTerm[]> }>(
    `${CMS_API_BASE}/v1/delivery/blog/terms`
  );
  return response.data;
}

/**
 * List blog authors.
 */
export async function listBlogAuthors(): Promise<CmsContributor[]> {
  const client = getAPIClient();
  const response = await client.get<{ success: boolean; data: CmsContributor[] }>(
    `${CMS_API_BASE}/v1/delivery/blog/authors`
  );
  return response.data;
}

/**
 * List podcast taxonomy terms (grouped by taxonomy slug).
 */
export async function listPodcastTerms(): Promise<Record<string, CmsTaxonomyTerm[]>> {
  const client = getAPIClient();
  const response = await client.get<{ success: boolean; data: Record<string, CmsTaxonomyTerm[]> }>(
    `${CMS_API_BASE}/v1/delivery/podcast/terms`
  );
  return response.data;
}

/**
 * List podcast hosts.
 */
export async function listPodcastHosts(): Promise<CmsContributor[]> {
  const client = getAPIClient();
  const response = await client.get<{ success: boolean; data: CmsContributor[] }>(
    `${CMS_API_BASE}/v1/delivery/podcast/hosts`
  );
  return response.data;
}

// ============================================================================
// MANAGEMENT API (authenticated)
// ============================================================================

/**
 * List all CMS pages (draft + published).
 */
export async function listManagedPages(
  options?: { limit?: number; cursor?: string }
): Promise<{ pages: CmsPageSummary[]; nextCursor?: string }> {
  const client = getAPIClient();
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.cursor) params.set('cursor', options.cursor);

  const qs = params.toString();
  const url = `${CMS_API_BASE}/v1/manage/pages${qs ? `?${qs}` : ''}`;

  log.debug('Listing managed pages', { options });

  const response = await client.get<{ success: boolean; data: { pages: CmsPageSummary[]; nextCursor?: string } }>(url);
  return response.data;
}

/**
 * Create a CMS page.
 */
export async function createPage(
  data: {
    title: string;
    slug?: string;
    pageType?: string;
    description?: string;
    sections?: Omit<CmsSection, 'id'>[];
    seo?: CmsSeoMeta;
  }
): Promise<CmsPageDetail> {
  const client = getAPIClient();

  log.debug('Creating CMS page', { title: data.title });

  const response = await client.post<{ success: boolean; data: CmsPageDetail }>(
    `${CMS_API_BASE}/v1/manage/pages`,
    data
  );
  return response.data;
}

/**
 * Update a CMS page.
 */
export async function updatePage(
  pageId: string,
  data: Record<string, unknown>
): Promise<CmsPageDetail> {
  const client = getAPIClient();

  log.debug('Updating CMS page', { pageId });

  const response = await client.put<{ success: boolean; data: CmsPageDetail }>(
    `${CMS_API_BASE}/v1/manage/pages/${encodeURIComponent(pageId)}`,
    data
  );
  return response.data;
}

/**
 * Delete a CMS page.
 */
export async function deletePage(pageId: string): Promise<void> {
  const client = getAPIClient();

  log.debug('Deleting CMS page', { pageId });

  await client.delete(`${CMS_API_BASE}/v1/manage/pages/${encodeURIComponent(pageId)}`);
}

// ============================================================================
// EXPORT/IMPORT API (authenticated)
// ============================================================================

/**
 * Export all CMS content.
 */
export async function exportContent(): Promise<CmsExportResult> {
  const client = getAPIClient();

  log.debug('Exporting CMS content');

  const response = await client.get<{ success: boolean; data: CmsExportResult }>(
    `${CMS_API_BASE}/v1/manage/export`
  );
  return response.data;
}

/**
 * Import CMS content.
 */
export async function importContent(
  data: CmsExportResult,
  options?: { overwrite?: boolean }
): Promise<{ imported: number; skipped: number }> {
  const client = getAPIClient();

  log.debug('Importing CMS content', { pageCount: data.pages.length });

  const response = await client.post<{ success: boolean; data: { imported: number; skipped: number } }>(
    `${CMS_API_BASE}/v1/manage/import`,
    { ...data, overwrite: options?.overwrite ?? false }
  );
  return response.data;
}

// ============================================================================
// ENGAGEMENT API (authenticated)
// ============================================================================

/**
 * List comments for a page.
 */
export async function listComments(pageId: string): Promise<CmsComment[]> {
  const client = getAPIClient();

  log.debug('Listing comments', { pageId });

  const response = await client.get<{ success: boolean; data: CmsComment[] }>(
    `${CMS_API_BASE}/v1/engagement/comments/${encodeURIComponent(pageId)}`
  );
  return response.data;
}

/**
 * Create a comment on a page.
 */
export async function createComment(
  data: { pageId: string; content: string; parentCommentId?: string; authorName?: string }
): Promise<CmsComment> {
  const client = getAPIClient();

  log.debug('Creating comment', { pageId: data.pageId });

  const response = await client.post<{ success: boolean; data: CmsComment }>(
    `${CMS_API_BASE}/v1/engagement/comments`,
    data
  );
  return response.data;
}

/**
 * Edit a comment.
 */
export async function editComment(
  commentId: string,
  content: string
): Promise<CmsComment> {
  const client = getAPIClient();

  log.debug('Editing comment', { commentId });

  const response = await client.patch<{ success: boolean; data: CmsComment }>(
    `${CMS_API_BASE}/v1/engagement/comments/${encodeURIComponent(commentId)}`,
    { content }
  );
  return response.data;
}

/**
 * Delete a comment.
 */
export async function deleteComment(commentId: string): Promise<void> {
  const client = getAPIClient();

  log.debug('Deleting comment', { commentId });

  await client.delete(
    `${CMS_API_BASE}/v1/engagement/comments/${encodeURIComponent(commentId)}`
  );
}

/**
 * Toggle a reaction on a page.
 */
export async function toggleReaction(
  pageId: string,
  reactionType: string
): Promise<CmsReactionSummary> {
  const client = getAPIClient();

  log.debug('Toggling reaction', { pageId, reactionType });

  const response = await client.post<{ success: boolean; data: CmsReactionSummary }>(
    `${CMS_API_BASE}/v1/engagement/reactions/${encodeURIComponent(pageId)}`,
    { type: reactionType }
  );
  return response.data;
}

/**
 * Track a page share event.
 */
export async function trackShare(
  pageId: string,
  platform: string
): Promise<void> {
  const client = getAPIClient();

  log.debug('Tracking share', { pageId, platform });

  await client.post(
    `${CMS_API_BASE}/v1/engagement/shares/${encodeURIComponent(pageId)}`,
    { platform }
  );
}

// ============================================================================
// RSS FEEDS (public, read-only)
// ============================================================================

/** Get the blog RSS feed URL. */
export function getBlogFeedUrl(): string {
  return `${SEO_SITEMAP_BASE}/blog/feed.xml`;
}

/** Get the podcast RSS feed URL. */
export function getPodcastFeedUrl(): string {
  return `${SEO_SITEMAP_BASE}/podcast/feed.xml`;
}

/** Get the sitemap URL. */
export function getSitemapUrl(): string {
  return `${SEO_SITEMAP_BASE}/sitemap.xml`;
}

// ============================================================================
// GDPR API (authenticated, admin-only)
// ============================================================================

/**
 * Delete all CMS data for a user (GDPR compliance).
 */
export async function deleteUserData(userId?: string): Promise<{ deleted: number }> {
  const client = getAPIClient();

  log.debug('GDPR user data deletion', { userId });

  const path = userId
    ? `${CMS_API_BASE}/v1/manage/gdpr/user-data/${encodeURIComponent(userId)}`
    : `${CMS_API_BASE}/v1/manage/gdpr/user-data`;

  const response = await client.delete<{ success: boolean; data: { deleted: number } }>(path);
  return response.data;
}
