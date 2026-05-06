/**
 * PromptDialog 通用输入对话框测试
 *
 * 覆盖：
 *   - PromptDialog 组件：渲染、确认/取消、键盘事件、required 校验
 *   - usePromptDialog Hook：Promise 解析（输入值 / null）、对话框显示与关闭
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useState } from 'react';
import {
  PromptDialog,
  usePromptDialog,
} from '../../src/lowcode/components/ConfirmDialog';

describe('PromptDialog (component)', () => {
  beforeEach(() => cleanup());

  it('renders title, message, placeholder and default value', () => {
    render(
      <PromptDialog
        title="创建群组"
        message="请输入群组名称"
        placeholder="群组名称"
        defaultValue="默认值"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText('创建群组')).toBeInTheDocument();
    expect(screen.getByText('请输入群组名称')).toBeInTheDocument();
    const input = screen.getByPlaceholderText('群组名称') as HTMLInputElement;
    expect(input.value).toBe('默认值');
  });

  it('calls onConfirm with input value when confirm is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <PromptDialog
        title="测试"
        placeholder="输入"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const input = screen.getByPlaceholderText('输入');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByText('确认'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('hello');
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <PromptDialog
        title="测试"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Enter key submits when value is non-empty', () => {
    const onConfirm = vi.fn();
    render(
      <PromptDialog
        title="测试"
        placeholder="输入"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const input = screen.getByPlaceholderText('输入');
    fireEvent.change(input, { target: { value: 'enter-value' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onConfirm).toHaveBeenCalledWith('enter-value');
  });

  it('Escape key cancels the dialog', () => {
    const onCancel = vi.fn();
    render(
      <PromptDialog
        title="测试"
        placeholder="输入"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByPlaceholderText('输入');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('confirm is disabled when required and input is empty', () => {
    render(
      <PromptDialog
        title="测试"
        placeholder="输入"
        required
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const confirmBtn = screen.getByText('确认') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it('Enter key is no-op when required and input is whitespace-only', () => {
    const onConfirm = vi.fn();
    render(
      <PromptDialog
        title="测试"
        placeholder="输入"
        required
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const input = screen.getByPlaceholderText('输入');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('non-required allows submitting empty value', () => {
    const onConfirm = vi.fn();
    render(
      <PromptDialog
        title="测试"
        placeholder="输入"
        required={false}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('确认'));
    expect(onConfirm).toHaveBeenCalledWith('');
  });

  it('uses custom button labels', () => {
    render(
      <PromptDialog
        title="测试"
        confirmLabel="提交"
        cancelLabel="放弃"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText('提交')).toBeInTheDocument();
    expect(screen.getByText('放弃')).toBeInTheDocument();
  });
});

// ============================================================================
// usePromptDialog Hook
// ============================================================================

/**
 * 测试包装：暴露 prompt 与 dialogElement，并把最近一次 resolve 的值存到 state
 * 这样测试可以断言 prompt() Promise 的解析结果
 */
function PromptHarness() {
  const { prompt, dialogElement } = usePromptDialog();
  const [result, setResult] = useState<string | null | undefined>(undefined);

  const trigger = async () => {
    const r = await prompt({ title: '请输入名称', placeholder: '名称' });
    setResult(r);
  };

  return (
    <>
      <button type="button" onClick={trigger}>open</button>
      <span data-testid="result">
        {result === undefined ? 'pending' : result === null ? 'cancelled' : `value:${result}`}
      </span>
      {dialogElement}
    </>
  );
}

describe('usePromptDialog (hook)', () => {
  beforeEach(() => cleanup());

  it('opens dialog when prompt() is called', async () => {
    render(<PromptHarness />);

    expect(screen.queryByText('请输入名称')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText('open'));
    });
    expect(screen.getByText('请输入名称')).toBeInTheDocument();
  });

  it('resolves with the input value when user confirms', async () => {
    render(<PromptHarness />);

    await act(async () => {
      fireEvent.click(screen.getByText('open'));
    });

    const input = screen.getByPlaceholderText('名称');
    fireEvent.change(input, { target: { value: 'group-1' } });

    await act(async () => {
      fireEvent.click(screen.getByText('确认'));
    });

    expect(screen.getByTestId('result').textContent).toBe('value:group-1');
    // 对话框关闭
    expect(screen.queryByText('请输入名称')).not.toBeInTheDocument();
  });

  it('resolves with null when user cancels', async () => {
    render(<PromptHarness />);

    await act(async () => {
      fireEvent.click(screen.getByText('open'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('取消'));
    });

    expect(screen.getByTestId('result').textContent).toBe('cancelled');
    expect(screen.queryByText('请输入名称')).not.toBeInTheDocument();
  });
});
