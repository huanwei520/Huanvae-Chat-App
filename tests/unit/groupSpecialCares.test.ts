/**
 * M3 群内特别关心 API 单测（addGroupSpecialCare / removeGroupSpecialCare / getGroupSpecialCares）
 *
 * 验证 URL、HTTP 方法、请求体形态，以及对 targetUserId 的 encodeURIComponent 处理。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroupSpecialCare } from '../../src/api/groups';

const mockApiClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  getBaseUrl: vi.fn(() => 'http://localhost'),
  getAccessToken: vi.fn(() => 'mock-token'),
  refreshAccessToken: vi.fn(() => Promise.resolve(true)),
};

vi.mock('../../src/api/client', () => ({
  createApiClient: () => mockApiClient,
}));

import {
  addGroupSpecialCare,
  removeGroupSpecialCare,
  getGroupSpecialCares,
} from '../../src/api/groups';

describe('M3 群内特别关心 API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addGroupSpecialCare', () => {
    it('POST 到 special-care 端点，body 含 target_user_id', async () => {
      mockApiClient.post.mockResolvedValue(undefined);

      await addGroupSpecialCare(mockApiClient, 'g1', 'u2');

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/api/groups/g1/special-care',
        { target_user_id: 'u2' },
      );
    });

    it('请求失败时抛出错误', async () => {
      mockApiClient.post.mockRejectedValue(new Error('400 cannot care self'));
      await expect(addGroupSpecialCare(mockApiClient, 'g1', 'g1-owner'))
        .rejects.toThrow('400 cannot care self');
    });
  });

  describe('removeGroupSpecialCare', () => {
    it('DELETE 到带 target 的端点', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await removeGroupSpecialCare(mockApiClient, 'g1', 'u2');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/groups/g1/special-care/u2');
    });

    it('对 target_user_id 做 encodeURIComponent（含特殊字符）', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await removeGroupSpecialCare(mockApiClient, 'g1', 'user/with space');

      expect(mockApiClient.delete).toHaveBeenCalledWith(
        '/api/groups/g1/special-care/user%2Fwith%20space',
      );
    });
  });

  describe('getGroupSpecialCares', () => {
    it('GET special-care 并返回成员名单', async () => {
      const cares: GroupSpecialCare[] = [
        { user_id: 'u2', user_nickname: 'Bob', user_avatar_url: null, created_at: '2026-06-12T00:00:00Z' },
        { user_id: 'u3', user_nickname: null, user_avatar_url: null, created_at: '2026-06-12T01:00:00Z' },
      ];
      mockApiClient.get.mockResolvedValue(cares);

      const result = await getGroupSpecialCares(mockApiClient, 'g1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/groups/g1/special-care');
      expect(result).toEqual(cares);
      expect(result.map((c) => c.user_id)).toEqual(['u2', 'u3']);
    });

    it('空名单返回空数组', async () => {
      mockApiClient.get.mockResolvedValue([]);
      const result = await getGroupSpecialCares(mockApiClient, 'g1');
      expect(result).toEqual([]);
    });
  });
});
