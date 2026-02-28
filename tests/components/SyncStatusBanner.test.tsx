/**
 * SyncStatusBanner 组件测试
 *
 * 测试消息同步状态横幅的渲染和交互
 *
 * 纯展示组件测试：
 * - notification 为 null 时不显示
 * - syncing 类型显示进度
 * - success 类型显示完成信息，自动调用 onDismiss
 * - error 类型显示错误信息，支持点击和键盘重试
 */

/* eslint-disable require-await */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { SyncStatusBanner } from '../../src/components/common/SyncStatusBanner';
import type { SyncNotification } from '../../src/hooks/useInitialSync';

describe('SyncStatusBanner', () => {
  it('同步中时显示进度文字', async () => {
    const notification: SyncNotification = {
      type: 'syncing',
      progress: 30,
      total: 10,
      synced: 3,
    };
    const onDismiss = vi.fn();

    await act(async () => {
      render(<SyncStatusBanner notification={notification} onDismiss={onDismiss} />);
    });

    expect(screen.getByText(/正在同步消息/)).toBeInTheDocument();
  });

  it('同步完成且有新消息时显示完成文字', async () => {
    const notification: SyncNotification = {
      type: 'success',
      newMessagesCount: 28,
    };
    const onDismiss = vi.fn();

    await act(async () => {
      render(<SyncStatusBanner notification={notification} onDismiss={onDismiss} />);
    });

    expect(screen.getByText('已同步 28 条新消息')).toBeInTheDocument();
  });

  it('同步完成但无新消息时显示最新状态', async () => {
    const notification: SyncNotification = {
      type: 'success',
      newMessagesCount: 0,
    };
    const onDismiss = vi.fn();

    await act(async () => {
      render(<SyncStatusBanner notification={notification} onDismiss={onDismiss} />);
    });

    expect(screen.getByText('消息已是最新')).toBeInTheDocument();
  });

  it('同步失败时显示错误信息并可点击重试', async () => {
    const notification: SyncNotification = {
      type: 'error',
      message: '网络错误',
    };
    const onDismiss = vi.fn();
    const onRetry = vi.fn();

    await act(async () => {
      render(
        <SyncStatusBanner notification={notification} onDismiss={onDismiss} onRetry={onRetry} />,
      );
    });

    const errorElement = screen.getByText('同步失败，点击重试');
    expect(errorElement).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(errorElement);
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('notification 为 null 时不显示横幅', async () => {
    const onDismiss = vi.fn();

    let container: HTMLElement;
    await act(async () => {
      const result = render(<SyncStatusBanner notification={null} onDismiss={onDismiss} />);
      container = result.container;
    });

    expect(container!.querySelector('.sync-banner-content')).not.toBeInTheDocument();
  });

  it('错误状态支持键盘交互', async () => {
    const notification: SyncNotification = {
      type: 'error',
      message: '网络错误',
    };
    const onDismiss = vi.fn();
    const onRetry = vi.fn();

    await act(async () => {
      render(
        <SyncStatusBanner notification={notification} onDismiss={onDismiss} onRetry={onRetry} />,
      );
    });

    const errorElement = screen.getByText('同步失败，点击重试');

    await act(async () => {
      fireEvent.keyDown(errorElement, { key: 'Enter' });
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('success 通知自动隐藏后调用 onDismiss', async () => {
    vi.useFakeTimers();

    const notification: SyncNotification = {
      type: 'success',
      newMessagesCount: 5,
    };
    const onDismiss = vi.fn();

    await act(async () => {
      render(<SyncStatusBanner notification={notification} onDismiss={onDismiss} />);
    });

    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('无新消息的 success 通知 1 秒后调用 onDismiss', async () => {
    vi.useFakeTimers();

    const notification: SyncNotification = {
      type: 'success',
      newMessagesCount: 0,
    };
    const onDismiss = vi.fn();

    await act(async () => {
      render(<SyncStatusBanner notification={notification} onDismiss={onDismiss} />);
    });

    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
