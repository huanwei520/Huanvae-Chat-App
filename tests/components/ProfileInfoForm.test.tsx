/**
 * ProfileInfoForm 测试
 *
 * 回归覆盖：
 *   邮箱/个性签名为空时不应把空串发到后端（避免后端把 "" 当作非法 email 格式）
 *
 * 关键断言：
 *   - email='' + signature=''  →  updateProfile 调用时 body 为 {}
 *   - email='a@b.com'          →  body 包含 email='a@b.com'
 *   - signature='hi'           →  body 包含 signature='hi'
 *   - 仅有空白字符的 email 等同未填
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

// ============== Mock SessionContext ==============
const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

const sessionState = vi.hoisted(() => ({
  session: {
    profile: {
      user_id: 'u1',
      user_nickname: 'Test',
      user_email: null as string | null,
      user_signature: null as string | null,
      user_avatar_url: null,
      admin: 'false',
      created_at: '',
      updated_at: '',
    },
  },
  setSession: vi.fn(),
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => sessionState,
  useApi: () => mockApi,
}));

// ============== Mock updateProfile ==============
const mockUpdateProfile = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/profile', () => ({
  updateProfile: mockUpdateProfile,
}));

// 必须在 mock 之后再 import
import { ProfileInfoForm } from '../../src/components/profile/ProfileInfoForm';

const EMAIL_PLACEHOLDER = '未填写邮箱';

describe('ProfileInfoForm submit payload', () => {
  beforeEach(() => {
    cleanup();
    mockUpdateProfile.mockReset();
    mockUpdateProfile.mockResolvedValue({ message: 'ok' });
    // 重置 session profile
    sessionState.session.profile.user_email = null;
    sessionState.session.profile.user_signature = null;
  });

  it('邮箱 input 渲染时使用中文 placeholder（不是 value）', () => {
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} />);
    const input = screen.getByPlaceholderText(EMAIL_PLACEHOLDER) as HTMLInputElement;
    // placeholder 仅是提示，input 的 value 仍为空 — 不会被当成实际邮箱内容提交
    expect(input.value).toBe('');
    expect(input.placeholder).toBe(EMAIL_PLACEHOLDER);
  });

  it('email 与 signature 都为空时，提交体不包含这两个字段（修截图 bug）', async () => {
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /保存修改/ }));
    });

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateProfile.mock.calls[0]!;
    expect(body).toEqual({ email: undefined, signature: undefined });
    // JSON.stringify 会跳过 undefined 字段，等同请求体里不带这两个 key
    expect(JSON.parse(JSON.stringify(body))).toEqual({});
  });

  it('email 为纯空白字符串时也视为未填', async () => {
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} />);

    fireEvent.change(
      screen.getByPlaceholderText(EMAIL_PLACEHOLDER),
      { target: { value: '   ' } },
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /保存修改/ }));
    });

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateProfile.mock.calls[0]!;
    expect(body.email).toBeUndefined();
  });

  it('email 填了合法值时，提交体包含该 email', async () => {
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} />);

    fireEvent.change(
      screen.getByPlaceholderText(EMAIL_PLACEHOLDER),
      { target: { value: 'a@b.com' } },
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /保存修改/ }));
    });

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateProfile.mock.calls[0]!;
    expect(body.email).toBe('a@b.com');
  });

  it('signature 填了内容时，提交体包含该 signature', async () => {
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} />);

    fireEvent.change(
      screen.getByPlaceholderText('介绍一下自己吧...'),
      { target: { value: '你好世界' } },
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /保存修改/ }));
    });

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateProfile.mock.calls[0]!;
    expect(body.signature).toBe('你好世界');
  });

  it('email 前后空白会被 trim 后再判定', async () => {
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} />);

    fireEvent.change(
      screen.getByPlaceholderText(EMAIL_PLACEHOLDER),
      { target: { value: '  a@b.com  ' } },
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /保存修改/ }));
    });

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateProfile.mock.calls[0]!;
    expect(body.email).toBe('a@b.com');
  });
});

describe('ProfileInfoForm 加载初值过滤（DB 脏数据）', () => {
  beforeEach(() => {
    cleanup();
    mockUpdateProfile.mockReset();
    mockUpdateProfile.mockResolvedValue({ message: 'ok' });
    sessionState.session.profile.user_signature = null;
  });

  it('DB 里 user_email 是非邮箱字符串（如"未填写邮箱"）时，input value 为空，placeholder 显示提示', () => {
    sessionState.session.profile.user_email = '未填写邮箱';
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} />);

    const input = screen.getByPlaceholderText(EMAIL_PLACEHOLDER) as HTMLInputElement;
    // input value 必须为空，placeholder "未填写邮箱" 仅是灰色提示，不会被提交
    expect(input.value).toBe('');
    expect(input.placeholder).toBe(EMAIL_PLACEHOLDER);
  });

  it('DB 脏数据被过滤后，提交时不会把脏值带回后端', async () => {
    sessionState.session.profile.user_email = '未填写邮箱';
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /保存修改/ }));
    });

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateProfile.mock.calls[0]!;
    expect(body.email).toBeUndefined();
  });

  it('DB 里 user_email 是合法邮箱时，input 显示该邮箱', () => {
    sessionState.session.profile.user_email = 'real@example.com';
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} />);

    const input = screen.getByPlaceholderText(EMAIL_PLACEHOLDER) as HTMLInputElement;
    expect(input.value).toBe('real@example.com');
  });

  it('DB 里 user_email 是 null 时，input 为空（保留原行为）', () => {
    sessionState.session.profile.user_email = null;
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} />);

    const input = screen.getByPlaceholderText(EMAIL_PLACEHOLDER) as HTMLInputElement;
    expect(input.value).toBe('');
  });
});

// 移动端保存键上移到页面顶部 header 的契约：hideSubmit 隐藏内部按钮，onSubmitStateChange
// 上报有改动态（canSave）+ 稳定 submit()，供 MobileProfilePage 顶部「保存」键置灰/高亮/触发。
describe('ProfileInfoForm 移动端 header 保存契约（hideSubmit / onSubmitStateChange）', () => {
  beforeEach(() => {
    cleanup();
    mockUpdateProfile.mockReset();
    mockUpdateProfile.mockResolvedValue({ message: 'ok' });
    sessionState.session.profile.user_email = null;
    sessionState.session.profile.user_signature = null;
  });

  it('hideSubmit 时不渲染内部「保存修改」按钮', () => {
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} hideSubmit />);
    expect(screen.queryByRole('button', { name: /保存修改/ })).toBeNull();
  });

  it('不传 hideSubmit（桌面默认）时仍渲染内部按钮', () => {
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} />);
    expect(screen.getByRole('button', { name: /保存修改/ })).toBeInTheDocument();
  });

  it('onSubmitStateChange：初始无改动 canSave=false，改字段后 canSave=true', () => {
    const onState = vi.fn();
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} hideSubmit onSubmitStateChange={onState} />);
    // 挂载即上报一次，初始未改动
    expect(onState).toHaveBeenCalled();
    expect(onState.mock.calls[onState.mock.calls.length - 1]![0].canSave).toBe(false);
    // 改「地区」→ 有改动
    fireEvent.change(screen.getByPlaceholderText('如：上海'), { target: { value: '北京' } });
    expect(onState.mock.calls[onState.mock.calls.length - 1]![0].canSave).toBe(true);
  });

  it('onSubmitStateChange 暴露的 submit() 触发 updateProfile 并带改后字段', async () => {
    const onState = vi.fn();
    render(<ProfileInfoForm onSuccess={() => {}} onError={() => {}} hideSubmit onSubmitStateChange={onState} />);
    fireEvent.change(screen.getByPlaceholderText('如：上海'), { target: { value: '北京' } });

    const { submit } = onState.mock.calls[onState.mock.calls.length - 1]![0];
    await act(async () => { submit(); });

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateProfile.mock.calls[0]!;
    expect(body.region).toBe('北京');
  });
});
