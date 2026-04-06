/**
 * Workspace Path Utilities
 *
 * Shared path resolution for Firestore REST API calls.
 * All collaborative data lives at `workspaces/{workspaceId}/`.
 *
 * @module utils/workspacePaths
 */

/**
 * Deterministic personal workspace ID for a user.
 * Must match the server-side seeding logic.
 */
export function personalWorkspaceId(userId: string): string {
  return `ws-personal-${userId}`;
}

/**
 * Resolve a Firestore collection path for collaborative data.
 *
 * When workspaceId is provided, routes to workspace-scoped path.
 * Otherwise falls back to personal workspace for the given userId.
 */
export function resolveCollectionPath(
  userId: string,
  collection: string,
  workspaceId?: string,
): string {
  const wsId = workspaceId ?? personalWorkspaceId(userId);
  return `workspaces/${wsId}/${collection}`;
}

/**
 * Resolve a Firestore document path for collaborative data.
 */
export function resolveDocumentPath(
  userId: string,
  collection: string,
  docId: string,
  workspaceId?: string,
): string {
  return `${resolveCollectionPath(userId, collection, workspaceId)}/${docId}`;
}
