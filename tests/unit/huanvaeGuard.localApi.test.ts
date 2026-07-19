/**
 * HuanvaeGuard localApi (src/huanvaeGuard/localApi.ts) 契约测试
 *
 * localApi 刻意保留 @tauri-apps/plugin-http（回环明文 http://127.0.0.1:19198，不走 secure_http）。
 * plugin-http 的 fetch 已在 tests/setup.ts 全局 mock 为 vi.fn()，此处经 vi.mocked(fetch)
 * 断言 fetch 的实参（URL / method / headers / body）与 localFetch 的 JSON 解析降级行为。
 *
 * 验证：
 *   - getStatus：GET /api/tunnel/status（init 为 undefined），JSON 结果整体透传
 *   - localFetch 降级：resp.json() reject → 返回 {success:false, error:`HTTP ${status}`}
 *   - checkServiceRunning：success:true → true / success:false → false / fetch reject → false
 *   - startTunnel：POST /api/tunnel/start，Content-Type + body JSON 与入参精确往返
 *   - stopTunnel：POST /api/tunnel/stop（无 headers / body）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import {
  checkServiceRunning,
  getStatus,
  startTunnel,
  stopTunnel,
} from '../../src/huanvaeGuard/localApi';
import type { PeerConfig, ObfuscationParams } from '../../src/huanvaeGuard/types';

const mockFetch = vi.mocked(fetch);

const LOCAL_BASE = 'http://127.0.0.1:19198';

/** 构造 plugin-http fetch 的最小 Response-like（localFetch 只消费 status + json()） */
function makeFetchResp(json: unknown, status = 200): Response {
  return { status, json: async () => json } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('localApi.getStatus', () => {
  it('GETs /api/tunnel/status with undefined init and returns parsed json passthrough', async () => {
    const payload = {
      success: true,
      data: {
        active: true,
        interface_name: 'utun6',
        address: '10.66.0.2/32',
        listen_port: 51820,
        peers: [],
      },
    };
    mockFetch.mockResolvedValueOnce(makeFetchResp(payload));

    const result = await getStatus();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(`${LOCAL_BASE}/api/tunnel/status`, undefined);
    expect(result).toEqual(payload);
  });

  it('falls back to {success:false, error:"HTTP {status}"} when resp.json() rejects', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);

    const result = await getStatus();

    expect(result).toEqual({ success: false, error: 'HTTP 502' });
  });
});

describe('localApi.checkServiceRunning', () => {
  it('returns true when svc responds success:true', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResp({ success: true, data: { active: false, peers: [] } }));

    await expect(checkServiceRunning()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(`${LOCAL_BASE}/api/tunnel/status`, undefined);
  });

  it('returns false when svc responds success:false', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResp({ success: false, error: 'no tunnel' }));

    await expect(checkServiceRunning()).resolves.toBe(false);
  });

  it('returns false when fetch rejects (service not listening)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused (os error 61)'));

    await expect(checkServiceRunning()).resolves.toBe(false);
  });
});

describe('localApi.startTunnel', () => {
  it('POSTs /api/tunnel/start with Content-Type header and exact JSON body roundtrip', async () => {
    const peers: PeerConfig[] = [
      {
        public_key: 'peer-pub-key',
        endpoint: '1.2.3.4:51820',
        allowed_ips: '0.0.0.0/0',
        persistent_keepalive: 25,
      },
    ];
    const obfuscation: ObfuscationParams = {
      h1: [1, 2],
      h2: [3, 4],
      h3: [5, 6],
      h4: [7, 8],
      s1: 10,
      s2: 20,
      s3: 30,
      s4: 40,
      jc: 4,
      jmin: 8,
      jmax: 80,
    };
    const params = {
      address: '10.66.0.2/32',
      private_key: 'client-priv-key',
      peers,
      obfuscation,
      dns: '1.1.1.1',
      mtu: 1280,
    };
    mockFetch.mockResolvedValueOnce(makeFetchResp({ success: true }));

    const result = await startTunnel(params);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(`${LOCAL_BASE}/api/tunnel/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    // body JSON 精确往返：解析后与入参对象完全一致
    const init = mockFetch.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body)).toEqual(params);
    expect(result).toEqual({ success: true });
  });
});

describe('localApi.stopTunnel', () => {
  it('POSTs /api/tunnel/stop with only {method:"POST"} init', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResp({ success: true }));

    const result = await stopTunnel();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(`${LOCAL_BASE}/api/tunnel/stop`, { method: 'POST' });
    expect(result).toEqual({ success: true });
  });
});
