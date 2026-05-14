/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * useNfcGlobalScan 全局 NFC 监听 hook 测试
 *
 * mock 链：@tauri-apps/plugin-os.platform / @tauri-apps/plugin-nfc.scan / trustStore / executor.dispatch
 * parser 不 mock（让真实 parseAction / decodeNdefUriPayload / computePayloadHash 执行）
 *
 * 关键点：
 * - scan 是 Promise，用 deferred 控制 resolve 时机
 * - while loop 跑在 useEffect 内，需 waitFor 等异步 state 更新
 *
 * 参考 .claude/rules/frontend-test.md "vi.mock 工厂引用 outer 变量必须用 vi.hoisted()"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const mockTrustStore = vi.hoisted(() => ({
  isTrusted: vi.fn(),
  addTrusted: vi.fn(),
  listTrusted: vi.fn(),
  removeTrusted: vi.fn(),
}));
vi.mock('../../src/nfc/trustStore', () => ({ trustStore: mockTrustStore }));

const mockDispatch = vi.hoisted(() => vi.fn());
vi.mock('../../src/nfc/executor', () => ({ dispatch: mockDispatch }));

const mockScan = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-nfc', () => ({ scan: mockScan }));

import { platform } from '@tauri-apps/plugin-os';
import { useNfcGlobalScan } from '../../src/hooks/useNfcGlobalScan';

// 构造一张含 huanvae:// miniapp/open?id=test URI Record 的卡片
function makeHuanvaeUriTag(uri: string) {
  const payload = [0x00, ...Array.from(new TextEncoder().encode(uri))];
  return {
    id: [0x04, 0x12, 0x34, 0x56],
    kind: ['android.nfc.tech.Ndef'],
    records: [{ tnf: 1, kind: [0x55], id: [], payload }],
  };
}

// Deferred Promise — 用来精确控制 scan() 何时 resolve
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const defaultOpts = () => ({
  setMiniAppLaunching: vi.fn(),
  getMiniAppById: vi.fn(),
});

