/**
 * 提示音管理 Hook 单元测试
 *
 * 测试 useNotificationSounds Hook 的核心功能：
 * 1. 加载提示音列表
 * 2. 播放/停止提示音
 * 3. 上传提示音
 * 4. 删除提示音
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useNotificationSounds, SoundInfo } from '../../src/hooks/useNotificationSounds';

// 模拟 Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

// 模拟 Audio - 使用类来正确模拟构造函数
let mockAudioInstance: {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  volume: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
} | null = null;

class MockAudio {
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  volume = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    mockAudioInstance = this;
  }
}

vi.stubGlobal('Audio', MockAudio);

describe('提示音管理 Hook (useNotificationSounds)', () => {
  const mockSounds: SoundInfo[] = [
    { name: 'water', filename: 'water.mp3', path: '/sounds/water.mp3' },
    { name: 'bell', filename: 'bell.mp3', path: '/sounds/bell.mp3' },
    { name: 'ding', filename: 'ding.mp3', path: '/sounds/ding.mp3' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // 重置模拟的 invoke 调用
    (invoke as Mock).mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case 'ensure_sounds_directory':
          return undefined;
        case 'list_notification_sounds':
          return mockSounds;
        case 'get_notification_sound_path':
          return `/sounds/${args?.name}.mp3`;
        case 'save_notification_sound':
          return { name: args?.name, filename: `${args?.name}.mp3`, path: `/sounds/${args?.name}.mp3` };
        case 'delete_notification_sound':
          return undefined;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });

    // 重置 Audio 模拟实例
    mockAudioInstance = null;
  });

  describe('加载提示音列表', () => {
    it('初始化时应加载提示音列表', async () => {
      const { result } = renderHook(() => useNotificationSounds());

      // 初始状态
      expect(result.current.loading).toBe(true);

      // 等待加载完成
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.sounds).toEqual(mockSounds);
      expect(result.current.error).toBeNull();
    });

    it('加载时应先确保目录存在', async () => {
      renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('ensure_sounds_directory');
      });
    });

    it('加载失败时应设置错误信息', async () => {
      const errorMessage = '无法读取提示音目录';
      (invoke as Mock).mockRejectedValueOnce(new Error(errorMessage));

      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe(errorMessage);
      expect(result.current.sounds).toEqual([]);
    });
  });

  describe('播放提示音', () => {
    it('应正确播放提示音', async () => {
      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.playSound('water', 70);
      });

      expect(invoke).toHaveBeenCalledWith('get_notification_sound_path', { name: 'water' });
      expect(convertFileSrc).toHaveBeenCalled();
      expect(mockAudioInstance).not.toBeNull();
      expect(mockAudioInstance!.volume).toBe(0.7);
      expect(mockAudioInstance!.play).toHaveBeenCalled();
      expect(result.current.playingSound).toBe('water');
    });

    it('播放新音效前应停止当前播放', async () => {
      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // 播放第一个
      await act(async () => {
        await result.current.playSound('water', 70);
      });

      // 保存第一个实例的引用
      const firstInstance = mockAudioInstance;

      // 播放第二个
      await act(async () => {
        await result.current.playSound('bell', 50);
      });

      // 第一个实例应该调用了 pause
      expect(firstInstance!.pause).toHaveBeenCalled();
    });

    it('音量应正确转换为 0-1 范围', async () => {
      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.playSound('water', 50);
      });

      expect(mockAudioInstance).not.toBeNull();
      expect(mockAudioInstance!.volume).toBe(0.5);
    });
  });

  describe('停止播放', () => {
    it('应正确停止播放', async () => {
      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // 先播放
      await act(async () => {
        await result.current.playSound('water', 70);
      });

      const playedInstance = mockAudioInstance;
      expect(playedInstance).not.toBeNull();

      // 停止
      act(() => {
        result.current.stopSound();
      });

      expect(playedInstance!.pause).toHaveBeenCalled();
      expect(result.current.playingSound).toBeNull();
    });
  });

  describe('上传提示音', () => {
    it('选择文件后应正确上传', async () => {
      (openDialog as Mock).mockResolvedValueOnce('/path/to/custom.mp3');

      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let uploadResult: SoundInfo | null = null;
      await act(async () => {
        uploadResult = await result.current.uploadSound();
      });

      expect(openDialog).toHaveBeenCalledWith({
        multiple: false,
        filters: [{ name: '音频文件', extensions: ['mp3'] }],
      });
      expect(invoke).toHaveBeenCalledWith('save_notification_sound', {
        sourcePath: '/path/to/custom.mp3',
        name: 'custom',
      });
      expect(uploadResult).not.toBeNull();
      expect(uploadResult!.name).toBe('custom');
    });

    it('取消选择时应返回 null', async () => {
      (openDialog as Mock).mockResolvedValueOnce(null);

      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      let uploadResult: SoundInfo | null = null;
      await act(async () => {
        uploadResult = await result.current.uploadSound();
      });

      expect(uploadResult).toBeNull();
      expect(invoke).not.toHaveBeenCalledWith('save_notification_sound', expect.anything());
    });

    it('上传失败时应抛出错误', async () => {
      (openDialog as Mock).mockResolvedValueOnce('/path/to/file.mp3');
      (invoke as Mock).mockImplementation(async (cmd: string) => {
        if (cmd === 'save_notification_sound') {
          throw new Error('保存失败');
        }
        if (cmd === 'ensure_sounds_directory') return undefined;
        if (cmd === 'list_notification_sounds') return mockSounds;
      });

      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.uploadSound();
        })
      ).rejects.toThrow('保存失败');
    });
  });

  describe('删除提示音', () => {
    it('应正确删除提示音', async () => {
      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteSound('bell');
      });

      expect(invoke).toHaveBeenCalledWith('delete_notification_sound', { name: 'bell' });
    });

    it('删除失败时应抛出错误', async () => {
      (invoke as Mock).mockImplementation(async (cmd: string) => {
        if (cmd === 'delete_notification_sound') {
          throw new Error('删除失败');
        }
        if (cmd === 'ensure_sounds_directory') return undefined;
        if (cmd === 'list_notification_sounds') return mockSounds;
      });

      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.deleteSound('bell');
        })
      ).rejects.toThrow('删除失败');
    });
  });

  describe('刷新列表', () => {
    it('应支持手动刷新列表', async () => {
      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // 清除之前的调用记录
      vi.clearAllMocks();

      await act(async () => {
        await result.current.refresh();
      });

      expect(invoke).toHaveBeenCalledWith('ensure_sounds_directory');
      expect(invoke).toHaveBeenCalledWith('list_notification_sounds');
    });
  });

  describe('返回值类型', () => {
    it('应返回正确的属性和方法', async () => {
      const { result } = renderHook(() => useNotificationSounds());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // 检查返回的属性
      expect(Array.isArray(result.current.sounds)).toBe(true);
      expect(typeof result.current.loading).toBe('boolean');
      expect(result.current.error === null || typeof result.current.error === 'string').toBe(true);
      expect(result.current.playingSound === null || typeof result.current.playingSound === 'string').toBe(true);

      // 检查返回的方法
      expect(typeof result.current.playSound).toBe('function');
      expect(typeof result.current.stopSound).toBe('function');
      expect(typeof result.current.uploadSound).toBe('function');
      expect(typeof result.current.deleteSound).toBe('function');
      expect(typeof result.current.refresh).toBe('function');
    });
  });
});

