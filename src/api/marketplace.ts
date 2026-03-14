/**
 * MyndHyve CLI — Marketplace API
 *
 * Interacts with marketplace Cloud Functions for browsing, installing,
 * and publishing packs.
 *
 * @see functions/src/marketplace/ — server endpoints
 */

import { getAPIClient } from './client.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('MarketplaceAPI');

// ============================================================================
// TYPES
// ============================================================================

export type PackType =
  | 'canvas'
  | 'node-pack'
  | 'card-pack'
  | 'canvas-pack'
  | 'template'
  | 'block'
  | 'mcp-server'
  | 'a2a-agent'
  | 'connector-template'
  | 'skill-package';

export type PricingType = 'free' | 'paid' | 'subscription';

export type SortBy = 'relevance' | 'downloads' | 'rating' | 'newest' | 'updated';

export interface PackListingSummary {
  id: string;
  name: string;
  shortDescription: string;
  packType: PackType;
  pricing: {
    type: PricingType;
    price?: number;
    currency?: string;
  };
  stats: {
    downloads: number;
    rating: number;
    reviewCount: number;
  };
  version: string;
  iconUrl?: string;
  publisherId: string;
  publisherName?: string;
  updatedAt: string;
}

export interface PackListingDetail extends PackListingSummary {
  description: string;
  category: string;
  tags: string[];
  screenshots: string[];
  videoUrl?: string;
  readme?: string;
  changelog?: string;
  license: string;
  repository?: string;
  website?: string;
  supportUrl?: string;
  minPlatformVersion?: string;
  dependencies: string[];
  createdAt: string;
}

export interface InstalledPack {
  listingId: string;
  packId: string;
  name: string;
  version: string;
  installedVersion: string;
  enabled: boolean;
  hasUpdate: boolean;
  packType: PackType;
  installedAt: string;
}

export interface InstallResult {
  success: boolean;
  packId: string;
  version: string;
  message?: string;
  warnings?: string[];
}

export interface UninstallResult {
  success: boolean;
  error?: string;
}

export interface UpdateResult {
  success: boolean;
  packId: string;
  version: string;
  message?: string;
}

export interface SearchParams {
  q?: string;
  packType?: string;
  category?: string;
  pricing?: string;
  sortBy?: SortBy;
  page?: number;
  limit?: number;
}

export interface SearchResult {
  listings: PackListingSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface PublishRequest {
  packType: PackType;
  packData: unknown;
  name: string;
  description: string;
  shortDescription: string;
  category: string;
  tags: string[];
  pricing: {
    type: PricingType;
    price?: number;
    currency?: string;
    trialDays?: number;
    subscriptionPeriod?: 'monthly' | 'yearly';
  };
  iconUrl?: string;
  bannerUrl?: string;
  screenshots?: string[];
  videoUrl?: string;
  readme?: string;
  changelog?: string;
  license: string;
  repository?: string;
  website?: string;
  supportUrl?: string;
  minPlatformVersion?: string;
  dependencies?: string[];
}

export interface PublishResult {
  success: boolean;
  listingId?: string;
  version?: string;
  message?: string;
  errors?: Array<{ field: string; message: string }>;
}

export interface PurchaseSummary {
  purchaseId: string;
  listingId: string;
  packId: string;
  name: string;
  packType: PackType;
  amount: number;
  currency: string;
  purchasedAt: string;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Search the marketplace for packs.
 */
export async function searchMarketplace(params: SearchParams): Promise<SearchResult> {
  const client = getAPIClient();
  const query: Record<string, string> = {};

  if (params.q) query.q = params.q;
  if (params.packType) query.packType = params.packType;
  if (params.category) query.category = params.category;
  if (params.pricing) query.pricing = params.pricing;
  if (params.sortBy) query.sortBy = params.sortBy;
  if (params.page) query.page = String(params.page);
  if (params.limit) query.limit = String(params.limit);

  log.debug('Searching marketplace', query);
  return client.get<SearchResult>(
    '/marketplaceSearch',
    Object.keys(query).length > 0 ? query : undefined
  );
}

/**
 * Get featured marketplace listings.
 */
export async function getFeaturedListings(): Promise<{ listings: PackListingSummary[] }> {
  const client = getAPIClient();
  log.debug('Fetching featured listings');
  return client.get<{ listings: PackListingSummary[] }>('/marketplaceFeatured');
}

/**
 * Get detailed information about a marketplace listing.
 */
export async function getListingDetails(listingId: string): Promise<PackListingDetail | null> {
  const client = getAPIClient();
  log.debug('Fetching listing details', { listingId });

  try {
    const response = await client.get<{ listing: PackListingDetail | null }>(
      `/marketplaceListing/${encodeURIComponent(listingId)}`
    );
    return response.listing;
  } catch (err) {
    log.debug('Failed to fetch listing', {
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Install a pack from the marketplace.
 */
export async function installPack(listingId: string): Promise<InstallResult> {
  const client = getAPIClient();
  log.debug('Installing pack', { listingId });
  return client.post<InstallResult>('/marketplaceInstall', { listingId });
}

/**
 * Uninstall a pack.
 */
export async function uninstallPack(packId: string): Promise<UninstallResult> {
  const client = getAPIClient();
  log.debug('Uninstalling pack', { packId });
  return client.post<UninstallResult>('/marketplaceUninstall', { packId });
}

/**
 * Update an installed pack to the latest version.
 */
export async function updateInstalledPack(packId: string): Promise<UpdateResult> {
  const client = getAPIClient();
  log.debug('Updating pack', { packId });
  return client.post<UpdateResult>('/marketplaceUpdatePack', { packId });
}

/**
 * List all packs installed by the current user.
 */
export async function getInstalledPacks(): Promise<{ packs: InstalledPack[] }> {
  const client = getAPIClient();
  log.debug('Fetching installed packs');
  return client.get<{ packs: InstalledPack[] }>('/marketplaceInstalled');
}

/**
 * Publish a pack to the marketplace.
 */
export async function publishPack(request: PublishRequest): Promise<PublishResult> {
  const client = getAPIClient();
  log.debug('Publishing pack', { name: request.name, packType: request.packType });
  return client.post<PublishResult>('/marketplacePublish', request);
}

/**
 * List the current user's marketplace purchases.
 */
export async function getPurchases(): Promise<{ purchases: PurchaseSummary[] }> {
  const client = getAPIClient();
  log.debug('Fetching purchases');
  return client.get<{ purchases: PurchaseSummary[] }>('/marketplacePurchases');
}
