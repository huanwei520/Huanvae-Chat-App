/**
 * SFTP 文件服务 (Phase 4)
 *
 * 注意：
 * - listDir 路径为 /api/remote-dev/files/{machineId}?path=...（无 /list 后缀）
 * - readFile 返回原始二进制（application/octet-stream），需要用 fetch 直接读取
 *
 * @module remoteDev/services/fileService
 */

import { fetch } from '@tauri-apps/plugin-http';
import type { RemoteDevApiClient } from './apiClient';
import type { FileEntry } from '../types/remoteDev';

export function createFileService(api: RemoteDevApiClient) {
  return {
    async listDir(machineId: string, path: string): Promise<FileEntry[]> {
      const encoded = encodeURIComponent(path);
      return api.get(`/api/remote-dev/files/${machineId}?path=${encoded}`);
    },

    /**
     * 读取文件内容
     *
     * 后端返回 application/octet-stream 原始二进制，不是 JSON
     * 需要直接用 fetch 请求并读取 text()
     */
    async readFile(machineId: string, path: string): Promise<string> {
      const encoded = encodeURIComponent(path);
      const url = `${api.getServerUrl()}/api/remote-dev/files/${machineId}/read?path=${encoded}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${api.getAccessToken()}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('文件不存在');
        }
        if (response.status === 400) {
          throw new Error('无效路径');
        }
        throw new Error(`读取失败 (HTTP ${response.status})`);
      }

      return response.text();
    },

    async getMetadata(machineId: string, path: string): Promise<FileEntry> {
      const encoded = encodeURIComponent(path);
      return api.get(`/api/remote-dev/files/${machineId}/stat?path=${encoded}`);
    },
  };
}

export type FileService = ReturnType<typeof createFileService>;
