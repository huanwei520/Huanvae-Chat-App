/**
 * 远控独立控制窗输入路由与桥接帧计数单测（块 1790709813552-pz3oo1tp-1）
 *
 * 锁 owner 2026-09-30「共享全屏后控制零反应（帧 0 · 注入 0）」的三处整改：
 * 1. 修复①输入路由：桌面独立控制窗上下文（无 DC 属主 + Tauri 宿主）的
 *    controlInput 必须走 rc-input-up 桥（sendInput 的 !dcOwner 臂），
 *    **不得**误落 postLocalInput 把跨端输入 POST 到控制端本机 daemon
 *    （旧根因：本窗 channels 属 meeting 窗，isPeerSessionActive() 恒 false）；
 * 2. DC 属主上下文行为不回归：会话在位时仍直发 DC（sendBinary），不走桥；
 * 3. 修复②桥接帧计数：独立控制窗经 RC_FRAME_DATA 桥接收帧必须 framesIn+=1
 *    （与 DC 直连重组路径 ingestSlice 同口径；旧根因：桥接交付不入账 ⇒ 恒「帧 0」）。
 * 另锁滚轮位编码（bit3 上/bit4 下，既有 buttons 域空闲位，非新协议域）。
 *
 * @module tests/unit/rcStandaloneInputRouting
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

/** 捕获的 Tauri listen handler（[事件名, callback]） */
type ListenCb = (e: unknown) => void;
const listenCbs = vi.hoisted(() => new Map<string, ListenCb>());

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: vi.fn(async (ev: string, cb: ListenCb) => {
    listenCbs.set(ev, cb);
    return () => undefined;
  }),
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: fetchMock,
}));

/** 每测试独立模块态（frameChannel 的 dcOwner/channels/stats 是模块单例） */
async function freshModules() {
  vi.resetModules();
  listenCbs.clear();
  const fc = await import('../../src/remote-control/frameChannel');
  const api = await import('../../src/remote-control/api');
  const coord = await import('../../src/remote-control/coordinates');
  return { fc, api, coord };
}

/** jsdom 无 RTCDataChannel —— 最小假件 */
function fakeDc(): RTCDataChannel {
  return {
    readyState: 'open',
    bufferedAmount: 0,
    binaryType: 'arraybuffer',
    label: 'control-session',
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onclose: null,
    onmessage: null,
  } as unknown as RTCDataChannel;
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  emitMock.mockReset();
  fetchMock.mockReset();
});

describe('pz3oo1tp 修复①：独立控制窗输入路由', () => {
  it('无 DC + Tauri 宿主（独立控制窗）⇒ rc-input-up 桥，不落本机 POST', async () => {
    const { fc, api } = await freshModules();
    expect(fc.isStandaloneControlWindow()).toBe(true);
    const r = await api.controlInput({ x: 10, y: 20, buttons: 1, keys: [] });
    expect(r).toBe(true);
    // sendInput 的桥臂是 fire-and-forget 动态 import——等 emit 落地
    await vi.waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(
        'rc-input-up',
        // emit(RC_INPUT_UP, ev)：第二参即事件载荷（Tauri 事件包装在 listen 侧）
        { x: 10, y: 20, buttons: 1, keys: [] },
      );
    });
    expect(fetchMock).not.toHaveBeenCalled(); // 🔴 旧根因：POST 127.0.0.1 本机 daemon
    expect(fc.getStats().inputsOut).toBe(1); // 注入计数入账（owner「注入 0」面）
  });

  it('DC 属主 + 会话在位 ⇒ 直发 DC（不走桥、不落 POST，行为不回归）', async () => {
    const { fc, api } = await freshModules();
    const dc = fakeDc();
    fc.attachChannel('peer-1', dc);
    expect(fc.isPeerSessionActive()).toBe(true);
    expect(fc.isStandaloneControlWindow()).toBe(false);
    const r = await api.controlInput({ x: 1, y: 2, buttons: 1, keys: [] });
    expect(r).toBe(true);
    expect(dc.send).toHaveBeenCalledTimes(1);
    expect(emitMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fc.getStats().inputsOut).toBe(1);
  });

  it('桥回 meeting 窗但无跨端会话 ⇒ 落本机 daemon（单机演示链保活）', async () => {
    const { fc } = await freshModules();
    fc.attachChannel('peer-1', fakeDc()); // 挂桥（ensureInputUpBridge），随后拆干净
    fc.detachChannel('peer-1');
    // listen 是动态 import 后异步注册——等一拍
    await vi.waitFor(() => {
      expect(listenCbs.has('rc-input-up')).toBe(true);
    });
    listenCbs.get('rc-input-up')!({ payload: { x: 3, y: 4, buttons: 0, keys: [] } });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(fetchMock.mock.calls[0]![0] as string).toContain('127.0.0.1');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
  });
});