describe('useNfcGlobalScan', () => {
  beforeEach(() => {
    vi.mocked(platform).mockReturnValue('android');
    mockScan.mockReset();
    mockTrustStore.isTrusted.mockReset();
    mockTrustStore.addTrusted.mockReset();
    mockDispatch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('桌面端 platform=windows → 不调 scan', async () => {
    vi.mocked(platform).mockReturnValue('windows');
    // 让永远不 resolve 的 scan（即使被调用）
    mockScan.mockImplementation(() => new Promise(() => {}));

    renderHook(() => useNfcGlobalScan(defaultOpts()));

    // 等几次 microtask，确认 scan 未被调用
    await new Promise((r) => setTimeout(r, 50));
    expect(mockScan).not.toHaveBeenCalled();
  });

  it('Android 启动 loop → 调用 scan({type:tag})', async () => {
    mockScan.mockImplementation(() => new Promise(() => {})); // 永挂起，避免下一轮
    renderHook(() => useNfcGlobalScan(defaultOpts()));

    await waitFor(() => expect(mockScan).toHaveBeenCalled());
    expect(mockScan).toHaveBeenCalledWith({ type: 'tag' });
  });

  it('卡片无 URI Record → 静默继续 loop（不弹 modal/toast）', async () => {
    const tagNoUri = { id: [1, 2], kind: ['x'], records: [{ tnf: 2, kind: [0x54], id: [], payload: [0] }] };
    // 第一次返回无 URI 卡，第二次永挂起
    const d2 = deferred<typeof tagNoUri>();
    mockScan
      .mockResolvedValueOnce(tagNoUri)
      .mockImplementationOnce(() => d2.promise);

    const { result } = renderHook(() => useNfcGlobalScan(defaultOpts()));

    // 等到第二次 scan 被调用（说明第一次已被静默处理）
    await waitFor(() => expect(mockScan).toHaveBeenCalledTimes(2));
    expect(result.current.pendingConfirm).toBeNull();
    expect(result.current.feedback).toBeNull();
  });

  it('非 huanvae:// URI → 静默继续 loop', async () => {
    const httpsTag = makeHuanvaeUriTag('https://example.com/foo'); // 非 huanvae scheme
    const d2 = deferred<typeof httpsTag>();
    mockScan
      .mockResolvedValueOnce(httpsTag)
      .mockImplementationOnce(() => d2.promise);

    const { result } = renderHook(() => useNfcGlobalScan(defaultOpts()));

    await waitFor(() => expect(mockScan).toHaveBeenCalledTimes(2));
    expect(result.current.pendingConfirm).toBeNull();
    expect(result.current.feedback).toBeNull();
  });

  it('信任卡 → 直接 dispatch + success toast', async () => {
    const tag = makeHuanvaeUriTag('huanvae://miniapp/open?id=app-1');
    const d2 = deferred<typeof tag>();
    mockScan
      .mockResolvedValueOnce(tag)
      .mockImplementationOnce(() => d2.promise);

    mockTrustStore.isTrusted.mockResolvedValue(true);
    mockDispatch.mockResolvedValue(undefined);

    const opts = defaultOpts();
    const { result } = renderHook(() => useNfcGlobalScan(opts));

    await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
    expect(mockDispatch.mock.calls[0]![0]).toEqual({
      kind: 'miniapp/open',
      miniappId: 'app-1',
    });
    await waitFor(() => expect(result.current.feedback?.variant).toBe('success'));
    expect(result.current.feedback?.message).toContain('app-1');
    expect(result.current.pendingConfirm).toBeNull(); // 信任卡不弹 modal
  });

  it('陌生卡 → pendingConfirm 非 null + 不立即 dispatch', async () => {
    const tag = makeHuanvaeUriTag('huanvae://miniapp/open?id=app-2');
    const d2 = deferred<typeof tag>();
    mockScan
      .mockResolvedValueOnce(tag)
      .mockImplementationOnce(() => d2.promise);

    mockTrustStore.isTrusted.mockResolvedValue(false);

    const { result } = renderHook(() => useNfcGlobalScan(defaultOpts()));

    await waitFor(() => expect(result.current.pendingConfirm).not.toBeNull());
    expect(result.current.pendingConfirm!.action).toEqual({
      kind: 'miniapp/open',
      miniappId: 'app-2',
    });
    // 信任前不调 dispatch
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(result.current.feedback).toBeNull();
  });

  it('onConfirmTrust → addTrusted + dispatch + success toast + pendingConfirm 清空 + loop 续', async () => {
    const tag = makeHuanvaeUriTag('huanvae://miniapp/open?id=app-3');
    const d2 = deferred<typeof tag>();
    mockScan
      .mockResolvedValueOnce(tag)
      .mockImplementationOnce(() => d2.promise);

    mockTrustStore.isTrusted.mockResolvedValue(false);
    mockTrustStore.addTrusted.mockResolvedValue(undefined);
    mockDispatch.mockResolvedValue(undefined);

    const { result } = renderHook(() => useNfcGlobalScan(defaultOpts()));

    await waitFor(() => expect(result.current.pendingConfirm).not.toBeNull());

    act(() => {
      result.current.onConfirmTrust();
    });

    await waitFor(() => expect(mockTrustStore.addTrusted).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.feedback?.variant).toBe('success'));
    expect(result.current.pendingConfirm).toBeNull();

    // loop 已续上：第 2 次 scan 应被调（modal resolver 完成）
    await waitFor(() => expect(mockScan).toHaveBeenCalledTimes(2));
  });

  it('onCancelTrust → pendingConfirm 清空 + 不 dispatch + loop 续', async () => {
    const tag = makeHuanvaeUriTag('huanvae://miniapp/open?id=app-4');
    const d2 = deferred<typeof tag>();
    mockScan
      .mockResolvedValueOnce(tag)
      .mockImplementationOnce(() => d2.promise);

    mockTrustStore.isTrusted.mockResolvedValue(false);

    const { result } = renderHook(() => useNfcGlobalScan(defaultOpts()));

    await waitFor(() => expect(result.current.pendingConfirm).not.toBeNull());

    act(() => {
      result.current.onCancelTrust();
    });

    expect(result.current.pendingConfirm).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockTrustStore.addTrusted).not.toHaveBeenCalled();
    await waitFor(() => expect(mockScan).toHaveBeenCalledTimes(2));
  });

  it('scan 抛 "NFC is disabled" → error toast + break loop（不再调 scan）', async () => {
    mockScan.mockRejectedValueOnce(new Error('NFC is disabled in device settings'));

    const { result } = renderHook(() => useNfcGlobalScan(defaultOpts()));

    await waitFor(() => expect(result.current.feedback?.variant).toBe('error'));
    expect(result.current.feedback?.message).toContain('NFC 不可用');

    // 等一会儿确认 loop 未续（第 2 次 scan 不会被调）
    await new Promise((r) => setTimeout(r, 100));
    expect(mockScan).toHaveBeenCalledTimes(1);
  });
});
