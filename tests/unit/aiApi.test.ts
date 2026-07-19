/**
 * AI 助手 API 封装单元测试（src/api/ai.ts，非流式的 11 个函数）
 *
 * 用假 ApiClient（get/post/put/delete 为 vi.fn）验证每个函数：
 *   - 正常：以正确 path/query/body 调用对应方法，并返回解包后的数据；
 *   - 异常：api 抛错时函数原样向上抛（薄封装不 try/catch 不兜底）。
 * createVoiceProfile 走 globalThis.fetch（FormData 直传，经 proxyRequestUrl；
 * 测试环境反代端口未初始化为 0 → URL 原样透传），单独 stub fetch 验证。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';

// ai.ts 顶层 import discovery（其内部又拉 plugin-store），与 apiClient.test.ts 同款 mock 掉
vi.mock('../../src/services/discovery', () => ({ resolveForSecureHttp: () => null }));

import * as ai from '../../src/api/ai';

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
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    getBaseUrl: ReturnType<typeof vi.fn>;
    getAccessToken: ReturnType<typeof vi.fn>;
  };
}

describe('AI API 封装 (api/ai 非流式)', () => {
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
  });

  // ---- 会话管理 ----

  it('getAIConversations 无 options：无 query，返回解包数据', async () => {
    api.get.mockResolvedValue({ conversations: [], total: 0 });
    const out = await ai.getAIConversations(api);
    expect(api.get).toHaveBeenCalledWith('/api/ai/conversations');
    expect(out).toEqual({ conversations: [], total: 0 });
  });

  it('getAIConversations 带分页：拼 page + per_page', async () => {
    api.get.mockResolvedValue({ conversations: [] });
    await ai.getAIConversations(api, { page: 2, perPage: 50 });
    expect(api.get).toHaveBeenCalledWith('/api/ai/conversations?page=2&per_page=50');
  });

  it('getAIConversations 异常：api.get 抛错时向上抛', async () => {
    api.get.mockRejectedValue(new Error('conv-fail'));
    await expect(ai.getAIConversations(api)).rejects.toThrow('conv-fail');
  });

  it('getAIConversation 正常：path 含会话 id，返回详情', async () => {
    api.get.mockResolvedValue({ conversation: { conversation_id: 'c1' }, messages: [] });
    const out = await ai.getAIConversation(api, 'c1');
    expect(api.get).toHaveBeenCalledWith('/api/ai/conversations/c1');
    expect(out).toEqual({ conversation: { conversation_id: 'c1' }, messages: [] });
  });

  it('deleteAIConversation 正常：api.delete 带会话 id', async () => {
    api.delete.mockResolvedValue(undefined);
    await expect(ai.deleteAIConversation(api, 'c1')).resolves.toBeUndefined();
    expect(api.delete).toHaveBeenCalledWith('/api/ai/conversations/c1');
  });

  it('getAIMessages 无 options：无 query', async () => {
    api.get.mockResolvedValue([]);
    const out = await ai.getAIMessages(api, 'c1');
    expect(api.get).toHaveBeenCalledWith('/api/ai/conversations/c1/messages');
    expect(out).toEqual([]);
  });

  it('getAIMessages 带 limit/before：拼 query', async () => {
    api.get.mockResolvedValue([]);
    await ai.getAIMessages(api, 'c1', { limit: 20, before: 'm1' });
    expect(api.get).toHaveBeenCalledWith('/api/ai/conversations/c1/messages?limit=20&before=m1');
  });

  // ---- 工具调用确认 ----

  it('confirmToolCall 正常：POST confirm，返回执行结果', async () => {
    const result = { pending_id: 'p1', tool_name: 'send_msg', success: true, result: { ok: 1 } };
    api.post.mockResolvedValue(result);
    const out = await ai.confirmToolCall(api, 'p1');
    expect(api.post).toHaveBeenCalledWith('/api/ai/tool_calls/p1/confirm');
    expect(out).toEqual(result);
  });

  it('rejectToolCall 正常：POST reject，resolve void', async () => {
    api.post.mockResolvedValue(undefined);
    await expect(ai.rejectToolCall(api, 'p2')).resolves.toBeUndefined();
    expect(api.post).toHaveBeenCalledWith('/api/ai/tool_calls/p2/reject');
  });

  // ---- 声音配置 ----

  it('getVoiceProfiles 正常：返回列表', async () => {
    const profiles = [{ profile_id: 'vp-1', voice_name: 'v', speaker_id: 's', system_prompt: null, is_default: true, created_at: '2026-07-01T00:00:00Z' }];
    api.get.mockResolvedValue(profiles);
    const out = await ai.getVoiceProfiles(api);
    expect(api.get).toHaveBeenCalledWith('/api/ai/voice_profiles');
    expect(out).toEqual(profiles);
  });

  it('setDefaultVoiceProfile 正常：PUT default', async () => {
    api.put.mockResolvedValue(undefined);
    await ai.setDefaultVoiceProfile(api, 'vp-1');
    expect(api.put).toHaveBeenCalledWith('/api/ai/voice_profiles/vp-1/default');
  });

  it('deleteVoiceProfile 正常：DELETE 带 profile id', async () => {
    api.delete.mockResolvedValue(undefined);
    await ai.deleteVoiceProfile(api, 'vp-1');
    expect(api.delete).toHaveBeenCalledWith('/api/ai/voice_profiles/vp-1');
  });

  it('updateVoiceProfilePrompt 正常：PUT prompt 带 system_prompt 字符串', async () => {
    api.put.mockResolvedValue(undefined);
    await ai.updateVoiceProfilePrompt(api, 'vp-1', 'x');
    expect(api.put).toHaveBeenCalledWith('/api/ai/voice_profiles/vp-1/prompt', { system_prompt: 'x' });
  });

  it('updateVoiceProfilePrompt 清空：null 原样入 body', async () => {
    api.put.mockResolvedValue(undefined);
    await ai.updateVoiceProfilePrompt(api, 'vp-1', null);
    expect(api.put).toHaveBeenCalledWith('/api/ai/voice_profiles/vp-1/prompt', { system_prompt: null });
  });

  // ---- createVoiceProfile：globalThis.fetch + FormData 直传 ----

  describe('createVoiceProfile (globalThis.fetch 直传)', () => {
    const originalFetch = globalThis.fetch;
    let consoleSpies: Array<{ mockRestore: () => void }> = [];

    beforeEach(() => {
      // SUT 内有 console.warn/error 埋点日志，静音避免测试输出噪音
      consoleSpies = [
        vi.spyOn(console, 'warn').mockImplementation(() => {}),
        vi.spyOn(console, 'error').mockImplementation(() => {}),
      ];
      api.getBaseUrl.mockReturnValue('https://api.example.com');
      api.getAccessToken.mockReturnValue('tok');
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      for (const s of consoleSpies) { s.mockRestore(); }
    });

    function fakeResponse(opts: { ok: boolean; status: number; jsonBody?: unknown; textBody?: string }) {
      return {
        ok: opts.ok,
        status: opts.status,
        statusText: '',
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(opts.jsonBody),
        text: () => Promise.resolve(opts.textBody ?? ''),
      } as unknown as Response;
    }

    it('成功（不传 system_prompt）：URL/方法/鉴权头/FormData 正确，system_prompt 缺席，返回解析 json', async () => {
      const profile = { profile_id: 'vp-9', voice_name: 'my-voice', speaker_id: 'spk', system_prompt: null, is_default: false, created_at: '2026-07-01T00:00:00Z' };
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ ok: true, status: 200, jsonBody: profile }));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const blob = new Blob(['fake-wav-bytes'], { type: 'audio/wav' });
      const out = await ai.createVoiceProfile(api, 'my-voice', blob, 'sample.wav');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      // 反代端口未初始化（0）→ proxyRequestUrl 原样透传
      expect(url).toBe('https://api.example.com/api/ai/voice_profiles');
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ Authorization: 'Bearer tok' });

      const body = init.body as FormData;
      expect(body.get('voice_name')).toBe('my-voice');
      const audio = body.get('audio') as File;
      expect(audio).toBeInstanceOf(File);
      expect(audio.name).toBe('sample.wav');
      expect(audio.type).toBe('audio/wav');
      // 未传 system_prompt → FormData 中不得出现该字段
      expect(body.get('system_prompt')).toBeNull();

      expect(out).toEqual(profile);
    });

    it('成功（传 system_prompt）：FormData 含 system_prompt', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ ok: true, status: 200, jsonBody: { profile_id: 'vp-9' } }));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const blob = new Blob(['fake-wav-bytes'], { type: 'audio/wav' });
      await ai.createVoiceProfile(api, 'my-voice', blob, 'sample.wav', '温柔一点');

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.body as FormData).get('system_prompt')).toBe('温柔一点');
    });

    it('失败（JSON 错误体）：抛后端 message', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        fakeResponse({ ok: false, status: 402, textBody: '{"message":"配额不足"}' }),
      );
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const blob = new Blob(['x'], { type: 'audio/wav' });
      await expect(ai.createVoiceProfile(api, 'v', blob, 'a.wav')).rejects.toThrow('配额不足');
    });

    it('失败（非 JSON 错误体）：抛含状态码的默认错误', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        fakeResponse({ ok: false, status: 500, textBody: 'oops not json' }),
      );
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const blob = new Blob(['x'], { type: 'audio/wav' });
      await expect(ai.createVoiceProfile(api, 'v', blob, 'a.wav')).rejects.toThrow('上传失败 (500)');
    });
  });
});
