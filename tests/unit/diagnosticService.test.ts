/**
 * 诊断服务单元测试
 *
 * 测试好友文件权限错误上报功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  reportFriendPermissionError,
  createPresignedUrlErrorContext,
  type FriendPermissionErrorReport,
} from '../../src/services/diagnosticService';

describe('诊断服务', () => {
  const mockServerUrl = 'https://api.example.com';
  const mockAccessToken = 'test-access-token';
  const mockFileUuid = 'd6fcc06b-3b7b-47a3-9804-e8ab6a45f4d7';

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  describe('reportFriendPermissionError', () => {
    it('上报成功时返回 success: true 和 report_id', async () => {
      const mockReportId = 'rpt-12345';
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          report_id: mockReportId,
          message: '上报成功',
        }),
      } as Response);

      const report: FriendPermissionErrorReport = {
        file_uuid: mockFileUuid,
        operation: 'preview',
        error_message: '好友关系已解除，无法访问文件',
      };

      const result = await reportFriendPermissionError(
        mockServerUrl,
        mockAccessToken,
        report,
      );

      expect(result.success).toBe(true);
      expect(result.report_id).toBe(mockReportId);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${mockServerUrl}/api/diagnostic/report/friend-permission`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mockAccessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );
    });

    it('上报失败时返回 success: false', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const report: FriendPermissionErrorReport = {
        file_uuid: mockFileUuid,
        error_message: '测试错误',
      };

      const result = await reportFriendPermissionError(
        mockServerUrl,
        mockAccessToken,
        report,
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('HTTP 500');
    });

    it('网络错误时静默返回 success: false', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network error'));

      const report: FriendPermissionErrorReport = {
        file_uuid: mockFileUuid,
        error_message: '测试错误',
      };

      const result = await reportFriendPermissionError(
        mockServerUrl,
        mockAccessToken,
        report,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Network error');
    });

    it('自动添加客户端时间戳', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ report_id: 'test' }),
      } as Response);

      const report: FriendPermissionErrorReport = {
        file_uuid: mockFileUuid,
        error_message: '测试错误',
      };

      await reportFriendPermissionError(mockServerUrl, mockAccessToken, report);

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.client_timestamp).toBeDefined();
      expect(body.client_timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('保留已有的客户端时间戳', async () => {
      const customTimestamp = '2025-12-28T17:30:45.123+08:00';
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ report_id: 'test' }),
      } as Response);

      const report: FriendPermissionErrorReport = {
        file_uuid: mockFileUuid,
        error_message: '测试错误',
        client_timestamp: customTimestamp,
      };

      await reportFriendPermissionError(mockServerUrl, mockAccessToken, report);

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.client_timestamp).toBe(customTimestamp);
    });

    it('包含完整的上报信息', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ report_id: 'test' }),
      } as Response);

      const report: FriendPermissionErrorReport = {
        file_uuid: mockFileUuid,
        operation: 'download',
        error_message: '好友关系已解除，无法访问文件',
        other_user_id: 'friend123',
        context: {
          screen: 'chat_detail',
          action: 'view_image',
          file_type: 'image',
        },
      };

      await reportFriendPermissionError(mockServerUrl, mockAccessToken, report);

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.file_uuid).toBe(mockFileUuid);
      expect(body.operation).toBe('download');
      expect(body.other_user_id).toBe('friend123');
      expect(body.context.screen).toBe('chat_detail');
      expect(body.context.action).toBe('view_image');
      expect(body.context.file_type).toBe('image');
    });
  });

  describe('createPresignedUrlErrorContext', () => {
    it('创建基本错误上下文', () => {
      const result = createPresignedUrlErrorContext(
        mockFileUuid,
        '403 Forbidden',
      );

      expect(result.file_uuid).toBe(mockFileUuid);
      expect(result.error_message).toBe('403 Forbidden');
      expect(result.operation).toBe('preview');
      expect(result.context?.screen).toBe('chat_detail');
      expect(result.context?.action).toBe('view_file');
    });

    it('包含所有可选参数', () => {
      const result = createPresignedUrlErrorContext(
        mockFileUuid,
        '403 Forbidden',
        {
          operation: 'download',
          urlType: 'friend',
          friendId: 'user456',
          fileType: 'video',
          screen: 'media_preview',
          action: 'get_presigned_url',
        },
      );

      expect(result.file_uuid).toBe(mockFileUuid);
      expect(result.operation).toBe('download');
      expect(result.other_user_id).toBe('user456');
      expect(result.context?.url_type).toBe('friend');
      expect(result.context?.file_type).toBe('video');
      expect(result.context?.screen).toBe('media_preview');
      expect(result.context?.action).toBe('get_presigned_url');
    });

    it('支持文档类型', () => {
      const result = createPresignedUrlErrorContext(
        mockFileUuid,
        '403 Forbidden',
        { fileType: 'document' },
      );

      expect(result.context?.file_type).toBe('document');
    });
  });
});

