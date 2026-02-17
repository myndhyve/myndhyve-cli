/**
 * MyndHyve CLI — Firestore REST API Wrapper
 *
 * Lightweight wrapper around the Firestore REST API for direct document
 * access without the Firebase JS SDK. Uses Firebase ID tokens from the
 * auth module for authentication.
 *
 * @see https://cloud.google.com/firestore/docs/reference/rest
 */

import { getToken } from '../auth/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Firestore');

// ============================================================================
// CONFIGURATION
// ============================================================================

const FIREBASE_PROJECT_ID = 'myndhyve-prod';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const DEFAULT_TIMEOUT_MS = 15_000;

// ============================================================================
// VALUE SERIALIZATION
// ============================================================================

/** Firestore REST API value representation. */
export type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

/** Firestore document from REST API. */
export interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

/**
 * Convert a JavaScript value to Firestore REST value format.
 */
export function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }

  if (typeof value === 'string') {
    return { stringValue: value };
  }

  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }

  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(toFirestoreValue),
      },
    };
  }

  if (typeof value === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }

  // Fallback: coerce to string
  return { stringValue: String(value) };
}

/**
 * Convert a Firestore REST value back to a JavaScript value.
 */
export function fromFirestoreValue(value: FirestoreValue): unknown {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return parseInt(value.integerValue, 10);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;

  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }

  if ('mapValue' in value) {
    const result: Record<string, unknown> = {};
    const fields = value.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      result[k] = fromFirestoreValue(v);
    }
    return result;
  }

  return null;
}

/**
 * Serialize a plain JS object to Firestore document fields.
 */
export function toFirestoreFields(
  obj: Record<string, unknown>
): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      fields[key] = toFirestoreValue(value);
    }
  }
  return fields;
}

/**
 * Deserialize Firestore document fields to a plain JS object.
 */
export function fromFirestoreFields(
  fields: Record<string, FirestoreValue>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = fromFirestoreValue(value);
  }
  return result;
}

/**
 * Extract the document ID from a Firestore document `name` field.
 * Format: `projects/{project}/databases/{db}/documents/{collection}/{docId}`
 */
export function extractDocId(documentName: string): string {
  const parts = documentName.split('/');
  return parts[parts.length - 1];
}

// ============================================================================
// HTTP HELPERS
// ============================================================================

async function firestoreRequest(
  url: string,
  init: RequestInit
): Promise<Response> {
  const token = await getToken();

  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    let errorMessage: string;
    try {
      const parsed = JSON.parse(errorBody);
      errorMessage =
        parsed.error?.message || parsed.error?.status || errorBody;
    } catch {
      errorMessage = errorBody || `HTTP ${response.status}`;
    }

    if (response.status === 404) {
      throw new FirestoreError(`Document not found`, 'NOT_FOUND', 404);
    }

    if (response.status === 403) {
      throw new FirestoreError(
        `Permission denied: ${errorMessage}`,
        'PERMISSION_DENIED',
        403
      );
    }

    throw new FirestoreError(
      `Firestore error (${response.status}): ${errorMessage}`,
      'REQUEST_FAILED',
      response.status
    );
  }

  return response;
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Get a single document by its collection path and document ID.
 *
 * @param collectionPath - e.g. 'projects' or 'users/uid123/hyveDocuments'
 * @param documentId - Document ID
 * @returns Deserialized document data with `id` field, or null if not found
 */
