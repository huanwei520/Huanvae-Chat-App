/**
 * PrivacySettingsForm 测试
 *
 * 覆盖：
 * - 进入时 getProfile 拉当前值并回填到开关/下拉
 * - 总开关关闭时，按 ID 开关被禁用且显示提示（总开关式）
 * - 保存调用 updateProfile 并带上 4 个隐私字段
 * - 切换好友申请策略后保存，提交体反映新值
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mockApi,
}));

const mockGetProfile = vi.hoisted(() => vi.fn());
const mockUpdateProfile = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/profile', () => ({
  getProfile: mockGetProfile,
  updateProfile: mockUpdateProfile,
}));

import { PrivacySettingsForm } from '../../src/components/profile/PrivacySettingsForm';

function profileWith(over: Record<string, unknown> = {}) {
  return {
    user_id: 'u1',
    user_nickname: 'Test',
    user_email: null,
    user_signature: null,
    user_avatar_url: null,
    admin: 'false',
    allow_search: true,
    search_visible_by_id: true,
    friend_request_policy: 'manual',
    group_invite_policy: 'manual',
    created_at: '',
    updated_at: '',
    ...over,
  };
}

describe('PrivacySettingsForm', () => {
  beforeEach(() => {
    cleanup();
    mockGetProfile.mockReset();
    mockUpdateProfile.mockReset();
    mockUpdateProfile.mockResolvedValue({ message: 'ok' });
  });

  it('进入时拉取并回填当前隐私值', async () => {
    mockGetProfile.mockResolvedValue(profileWith({ friend_request_policy: 'auto_accept' }));
    render(<PrivacySettingsForm onSuccess={() => {}} onError={() => {}} />);

    await waitFor(() => expect(screen.getByText('搜索可见性')).toBeInTheDocument());
    // 好友申请下拉应回填为 auto_accept
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects[0]!.value).toBe('auto_accept');
  });

  it('总开关关闭时按 ID 开关禁用并显示提示', async () => {
    mockGetProfile.mockResolvedValue(profileWith({ allow_search: false }));
    render(<PrivacySettingsForm onSuccess={() => {}} onError={() => {}} />);

    await waitFor(() => expect(screen.getByText('搜索可见性')).toBeInTheDocument());
    const toggles = screen.getAllByRole('checkbox') as HTMLInputElement[];
    // toggles[0]=总开关(关), toggles[1]=按ID(应禁用)
    expect(toggles[0]!.checked).toBe(false);
    expect(toggles[1]!.disabled).toBe(true);
    expect(screen.getByText(/无法添加你/)).toBeInTheDocument();
  });

  it('保存调用 updateProfile 并带 4 个隐私字段', async () => {
    mockGetProfile.mockResolvedValue(profileWith());
    render(<PrivacySettingsForm onSuccess={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByText('搜索可见性')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /保存设置/ }));
    });

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateProfile.mock.calls[0]!;
    expect(body).toEqual({
      allow_search: true,
      search_visible_by_id: true,
      friend_request_policy: 'manual',
      group_invite_policy: 'manual',
    });
  });

  it('切换群邀请策略后保存，提交体反映新值', async () => {
    mockGetProfile.mockResolvedValue(profileWith());
    render(<PrivacySettingsForm onSuccess={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByText('申请默认处理')).toBeInTheDocument());

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    // selects[0]=好友申请, selects[1]=群邀请
    fireEvent.change(selects[1]!, { target: { value: 'auto_reject' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /保存设置/ }));
    });

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateProfile.mock.calls[0]!;
    expect(body.group_invite_policy).toBe('auto_reject');
  });
});

// 移动端保存键上移到页面顶部 header 的契约（2026-07-10 手机资料页重设计新增）：
// hideSubmit 隐藏内部按钮，onSubmitStateChange 上报有改动态（isDirty）+ 稳定 submit()。
// isDirty 基线逻辑非平凡：加载完成后落基线、保存成功后基线归位，故重点覆盖"改了→高亮、存完→回置灰"。
describe('PrivacySettingsForm 移动端 header 保存契约（hideSubmit / onSubmitStateChange / isDirty）', () => {
  beforeEach(() => {
    cleanup();
    mockGetProfile.mockReset();
    mockUpdateProfile.mockReset();
    mockUpdateProfile.mockResolvedValue({ message: 'ok' });
  });

  function lastState(spy: ReturnType<typeof vi.fn>) {
    const calls = spy.mock.calls;
    return calls[calls.length - 1]![0] as { canSave: boolean; saving: boolean; submit: () => void };
  }

  it('hideSubmit 时不渲染内部「保存设置」按钮', async () => {
    mockGetProfile.mockResolvedValue(profileWith());
    render(<PrivacySettingsForm onSuccess={() => {}} onError={() => {}} hideSubmit />);
    await waitFor(() => expect(screen.getByText('搜索可见性')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /保存设置/ })).toBeNull();
  });

  it('不传 hideSubmit（桌面默认）时仍渲染内部按钮', async () => {
    mockGetProfile.mockResolvedValue(profileWith());
    render(<PrivacySettingsForm onSuccess={() => {}} onError={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /保存设置/ })).toBeInTheDocument());
  });

  it('isDirty：加载后未改动 canSave=false，改策略后 true，保存成功后基线归位回 false', async () => {
    const onState = vi.fn();
    mockGetProfile.mockResolvedValue(profileWith());
    // 用带一跳延迟的 updateProfile 模拟真实网络：保证「保存中」(saving=true) 先落一次真实渲染，
    // 再到 saving=false + 基线归位那一帧重算 isDirty。若用即时 resolve，setSaving(true→false)
    // 会被 React 批处理成 saving 无净变化 → 组件不重渲染 → 仅 ref 的 baseline 变更观察不到（测试假象）。
    mockUpdateProfile.mockImplementation(() => new Promise((res) => { setTimeout(() => res({ message: 'ok' }), 0); }));
    render(<PrivacySettingsForm onSuccess={() => {}} onError={() => {}} hideSubmit onSubmitStateChange={onState} />);

    // 加载完成、基线落定后：未改动 → canSave=false
    await waitFor(() => expect(screen.getByText('申请默认处理')).toBeInTheDocument());
    await waitFor(() => expect(lastState(onState).canSave).toBe(false));

    // 改群邀请策略 → 与基线不一致 → canSave=true
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(selects[1]!, { target: { value: 'auto_reject' } });
    expect(lastState(onState).canSave).toBe(true);

    // 经 header 保存键触发 submit → updateProfile → 成功后基线归位 → canSave 回 false
    await act(async () => { lastState(onState).submit(); });
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(lastState(onState).canSave).toBe(false));
  });

  it('submit() 提交体反映改后的策略值', async () => {
    const onState = vi.fn();
    mockGetProfile.mockResolvedValue(profileWith());
    render(<PrivacySettingsForm onSuccess={() => {}} onError={() => {}} hideSubmit onSubmitStateChange={onState} />);
    await waitFor(() => expect(screen.getByText('申请默认处理')).toBeInTheDocument());

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(selects[0]!, { target: { value: 'auto_accept' } });

    await act(async () => { lastState(onState).submit(); });
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateProfile.mock.calls[0]!;
    expect(body.friend_request_policy).toBe('auto_accept');
  });
});
