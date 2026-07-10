/**
 * MobileProfilePage 测试（2026-07-10 手机资料页重设计：独立整屏页 + 右上保存）
 *
 * 只覆盖本页**自有的接线逻辑**（子表单/编辑 hook 已各自单测，这里 stub 掉）：
 * 1. 顶部保存键：saveCtl=null 时置灰；当前 tab 表单经 onSubmitStateChange 报 canSave 后高亮可点
 * 2. saving 中：文案「保存中」且禁用（canSaveNow = canSave && !saving）
 * 3. 点保存 → 调当前表单上报的 submit()
 * 4. 切 tab → 先清空 saveCtl（避免顶部键指向已卸载表单的 submit），保存键回置灰
 * 5. 快览事实卡：region / gender 派生展示
 *
 * mock 策略：
 * - useProfileEditor：提供固定 session + 空操作 handlers（隔离上传/裁剪/账号缓存等重依赖）
 * - components/profile 桶：表单 stub 捕获各自 onSubmitStateChange，供测试驱动上报
 * - utils/avatar：resolveServerAvatarUrl 直通（避开 Tauri secureProxy）
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

type SaveState = { canSave: boolean; saving: boolean; submit: () => void };

// 各 tab 表单 stub 捕获到的 onSubmitStateChange（= MobileProfilePage 的 setSaveCtl）
const reporters = vi.hoisted(() => ({
  info: undefined as ((s: SaveState) => void) | undefined,
  privacy: undefined as ((s: SaveState) => void) | undefined,
  password: undefined as ((s: SaveState) => void) | undefined,
}));

// 固定 session（profile 字段覆盖本页读取点：背景/地区/性别/注册时间/签名）
const editorState = vi.hoisted(() => ({
  session: {
    userId: 'u1',
    profile: {
      user_id: 'u1',
      user_nickname: '测试用户',
      user_email: null as string | null,
      user_signature: '在路上',
      user_avatar_url: null as string | null,
      background_url: null as string | null,
      region: '北京',
      gender: 'male' as string | null,
      admin: 'false',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '',
    },
  } as unknown,
}));

vi.mock('../../src/hooks/useProfileEditor', () => ({
  useProfileEditor: () => ({
    session: editorState.session,
    error: null,
    success: null,
    uploadingAvatar: false,
    uploadProgress: 0,
    updatingNickname: false,
    savingBackground: false,
    backgroundProgress: 0,
    backgroundNotice: null,
    clearBackgroundNotice: vi.fn(),
    handleAvatarSelect: vi.fn(),
    handleNicknameUpdate: vi.fn(),
    handleBackgroundSelect: vi.fn(),
    handleBackgroundReset: vi.fn(),
    handleSuccess: vi.fn(),
    handleError: vi.fn(),
    cropModal: null,
  }),
}));

vi.mock('../../src/components/profile', () => ({
  AvatarUploader: () => <div data-testid="avatar-uploader" />,
  ProfileCoverActions: () => <div data-testid="cover-actions" />,
  ProfileInfoForm: (p: { onSubmitStateChange?: (s: SaveState) => void }) => {
    reporters.info = p.onSubmitStateChange;
    return <div data-testid="form-info" />;
  },
  PrivacySettingsForm: (p: { onSubmitStateChange?: (s: SaveState) => void }) => {
    reporters.privacy = p.onSubmitStateChange;
    return <div data-testid="form-privacy" />;
  },
  PasswordForm: (p: { onSubmitStateChange?: (s: SaveState) => void }) => {
    reporters.password = p.onSubmitStateChange;
    return <div data-testid="form-password" />;
  },
}));

vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (u: string | null | undefined) => u ?? undefined,
}));

import { MobileProfilePage } from '../../src/pages/mobile/MobileProfilePage';

const saveBtn = () => screen.getByRole('button', { name: /保存/ });

describe('MobileProfilePage 顶部保存键接线', () => {
  beforeEach(() => {
    cleanup();
    reporters.info = undefined;
    reporters.privacy = undefined;
    reporters.password = undefined;
  });

  it('初始 saveCtl=null：保存键置灰禁用、文案「保存」', () => {
    render(<MobileProfilePage onClose={() => {}} />);
    const btn = saveBtn();
    expect(btn).toBeDisabled();
    expect(btn.textContent).toBe('保存');
    // 默认在「基本信息」tab，info 表单已挂载并上报过 setter
    expect(reporters.info).toBeTypeOf('function');
  });

  it('当前表单上报 canSave=true → 保存键高亮可点（is-active）', () => {
    render(<MobileProfilePage onClose={() => {}} />);
    act(() => { reporters.info!({ canSave: true, saving: false, submit: vi.fn() }); });
    const btn = saveBtn();
    expect(btn).toBeEnabled();
    expect(btn.className).toContain('is-active');
  });

  it('saving=true：canSaveNow=false → 禁用且文案「保存中」', () => {
    render(<MobileProfilePage onClose={() => {}} />);
    act(() => { reporters.info!({ canSave: true, saving: true, submit: vi.fn() }); });
    const btn = saveBtn();
    expect(btn).toBeDisabled();
    expect(btn.textContent).toBe('保存中');
  });

  it('点保存键 → 调当前表单上报的 submit()', () => {
    render(<MobileProfilePage onClose={() => {}} />);
    const submit = vi.fn();
    act(() => { reporters.info!({ canSave: true, saving: false, submit }); });
    fireEvent.click(saveBtn());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('切 tab 先清空 saveCtl：切到隐私后保存键回置灰（直到新表单重新上报）', () => {
    render(<MobileProfilePage onClose={() => {}} />);
    // 基本信息 tab 报可存 → 高亮
    act(() => { reporters.info!({ canSave: true, saving: false, submit: vi.fn() }); });
    expect(saveBtn()).toBeEnabled();

    // 切到「隐私设置」→ switchTab 清空 saveCtl → 置灰
    fireEvent.click(screen.getByRole('tab', { name: '隐私设置' }));
    expect(saveBtn()).toBeDisabled();

    // 隐私表单重新上报可存 → 再次高亮（验证清空后仍能被新表单接管）
    expect(reporters.privacy).toBeTypeOf('function');
    act(() => { reporters.privacy!({ canSave: true, saving: false, submit: vi.fn() }); });
    expect(saveBtn()).toBeEnabled();
  });

  it('快览事实卡展示 region / gender 派生值', () => {
    render(<MobileProfilePage onClose={() => {}} />);
    expect(screen.getByText('北京')).toBeInTheDocument();
    expect(screen.getByText('男')).toBeInTheDocument(); // gender=male → GENDER_LABELS
  });
});
