/**
 * GroupRemarkInputModal 测试（D7 群内私有备注输入弹窗）
 *
 * 覆盖：
 * - 关闭时不渲染；打开时渲染标题 + 回填当前备注
 * - 输入后点「保存」→ onSave(trimmed) + onClose
 * - 空输入时「保存」禁用
 * - 已有备注时显示「清除备注」→ onSave('') + onClose
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { GroupRemarkInputModal } from '../../src/chat/group/GroupRemarkInputModal';

describe('GroupRemarkInputModal', () => {
  beforeEach(() => {
    cleanup();
  });

  it('关闭时不渲染', () => {
    render(
      <GroupRemarkInputModal isOpen={false} memberName="张三" currentRemark="" onSave={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByText('设置群内备注')).toBeNull();
  });

  it('打开时渲染标题并回填当前备注', () => {
    render(
      <GroupRemarkInputModal isOpen memberName="张三" currentRemark="小王" onSave={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByText('设置群内备注')).toBeTruthy();
    const input = screen.getByPlaceholderText('输入备注名') as HTMLInputElement;
    expect(input.value).toBe('小王');
  });

  it('输入后点保存触发 onSave(trimmed) + onClose', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <GroupRemarkInputModal isOpen memberName="张三" currentRemark="" onSave={onSave} onClose={onClose} />,
    );
    const input = screen.getByPlaceholderText('输入备注名');
    fireEvent.change(input, { target: { value: '  老王  ' } });
    fireEvent.click(screen.getByText('保存'));
    expect(onSave).toHaveBeenCalledWith('老王');
    expect(onClose).toHaveBeenCalled();
  });

  it('空输入时保存按钮禁用', () => {
    render(
      <GroupRemarkInputModal isOpen memberName="张三" currentRemark="" onSave={vi.fn()} onClose={vi.fn()} />,
    );
    expect((screen.getByText('保存') as HTMLButtonElement).disabled).toBe(true);
  });

  it('已有备注时显示清除按钮，点击触发 onSave("") + onClose', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <GroupRemarkInputModal isOpen memberName="张三" currentRemark="小王" onSave={onSave} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText('清除备注'));
    expect(onSave).toHaveBeenCalledWith('');
    expect(onClose).toHaveBeenCalled();
  });

  it('无备注时不显示清除按钮', () => {
    render(
      <GroupRemarkInputModal isOpen memberName="张三" currentRemark="" onSave={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByText('清除备注')).toBeNull();
  });
});
