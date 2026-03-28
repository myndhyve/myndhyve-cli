/**
 * MyndHyve CLI — Launch Studio API
 *
 * CRUD for Launch Studios via Firestore REST API.
 * Path: users/{userId}/launchStudios/{studioId}
 */

import { getDocument, createDocument, deleteDocument, listDocuments } from './firestore.js';
import { createLogger } from '../utils/logger.js';
import { randomBytes } from 'node:crypto';

const log = createLogger('LaunchStudioAPI');

export type LaunchStudioStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
export type LaunchStudioStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type BuiltInFlowTemplateId = 'ai-saas-launch' | 'ai-api-launch' | 'ai-agent-launch' | 'ai-pitch-prep' | 'ai-gtm-blitz';

export interface LaunchStudioStep {
  id: string;
  canvasTypeId: string;
  name: string;
  order: number;
  status: LaunchStudioStepStatus;
  projectId?: string;
  taskIds: string[];
}

export interface ProjectArtifactRef {
  artifactId: string;
  sourceProjectId: string;
  sourceCanvasTypeId: string;
  artifactTypeId: string;
  label?: string;
}

export interface LaunchStudio {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  flowTemplateId: BuiltInFlowTemplateId;
  steps: LaunchStudioStep[];
  prdId?: string;
  brandId?: string;
  designSystemId?: string;
  boardId?: string;
  workflowRunId?: string;
  sharedArtifactRefs: ProjectArtifactRef[];
  status: LaunchStudioStatus;
  currentStepIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface FlowTemplate {
  id: BuiltInFlowTemplateId;
  name: string;
  description: string;
  canvasTypeIds: string[];
  bestFor: string;
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  { id: 'ai-saas-launch', name: 'AI SaaS Launch', description: 'PRD → LP → Campaigns → Pitch Deck', canvasTypeIds: ['app-builder', 'cms-builder', 'campaign-studio', 'slides'], bestFor: 'AI-powered SaaS products' },
  { id: 'ai-api-launch', name: 'AI API Product Launch', description: 'PRD → LP → Campaigns', canvasTypeIds: ['app-builder', 'cms-builder', 'campaign-studio'], bestFor: 'AI API products' },
  { id: 'ai-agent-launch', name: 'AI Agent Product Launch', description: 'PRD → LP → Campaigns → Pitch Deck', canvasTypeIds: ['app-builder', 'cms-builder', 'campaign-studio', 'slides'], bestFor: 'Autonomous agent products' },
  { id: 'ai-pitch-prep', name: 'AI Pitch Prep', description: 'PRD → Pitch Deck', canvasTypeIds: ['app-builder', 'slides'], bestFor: 'Pre-fundraise preparation' },
  { id: 'ai-gtm-blitz', name: 'AI GTM Blitz', description: 'LP → Campaigns', canvasTypeIds: ['cms-builder', 'campaign-studio'], bestFor: 'Post-MVP customer acquisition' },
];

const COLLECTION = 'launchStudios';

export async function listLaunchStudios(userId: string): Promise<LaunchStudio[]> {
  log.debug('Listing launch studios');
  const result = await listDocuments(`users/${userId}/${COLLECTION}`);
  return (result.documents ?? []).map((doc) => {
    const id = (doc._documentId as string) ?? '';
    return { ...doc, id } as unknown as LaunchStudio;
  });
}

export async function getLaunchStudio(userId: string, studioId: string): Promise<LaunchStudio | null> {
  log.debug('Getting launch studio');
  const doc = await getDocument(`users/${userId}/${COLLECTION}`, studioId);
  if (!doc) return null;
  return { ...doc, id: studioId } as unknown as LaunchStudio;
}

export async function createLaunchStudio(
  userId: string,
  options: { name: string; flowTemplateId: BuiltInFlowTemplateId; description?: string },
): Promise<LaunchStudio> {
  const template = FLOW_TEMPLATES.find((t) => t.id === options.flowTemplateId);
  const steps: LaunchStudioStep[] = (template?.canvasTypeIds ?? []).map((ct, i) => ({
    id: `step-${i}`, canvasTypeId: ct, name: ct, order: i, status: 'pending' as const, taskIds: [],
  }));
  const now = new Date().toISOString();
  const studioId = `ls-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const data = {
    ownerId: userId, name: options.name, description: options.description ?? '',
    flowTemplateId: options.flowTemplateId, steps, sharedArtifactRefs: [],
    status: 'draft', currentStepIndex: 0, createdAt: now, updatedAt: now,
  };
  await createDocument(`users/${userId}/${COLLECTION}`, studioId, data);
  return { id: studioId, ...data } as LaunchStudio;
}

export async function deleteLaunchStudio(userId: string, studioId: string): Promise<void> {
  await deleteDocument(`users/${userId}/${COLLECTION}`, studioId);
}
