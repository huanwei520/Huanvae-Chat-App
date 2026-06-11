/**
 * D6 群内屏蔽 API 单测（addGroupMessageBlock / removeGroupMessageBlock / getGroupMessageBlocks）
 *
 * 验证 URL、HTTP 方法、请求体形态，以及对 targetUserId 的 encodeURIComponent 处理。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroupMessageBlock } from '../../src/api/groups';

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
  addGroupMessageBlock,
  removeGroupMessageBlock,
  getGroupMessageBlocks,
} from '../../src/api/groups';

describe('D6 群内屏蔽 API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addGroupMessageBlock', () => {
    it('POST 到 message-blocks 端点，body 含 target_user_id', async () => {
      mockApiClient.post.mockResolvedValue(undefined);

      await addGroupMessageBlock(mockApiClient, 'g1', 'u2');

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/api/groups/g1/message-blocks',
        { target_user_id: 'u2' },
      );
    });

    it('请求失败时抛出错误', async () => {
      mockApiClient.post.mockRejectedValue(new Error('400 cannot block self'));
      await expect(addGroupMessageBlock(mockApiClient, 'g1', 'g1-owner'))
        .rejects.toThrow('400 cannot block self');
    });
  });

  describe('removeGroupMessageBlock', () => {
    it('DELETE 到带 target 的端点', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await removeGroupMessageBlock(mockApiClient, 'g1', 'u2');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/groups/g1/message-blocks/u2');
    });

    it('对 target_user_id 做 encodeURIComponent（含特殊字符）', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await removeGroupMessageBlock(mockApiClient, 'g1', 'user/with space');

      expect(mockApiClient.delete).toHaveBeenCalledWith(
        '/api/groups/g1/message-blocks/user%2Fwith%20space',
      );
    });
  });

  describe('getGroupMessageBlocks', () => {
    it('GET message-blocks 并返回成员名单', async () => {
      const blocks: GroupMessageBlock[] = [
        { user_id: 'u2', user_nickname: 'Bob', user_avatar_url: null, created_at: '2026-06-12T00:00:00Z' },
        { user_id: 'u3', user_nickname: null, user_avatar_url: null, created_at: '2026-06-12T01:00:00Z' },
      ];
      mockApiClient.get.mockResolvedValue(blocks);

      const result = await getGroupMessageBlocks(mockApiClient, 'g1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/groups/g1/message-blocks');
      expect(result).toEqual(blocks);
      expect(result.map((b) => b.user_id)).toEqual(['u2', 'u3']);
    });

    it('空名单返回空数组', async () => {
      mockApiClient.get.mockResolvedValue([]);
      const result = await getGroupMessageBlocks(mockApiClient, 'g1');
      expect(result).toEqual([]);
    });
  });
});
