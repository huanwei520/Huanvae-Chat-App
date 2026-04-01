/**
 * Claude Code 安装服务 (Phase 5)
 *
 * startSetup 使用原始 fetch 而非 api.post()，因为后端返回 202 Accepted
 * 且可能无 JSON 响应体（文档第 17 条）。
 *
 * @module remoteDev/services/setupService
 */

import { fetch } from '@tauri-apps/plugin-http';
import type { RemoteDevApiClient } from './apiClient';
import type { SetupStatusResponse } from '../types/remoteDev';

export function createSetupService(api: RemoteDevApiClient) {
  return {
    async startSetup(machineId: string): Promise<void> {
      const response = await fetch(
        `${api.getServerUrl()}/api/remote-dev/setup/${machineId}`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${api.getAccessToken()}` },
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({} as Record<string, string>));
        throw new Error(data.error || data.message || `安装启动失败 (HTTP ${response.status})`);
      }
    },

    async getSetupStatus(machineId: string): Promise<SetupStatusResponse> {
      return api.get(`/api/remote-dev/setup/${machineId}/status`);
    },
  };
}

export type SetupService = ReturnType<typeof createSetupService>;
