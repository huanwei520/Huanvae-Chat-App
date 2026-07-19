/**
 * 个人资料 API 封装单元测试（src/api/profile.ts）
 *
 * 用假 ApiClient（get/post/put/delete/patch 为 vi.fn）验证：
 *   - getProfile / getPublicProfile / updateProfile / changePassword / resetBackground：
 *     正确 path/method/body + 返回透传 + 异常向上抛（薄封装不 try/catch 不兜底）；
 *   - getPublicProfile：userId 含特殊字符时 encodeURIComponent 编码进 URL；
 *   - uploadAvatar：mock uploadWithProgress，断言调用参数（URL 拼接 / 字段名 'avatar' /
 *     进度回调透传）与返回值透传。
 * （uploadBackground 已在 tests/api/uploadBackground.test.ts 覆盖，此处不重复。）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';

const uploadMock = vi.hoisted(() => ({
  uploadWithProgress: vi.fn(),
}));
vi.mock('../../src/api/upload', () => uploadMock);

import * as profile from '../../src/api/profile';

function makeApi() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    getBaseUrl: vi.fn(),
    getAccessToken: vi.fn(),
    refreshAccessToken: vi.fn(),
  } as unknown as ApiClient & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

describe('个人资料 API 封装 (api/profile)', () => {
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
    uploadMock.uploadWithProgress.mockReset();
  });

  // ---- getProfile ----

  it('getProfile 正常：GET /api/profile 并原样返回响应', async () => {
    const resp = { user_id: 'u1', user_nickname: '我', allow_search: true };
    api.get.mockResolvedValue(resp);
    const out = await profile.getProfile(api);
    expect(api.get).toHaveBeenCalledWith('/api/profile');
    expect(out).toEqual(resp);
  });

  it('getProfile 异常：api.get 抛错时向上抛', async () => {
    api.get.mockRejectedValue(new Error('profile-fail'));
    await expect(profile.getProfile(api)).rejects.toThrow('profile-fail');
  });

  // ---- getPublicProfile ----

  it('getPublicProfile 正常：GET /api/profile/{userId}/public', async () => {
    const resp = { user_id: 'u2', user_nickname: '对方' };
    api.get.mockResolvedValue(resp);
    const out = await profile.getPublicProfile(api, 'u2');
    expect(api.get).toHaveBeenCalledWith('/api/profile/u2/public');
    expect(out).toEqual(resp);
  });

  it('getPublicProfile 特殊字符：userId 经 encodeURIComponent 编码进 URL', async () => {
    api.get.mockResolvedValue({ user_id: 'user/1@x' });
    await profile.getPublicProfile(api, 'user/1@x');
    expect(api.get).toHaveBeenCalledWith('/api/profile/user%2F1%40x/public');
  });

  it('getPublicProfile 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('public-fail'));
    await expect(profile.getPublicProfile(api, 'u2')).rejects.toThrow('public-fail');
  });

  // ---- updateProfile ----

  it('updateProfile 正常：PUT /api/profile，data 原样进 body', async () => {
    api.put.mockResolvedValue({ message: 'ok' });
    const data = {
      nickname: '新昵称',
      signature: '签名',
      allow_search: false,
      gender: 'female' as const,
      birthday: '2000-01-01',
      region: '上海',
    };
    const out = await profile.updateProfile(api, data);
    expect(api.put).toHaveBeenCalledWith('/api/profile', {
      nickname: '新昵称',
      signature: '签名',
      allow_search: false,
      gender: 'female',
      birthday: '2000-01-01',
      region: '上海',
    });
    expect(out).toEqual({ message: 'ok' });
  });

  it('updateProfile 异常：api.put 抛错时向上抛', async () => {
    api.put.mockRejectedValue(new Error('update-fail'));
    await expect(profile.updateProfile(api, { nickname: 'x' })).rejects.toThrow('update-fail');
  });

  // ---- changePassword ----

  it('changePassword 正常：PUT /api/profile/password 带 old/new_password', async () => {
    api.put.mockResolvedValue({ message: 'changed' });
    const out = await profile.changePassword(api, {
      old_password: 'old-pw',
      new_password: 'new-pw',
    });
    expect(api.put).toHaveBeenCalledWith('/api/profile/password', {
      old_password: 'old-pw',
      new_password: 'new-pw',
    });
    expect(out).toEqual({ message: 'changed' });
  });

  it('changePassword 异常：向上抛', async () => {
    api.put.mockRejectedValue(new Error('pw-fail'));
    await expect(
      profile.changePassword(api, { old_password: 'a', new_password: 'b' }),
    ).rejects.toThrow('pw-fail');
  });

  // ---- resetBackground ----

  it('resetBackground 正常：DELETE /api/profile/background 并原样返回响应', async () => {
    const resp = { background_url: '', message: 'reset' };
    api.delete.mockResolvedValue(resp);
    const out = await profile.resetBackground(api);
    expect(api.delete).toHaveBeenCalledWith('/api/profile/background');
    expect(out).toEqual(resp);
  });

  it('resetBackground 异常：向上抛', async () => {
    api.delete.mockRejectedValue(new Error('reset-fail'));
    await expect(profile.resetBackground(api)).rejects.toThrow('reset-fail');
  });

  // ---- uploadAvatar（经 mock 的 uploadWithProgress）----

  it('uploadAvatar 正常：拼 URL + 字段名 avatar + 透传进度回调与返回值', async () => {
    const resp = { avatar_url: '/avatars/u1.png', message: 'ok' };
    uploadMock.uploadWithProgress.mockResolvedValue(resp);
    const file = new File(['png-bytes'], 'me.png', { type: 'image/png' });
    const onProgress = vi.fn();
    const out = await profile.uploadAvatar('https://api.example.com', 'tok-1', file, onProgress);
    expect(uploadMock.uploadWithProgress).toHaveBeenCalledWith(
      'https://api.example.com/api/profile/avatar',
      'tok-1',
      file,
      'avatar',
      onProgress,
    );
    expect(out).toEqual(resp);
  });

  it('uploadAvatar 缺省进度回调：第 5 参为 undefined', async () => {
    uploadMock.uploadWithProgress.mockResolvedValue({ avatar_url: '/a.png', message: 'ok' });
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await profile.uploadAvatar('https://api.example.com', 'tok-1', file);
    expect(uploadMock.uploadWithProgress).toHaveBeenCalledWith(
      'https://api.example.com/api/profile/avatar',
      'tok-1',
      file,
      'avatar',
      undefined,
    );
  });

  it('uploadAvatar 异常：uploadWithProgress 抛错时向上抛', async () => {
    uploadMock.uploadWithProgress.mockRejectedValue(new Error('upload-fail'));
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await expect(
      profile.uploadAvatar('https://api.example.com', 'tok-1', file),
    ).rejects.toThrow('upload-fail');
  });
});
