/**
 * PasswordForm 测试
 *
 * 覆盖移动端「保存键上移到页面顶部 header」契约（2026-07-10 手机资料页重设计新增）：
 * - hideSubmit：隐藏内部「修改密码」按钮（桌面默认 false 仍展示，不回归）
 * - onSubmitStateChange：上报 { canSave, saving, submit }
 *     canSave = 三项密码全填且非提交中（!loading && old && new && confirm）
 * - 暴露的 submit() 触发 changePassword，并带旧/新密码
 *
 * 断言均锚定真实条件逻辑（canSave 三项与门），非静态字面量：任一密码为空 canSave 必须 false。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

// ============== Mock SessionContext（PasswordForm 只用 useApi） ==============
const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mockApi,
}));

// ============== Mock changePassword ==============
const mockChangePassword = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/profile', () => ({
  changePassword: mockChangePassword,
}));

import { PasswordForm } from '../../src/components/profile/PasswordForm';

const PH_OLD = '请输入旧密码';
const PH_NEW = '请输入新密码（至少 6 位）';
const PH_CONFIRM = '请再次输入新密码';

/** 取 onSubmitStateChange 最近一次上报的状态 */
function lastState(spy: ReturnType<typeof vi.fn>) {
  return spy.mock.calls[spy.mock.calls.length - 1]![0] as { canSave: boolean; saving: boolean; submit: () => void };
}

describe('PasswordForm 移动端 header 保存契约（hideSubmit / onSubmitStateChange）', () => {
  beforeEach(() => {
    cleanup();
    mockChangePassword.mockReset();
    mockChangePassword.mockResolvedValue({ message: 'ok' });
  });

  it('hideSubmit 时不渲染内部「修改密码」按钮', () => {
    render(<PasswordForm onSuccess={() => {}} onError={() => {}} hideSubmit />);
    expect(screen.queryByRole('button', { name: /修改密码/ })).toBeNull();
  });

  it('不传 hideSubmit（桌面默认）时仍渲染内部按钮', () => {
    render(<PasswordForm onSuccess={() => {}} onError={() => {}} />);
    expect(screen.getByRole('button', { name: /修改密码/ })).toBeInTheDocument();
  });

  it('onSubmitStateChange：三项全填才 canSave=true，缺一项即 false', () => {
    const onState = vi.fn();
    render(<PasswordForm onSuccess={() => {}} onError={() => {}} hideSubmit onSubmitStateChange={onState} />);

    // 挂载即上报一次，三项皆空 → canSave=false
    expect(onState).toHaveBeenCalled();
    expect(lastState(onState).canSave).toBe(false);

    // 只填旧密码 → 仍缺两项 → false
    fireEvent.change(screen.getByPlaceholderText(PH_OLD), { target: { value: 'old-pass' } });
    expect(lastState(onState).canSave).toBe(false);

    // 再填新密码 → 仍缺确认 → false
    fireEvent.change(screen.getByPlaceholderText(PH_NEW), { target: { value: 'new-pass' } });
    expect(lastState(onState).canSave).toBe(false);

    // 补齐确认密码 → 三项全填 → true
    fireEvent.change(screen.getByPlaceholderText(PH_CONFIRM), { target: { value: 'new-pass' } });
    expect(lastState(onState).canSave).toBe(true);
  });

  it('onSubmitStateChange 暴露的 submit() 触发 changePassword 并带旧/新密码', async () => {
    const onState = vi.fn();
    render(<PasswordForm onSuccess={() => {}} onError={() => {}} hideSubmit onSubmitStateChange={onState} />);

    fireEvent.change(screen.getByPlaceholderText(PH_OLD), { target: { value: 'old-pass' } });
    fireEvent.change(screen.getByPlaceholderText(PH_NEW), { target: { value: 'new-pass' } });
    fireEvent.change(screen.getByPlaceholderText(PH_CONFIRM), { target: { value: 'new-pass' } });

    await act(async () => { lastState(onState).submit(); });

    await waitFor(() => expect(mockChangePassword).toHaveBeenCalledTimes(1));
    const [, body] = mockChangePassword.mock.calls[0]!;
    expect(body).toEqual({ old_password: 'old-pass', new_password: 'new-pass' });
  });
});
