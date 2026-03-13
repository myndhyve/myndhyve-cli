/**
 * MyndHyve CLI — Canvas Runtime API Client
 *
 * API client for canvas runtime endpoints. Extends the MyndHyveClient
 * with canvas-specific methods for session management, queue control,
 * and agent interaction.
 */

import type { MyndHyveClient } from './client.js';

// ============================================================================
// TYPES
// ============================================================================

export interface CanvasSessionCreateRequest {
  tenantId: string;
  projectId: string;
  canvasId: string;
  canvasType: string;
  surface: string;
  sessionScope: string;
  title?: string;
  primaryAgentId?: string;
  queueMode?: string;
}

export interface CanvasSessionCreateResponse {
  sessionKey: string;
  sessionId: string;
  canvasMetadata: {
    canvasId: string;
    canvasType: string;
    surface: string;
    sessionScope: string;
    executionState: {
      queueMode: string;
    };
  };
  runtimeState: {
    isActive: boolean;
  };
}

export interface CanvasSessionResponse {
  sessionKey: string;
  sessionId: string;
  title: string;
  projectId: string;
  canvasMetadata: {
    canvasId: string;
    canvasType: string;
    surface: string;
    sessionScope: string;
    executionState: {
      queueMode: string;
    };
  };
  runtimeState: {
    isActive: boolean;
  };
  workflowState: any;
  stats: {
    messageCount: number;
    tokenCount: number;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
  };
}

export interface CanvasSessionHistoryResponse {
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: string;
    status: string;
  }>;
  total: number;
  offset: number;
  limit: number;
}

export interface QueueStatus {
  queueMode: string;
  queuedEvents: Array<{
    id: string;
    type: string;
    data: unknown;
    queuedAt: string;
    source: string;
    priority: string;
  }>;
  isLocked: boolean;
  lockHolder: string | null;
}

export interface QueueModeSetRequest {
  queueMode: string;
}

export interface QueueModeSetResponse {
  message: string;
  queueMode: string;
}

// ============================================================================
// CANVAS API CLIENT
// ============================================================================

export class CanvasApiClient {
  constructor(private readonly client: MyndHyveClient) {}

  // ==========================================================================
  // SESSION MANAGEMENT
  // ==========================================================================

  /**
   * Create a new canvas session
   */
  async createSession(request: CanvasSessionCreateRequest): Promise<CanvasSessionCreateResponse> {
    return this.client.post('/canvas-api/v1/sessions', request);
  }

  /**
   * Get a canvas session by session key
   */
  async getSession(sessionKey: string): Promise<CanvasSessionResponse> {
    return this.client.get(`/canvas-api/v1/sessions/${sessionKey}`);
  }

  /**
   * Reset a canvas session
   */
  async resetSession(sessionKey: string): Promise<{ sessionKey: string; sessionId: string; message: string }> {
    return this.client.post(`/canvas-api/v1/sessions/${sessionKey}/reset`);
  }

  /**
   * Get session history
   */
  async getSessionHistory(
    sessionKey: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<CanvasSessionHistoryResponse> {
    return this.client.get(`/canvas-api/v1/sessions/${sessionKey}/history`, options);
  }

  // ==========================================================================
  // QUEUE MANAGEMENT
  // ==========================================================================

  /**
   * Get queue status for a session
   */
  async getQueueStatus(sessionKey: string): Promise<QueueStatus> {
    return this.client.get(`/canvas-api/v1/sessions/${sessionKey}/queue`);
  }

  /**
   * Set queue mode for a session
   */
  async setQueueMode(sessionKey: string, queueMode: string): Promise<QueueModeSetResponse> {
    return this.client.post(`/canvas-api/v1/sessions/${sessionKey}/queue-mode`, { queueMode });
  }

  // ==========================================================================
  // AGENT INTERACTION (Future Implementation)
  // ==========================================================================

  /**
   * Send message to canvas agent (future)
   */
  async sendAgentMessage(sessionKey: string, message: string): Promise<{ success: boolean; message: string }> {
    // This would integrate with the canvas agent system
    throw new Error('Agent messaging not yet implemented in CLI');
  }

  /**
   * Steer active agent run (future)
   */
  async steerAgent(sessionKey: string, steeringMessage: string): Promise<{ success: boolean; message: string }> {
    // This would integrate with the canvas steering system
    throw new Error('Agent steering not yet implemented in CLI');
  }

  /**
   * Cancel active agent run (future)
   */
  async cancelAgentRun(sessionKey: string): Promise<{ success: boolean; message: string }> {
    // This would integrate with the canvas run cancellation system
    throw new Error('Agent run cancellation not yet implemented in CLI');
  }

  // ==========================================================================
  // RUN MANAGEMENT (Future Implementation)
  // ==========================================================================

  /**
   * Get run status (future)
   */
  async getRunStatus(runId: string): Promise<any> {
    // This would integrate with the workflow execution system
    throw new Error('Run status not yet implemented in CLI');
  }

  /**
   * Get run logs (future)
   */
  async getRunLogs(runId: string): Promise<any> {
    // This would integrate with the workflow execution system
    throw new Error('Run logs not yet implemented in CLI');
  }

  /**
   * Get run trace (future)
   */
  async getRunTrace(runId: string): Promise<any> {
    // This would integrate with the workflow execution system
    throw new Error('Run trace not yet implemented in CLI');
  }

  // ==========================================================================
  // SCHEDULING (Future Implementation)
  // ==========================================================================

  /**
   * Set heartbeat for canvas (future)
   */
  async setHeartbeat(canvasId: string, intervalMinutes: number): Promise<{ success: boolean; message: string }> {
    // This would integrate with the canvas wakeup system
    throw new Error('Heartbeat scheduling not yet implemented in CLI');
  }

  /**
   * Add cron schedule (future)
   */
  async addCronSchedule(
    canvasId: string,
    schedule: string,
    prompt: string
  ): Promise<{ success: boolean; message: string }> {
    // This would integrate with the canvas wakeup system
    throw new Error('Cron scheduling not yet implemented in CLI');
  }
}
