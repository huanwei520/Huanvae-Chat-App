/**
 * RustWebSocket 单元测试
 *
 * RustWebSocket 模拟浏览器 WebSocket 接口,底层走 Rust(ws_proxy.rs)。
 * 这里 mock `@tauri-apps/api/core` 的 invoke + Channel:
 *   - invoke('ws_connect') 解析为 conn_id;ws_send_text/binary/close 为 spy
 *   - Channel mock 暴露 onmessage,测试用它模拟 Rust 经 Channel 推回的事件
 *
 * 验证:
 *   - opts(resolve)透传 ws_connect
 *   - onopen 必先于任何 message/close(open 前到达的帧缓冲后按序回放)
 *   - text → string data;binary(number[])→ ArrayBuffer data 且字节一致
 *   - close/error 事件 → onclose/onerror + readyState=CLOSED + 终态后不再派发
 *   - send 文本/二进制走对应命令;未 OPEN 时 send 被 guard
 *   - close() 走 ws_close;建连前 close() → 不触发 onopen 且回收连接
 *   - ws_connect 拒绝 → onerror + onclose(1006)
 *   - ping 事件 → 仅刷新 lastActivityAt,不派发 onmessage;text 等入站事件同样刷新
 *   - terminate(code) → 同步 onclose(code) + readyState=CLOSED + ws_close 清理;
 *     终态后事件忽略,重复 terminate 幂等(不重复派发)
 *   - localOpts.idleTimeoutSecs → ws_connect opts 携带 idle_timeout_secs;不传则无该键
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockChannel {
    onmessage: ((m: unknown) => void) | null = null;
  }
  return { invoke: vi.fn(), MockChannel };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  Channel: mocks.MockChannel,
}));

import { RustWebSocket } from '../../src/services/rustWebSocket';

/** 默认 invoke 行为:ws_connect → conn_id=1,其余 → resolve(undefined) */
function defaultInvoke(connId = 1) {
  mocks.invoke.mockImplementation((cmd: string) => {
    if (cmd === 'ws_connect') { return Promise.resolve(connId); }
    return Promise.resolve();
  });
}

/** 让 invoke 的 .then/.catch 链跑完(macrotask 在所有 microtask 之后) */
const tick = () => new Promise<void>((r) => { setTimeout(r, 0); });

/** 取第 i 次 invoke 调用的 [cmd, args] */
function callOf(i: number): [string, Record<string, unknown>] {
  return mocks.invoke.mock.calls[i] as [string, Record<string, unknown>];
}

/** 取 ws_connect 时传入的 Channel 实例(用于模拟 Rust 推事件) */
function channelOf(i = 0): { onmessage: ((m: unknown) => void) | null } {
  return (callOf(i)[1].onEvent) as { onmessage: ((m: unknown) => void) | null };
}

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe('RustWebSocket 建连', () => {
  it('direct_ip 改写 ws url 主机为 IP(不发SNI),opts 透传,resolve 后 onopen + readyState=OPEN', async () => {
    defaultInvoke(7);
    const resolve = { pin_ca: true, extra_ca_pem: 'CA', direct_ip: '47.105.101.42', direct_port: 443 };
    const ws = new RustWebSocket('wss://api.huanvae.cn/ws?token=x', resolve);

    const onopen = vi.fn();
    ws.onopen = onopen;
    expect(ws.readyState).toBe(RustWebSocket.CONNECTING);

    const [cmd, args] = callOf(0);
    expect(cmd).toBe('ws_connect');
    // 主机改写为 IP(443 省略),token 等 query 保留 —— IP 字面量 → ws_proxy 不发 SNI
    expect(args.url).toBe('wss://47.105.101.42/ws?token=x');
    expect(args.opts).toEqual(resolve);

    await tick();
    expect(onopen).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(RustWebSocket.OPEN);
  });

  it('无 direct_ip → url 不改写,opts 缺省传空对象', async () => {
    defaultInvoke();
    new RustWebSocket('wss://x/ws');
    expect(callOf(0)[1].url).toBe('wss://x/ws');
    expect(callOf(0)[1].opts).toEqual({});
    await tick();
  });
});

