/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * NfcTrustConfirmModal 组件测试
 *
 * 验证：
 * - 渲染 actionSummary + UID 短码 + hash 前 16 字符
 * - 点信任触发 onConfirm（精确空调用）
 * - 点取消触发 onCancel（精确空调用）
 * - 两按钮不相互触发
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NfcTrustConfirmModal } from '../../src/nfc/NfcTrustConfirmModal';

describe('NfcTrustConfirmModal', () => {
  it('渲染 actionSummary + UID 短码 + hash 前 16 位', () => {
    render(
      <NfcTrustConfirmModal
        uid="04123456deadbeef"
        payloadHash="abcdef0123456789fedcba9876543210"
        actionSummary="打开小程序: app-42"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('打开小程序: app-42')).toBeInTheDocument();
    // UID 前 8 字符
    expect(screen.getByText(/04123456/)).toBeInTheDocument();
    // payload_hash 前 16 字符
    expect(screen.getByText(/abcdef0123456789/)).toBeInTheDocument();
    // 不暴露完整 hash
    expect(screen.queryByText(/fedcba9876543210/)).not.toBeInTheDocument();
  });

  it('点信任触发 onConfirm（且不触发 onCancel）', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <NfcTrustConfirmModal
        uid="uid"
        payloadHash="hash"
        actionSummary="summary"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '信任并执行' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('点取消触发 onCancel（且不触发 onConfirm）', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <NfcTrustConfirmModal
        uid="uid"
        payloadHash="hash"
        actionSummary="summary"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('role="dialog" + aria-modal="true"（可访问性契约）', () => {
    render(
      <NfcTrustConfirmModal
        uid="uid"
        payloadHash="hash"
        actionSummary="summary"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});
