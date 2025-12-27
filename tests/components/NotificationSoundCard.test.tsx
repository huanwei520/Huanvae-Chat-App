/**
 * 消息提示音设置卡片组件测试
 *
 * 测试 NotificationSoundCard 的核心功能：
 * 1. 开关切换
 * 2. 音量调节
 * 3. 提示音列表显示
 * 4. 提示音选择
 * 5. 播放/停止功能
 * 6. 上传功能
 * 7. 删除功能
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { NotificationSoundCard } from '../../src/components/settings/NotificationSoundCard';
import { SoundInfo } from '../../src/hooks/useNotificationSounds';

// 模拟 settingsStore
const mockNotification = {
  enabled: true,
  soundName: 'water',
  volume: 70,
};

const mockSetNotificationSound = vi.fn();
const mockSetNotificationEnabled = vi.fn();
const mockSetNotificationVolume = vi.fn();

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    notification: mockNotification,
    setNotificationSound: mockSetNotificationSound,
    setNotificationEnabled: mockSetNotificationEnabled,
    setNotificationVolume: mockSetNotificationVolume,
  }),
}));

// 模拟 useNotificationSounds
const mockSounds: SoundInfo[] = [
  { name: 'water', filename: 'water.mp3', path: '/sounds/water.mp3' },
  { name: 'bell', filename: 'bell.mp3', path: '/sounds/bell.mp3' },
];

const mockPlaySound = vi.fn();
const mockStopSound = vi.fn();
const mockUploadSound = vi.fn();
const mockDeleteSound = vi.fn();
const mockRefresh = vi.fn();

vi.mock('../../src/hooks/useNotificationSounds', () => ({
  useNotificationSounds: () => ({
    sounds: mockSounds,
    loading: false,
    error: null,
    playingSound: null,
    playSound: mockPlaySound,
    stopSound: mockStopSound,
    uploadSound: mockUploadSound,
    deleteSound: mockDeleteSound,
    refresh: mockRefresh,
  }),
}));

// 模拟 framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, initial, animate, exit, transition, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
      <div className={className as string} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

describe('消息提示音设置卡片 (NotificationSoundCard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    // 重置模拟数据
    mockNotification.enabled = true;
    mockNotification.soundName = 'water';
    mockNotification.volume = 70;
  });

  describe('渲染', () => {
    it('应正确渲染卡片', () => {
      render(<NotificationSoundCard />);

      expect(screen.getByText('消息提示音')).toBeInTheDocument();
      expect(screen.getByText('选择新消息到达时的提示音效')).toBeInTheDocument();
    });

    it('应有正确的 CSS 类名', () => {
      const { container } = render(<NotificationSoundCard />);

      expect(container.querySelector('.settings-card')).toBeInTheDocument();
      expect(container.querySelector('.notification-sound-card')).toBeInTheDocument();
    });
  });

  describe('开关切换', () => {
    it('应渲染开关组件', () => {
      render(<NotificationSoundCard />);

      const toggle = screen.getByRole('checkbox');
      expect(toggle).toBeInTheDocument();
    });

    it('开关应反映当前状态', () => {
      render(<NotificationSoundCard />);

      const toggle = screen.getByRole('checkbox') as HTMLInputElement;
      expect(toggle.checked).toBe(true);
    });

    it('切换开关应调用 setNotificationEnabled', () => {
      render(<NotificationSoundCard />);

      const toggle = screen.getByRole('checkbox');
      fireEvent.click(toggle);

      expect(mockSetNotificationEnabled).toHaveBeenCalledWith(false);
    });
  });

  describe('音量调节', () => {
    it('应渲染音量滑块', () => {
      render(<NotificationSoundCard />);

      const slider = screen.getByRole('slider');
      expect(slider).toBeInTheDocument();
    });

    it('音量滑块应显示当前值', () => {
      render(<NotificationSoundCard />);

      expect(screen.getByText('70%')).toBeInTheDocument();
    });

    it('拖动滑块应调用 setNotificationVolume', () => {
      render(<NotificationSoundCard />);

      const slider = screen.getByRole('slider');
      fireEvent.change(slider, { target: { value: '50' } });

      expect(mockSetNotificationVolume).toHaveBeenCalledWith(50);
    });

    it('应显示音量标签', () => {
      render(<NotificationSoundCard />);

      expect(screen.getByText('音量')).toBeInTheDocument();
    });
  });

  describe('提示音列表', () => {
    it('应显示所有提示音', () => {
      render(<NotificationSoundCard />);

      expect(screen.getByText('water')).toBeInTheDocument();
      expect(screen.getByText('bell')).toBeInTheDocument();
    });

    it('当前选中的提示音应有选中标记', () => {
      const { container } = render(<NotificationSoundCard />);

      const selectedItem = container.querySelector('.sound-item.selected');
      expect(selectedItem).toBeInTheDocument();
    });
  });

  describe('选择提示音', () => {
    it('点击提示音应调用 setNotificationSound', () => {
      render(<NotificationSoundCard />);

      const bellButton = screen.getByText('bell').closest('button');
      expect(bellButton).toBeInTheDocument();

      fireEvent.click(bellButton!);

      expect(mockSetNotificationSound).toHaveBeenCalledWith('bell');
    });

    it('选择提示音后应播放预览', () => {
      render(<NotificationSoundCard />);

      const bellButton = screen.getByText('bell').closest('button');
      fireEvent.click(bellButton!);

      expect(mockPlaySound).toHaveBeenCalledWith('bell', 70);
    });
  });

  describe('播放/停止按钮', () => {
    it('应为每个提示音显示播放按钮', () => {
      const { container } = render(<NotificationSoundCard />);

      const playButtons = container.querySelectorAll('.play-btn');
      expect(playButtons.length).toBe(2);
    });

    it('点击播放按钮应调用 playSound', () => {
      const { container } = render(<NotificationSoundCard />);

      const playButtons = container.querySelectorAll('.play-btn');
      fireEvent.click(playButtons[0]);

      expect(mockPlaySound).toHaveBeenCalled();
    });
  });

  describe('上传功能', () => {
    it('应显示上传按钮', () => {
      render(<NotificationSoundCard />);

      expect(screen.getByText('上传自定义提示音')).toBeInTheDocument();
    });

    it('点击上传按钮应调用 uploadSound', async () => {
      mockUploadSound.mockResolvedValueOnce({ name: 'custom', filename: 'custom.mp3', path: '/sounds/custom.mp3' });

      render(<NotificationSoundCard />);

      const uploadButton = screen.getByText('上传自定义提示音').closest('button');
      expect(uploadButton).toBeInTheDocument();

      fireEvent.click(uploadButton!);

      await waitFor(() => {
        expect(mockUploadSound).toHaveBeenCalled();
      });
    });

    it('上传成功后应自动选中新音效', async () => {
      mockUploadSound.mockResolvedValueOnce({ name: 'custom', filename: 'custom.mp3', path: '/sounds/custom.mp3' });

      render(<NotificationSoundCard />);

      const uploadButton = screen.getByText('上传自定义提示音').closest('button');
      fireEvent.click(uploadButton!);

      await waitFor(() => {
        expect(mockSetNotificationSound).toHaveBeenCalledWith('custom');
      });
    });
  });

  describe('删除功能', () => {
    it('默认提示音 water 不应显示删除按钮', () => {
      const { container } = render(<NotificationSoundCard />);

      // water 项
      const soundItems = container.querySelectorAll('.sound-item');
      const waterItem = Array.from(soundItems).find(item => 
        item.textContent?.includes('water')
      );

      const deleteBtn = waterItem?.querySelector('.delete-btn');
      expect(deleteBtn).toBeNull();
    });

    it('非默认提示音应显示删除按钮', () => {
      const { container } = render(<NotificationSoundCard />);

      // bell 项
      const soundItems = container.querySelectorAll('.sound-item');
      const bellItem = Array.from(soundItems).find(item => 
        item.textContent?.includes('bell')
      );

      const deleteBtn = bellItem?.querySelector('.delete-btn');
      expect(deleteBtn).toBeInTheDocument();
    });
  });

  describe('禁用状态', () => {
    it('禁用时不应显示详细设置', () => {
      mockNotification.enabled = false;

      render(<NotificationSoundCard />);

      // 音量和列表应该隐藏（由于 AnimatePresence 被模拟，这里需要检查条件渲染）
      expect(screen.queryByText('音量')).not.toBeInTheDocument();
    });
  });
});

