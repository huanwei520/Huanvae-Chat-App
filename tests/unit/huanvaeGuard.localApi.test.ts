/**
 * HuanvaeGuard localApi (src/huanvaeGuard/localApi.ts) 契约测试
 *
 * localApi 刻意保留 @tauri-apps/plugin-http（回环明文 http://127.0.0.1:<控制端口>，不走 secure_http）。
 * plugin-http 的 fetch 已在 tests/setup.ts 全局 mock 为 vi.fn()，此处经 vi.mocked(fetch)
 * 断言 fetch 的实参（URL / method / headers / body / signal）与 localFetch 的 JSON 解析降级行为。
 * 控制端口不写死：localFetch 每次请求都经 invoke('hg_local_control_port') 解析（默认 19198），
 * invoke 同样已在 tests/setup.ts 全局 mock。
 *
 * 验证：
 *   - getStatus：GET /api/tunnel/status（init 只含 AbortSignal），JSON 结果整体透传
 *   - localFetch 降级：resp.json() reject → 返回 {success:false, error:`HTTP ${status}`}
 *   - startTunnel：POST /api/tunnel/start，Content-Type + body JSON 与入参精确往返
 *   - stopTunnel：POST /api/tunnel/stop（除 signal 外无 headers / body）
 *   - 本地控制端口解析（倒数第二个 describe）：用解析出的端口发请求 / 查询失败或值不可用时
 *     回落默认端口 / **不缓存**基址
 *   - 请求超时上限（末尾 describe，契约已实现）：localFetch 恒传 AbortSignal + LOCAL_TIMEOUT_MS 上限
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import {
  LOCAL_TIMEOUT_MS,
  getStatus,
  startTunnel,
  stopTunnel,
} from '../../src/huanvaeGuard/localApi';
import type { PeerConfig, ObfuscationParams } from '../../src/huanvaeGuard/types';

const mockFetch = vi.mocked(fetch);
const mockInvoke = vi.mocked(invoke);

/** 端口解析失败 / 值不可用时 localApi 回落到的默认基址 */
const LOCAL_BASE = 'http://127.0.0.1:19198';

/** 构造 plugin-http fetch 的最小 Response-like（localFetch 只消费 status + json()） */
function makeFetchResp(json: unknown, status = 200): Response {
  return { status, json: async () => json } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  // invoke 复位后**保持未配置**（bare vi.fn 返回 undefined，不是可用端口号）——
  // 即下面没有显式设置 invoke 的用例，走的都是端口解析的**回落路径**，URL 落在
  // LOCAL_BASE(19198) 是回落的结果，不是"碰巧撞上默认值"。
  mockInvoke.mockReset();
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
 * 本地控制端口解析 —— 契约**已实现**（localApi.ts 的 DEFAULT_LOCAL_PORT / resolveLocalBase）
 *
 * 历史动机（缺陷已修）：基址原本是模块常量 `http://127.0.0.1:19198` 写死的。同一台机器上
 * 可以并存多路守护进程实例，各自监听不同的回环端口 —— 别的实例先占住 19198 时，App 就会
 * 去连**别人家**的守护进程，把对方的隧道当成自己的显示出来（而且看不出任何异常）。
 * 现在端口由 Rust 侧 `hg_local_control_port` 给出，localFetch 逐次解析后再拼 URL。
 */
describe('localApi 本地控制端口解析', () => {
  it('按 hg_local_control_port 解析出的端口发 GET 请求（而非写死的 19198）', async () => {
    mockInvoke.mockResolvedValueOnce(19203);
    mockFetch.mockResolvedValueOnce(
      makeFetchResp({ success: true, data: { active: false, peers: [] } }),
    );

    await getStatus();

    // 命令名是与 Rust 侧的契约，写错就永远拿不到端口（且会静默回落到默认端口）
    expect(mockInvoke).toHaveBeenCalledWith('hg_local_control_port');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:19203/api/tunnel/status');
  });

  it('POST 路径同样用解析出的端口（不是只改了 GET）', async () => {
    mockInvoke.mockResolvedValueOnce(19205);
    mockFetch.mockResolvedValueOnce(makeFetchResp({ success: true }));

    const result = await stopTunnel();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:19205/api/tunnel/stop');
    const init = mockFetch.mock.calls[0][1] as { method?: string };
    expect(init.method).toBe('POST');
    expect(result).toEqual({ success: true });
  });

  it('端口查询抛错时回落到默认端口，且请求照常拿到解析后的响应体', async () => {
    // 端口查不到不该把请求一起带塌：默认端口正是全新安装绑的那个，照它发才是正确答案
    mockInvoke.mockRejectedValueOnce(new Error('command hg_local_control_port not found'));
    const payload = {
      success: true,
      data: { active: true, interface_name: 'utun6', peers: [] },
    };
    mockFetch.mockResolvedValueOnce(makeFetchResp(payload));

    const result = await getStatus();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(`${LOCAL_BASE}/api/tunnel/status`);
    expect(result).toEqual(payload);
  });

  it('端口值不可用（0 不是合法端口）时回落到默认端口', async () => {
    mockInvoke.mockResolvedValueOnce(0);
    mockFetch.mockResolvedValueOnce(makeFetchResp({ success: true }));

    await getStatus();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    // 若直接把 0 拼进 URL，这里会是 http://127.0.0.1:0/... —— 一个连不上的地址
    expect(mockFetch.mock.calls[0][0]).toBe(`${LOCAL_BASE}/api/tunnel/status`);
  });

  it('不缓存基址：端口在两次调用之间变了，第二次请求就打到新端口', async () => {
    // "刻意不缓存"这条决定的回归防线 —— 修复 / 重装可能把守护进程落到另一个端口上，
    // 一旦有人加了模块级缓存，第二次 URL 会仍停在 19198，本用例即 FAIL。
    mockInvoke.mockResolvedValueOnce(19198).mockResolvedValueOnce(19204);
    mockFetch
      .mockResolvedValueOnce(makeFetchResp({ success: true }))
      .mockResolvedValueOnce(makeFetchResp({ success: true }));

    await getStatus();
    await getStatus();

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:19198/api/tunnel/status');
    expect(mockFetch.mock.calls[1][0]).toBe('http://127.0.0.1:19204/api/tunnel/status');
  });
});

/**
 * 回环请求的超时上限 —— 契约**已实现**（localApi.ts 的 LOCAL_TIMEOUT_MS + localFetch）
 *
 * 历史动机（缺陷已修）：早先的 localFetch 是裸 `fetch(url, init)`，既不带 AbortSignal、也没有
 * 任何超时上限。守护进程处于"端口已 listen 但不回包"的半死态时（launchd KeepAlive 把 daemon
 * 拉起来了却卡在 utun 分配 / 服务线程死锁），TCP 连上了、HTTP 响应永不到达 —— localFetch 的
 * promise 永远不落地，于是 getStatus() 的每个调用方（页面的常驻探活、修复退避重试）都被永久
 * 挂住，界面停在上一次状态，且没有任何错误分支会被触发（catch 也等不到）。
 *
 * 现在 localFetch 用 AbortController 挂 LOCAL_TIMEOUT_MS（8s）的定时 abort，并把
 * signal 透传给 plugin-http 的 fetch —— 是真取消，不是"只丢结果、请求还在后台跑"。
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
