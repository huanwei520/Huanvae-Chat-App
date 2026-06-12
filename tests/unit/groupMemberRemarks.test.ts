/**
 * D7 群内私有备注 API 单测（setGroupMemberRemark / removeGroupMemberRemark / getGroupMemberRemarks）
 *
 * 验证 URL、HTTP 方法、请求体形态，以及对 targetUserId 的 encodeURIComponent 处理。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroupMemberRemark } from '../../src/api/groups';

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
  setGroupMemberRemark,
  removeGroupMemberRemark,
  getGroupMemberRemarks,
} from '../../src/api/groups';

describe('D7 群内私有备注 API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setGroupMemberRemark', () => {
    it('PUT 到 member-remarks 端点，body 含 target_user_id + remark', async () => {
      mockApiClient.put.mockResolvedValue(undefined);

      await setGroupMemberRemark(mockApiClient, 'g1', 'u2', '小王');

      expect(mockApiClient.put).toHaveBeenCalledWith(
        '/api/groups/g1/member-remarks',
        { target_user_id: 'u2', remark: '小王' },
      );
    });

    it('请求失败时抛出错误', async () => {
      mockApiClient.put.mockRejectedValue(new Error('400 备注不能为空'));
      await expect(setGroupMemberRemark(mockApiClient, 'g1', 'u2', ''))
        .rejects.toThrow('400 备注不能为空');
    });
  });

  describe('removeGroupMemberRemark', () => {
    it('DELETE 到带 target 的端点', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await removeGroupMemberRemark(mockApiClient, 'g1', 'u2');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/groups/g1/member-remarks/u2');
    });

    it('对 target_user_id 做 encodeURIComponent（含特殊字符）', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await removeGroupMemberRemark(mockApiClient, 'g1', 'user/with space');

      expect(mockApiClient.delete).toHaveBeenCalledWith(
        '/api/groups/g1/member-remarks/user%2Fwith%20space',
      );
    });
  });

  describe('getGroupMemberRemarks', () => {
    it('GET member-remarks 并返回备注名单', async () => {
      const remarks: GroupMemberRemark[] = [
        { user_id: 'u2', remark: '小王' },
        { user_id: 'u3', remark: '老李' },
      ];
      mockApiClient.get.mockResolvedValue(remarks);

      const result = await getGroupMemberRemarks(mockApiClient, 'g1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/groups/g1/member-remarks');
      expect(result).toEqual(remarks);
    });

    it('空名单返回空数组', async () => {
      mockApiClient.get.mockResolvedValue([]);
      const result = await getGroupMemberRemarks(mockApiClient, 'g1');
      expect(result).toEqual([]);
    });
  });
});
