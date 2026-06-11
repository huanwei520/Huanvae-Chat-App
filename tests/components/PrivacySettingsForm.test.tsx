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
