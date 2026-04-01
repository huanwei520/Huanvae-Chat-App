/**
 * Claude 对话会话服务 (Phase 6)
 *
 * @module remoteDev/services/sessionService
 */

import type { RemoteDevApiClient } from './apiClient';
import type { ClaudeSession, ClaudeSessionStartParams } from '../types/remoteDev';

export function createSessionService(api: RemoteDevApiClient) {
  return {
    async startSession(machineId: string, params: ClaudeSessionStartParams): Promise<ClaudeSession> {
      return api.post(`/api/remote-dev/sessions/${machineId}/start`, params);
    },

    async listSessions(): Promise<ClaudeSession[]> {
      return api.get('/api/remote-dev/sessions');
    },

    async closeSession(sessionId: string): Promise<void> {
      await api.delete(`/api/remote-dev/sessions/${sessionId}`);
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
