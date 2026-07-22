/**
 * ActionButton 测试(可复用动作按钮:本地可视状态机 + 二次确认)
 *
 * 真组件渲染,无 mock 边界(onExecute/onError 是调用方注入的回调,用 vi.fn 断言精确入参)。
 *
 * 覆盖:
 * 1. 渲染:label 文案 + style 白名单类(默认 secondary / danger)+ data 锚点
 * 2. 无 confirm:点击 → onExecute 精确入参 1 次;pending 期文案/禁用 + 忽略重复点击;成功 → ✓ 已执行
 * 3. 有 confirm:第一次点击不执行、文案 确认<label>?;确认窗内再点才执行
 * 4. onExecute reject → ✗ 失败 + onError(actionId, message)
 * 5. 成功/失败态 2500ms、确认态 3000ms 自动回 idle(fake timers)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ActionButton } from '../../src/chat/shared/ActionButton';

/** 可控 deferred promise(把 resolve/reject 拿到测试手里) */
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ActionButton', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染:label 文案 + 默认 secondary 白名单类 + data 锚点,初始 idle', () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    render(<ActionButton actionId="act-render" label="执行" onExecute={onExecute} />);

    const btn = screen.getByRole('button', { name: '执行' });
    expect(btn).toHaveClass('card-button');
    expect(btn).toHaveClass('card-button-secondary');
    expect(btn).toHaveClass('card-button--idle');
    expect(btn).toHaveAttribute('data-action-id', 'act-render');
    expect(btn).toHaveAttribute('data-state', 'idle');
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).not.toBeDisabled();
  });

  it("style='danger' → card-button-danger 白名单类", () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    render(<ActionButton actionId="act-danger" label="删除" style="danger" onExecute={onExecute} />);

    const btn = screen.getByRole('button', { name: '删除' });
    expect(btn).toHaveClass('card-button-danger');
    expect(btn).not.toHaveClass('card-button-secondary');
  });

  it('无 confirm:点击 → onExecute 以 actionId 精确入参 1 次;pending 期禁用且不响应重复点击;成功 → ✓ 已执行', async () => {
    const d = deferred();
    const onExecute = vi.fn(() => d.promise);
    render(<ActionButton actionId="act-run" label="执行" onExecute={onExecute} />);

    fireEvent.click(screen.getByRole('button', { name: '执行' }));
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith('act-run');

    // pending:文案切换 + disabled + 再点不重复调用
    const pendingBtn = screen.getByRole('button', { name: '执行中…' });
    expect(pendingBtn).toBeDisabled();
    expect(pendingBtn).toHaveAttribute('data-state', 'pending');
    fireEvent.click(pendingBtn);
    expect(onExecute).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve();
    });
    const doneBtn = screen.getByRole('button', { name: '✓ 已执行' });
    expect(doneBtn).toHaveAttribute('data-state', 'success');
    expect(doneBtn).not.toBeDisabled();
  });

  it("有 confirm:第一次点击不执行、文案 确认取消?(label='取消'),确认窗内再点才执行 1 次", async () => {
    const d = deferred();
    const onExecute = vi.fn(() => d.promise);
    render(<ActionButton actionId="act-confirm" label="取消" confirm onExecute={onExecute} />);

    // 第一次点击 → 确认态,不执行
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onExecute).not.toHaveBeenCalled();
    const confirming = screen.getByRole('button', { name: '确认取消?' });
    expect(confirming).toHaveAttribute('data-state', 'confirming');
    expect(confirming).not.toBeDisabled();

    // 确认窗内再点 → 执行
    fireEvent.click(confirming);
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith('act-confirm');

    await act(async () => {
      d.resolve();
    });
    expect(screen.getByRole('button')).toHaveAttribute('data-state', 'success');
  });

  it('onExecute reject → ✗ 失败 + onError 以 (actionId, message) 精确回调', async () => {
    const d = deferred();
    const onExecute = vi.fn(() => d.promise);
    const onError = vi.fn();
    render(<ActionButton actionId="act-fail" label="执行" onExecute={onExecute} onError={onError} />);

    fireEvent.click(screen.getByRole('button', { name: '执行' }));
    await act(async () => {
      d.reject(new Error('网络超时'));
    });

    expect(screen.getByRole('button', { name: '✗ 失败' })).toHaveAttribute('data-state', 'failed');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('act-fail', '网络超时');
  });

  it('成功态 2500ms 后自动回 idle(fake timers)', async () => {
    vi.useFakeTimers();
    try {
      const onExecute = vi.fn().mockResolvedValue(undefined);
      render(<ActionButton actionId="act-t1" label="执行" onExecute={onExecute} />);

      fireEvent.click(screen.getByRole('button', { name: '执行' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole('button', { name: '✓ 已执行' })).toBeInTheDocument();

      // 2499ms 时仍在成功态,2500ms 到点回 idle
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2499);
      });
      expect(screen.getByRole('button', { name: '✓ 已执行' })).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      const btn = screen.getByRole('button', { name: '执行' });
      expect(btn).toHaveAttribute('data-state', 'idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('失败态 2500ms 后自动回 idle(fake timers)', async () => {
    vi.useFakeTimers();
    try {
      const onExecute = vi.fn().mockRejectedValue(new Error('boom'));
      render(<ActionButton actionId="act-t2" label="执行" onExecute={onExecute} />);

      fireEvent.click(screen.getByRole('button', { name: '执行' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole('button', { name: '✗ 失败' })).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      expect(screen.getByRole('button', { name: '执行' })).toHaveAttribute('data-state', 'idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('确认态 3000ms 未确认自动回 idle,期间 onExecute 始终未调用(fake timers)', async () => {
    vi.useFakeTimers();
    try {
      const onExecute = vi.fn().mockResolvedValue(undefined);
      render(<ActionButton actionId="act-t3" label="删除" confirm onExecute={onExecute} />);

      fireEvent.click(screen.getByRole('button', { name: '删除' }));
      expect(screen.getByRole('button', { name: '确认删除?' })).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByRole('button', { name: '删除' })).toHaveAttribute('data-state', 'idle');
      expect(onExecute).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
