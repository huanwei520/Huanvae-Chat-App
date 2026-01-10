/**
 * 会话锁服务单元测试
 *
 * 测试同设备同账户单开功能
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import {
  checkSessionLock,
  createSessionLock,
  removeSessionLock,
  checkAndHandleSessionConflict,
} from '../../src/services/sessionLock';

const mockInvoke = vi.mocked(invoke);

describe('会话锁服务 (sessionLock)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkSessionLock', () => {
    it('无冲突时返回 exists: false', async () => {
      mockInvoke.mockResolvedValue({
        exists: false,
        process_alive: false,
        pid: null,
      });

      const result = await checkSessionLock('https://example.com', 'user123');

      expect(result.exists).toBe(false);
      expect(result.process_alive).toBe(false);
      expect(mockInvoke).toHaveBeenCalledWith('check_session_lock', {
        serverUrl: 'https://example.com',
        userId: 'user123',
      });
    });

    it('有冲突时返回 exists: true 和 PID', async () => {
      mockInvoke.mockResolvedValue({
        exists: true,
        process_alive: true,
        pid: 12345,
      });

      const result = await checkSessionLock('https://example.com', 'user123');

      expect(result.exists).toBe(true);
      expect(result.process_alive).toBe(true);
      expect(result.pid).toBe(12345);
    });
  });

  describe('createSessionLock', () => {
    it('正确调用后端创建锁', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await createSessionLock('https://example.com', 'user123');

      expect(mockInvoke).toHaveBeenCalledWith('create_session_lock', {
        serverUrl: 'https://example.com',
        userId: 'user123',
      });
    });
  });

  describe('removeSessionLock', () => {
    it('正确调用后端移除锁', async () => {
      mockInvoke.mockResolvedValue(undefined);

      await removeSessionLock('https://example.com', 'user123');

      expect(mockInvoke).toHaveBeenCalledWith('remove_session_lock', {
        serverUrl: 'https://example.com',
        userId: 'user123',
      });
    });
  });

  describe('checkAndHandleSessionConflict', () => {
    it('无冲突时返回 canProceed: true', async () => {
      mockInvoke.mockResolvedValue({
        exists: false,
        process_alive: false,
        pid: null,
      });

      const result = await checkAndHandleSessionConflict(
        'https://example.com',
        'user123',
      );

      expect(result.canProceed).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('有冲突时返回 canProceed: false 和错误消息', async () => {
      mockInvoke.mockResolvedValue({
        exists: true,
        process_alive: true,
        pid: 12345,
      });

      const result = await checkAndHandleSessionConflict(
        'https://example.com',
        'user123',
      );

      expect(result.canProceed).toBe(false);
      expect(result.message).toBe('该账户已在其他窗口登录');
    });

    it('检查锁文件失败时返回 canProceed: true', async () => {
      mockInvoke.mockRejectedValue(new Error('读取锁文件失败'));

      const result = await checkAndHandleSessionConflict(
        'https://example.com',
        'user123',
      );

      // 检查失败不阻止登录
      expect(result.canProceed).toBe(true);
    });

    it('进程已死时返回 canProceed: true', async () => {
      mockInvoke.mockResolvedValue({
        exists: true,
        process_alive: false, // 进程已死
        pid: 12345,
      });

      const result = await checkAndHandleSessionConflict(
        'https://example.com',
        'user123',
      );

      expect(result.canProceed).toBe(true);
    });
  });
});

