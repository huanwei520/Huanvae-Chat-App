/**
 * 设置面板组件测试
 *
 * 测试 SettingsPanel 的核心功能：
 * 1. 渲染状态
 * 2. 返回按钮功能
 * 3. ESC 键关闭
 * 4. 分组结构渲染
 * 5. 版本信息显示
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SettingsPanel } from '../../src/components/settings/SettingsPanel';

// 模拟 Tauri API
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(() => Promise.resolve('1.0.11')),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

// 模拟 SoundSelector 组件
vi.mock('../../src/components/settings/SoundSelector', () => ({
  SoundSelector: () => <div data-testid="sound-selector">SoundSelector</div>,
  default: () => <div data-testid="sound-selector">SoundSelector</div>,
}));

// 模拟 settingsStore
vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    notification: {
      enabled: true,
      volume: 80,
      soundName: 'water',
    },
    fileCache: {
      largeFileThresholdMB: 100,
    },
    setNotificationEnabled: vi.fn(),
    setNotificationSound: vi.fn(),
    setNotificationVolume: vi.fn(),
    setLargeFileThreshold: vi.fn(),
  }),
}));

// 模拟 framer-motion 以简化测试
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...props }: React.PropsWithChildren<{ className?: string }>) => (
      <div className={className} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// 模拟 update 模块
vi.mock('../../src/update', () => ({
  checkForUpdates: vi.fn(() => Promise.resolve({ available: false })),
  downloadAndInstall: vi.fn(),
  restartApp: vi.fn(),
  useUpdateToast: vi.fn(() => ({
    status: 'idle',
    version: '',
    notes: '',
    progress: 0,
    downloaded: 0,
    total: 0,
    proxyUrl: '',
    errorMessage: '',
    showAvailable: vi.fn(),
    startDownload: vi.fn(),
    updateProgress: vi.fn(),
    downloadComplete: vi.fn(),
    showError: vi.fn(),
    dismiss: vi.fn(),
  })),
  UpdateToast: () => null,
}));

// 模拟 DeviceListPanel
vi.mock('../../src/components/settings/DeviceListPanel', () => ({
  DeviceListPanel: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="device-list-panel">
      <button onClick={onBack}>返回</button>
      DeviceListPanel
    </div>
  ),
  default: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="device-list-panel">
      <button onClick={onBack}>返回</button>
      DeviceListPanel
    </div>
  ),
}));

describe('设置面板组件 (SettingsPanel)', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  describe('渲染', () => {
    it('应正确渲染面板', () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      expect(screen.getByText('设置')).toBeInTheDocument();
      expect(screen.getByText('返回')).toBeInTheDocument();
    });

    it('应渲染分组标题', () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      expect(screen.getByText('通知与提醒')).toBeInTheDocument();
      expect(screen.getByText('存储与数据')).toBeInTheDocument();
      expect(screen.getByText('账户与安全')).toBeInTheDocument();
      expect(screen.getByText('关于')).toBeInTheDocument();
    });

    it('应渲染设置行标题', () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      expect(screen.getByText('消息提示音')).toBeInTheDocument();
      expect(screen.getByText('大文件直连阈值')).toBeInTheDocument();
      expect(screen.getByText('清空消息缓存')).toBeInTheDocument();
      expect(screen.getByText('重置所有数据')).toBeInTheDocument();
      expect(screen.getByText('设备管理')).toBeInTheDocument();
      expect(screen.getByText('检查更新')).toBeInTheDocument();
    });

    it('应有正确的 CSS 类名', () => {
      const { container } = render(<SettingsPanel onClose={mockOnClose} />);

      expect(container.querySelector('.settings-panel')).toBeInTheDocument();
      expect(container.querySelector('.settings-panel-header')).toBeInTheDocument();
      expect(container.querySelector('.settings-panel-content')).toBeInTheDocument();
      expect(container.querySelector('.settings-section')).toBeInTheDocument();
      expect(container.querySelector('.settings-group')).toBeInTheDocument();
      expect(container.querySelector('.settings-row')).toBeInTheDocument();
    });
  });

  describe('返回按钮', () => {
    it('点击返回按钮应触发 onClose', () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      const backButton = screen.getByText('返回').closest('button');
      expect(backButton).toBeInTheDocument();

      fireEvent.click(backButton!);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('返回按钮应有正确的类名', () => {
      const { container } = render(<SettingsPanel onClose={mockOnClose} />);

      const backButton = container.querySelector('.settings-back-btn');
      expect(backButton).toBeInTheDocument();
    });
  });

  describe('键盘交互', () => {
    it('按 ESC 键应触发 onClose', () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('按其他键不应触发 onClose', () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      fireEvent.keyDown(window, { key: 'Enter' });
      fireEvent.keyDown(window, { key: 'Space' });
      fireEvent.keyDown(window, { key: 'Tab' });

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('卸载清理', () => {
    it('组件卸载后不应再响应键盘事件', () => {
      const { unmount } = render(<SettingsPanel onClose={mockOnClose} />);

      unmount();

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('标题', () => {
    it('应显示正确的标题', () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      const title = screen.getByText('设置');
      expect(title).toBeInTheDocument();
      expect(title.tagName).toBe('H2');
    });

    it('标题应有正确的类名', () => {
      const { container } = render(<SettingsPanel onClose={mockOnClose} />);

      const title = container.querySelector('.settings-panel-title');
      expect(title).toBeInTheDocument();
    });
  });

  describe('版本信息', () => {
    it('应显示应用名称', async () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      await waitFor(() => {
        expect(screen.getByText('Huanvae Chat')).toBeInTheDocument();
      });
    });

    it('应显示版本号', async () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      await waitFor(() => {
        expect(screen.getByText('v1.0.11')).toBeInTheDocument();
      });
    });

    it('应显示版权信息', async () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      const currentYear = new Date().getFullYear();
      await waitFor(() => {
        expect(screen.getByText(`© ${currentYear} HuanWei`)).toBeInTheDocument();
      });
    });

    it('版本信息区域应有正确的类名', () => {
      const { container } = render(<SettingsPanel onClose={mockOnClose} />);

      expect(container.querySelector('.app-version-info')).toBeInTheDocument();
      expect(container.querySelector('.app-version-name')).toBeInTheDocument();
      expect(container.querySelector('.app-version-number')).toBeInTheDocument();
      expect(container.querySelector('.app-version-copyright')).toBeInTheDocument();
    });
  });

  describe('分组结构', () => {
    it('应渲染五个设置分组', () => {
      const { container } = render(<SettingsPanel onClose={mockOnClose} />);

      // 外观、通知与提醒、存储与数据、账户与安全、关于
      const sections = container.querySelectorAll('.settings-section');
      expect(sections.length).toBe(5);
    });

    it('每个分组应包含分组标题', () => {
      const { container } = render(<SettingsPanel onClose={mockOnClose} />);

      const sectionTitles = container.querySelectorAll('.settings-section-title');
      expect(sectionTitles.length).toBe(5);
    });

    it('消息提示音开关开启时应显示 SoundSelector', () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      // 因为 mock 的 notification.enabled = true，所以应该显示 SoundSelector
      expect(screen.getByTestId('sound-selector')).toBeInTheDocument();
    });
  });

  describe('设备管理', () => {
    it('应显示设备管理行', () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      expect(screen.getByText('设备管理')).toBeInTheDocument();
      expect(screen.getByText('查看和管理登录设备')).toBeInTheDocument();
    });
  });

  describe('检查更新', () => {
    it('应显示检查更新按钮', () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      expect(screen.getByText('检查更新')).toBeInTheDocument();
      expect(screen.getByText('检查')).toBeInTheDocument();
    });
  });
});