describe('RustWebSocket 事件顺序与派发', () => {
  it('open 前到达的事件先缓冲,onopen 后按序回放(open 必先于 message)', async () => {
    defaultInvoke();
    const ws = new RustWebSocket('wss://x/ws');
    const order: string[] = [];
    ws.onopen = () => order.push('open');
    ws.onmessage = (e) => order.push(`msg:${String(e.data)}`);

    // 在 ws_connect resolve 之前推入两条 text(模拟竞态:读循环先于命令返回)
    const ch = channelOf();
    ch.onmessage?.({ event: 'text', data: 'a' });
    ch.onmessage?.({ event: 'text', data: 'b' });
    expect(order).toEqual([]); // 尚未 open,全部缓冲

    await tick();
    expect(order).toEqual(['open', 'msg:a', 'msg:b']);
  });

  it('text 事件 → onmessage 收到 string', async () => {
    defaultInvoke();
    const ws = new RustWebSocket('wss://x/ws');
    const onmessage = vi.fn();
    ws.onmessage = onmessage;
    await tick();

    channelOf().onmessage?.({ event: 'text', data: '{"type":"ping"}' });
    expect(onmessage).toHaveBeenCalledWith({ data: '{"type":"ping"}' });
  });

  it('binary 事件(number[])→ onmessage 收到 ArrayBuffer 且字节一致', async () => {
    defaultInvoke();
    const ws = new RustWebSocket('wss://x/ws');
    let received: ArrayBuffer | null = null;
    ws.onmessage = (e) => { received = e.data as ArrayBuffer; };
    await tick();

    channelOf().onmessage?.({ event: 'binary', data: [1, 2, 255] });
    expect(received).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(received!))).toEqual([1, 2, 255]);
  });

  it('close 事件 → onclose(code) + readyState=CLOSED,终态后不再派发', async () => {
    defaultInvoke();
    const ws = new RustWebSocket('wss://x/ws');
    const onclose = vi.fn();
    const onmessage = vi.fn();
    ws.onclose = onclose;
    ws.onmessage = onmessage;
    await tick();

    const ch = channelOf();
    ch.onmessage?.({ event: 'close', code: 1000 });
    expect(onclose).toHaveBeenCalledWith({ code: 1000 });
    expect(ws.readyState).toBe(RustWebSocket.CLOSED);

    // 终态后再来事件 → 忽略
    ch.onmessage?.({ event: 'text', data: 'late' });
    expect(onmessage).not.toHaveBeenCalled();
  });

  it('error 事件 → onerror + onclose(1006) + readyState=CLOSED', async () => {
    defaultInvoke();
    const ws = new RustWebSocket('wss://x/ws');
    const onerror = vi.fn();
    const onclose = vi.fn();
    ws.onerror = onerror;
    ws.onclose = onclose;
    await tick();

    channelOf().onmessage?.({ event: 'error', message: '流读取失败' });
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(onerror.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onclose).toHaveBeenCalledWith({ code: 1006 });
    expect(ws.readyState).toBe(RustWebSocket.CLOSED);
  });
});

