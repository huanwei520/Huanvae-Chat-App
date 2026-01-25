/**
 * SyncStatusBanner 组件测试
 *
 * 测试消息同步状态横幅的渲染和交互
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { SyncStatusBanner, type SyncStatus } from '../../src/components/common/SyncStatusBanner';

/** 创建默认同步状态 */
function createSyncStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    syncing: false,
    progress: 0,
    totalConversations: 0,
    syncedConversations: 0,
    newMessagesCount: 0,
    error: null,
    lastSyncTime: null,
    ...overrides,
  };
}

describe('SyncStatusBanner', () => {
  it('同步中时显示进度文字', async () => {
    const status = createSyncStatus({
      syncing: true,
      totalConversations: 10,
      syncedConversations: 3,
    });

    await act(async () => {
      render(<SyncStatusBanner status={status} />);
    });

    expect(screen.getByText(/正在同步消息/)).toBeInTheDocument();
  });

  it('同步完成且有新消息时显示完成文字', async () => {
    const status = createSyncStatus({
      syncing: false,
      newMessagesCount: 28,
      lastSyncTime: new Date(),
    });

    await act(async () => {
      render(<SyncStatusBanner status={status} />);
    });

    expect(screen.getByText('已同步 28 条新消息')).toBeInTheDocument();
  });

  it('同步完成但无新消息时显示最新状态', async () => {
    const status = createSyncStatus({
      syncing: false,
      newMessagesCount: 0,
      lastSyncTime: new Date(),
    });

    await act(async () => {
      render(<SyncStatusBanner status={status} />);
    });

    expect(screen.getByText('消息已是最新')).toBeInTheDocument();
  });

  it('同步失败时显示错误信息并可点击重试', async () => {
    const status = createSyncStatus({
      syncing: false,
      error: '网络错误',
    });

    const onRetry = vi.fn();

    await act(async () => {
      render(<SyncStatusBanner status={status} onRetry={onRetry} />);
    });

    const errorElement = screen.getByText('同步失败，点击重试');
    expect(errorElement).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(errorElement);
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('未开始同步时不显示横幅', async () => {
    const status = createSyncStatus();

    let container: HTMLElement;
    await act(async () => {
      const result = render(<SyncStatusBanner status={status} />);
      container = result.container;
    });

    // 横幅容器应该为空或不可见
    expect(container!.querySelector('.sync-banner-content')).not.toBeInTheDocument();
  });

  it('错误状态支持键盘交互', async () => {
    const status = createSyncStatus({
      syncing: false,
      error: '网络错误',
    });

    const onRetry = vi.fn();

    await act(async () => {
      render(<SyncStatusBanner status={status} onRetry={onRetry} />);
    });

    const errorElement = screen.getByText('同步失败，点击重试');

    await act(async () => {
      fireEvent.keyDown(errorElement, { key: 'Enter' });
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
