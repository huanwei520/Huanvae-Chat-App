/**
 * daemonCredentialSync（src/huanvaeGuard/daemonCredentialSync.ts）契约测试
 *
 * 主窗口侧 guard 凭据静默同步（401 自愈链 gtcy072z 的主窗口半边）：
 *  - shouldSyncToDaemon：门控纯函数（桌面轨 + 非空 access token）
 *  - syncToDaemon：localApi.updateControlCredentials 的 fire-and-forget 包装，
 *    404 单独分类为 endpointMissing（守护进程早于凭据推送端点发布的唯一可观测信号）
 *
 * plugin-http fetch / tauri invoke 已在 tests/setup.ts 全局 mock（与
 * huanvaeGuard.localApi.test.ts 同一套底层），这里经 vi.mocked(fetch) 驱动。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import {
  shouldSyncToDaemon,
  syncToDaemon,
} from '../../src/huanvaeGuard/daemonCredentialSync';

const mockFetch = vi.mocked(fetch);

/** 构造 plugin-http fetch 的最小 Response-like（localFetch 只消费 status + json()） */
function makeFetchResp(json: unknown, status = 200): Response {
  return { status, json: async () => json } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(invoke).mockReset();
});

describe('shouldSyncToDaemon — 主窗口推送门控', () => {
  it('桌面轨 + 非空令牌：推', () => {
    expect(shouldSyncToDaemon('TOKEN-A', false)).toBe(true);
  });

  it('移动轨：一律不推（安卓/iOS 会话走插件会话文件，无本地 HTTP 控制面）', () => {
    expect(shouldSyncToDaemon('TOKEN-A', true)).toBe(false);
  });

  it('空 access token：不推', () => {
    expect(shouldSyncToDaemon('', false)).toBe(false);
  });
});

describe('syncToDaemon — 推送结果分类', () => {
  it('守护进程 200 success：ok=true', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResp({ success: true }));
    const r = await syncToDaemon('TOKEN-OK', 'REFRESH-OK');
    expect(r).toEqual({ ok: true, endpointMissing: false });
    // 线格式：POST /api/tunnel/credentials，refresh_token 键存在
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/tunnel/credentials');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      access_token: 'TOKEN-OK',
      refresh_token: 'REFRESH-OK',
    });
  });

  it('404（守护进程早于凭据推送端点）：ok=false 且 endpointMissing=true', async () => {
    // localFetch 对非 JSON 响应体降级为 {success:false, error:'HTTP 404'}
    mockFetch.mockResolvedValueOnce(
      makeFetchResp({ success: false, error: 'HTTP 404' }, 404),
    );
    const r = await syncToDaemon('TOKEN-X');
    expect(r.ok).toBe(false);
    expect(r.endpointMissing).toBe(true);
  });

  it('其他错误（如无活跃控制面）：ok=false 且 endpointMissing=false', async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResp({ success: false, error: 'no active control plane' }),
    );
    const r = await syncToDaemon('TOKEN-Y');
    expect(r.ok).toBe(false);
    expect(r.endpointMissing).toBe(false);
    expect(r.error).toBe('no active control plane');
  });

  it('传输异常（连接拒绝等）：不抛出，归为 ok=false', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection refused'));
    const r = await syncToDaemon('TOKEN-Z');
    expect(r.ok).toBe(false);
    expect(r.endpointMissing).toBe(false);
    expect(r.error).toContain('connection refused');
  });

  it('空串 refresh_token 归一化为键不存在（与 localApi 闸门同一规则）', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResp({ success: true }));
    await syncToDaemon('TOKEN-W', '');
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ access_token: 'TOKEN-W' });
    expect('refresh_token' in body).toBe(false);
  });
});