describe('RustWebSocket send', () => {
  it('OPEN 时 send(string) → ws_send_text(connId, data)', async () => {
    defaultInvoke(42);
    const ws = new RustWebSocket('wss://x/ws');
    await tick();
    mocks.invoke.mockClear();

    ws.send('{"type":"ping"}');
    expect(mocks.invoke).toHaveBeenCalledWith('ws_send_text', { connId: 42, data: '{"type":"ping"}' });
  });

  it('OPEN 时 send(ArrayBuffer) → ws_send_binary(connId, number[])', async () => {
    defaultInvoke(42);
    const ws = new RustWebSocket('wss://x/ws');
    await tick();
    mocks.invoke.mockClear();

    const buf = new Uint8Array([10, 20, 30]).buffer;
    ws.send(buf);
    expect(mocks.invoke).toHaveBeenCalledWith('ws_send_binary', { connId: 42, data: [10, 20, 30] });
  });

  it('send(Uint8Array view) 也正确取字节', async () => {
    defaultInvoke(42);
    const ws = new RustWebSocket('wss://x/ws');
    await tick();
    mocks.invoke.mockClear();

    ws.send(new Uint8Array([5, 6]));
    expect(mocks.invoke).toHaveBeenCalledWith('ws_send_binary', { connId: 42, data: [5, 6] });
  });

  it('未 OPEN(CONNECTING)时 send 被 guard,不发命令', () => {
    defaultInvoke();
    const ws = new RustWebSocket('wss://x/ws');
    mocks.invoke.mockClear(); // 清掉 ws_connect
    ws.send('too early');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe('RustWebSocket close', () => {
  it('OPEN 后 close(code, reason) → ws_close + readyState=CLOSING', async () => {
    defaultInvoke(9);
    const ws = new RustWebSocket('wss://x/ws');
    await tick();
    mocks.invoke.mockClear();

    ws.close(1000, 'Token refreshed');
    expect(mocks.invoke).toHaveBeenCalledWith('ws_close', { connId: 9, code: 1000, reason: 'Token refreshed' });
    expect(ws.readyState).toBe(RustWebSocket.CLOSING);
  });

  it('建连返回前 close() → 不触发 onopen,resolve 后回收连接', async () => {
    defaultInvoke(13);
    const ws = new RustWebSocket('wss://x/ws');
    const onopen = vi.fn();
    ws.onopen = onopen;

    ws.close(); // ws_connect 尚未 resolve
    await tick();

    expect(onopen).not.toHaveBeenCalled();
    expect(ws.readyState).toBe(RustWebSocket.CLOSED);
    // resolve 后用刚拿到的 conn_id 关闭
    expect(mocks.invoke).toHaveBeenCalledWith('ws_close', { connId: 13 });
  });
});

describe('RustWebSocket 建连失败', () => {
  it('ws_connect 拒绝 → onerror + onclose(1006) + readyState=CLOSED', async () => {
    mocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'ws_connect') { return Promise.reject(new Error('WS 握手失败')); }
      return Promise.resolve();
    });
    const ws = new RustWebSocket('wss://x/ws');
    const onerror = vi.fn();
    const onclose = vi.fn();
    ws.onerror = onerror;
    ws.onclose = onclose;

    await tick();
    expect(onerror).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledWith({ code: 1006 });
    expect(ws.readyState).toBe(RustWebSocket.CLOSED);
  });
});

describe('RustWebSocket 活性追踪与 terminate（半开看门狗支撑）', () => {
  it('ping 事件 → 刷新 lastActivityAt 且不派发 onmessage', async () => {
    defaultInvoke();
    const ws = new RustWebSocket('wss://x/ws');
    const onmessage = vi.fn();
    ws.onmessage = onmessage;
    await tick();

    ws.lastActivityAt = 0; // 人为置旧,便于观察刷新
    channelOf().onmessage?.({ event: 'ping' });
    expect(ws.lastActivityAt).toBeGreaterThan(0); // 已刷新为当前时刻
    expect(onmessage).not.toHaveBeenCalled(); // 协议 ping 不进业务 onmessage
  });

  it('text 事件同样刷新 lastActivityAt(且照常派发 onmessage)', async () => {
    defaultInvoke();
    const ws = new RustWebSocket('wss://x/ws');
    const onmessage = vi.fn();
    ws.onmessage = onmessage;
    await tick();

    ws.lastActivityAt = 0;
    channelOf().onmessage?.({ event: 'text', data: '{"type":"connected"}' });
    expect(ws.lastActivityAt).toBeGreaterThan(0);
    expect(onmessage).toHaveBeenCalledWith({ data: '{"type":"connected"}' });
  });

  it('terminate() → 同步 onclose(4008) + readyState=CLOSED + ws_close 清理;终态后事件忽略、重复调用幂等', async () => {
    defaultInvoke(21);
    const ws = new RustWebSocket('wss://x/ws');
    const onclose = vi.fn();
    const onmessage = vi.fn();
    ws.onclose = onclose;
    ws.onmessage = onmessage;
    await tick();
    const ch = channelOf(); // mockClear 前捕获 Channel(calls[0] 会被清)
    mocks.invoke.mockClear();

    ws.terminate();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(onclose).toHaveBeenCalledWith({ code: 4008 });
    expect(ws.readyState).toBe(RustWebSocket.CLOSED);
    expect(mocks.invoke).toHaveBeenCalledWith('ws_close', {
      connId: 21,
      code: 4008,
      reason: 'liveness timeout',
    });

    // 终态后 Channel 再推事件 → 全部忽略
    ch.onmessage?.({ event: 'text', data: 'late' });
    expect(onmessage).not.toHaveBeenCalled();

    // 幂等:重复 terminate 不重复派发 onclose
    ws.terminate();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(RustWebSocket.CLOSED);
  });

  it('terminate(自定义 code) → onclose 与 ws_close 均透传该 code', async () => {
    defaultInvoke(5);
    const ws = new RustWebSocket('wss://x/ws');
    const onclose = vi.fn();
    ws.onclose = onclose;
    await tick();
    mocks.invoke.mockClear();

    ws.terminate(4999);
    expect(onclose).toHaveBeenCalledWith({ code: 4999 });
    expect(mocks.invoke).toHaveBeenCalledWith('ws_close', {
      connId: 5,
      code: 4999,
      reason: 'liveness timeout',
    });
  });

  it('localOpts.idleTimeoutSecs → ws_connect opts 携带 idle_timeout_secs', async () => {
    defaultInvoke();
    new RustWebSocket('wss://x/ws', { pin_ca: true }, { idleTimeoutSecs: 90 });
    expect(callOf(0)[0]).toBe('ws_connect');
    expect(callOf(0)[1].opts).toEqual({ pin_ca: true, idle_timeout_secs: 90 });
    await tick();
  });

  it('不传 localOpts → opts 不含 idle_timeout_secs 键', async () => {
    defaultInvoke();
    new RustWebSocket('wss://x/ws', { pin_ca: true });
    const opts = callOf(0)[1].opts as Record<string, unknown>;
    expect(opts).toEqual({ pin_ca: true });
    expect(Object.prototype.hasOwnProperty.call(opts, 'idle_timeout_secs')).toBe(false);
    await tick();
  });
});
