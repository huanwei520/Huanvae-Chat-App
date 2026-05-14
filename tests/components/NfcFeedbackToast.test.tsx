/**
 * NfcFeedbackToast 组件测试
 *
 * 验证：
 * - variant=success/error 双变体的 className 与图标差异
 * - 点击触发 onDismiss
 * - 3 秒自动 dismiss（fake timer）
 *
 * 注意：useEffect 内 setTimeout(onDismiss, 3000)，fake timer 时
 * 必须用 advanceTimersByTimeAsync 而非 advanceTimersByTime（参考
 * .claude/rules/frontend-test.md「vitest fake timer 与真实 Promise 协调」）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NfcFeedbackToast } from '../../src/nfc/NfcFeedbackToast';

describe('NfcFeedbackToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('variant=success 渲染含 ✓ 图标 + className 修饰符', () => {
    render(
      <NfcFeedbackToast
        variant="success"
        message="已执行: 打开小程序: app-1"
        toastKey={1}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('已执行: 打开小程序: app-1')).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
    const toast = screen.getByRole('status');
    expect(toast).toHaveClass('nfc-feedback-toast');
    expect(toast).toHaveClass('nfc-feedback-toast--success');
    expect(toast).not.toHaveClass('nfc-feedback-toast--error');
  });

  it('variant=error 渲染含 ⚠ 图标 + className 修饰符', () => {
    render(
      <NfcFeedbackToast
        variant="error"
        message="扫卡失败: 卡片无 URI Record"
        toastKey={1}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('扫卡失败: 卡片无 URI Record')).toBeInTheDocument();
    expect(screen.getByText('⚠')).toBeInTheDocument();
    const toast = screen.getByRole('status');
    expect(toast).toHaveClass('nfc-feedback-toast--error');
    expect(toast).not.toHaveClass('nfc-feedback-toast--success');
  });

  it('点击 toast 触发 onDismiss', () => {
    const onDismiss = vi.fn();
    render(
      <NfcFeedbackToast variant="success" message="msg" toastKey={1} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole('status'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('3 秒后自动触发 onDismiss', async () => {
    const onDismiss = vi.fn();
    render(
      <NfcFeedbackToast variant="success" message="msg" toastKey={1} onDismiss={onDismiss} />,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
