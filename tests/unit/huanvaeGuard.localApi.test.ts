/**
 * HuanvaeGuard localApi (src/huanvaeGuard/localApi.ts) 契约测试
 *
 * localApi 刻意保留 @tauri-apps/plugin-http（回环明文 http://127.0.0.1:19198，不走 secure_http）。
 * plugin-http 的 fetch 已在 tests/setup.ts 全局 mock 为 vi.fn()，此处经 vi.mocked(fetch)
 * 断言 fetch 的实参（URL / method / headers / body / signal）与 localFetch 的 JSON 解析降级行为。
 *
 * 验证：
 *   - getStatus：GET /api/tunnel/status（init 只含 AbortSignal），JSON 结果整体透传
 *   - localFetch 降级：resp.json() reject → 返回 {success:false, error:`HTTP ${status}`}
 *   - startTunnel：POST /api/tunnel/start，Content-Type + body JSON 与入参精确往返
 *   - stopTunnel：POST /api/tunnel/stop（除 signal 外无 headers / body）
 *   - 请求超时上限（末尾 describe，契约已实现）：localFetch 恒传 AbortSignal + LOCAL_TIMEOUT_MS 上限
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import {
  LOCAL_TIMEOUT_MS,
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
  it('GETs /api/tunnel/status with signal-only init and returns parsed json passthrough', async () => {
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
    expect(mockFetch.mock.calls[0][0]).toBe(`${LOCAL_BASE}/api/tunnel/status`);
    // init 不再是 undefined（localFetch 恒传超时用的 AbortSignal），但「GET 除此之外什么都不发」
    // 这条旧严格度必须保留 —— 由 keys 精确比对承接（多带一个 header/body 即 FAIL）
    const init = mockFetch.mock.calls[0][1] as { signal?: AbortSignal };
    expect(Object.keys(init)).toEqual(['signal']);
    expect(init.signal).toBeInstanceOf(AbortSignal);
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
    expect(mockFetch).toHaveBeenCalledWith(`${LOCAL_BASE}/api/tunnel/start`, expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }));
    const init = mockFetch.mock.calls[0][1] as { body: string; signal?: AbortSignal };
    // 多出来的字段只允许是超时用的 AbortSignal：旧断言是整对象精确比对，
    // 这里用 keys 精确比对 + signal 类型断言承接同等严格度
    expect(Object.keys(init).sort()).toEqual(['body', 'headers', 'method', 'signal']);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // body JSON 精确往返：解析后与入参对象完全一致
    expect(JSON.parse(init.body)).toEqual(params);
    expect(result).toEqual({ success: true });
  });
});

describe('localApi.stopTunnel', () => {
  it('POSTs /api/tunnel/stop with only {method:"POST"} + signal init', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResp({ success: true }));

    const result = await stopTunnel();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `${LOCAL_BASE}/api/tunnel/stop`,
      expect.objectContaining({ method: 'POST' }),
    );
    const init = mockFetch.mock.calls[0][1] as { signal?: AbortSignal };
    // 「只发 method、不带 headers / body」的旧严格度由 keys 精确比对承接
    expect(Object.keys(init).sort()).toEqual(['method', 'signal']);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({ success: true });
  });
});

/**
 * 回环请求的超时上限 —— 契约**已实现**（localApi.ts:34 LOCAL_TIMEOUT_MS + :36-53 localFetch）
 *
 * 历史动机（缺陷已修）：早先的 localFetch 是裸 `fetch(url, init)`，既不带 AbortSignal、也没有
 * 任何超时上限。守护进程处于"端口已 listen 但不回包"的半死态时（launchd KeepAlive 把 daemon
 * 拉起来了却卡在 utun 分配 / 服务线程死锁），TCP 连上了、HTTP 响应永不到达 —— localFetch 的
 * promise 永远不落地，于是 getStatus() 的每个调用方（页面的常驻探活、修复退避重试）都被永久
 * 挂住，界面停在上一次状态，且没有任何错误分支会被触发（catch 也等不到）。
 *
 * 现在 localFetch 用 AbortController 挂 LOCAL_TIMEOUT_MS（8s）的定时 abort（:41-42），并把
 * signal 透传给 plugin-http 的 fetch（:44）—— 是真取消，不是"只丢结果、请求还在后台跑"。
 * 这两条用例把这份契约钉成机器可复查的回归防线：init 里必须有 signal、永不回包时必须在上限内落地。
 */
describe('localApi 请求超时上限', () => {
  // 仅本 describe 用假时钟（其余 describe 走真实计时器，不受影响）
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('localFetch 必须给 fetch 传 AbortSignal（没有 signal 就无从中止永不落地的请求）', async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResp({ success: true, data: { active: false, peers: [] } }),
    );

    await getStatus();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0][1] as { signal?: unknown } | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('fetch 永不落地时，请求在超时上限后中止（不会永久挂住调用方）', async () => {
    // 半死态守护进程：连得上、永远不回包。唯一能终结它的只有 localFetch 自己挂的 abort
    mockFetch.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
          signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    // 用 spy 记录落地（而非局部变量：既避开 TS 字面量收窄，也顺带挂上 rejection handler）
    const onFulfilled = vi.fn();
    const onRejected = vi.fn();
    void getStatus().then(onFulfilled, onRejected);

    // 推进到超时上限（async 版才 flush microtask，同步版推不动 abort → reject 链）
    await vi.advanceTimersByTimeAsync(LOCAL_TIMEOUT_MS);
    await Promise.resolve();

    // 落地即可：reject 抛给调用方、或降级成 {success:false} 都算修好；
    // 不可接受的只有"一直挂着"这一种
    expect(onFulfilled.mock.calls.length + onRejected.mock.calls.length).toBe(1);
    // 且落地必须来自 abort 本身（不是 mock 恰好自己 resolve 了）
    const init = mockFetch.mock.calls[0][1] as { signal?: AbortSignal } | undefined;
    expect(init?.signal?.aborted).toBe(true);
  });
});
