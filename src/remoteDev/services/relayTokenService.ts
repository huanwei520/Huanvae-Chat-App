/**
 * 中继 Token 服务 (Phase 1)
 *
 * @module remoteDev/services/relayTokenService
 */

import type { RemoteDevApiClient } from './apiClient';
import type {
  RelayToken,
  RelayTokenCreateParams,
  RelayTokenCreateResponse,
  UsageRecord,
  DailyUsage,
} from '../types/remoteDev';

export function createRelayTokenService(api: RemoteDevApiClient) {
  return {
    async createToken(params: RelayTokenCreateParams = {}): Promise<RelayTokenCreateResponse> {
      return api.post('/api/remote-dev/relay-tokens', params);
    },

    async listTokens(): Promise<RelayToken[]> {
      return api.get('/api/remote-dev/relay-tokens');
    },

    async deleteToken(tokenId: string): Promise<void> {
      await api.delete(`/api/remote-dev/relay-tokens/${tokenId}`);
    },

    async getUsage(limit = 50, offset = 0): Promise<UsageRecord[]> {
      return api.get(`/api/remote-dev/usage?limit=${limit}&offset=${offset}`);
    },

    async getDailyUsage(): Promise<DailyUsage[]> {
      return api.get('/api/remote-dev/usage/daily');
    },
  };
}

export type RelayTokenService = ReturnType<typeof createRelayTokenService>;
