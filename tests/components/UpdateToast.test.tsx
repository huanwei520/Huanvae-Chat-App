/**
 * UpdateToast 组件测试
 *
 * 测试更新弹窗的各种状态和交互
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UpdateToast, useUpdateToast } from '../../src/update/components';
import { renderHook, act } from '@testing-library/react';

describe('UpdateToast', () => {
  describe('状态渲染', () => {
    it('idle 状态不渲染任何内容', () => {
      const { container } = render(<UpdateToast status="idle" />);
      expect(container.querySelector('.update-toast')).toBeNull();
    });

    it('available 状态显示新版本信息', () => {
      render(
        <UpdateToast
          status="available"
          version="1.0.8"
          notes="修复了一些问题"
        />,
      );

      expect(screen.getByText('发现新版本 v1.0.8')).toBeInTheDocument();
      expect(screen.getByText('修复了一些问题')).toBeInTheDocument();
      expect(screen.getByText('更新')).toBeInTheDocument();
      expect(screen.getByText('稍后')).toBeInTheDocument();
    });

    it('downloading 状态显示进度条', () => {
      render(
        <UpdateToast
          status="downloading"
          version="1.0.8"
          progress={50}
          downloaded={10485760}
          total={20971520}
          proxyUrl="https://gh-proxy.com"
        />,
      );

      expect(screen.getByText('正在下载 v1.0.8')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('10.0 MB / 20.0 MB')).toBeInTheDocument();
      expect(screen.getByText('代理: gh-proxy.com')).toBeInTheDocument();
    });

    it('ready 状态显示重启按钮', () => {
      render(<UpdateToast status="ready" />);

      expect(screen.getByText('下载完成')).toBeInTheDocument();
      expect(screen.getByText('立即重启')).toBeInTheDocument();
    });

    it('error 状态显示错误信息', () => {
      render(
        <UpdateToast
          status="error"
          errorMessage="网络连接失败"
        />,
      );

      expect(screen.getByText('更新失败')).toBeInTheDocument();
      expect(screen.getByText('网络连接失败')).toBeInTheDocument();
      expect(screen.getByText('重试')).toBeInTheDocument();
    });
  });

  describe('交互事件', () => {
    it('点击更新按钮触发 onUpdate', () => {
      const onUpdate = vi.fn();
      render(
        <UpdateToast
          status="available"
          version="1.0.8"
          onUpdate={onUpdate}
        />,
      );

      fireEvent.click(screen.getByText('更新'));
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    it('点击稍后按钮触发 onDismiss', () => {
      const onDismiss = vi.fn();
      render(
        <UpdateToast
          status="available"
          version="1.0.8"
          onDismiss={onDismiss}
        />,
      );

      fireEvent.click(screen.getByText('稍后'));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('点击重启按钮触发 onRestart', () => {
      const onRestart = vi.fn();
      render(
        <UpdateToast
          status="ready"
          onRestart={onRestart}
        />,
      );

      fireEvent.click(screen.getByText('立即重启'));
      expect(onRestart).toHaveBeenCalledTimes(1);
    });

    it('点击重试按钮触发 onRetry', () => {
      const onRetry = vi.fn();
      render(
        <UpdateToast
          status="error"
          errorMessage="网络错误"
          onRetry={onRetry}
        />,
      );

      fireEvent.click(screen.getByText('重试'));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });
});

describe('useUpdateToast', () => {
  it('初始状态为 idle', () => {
    const { result } = renderHook(() => useUpdateToast());
    expect(result.current.status).toBe('idle');
  });

  it('showAvailable 更新状态为 available', () => {
    const { result } = renderHook(() => useUpdateToast());

    act(() => {
      result.current.showAvailable('1.0.8', '新功能');
    });

    expect(result.current.status).toBe('available');
    expect(result.current.version).toBe('1.0.8');
    expect(result.current.notes).toBe('新功能');
  });

  it('startDownload 更新状态为 downloading', () => {
    const { result } = renderHook(() => useUpdateToast());

    act(() => {
      result.current.startDownload();
    });

    expect(result.current.status).toBe('downloading');
    expect(result.current.progress).toBe(0);
  });

  it('updateProgress 更新进度信息', () => {
    const { result } = renderHook(() => useUpdateToast());

    act(() => {
      result.current.startDownload();
      result.current.updateProgress(50, 1000, 2000, 'https://proxy.com');
    });

    expect(result.current.progress).toBe(50);
    expect(result.current.downloaded).toBe(1000);
    expect(result.current.total).toBe(2000);
    expect(result.current.proxyUrl).toBe('https://proxy.com');
  });

  it('downloadComplete 更新状态为 ready', () => {
    const { result } = renderHook(() => useUpdateToast());

    act(() => {
      result.current.downloadComplete();
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.progress).toBe(100);
  });

  it('showError 更新状态为 error', () => {
    const { result } = renderHook(() => useUpdateToast());

    act(() => {
      result.current.showError('下载失败');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe('下载失败');
  });

  it('dismiss 重置状态为 idle', () => {
    const { result } = renderHook(() => useUpdateToast());

    act(() => {
      result.current.showAvailable('1.0.8');
      result.current.dismiss();
    });

    expect(result.current.status).toBe('idle');
  });
});


