/**
 * 设置面板组件测试
 *
 * 测试 SettingsPanel 的核心功能：
 * 1. 渲染状态
 * 2. 返回按钮功能
 * 3. ESC 键关闭
 * 4. 子组件渲染
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

// 模拟 NotificationSoundCard 组件
vi.mock('../../src/components/settings/NotificationSoundCard', () => ({
  NotificationSoundCard: () => <div data-testid="notification-sound-card">NotificationSoundCard</div>,
}));

// 模拟 DataManagementCard 组件
vi.mock('../../src/components/settings/DataManagementCard', () => ({
  DataManagementCard: () => <div data-testid="data-management-card">DataManagementCard</div>,
  default: () => <div data-testid="data-management-card">DataManagementCard</div>,
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

    it('应渲染 NotificationSoundCard 子组件', () => {
      render(<SettingsPanel onClose={mockOnClose} />);

      expect(screen.getByTestId('notification-sound-card')).toBeInTheDocument();
    });

    it('应有正确的 CSS 类名', () => {
      const { container } = render(<SettingsPanel onClose={mockOnClose} />);

      expect(container.querySelector('.settings-panel')).toBeInTheDocument();
      expect(container.querySelector('.settings-panel-header')).toBeInTheDocument();
      expect(container.querySelector('.settings-panel-content')).toBeInTheDocument();
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
});

