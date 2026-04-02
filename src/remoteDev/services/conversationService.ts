/**
 * Claude 多轮对话服务 (Phase 8)
 *
 * 对应后端 /api/remote-dev/conversations 端点
 * 持久 CLI 进程 + 双向 WS 多轮对话
 *
 * @module remoteDev/services/conversationService
 */

import type { RemoteDevApiClient } from './apiClient';
import type { Conversation, ConversationCreateParams, ConversationMessage } from '../types/remoteDev';

export function createConversationService(api: RemoteDevApiClient) {
  return {
    async create(params: ConversationCreateParams): Promise<Conversation> {
      return api.post('/api/remote-dev/conversations', params);
    },

    async list(): Promise<Conversation[]> {
      return api.get('/api/remote-dev/conversations');
    },

    async get(id: string): Promise<Conversation> {
      return api.get(`/api/remote-dev/conversations/${id}`);
    },

    async close(id: string): Promise<void> {
      await api.delete(`/api/remote-dev/conversations/${id}`);
    },

    async getMessages(id: string): Promise<ConversationMessage[]> {
      return api.get(`/api/remote-dev/conversations/${id}/messages`);
    },

    async resume(id: string): Promise<Conversation> {
      return api.post(`/api/remote-dev/conversations/${id}/resume`);
    },
  };
}

export type ConversationService = ReturnType<typeof createConversationService>;