export async function getDocument(
  collectionPath: string,
  documentId: string
): Promise<Record<string, unknown> | null> {
  const url = `${FIRESTORE_BASE}/${collectionPath}/${documentId}`;

  try {
    const response = await firestoreRequest(url, { method: 'GET' });
    const doc = (await response.json()) as FirestoreDocument;

    if (!doc.fields) return null;

    const data = fromFirestoreFields(doc.fields);
    data.id = extractDocId(doc.name);
    return data;
  } catch (error) {
    if (error instanceof FirestoreError && error.code === 'NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

/**
 * List all documents in a collection.
 *
 * @param collectionPath - e.g. 'projects' or 'users/uid123/hyveDocuments'
 * @param options - Page size and page token for pagination
 * @returns Array of deserialized documents
 */
export async function listDocuments(
  collectionPath: string,
  options?: { pageSize?: number; pageToken?: string; orderBy?: string }
): Promise<{ documents: Record<string, unknown>[]; nextPageToken?: string }> {
  const params = new URLSearchParams();
  if (options?.pageSize) params.set('pageSize', String(options.pageSize));
  if (options?.pageToken) params.set('pageToken', options.pageToken);
  if (options?.orderBy) params.set('orderBy', options.orderBy);

  const url = `${FIRESTORE_BASE}/${collectionPath}?${params.toString()}`;

  const response = await firestoreRequest(url, { method: 'GET' });
  const body = (await response.json()) as {
    documents?: FirestoreDocument[];
    nextPageToken?: string;
  };

  const documents: Record<string, unknown>[] = [];
  if (body.documents) {
    for (const doc of body.documents) {
      if (doc.fields) {
        const data = fromFirestoreFields(doc.fields);
        data.id = extractDocId(doc.name);
        documents.push(data);
      }
    }
  }

  return {
    documents,
    nextPageToken: body.nextPageToken,
  };
}

/**
 * Create a document with a specific ID.
 *
 * @param collectionPath - e.g. 'projects'
 * @param documentId - Desired document ID
 * @param data - Document data
 * @returns The created document data
 */
export async function createDocument(
  collectionPath: string,
  documentId: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const url = `${FIRESTORE_BASE}/${collectionPath}?documentId=${encodeURIComponent(documentId)}`;

  const body = {
    fields: toFirestoreFields(data),
  };

  const response = await firestoreRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const doc = (await response.json()) as FirestoreDocument;
  const result = doc.fields ? fromFirestoreFields(doc.fields) : data;
  result.id = extractDocId(doc.name);
  return result;
}

/**
 * Update specific fields of a document (merge semantics).
 *
 * @param collectionPath - e.g. 'projects'
 * @param documentId - Document ID to update
 * @param data - Fields to update
 * @param fieldPaths - Specific field paths to update (for partial updates)
 * @returns Updated document data
 */
export async function updateDocument(
  collectionPath: string,
  documentId: string,
  data: Record<string, unknown>,
  fieldPaths?: string[]
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  const updatePaths = fieldPaths || Object.keys(data);
  for (const path of updatePaths) {
    params.append('updateMask.fieldPaths', path);
  }

  const url = `${FIRESTORE_BASE}/${collectionPath}/${documentId}?${params.toString()}`;

  const body = {
    fields: toFirestoreFields(data),
  };

  const response = await firestoreRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

  const doc = (await response.json()) as FirestoreDocument;
  const result = doc.fields ? fromFirestoreFields(doc.fields) : data;
  result.id = extractDocId(doc.name);
  return result;
}

/**
 * Delete a document.
 *
 * @param collectionPath - e.g. 'projects'
 * @param documentId - Document ID to delete
 */
export async function deleteDocument(
  collectionPath: string,
  documentId: string
): Promise<void> {
  const url = `${FIRESTORE_BASE}/${collectionPath}/${documentId}`;
  await firestoreRequest(url, { method: 'DELETE' });
  log.debug('Document deleted', { collectionPath, documentId });
}

/**
 * Run a structured query against a collection.
 *
 * @param collectionPath - e.g. 'projects' (relative to the database root)
 * @param filters - Array of field filters
 * @param options - Ordering and limit
 * @returns Array of matching documents
 */
export async function runQuery(
  collectionPath: string,
  filters: QueryFilter[],
  options?: { orderBy?: string; orderDirection?: 'ASCENDING' | 'DESCENDING'; limit?: number }
): Promise<Record<string, unknown>[]> {
  const url = `${FIRESTORE_BASE}:runQuery`;

  const where = buildCompositeFilter(filters);

  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: getCollectionId(collectionPath) }],
    ...(where ? { where } : {}),
  };

  if (options?.orderBy) {
    structuredQuery.orderBy = [
      {
        field: { fieldPath: options.orderBy },
        direction: options.orderDirection || 'ASCENDING',
      },
    ];
  }

  if (options?.limit) {
    structuredQuery.limit = options.limit;
  }

  // For subcollections, we need to extract the parent path
  const parentPath = getParentPath(collectionPath);

  const response = await firestoreRequest(
    parentPath ? `${FIRESTORE_BASE}/${parentPath}:runQuery` : url,
    {
      method: 'POST',
      body: JSON.stringify({ structuredQuery }),
    }
  );

  const results = (await response.json()) as Array<{ document?: FirestoreDocument }>;
  const documents: Record<string, unknown>[] = [];

  if (Array.isArray(results)) {
    for (const result of results) {
      if (result.document?.fields) {
        const data = fromFirestoreFields(result.document.fields);
        data.id = extractDocId(result.document.name);
        documents.push(data);
      }
    }
  }

  return documents;
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

export interface QueryFilter {
  field: string;
  op: 'EQUAL' | 'NOT_EQUAL' | 'LESS_THAN' | 'GREATER_THAN' |
    'LESS_THAN_OR_EQUAL' | 'GREATER_THAN_OR_EQUAL' |
    'ARRAY_CONTAINS' | 'IN' | 'ARRAY_CONTAINS_ANY' | 'NOT_IN';
  value: unknown;
}

function buildCompositeFilter(
  filters: QueryFilter[]
): Record<string, unknown> | undefined {
  if (filters.length === 0) return undefined;

  const fieldFilters = filters.map((f) => ({
    fieldFilter: {
      field: { fieldPath: f.field },
      op: f.op,
      value: toFirestoreValue(f.value),
    },
  }));

  if (fieldFilters.length === 1) {
    return fieldFilters[0];
  }

  return {
    compositeFilter: {
      op: 'AND',
      filters: fieldFilters,
    },
  };
}

/**
 * Extract the last segment of a collection path (the collection ID).
 * e.g. 'users/uid/hyveDocuments' → 'hyveDocuments'
 */
function getCollectionId(collectionPath: string): string {
  const parts = collectionPath.split('/');
  return parts[parts.length - 1];
}

/**
 * Get the parent document path for a subcollection.
 * e.g. 'users/uid/hyveDocuments' → 'users/uid'
 * Returns undefined for top-level collections.
 */
function getParentPath(collectionPath: string): string | undefined {
  const parts = collectionPath.split('/');
  if (parts.length <= 1) return undefined;
  return parts.slice(0, -1).join('/');
}

// ============================================================================
// ERROR
// ============================================================================

export class FirestoreError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'FirestoreError';
  }
}
