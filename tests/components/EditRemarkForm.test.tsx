/**
 * EditRemarkForm 组件测试
 *
 * 好友备注设置表单：输入 onChange、保存 onSubmit、清除 onClear、空值时保存禁用。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditRemarkForm } from '../../src/chat/shared/menu/EditRemarkForm';

function setup(value: string, loading = false) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const onClear = vi.fn();
  const onBack = vi.fn();
  render(
    <EditRemarkForm
      value={value}
      loading={loading}
      onChange={onChange}
      onSubmit={onSubmit}
      onClear={onClear}
      onBack={onBack}
    />,
  );
  return { onChange, onSubmit, onClear, onBack };
}

describe('EditRemarkForm', () => {
  it('渲染标题与当前备注值', () => {
    setup('老王');
    expect(screen.getByText('设置备注')).toBeInTheDocument();
    expect(screen.getByDisplayValue('老王')).toBeInTheDocument();
  });

  it('输入触发 onChange', () => {
    const { onChange } = setup('');
    fireEvent.change(screen.getByPlaceholderText('输入好友备注（留空显示昵称）'), {
      target: { value: '阿强' },
    });
    expect(onChange).toHaveBeenCalledWith('阿强');
  });

  it('有值时点击保存触发 onSubmit', () => {
    const { onSubmit } = setup('老王');
    fireEvent.click(screen.getByText('保存'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('值为空白时保存按钮禁用', () => {
    setup('   ');
    expect(screen.getByText('保存')).toBeDisabled();
  });

  it('点击清除触发 onClear', () => {
    const { onClear } = setup('老王');
    fireEvent.click(screen.getByText('清除备注'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('loading 时显示保存中并禁用两个按钮', () => {
    setup('老王', true);
    expect(screen.getByText('保存中...')).toBeDisabled();
    expect(screen.getByText('清除备注')).toBeDisabled();
  });
});
