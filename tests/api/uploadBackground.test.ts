/**
 * uploadBackground 解包回归测试
 *
 * 背景（2026-07-10 真机 DevTools Network 定位）：后端 POST /api/profile/background 返回
 * 完整 ApiResponse 包裹 `{ success, code, data: { background_url, message } }`；而
 * uploadWithProgress 走裸 XHR、绕过 ApiClient 的自动解包，拿到的是**包裹层**。
 * 旧实现直接把包裹层当 BackgroundResponse 返回 → 调用方读 `res.background_url` 得 undefined
 * → setSession(background_url: undefined) → 上传成功后封面却回退默认 + hasBackground=false。
 *
 * 本测试锚定修复：uploadBackground 必须解包 data，返回扁平 { background_url, message }。
 * 若回退到"不解包"，background_url 断言从有值翻 undefined → 测试 FAIL（非恒真）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// proxyRequestUrl 依赖 Tauri，测试里直通即可
vi.mock('../../src/services/secureProxy', () => ({
  proxyRequestUrl: (url: string) => url,
}));

import { uploadBackground } from '../../src/api/profile';

const WRAPPED_BODY = {
  success: true,
  code: 200,
  data: { background_url: 'avatars/background/test.jpg?t=1783624102', message: '背景图上传成功' },
  message: 'ok',
};

// 裸 XHR 替身：send() 时同步回放一个 200 + 完整 ApiResponse 包裹体
class FakeXHR {
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 0;
  responseText = '';
  open() { /* noop */ }
  setRequestHeader() { /* noop */ }
  send() {
    this.status = 200;
    this.responseText = JSON.stringify(WRAPPED_BODY);
    this.onload?.();
  }
}

describe('uploadBackground 解包 ApiResponse.data', () => {
  const OriginalXHR = globalThis.XMLHttpRequest;

  beforeEach(() => {
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
  });
  afterEach(() => {
    globalThis.XMLHttpRequest = OriginalXHR;
  });

  it('返回扁平 { background_url, message }（已从 data 解包），而非包裹层', async () => {
    const file = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    const res = await uploadBackground('https://api.example.cn', 'tok', file);

    // 解包后：直接拿到 background_url（旧 bug 下此处为 undefined）
    expect(res.background_url).toBe('avatars/background/test.jpg?t=1783624102');
    expect(res.message).toBe('背景图上传成功');

    // 且不应把包裹字段透出（证明确实解了包，不是恰好透传）
    expect((res as unknown as Record<string, unknown>).success).toBeUndefined();
    expect((res as unknown as Record<string, unknown>).data).toBeUndefined();
  });
});
