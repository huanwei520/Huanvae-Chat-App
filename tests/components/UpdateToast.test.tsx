/**
 * UpdateToast 组件测试
 *
 * 测试更新弹窗的各种状态和交互
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UpdateToast } from '../../src/update/components';

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
          sourceUrl="https://store.huanvae.cn/update/foo.apk"
        />,
      );

      expect(screen.getByText('正在下载 v1.0.8')).toBeInTheDocument();
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('10.0 MB / 20.0 MB')).toBeInTheDocument();
      expect(screen.getByText('源: store.huanvae.cn')).toBeInTheDocument();
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