describe('pz3oo1tp 修复②：桥接帧计数（帧 0 根因）', () => {
  it('RC_FRAME_DATA 桥接收帧 ⇒ framesIn+=1 且 sink 交付', async () => {
    const { fc } = await freshModules();
    const sink = vi.fn();
    fc.subscribeFrames(sink);
    await vi.waitFor(() => {
      expect(listenCbs.has('rc-frame-data')).toBe(true);
    });
    const w = 4;
    const h = 3;
    const rgba = new Uint8Array(w * h * 4).fill(7);
    // 分块 btoa（与 frameChannel.bytesToBase64 同实现语义）
    let bin = '';
    for (let i = 0; i < rgba.length; i += 0x8000) {
      bin += String.fromCharCode(...rgba.subarray(i, i + 0x8000));
    }
    listenCbs.get('rc-frame-data')!({ payload: { w, h, seq: 1, rgbaB64: btoa(bin) } });
    expect(sink).toHaveBeenCalledWith({ seq: 1, width: w, height: h, rgba });
    expect(fc.getStats().framesIn).toBe(1); // 🔴 旧根因：桥接不入账 ⇒ 控制窗恒「帧 0」
  });

  it('长度不符的脏帧 ⇒ 不入账不交付（防御不回归）', async () => {
    const { fc } = await freshModules();
    const sink = vi.fn();
    fc.subscribeFrames(sink);
    await vi.waitFor(() => {
      expect(listenCbs.has('rc-frame-data')).toBe(true);
    });
    listenCbs.get('rc-frame-data')!({ payload: { w: 4, h: 3, seq: 1, rgbaB64: btoa('x') } });
    expect(sink).not.toHaveBeenCalled();
    expect(fc.getStats().framesIn).toBe(0);
  });
});

describe('pz3oo1tp：滚轮位编码（既有 buttons 域空闲位）', () => {
  it('BUTTON_WHEEL_UP/DOWN = bit3/bit4，makeInputEvent 保位', async () => {
    const { coord } = await freshModules();
    expect(coord.BUTTON_WHEEL_UP).toBe(0x08);
    expect(coord.BUTTON_WHEEL_DOWN).toBe(0x10);
    expect(coord.makeInputEvent(5, 6, coord.BUTTON_WHEEL_UP, []).buttons).toBe(0x08);
    expect(coord.makeInputEvent(5, 6, coord.BUTTON_WHEEL_DOWN, []).buttons).toBe(0x10);
    // domButtonsToMask 裁剪域不含滚轮位（滚轮走 onWheel 专属编码，不与物理按键混）
    expect(coord.domButtonsToMask(0xff)).toBe(0x07);
  });

  it('encodeInputEvent 大端线格式含滚轮位（0x06 与 session.rs 对齐）', async () => {
    const { fc } = await freshModules();
    const dc = fakeDc();
    fc.attachChannel('peer-1', dc);
    expect(fc.isPeerSessionActive()).toBe(true);
    fc.sendInput({ x: 0x0102, y: 0x0304, buttons: 0x08, keys: [] });
    expect(dc.send).toHaveBeenCalledTimes(1);
    const u8 = new Uint8Array((dc.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as ArrayBuffer);
    expect(u8[0]).toBe(0x06); // TAG_INPUT_EVENT
    expect(u8[1]).toBe(0x01); // x BE 高字节
    expect(u8[2]).toBe(0x02); // x BE 低字节
    expect(u8[3]).toBe(0x03); // y BE 高字节
    expect(u8[4]).toBe(0x04); // y BE 低字节
    expect(u8[5]).toBe(0x08); // buttons bit3 = 上滚
    expect(u8.length).toBe(8); // n=0
  });
});
