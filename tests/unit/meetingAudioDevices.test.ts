/**
 * 会议音频设备管理模块测试（src/meeting/audioDevices.ts）
 *
 * 覆盖任务卡 §实现5 全部要求：
 *   - 设备枚举过滤（audioinput/audiooutput 之外的 kind 丢弃；无 mediaDevices 环境回空）
 *   - 持久化往返 + 坏 JSON 容灾（坏 JSON / 结构不符 / 空串 id 均回退默认）
 *   - constraints 构建（桌面有选择 → deviceId:{exact}；无选择 → {audio:true}；移动端兜底恒 {audio:true}）
 *   - setSinkId feature-detect（jsdom 无 setSinkId → 不支持；补 prototype 方法 → 支持；
 *     不支持时 applyAudioOutputSink 零调用零抛错；支持时按选中 id / 默认 '' 调用）
 *   - devicechange / storage 订阅与解绑
 *
 * 平台门控用 vi.hoisted 可控 flag（参照 tests/update/androidPendingInstall.test.tsx 模式），
 * 不依赖真实 UA（jsdom UA 是 Mozilla/5.0 ... jsdom，isMobile 恒 false 且有模块级缓存）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const platformMock = vi.hoisted(() => ({ mobile: false }));
vi.mock('../../src/utils/platform', () => ({
  isMobile: () => platformMock.mobile,
  isDesktop: () => !platformMock.mobile,
}));

import {
  MEETING_AUDIO_DEVICES_KEY,
  buildAudioConstraints,
  deviceDisplayLabel,
  enumerateMeetingAudioDevices,
  getSelectedAudioInputId,
  getSelectedAudioOutputId,
  loadMeetingAudioDevicePrefs,
  saveMeetingAudioDevicePrefs,
  setSelectedAudioInputId,
  supportsAudioOutputSelection,
  applyAudioOutputSink,
  subscribeMeetingAudioDevices,
} from '../../src/meeting/audioDevices';

// ---------- 测试基建：功能性 localStorage（setup.ts 的是无行为 vi.fn，往返测不了真读写）----------

function installFunctionalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  // 模块代码引用的是裸 `localStorage`（全局查找），jsdom 环境下两处都要覆盖
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  return store;
}

// ---------- 测试基建：可控的 navigator.mediaDevices（jsdom 默认没有该属性）----------

type EnumerateMock = ReturnType<typeof vi.fn> & { mockReturnValue: (v: unknown) => void };

function installMediaDevices(enumerateImpl?: EnumerateMock) {
  // EventTarget 为基：devicechange 用真事件派发走真监听路径，不手搓 handler 直调
  const target = new EventTarget() as EventTarget & {
    enumerateDevices: () => Promise<MediaDeviceInfo[]>;
  };
  target.enumerateDevices = (enumerateImpl ?? (vi.fn().mockResolvedValue([]) as EnumerateMock)) as () =>
    Promise<MediaDeviceInfo[]>;
  Object.defineProperty(navigator, 'mediaDevices', { value: target, configurable: true });
  return target;
}

function makeDevice(kind: 'audioinput' | 'audiooutput' | 'videoinput', deviceId: string, label: string): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: 'g1', toJSON: () => ({}) } as MediaDeviceInfo;
}

beforeEach(() => {
  installFunctionalStorage();
  platformMock.mobile = false;
});

afterEach(() => {
  // navigator.mediaDevices 是本文件 defineProperty 挂上的（configurable: true），摘除防泄漏
  delete (navigator as unknown as { mediaDevices?: MediaDevices }).mediaDevices;
  delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId;
  vi.restoreAllMocks();
});

// ---- 1. 枚举过滤 ----

describe('enumerateMeetingAudioDevices', () => {
  it('只保留 audioinput / audiooutput，videoinput 等其他 kind 丢弃', async () => {
    const enumerate = vi.fn().mockResolvedValue([
      makeDevice('audioinput', 'in-1', '麦克风 A'),
      makeDevice('videoinput', 'cam-1', '摄像头 A'),
      makeDevice('audiooutput', 'out-1', '扬声器 A'),
      makeDevice('videoinput', 'cam-2', '摄像头 B'),
      makeDevice('audioinput', 'in-2', '麦克风 B'),
    ]) as EnumerateMock;
    installMediaDevices(enumerate);

    const { inputs, outputs } = await enumerateMeetingAudioDevices();
    expect(inputs.map((d) => d.deviceId)).toEqual(['in-1', 'in-2']);
    expect(outputs.map((d) => d.deviceId)).toEqual(['out-1']);
  });

  it('无 navigator.mediaDevices 环境（老内核/非安全上下文）返回空列表不抛错', async () => {
    // 本用例先于 afterEach 摘除前没有 mediaDevices —— 显式删掉模拟「不存在」
    delete (navigator as unknown as { mediaDevices?: MediaDevices }).mediaDevices;
    const { inputs, outputs } = await enumerateMeetingAudioDevices();
    expect(inputs).toEqual([]);
    expect(outputs).toEqual([]);
  });
});

// ---- 2. 持久化往返 + 容灾 ----

describe('会议音频设备偏好持久化', () => {
  it('save → load 往返：两个 id 均保存并原样读回', () => {
    saveMeetingAudioDevicePrefs({ inputDeviceId: 'in-9', outputDeviceId: 'out-9' });
    // 键名契约：与 meeting/api.ts MEETING_DATA_KEY 同风格
    expect(loadMeetingAudioDevicePrefs()).toEqual({
      inputDeviceId: 'in-9',
      outputDeviceId: 'out-9',
    });
  });

  it('setter 单独改输入/输出，不影响另一项', () => {
    saveMeetingAudioDevicePrefs({ inputDeviceId: 'in-1', outputDeviceId: 'out-1' });
    setSelectedAudioInputId('in-2');
    expect(getSelectedAudioInputId()).toBe('in-2');
    expect(getSelectedAudioOutputId()).toBe('out-1');
  });

  it('键不存在 → 默认（全 null）', () => {
    expect(loadMeetingAudioDevicePrefs()).toEqual({ inputDeviceId: null, outputDeviceId: null });
  });

  it('坏 JSON（手工写入非法串）→ 容灾回退默认，不抛错', () => {
    localStorage.setItem(MEETING_AUDIO_DEVICES_KEY, '{not-valid-json');
    expect(loadMeetingAudioDevicePrefs()).toEqual({ inputDeviceId: null, outputDeviceId: null });
  });

  it('结构不符（id 为数字 / 对象为 null）→ 容灾回退 null', () => {
    localStorage.setItem(MEETING_AUDIO_DEVICES_KEY, JSON.stringify({ inputDeviceId: 42, outputDeviceId: { x: 1 } }));
    expect(loadMeetingAudioDevicePrefs()).toEqual({ inputDeviceId: null, outputDeviceId: null });
    localStorage.setItem(MEETING_AUDIO_DEVICES_KEY, 'null');
    expect(loadMeetingAudioDevicePrefs()).toEqual({ inputDeviceId: null, outputDeviceId: null });
  });

  it('空串 id 视为未选择（保存时归一为 null）', () => {
    saveMeetingAudioDevicePrefs({ inputDeviceId: '', outputDeviceId: 'out-1' });
    expect(loadMeetingAudioDevicePrefs()).toEqual({ inputDeviceId: null, outputDeviceId: 'out-1' });
  });
});

// ---- 3. constraints 构建（有/无选择两态 + 移动端兜底）----

describe('buildAudioConstraints', () => {
  it('桌面端 + 已选设备 → deviceId:{exact:<id>}（严格绑定选中设备）', () => {
    expect(buildAudioConstraints('in-7')).toEqual({ audio: { deviceId: { exact: 'in-7' } } });
  });

  it('桌面端 + 未选 → { audio: true }（系统默认，与既有行为一致）', () => {
    expect(buildAudioConstraints(null)).toEqual({ audio: true });
  });

  it('移动端兜底：即使有持久化选择也恒 { audio: true }（移动端行为零改动红线）', () => {
    platformMock.mobile = true;
    expect(buildAudioConstraints('in-7')).toEqual({ audio: true });
    expect(buildAudioConstraints(null)).toEqual({ audio: true });
  });

  it('每次返回全新对象（调用方复用不共享引用）', () => {
    const a = buildAudioConstraints(null);
    const b = buildAudioConstraints(null);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ---- 4. 设备显示名（未授权 label 为空的序号化名取舍）----

describe('deviceDisplayLabel', () => {
  it('有真实 label → 原样返回', () => {
    expect(deviceDisplayLabel(makeDevice('audioinput', 'in-1', 'USB 麦克风'), 0)).toBe('USB 麦克风');
  });

  it('label 为空（未授权）→ 序号化名「麦克风 N / 扬声器 N」', () => {
    expect(deviceDisplayLabel(makeDevice('audioinput', 'in-1', ''), 0)).toBe('麦克风 1');
    expect(deviceDisplayLabel(makeDevice('audioinput', 'in-2', ''), 1)).toBe('麦克风 2');
    expect(deviceDisplayLabel(makeDevice('audiooutput', 'out-1', ''), 0)).toBe('扬声器 1');
  });
});

// ---- 5. setSinkId feature-detect 与输出应用 ----

describe('supportsAudioOutputSelection / applyAudioOutputSink', () => {
  it('jsdom 默认无 setSinkId → 不支持（WebKitGTK 同构场景）', () => {
    expect(supportsAudioOutputSelection()).toBe(false);
  });

  it('prototype 补上 setSinkId（WebView2/Chromium 系同构）→ 支持', () => {
    (HTMLMediaElement.prototype as unknown as { setSinkId: () => Promise<void> }).setSinkId = () =>
      Promise.resolve();
    expect(supportsAudioOutputSelection()).toBe(true);
  });

  it('不支持时 applyAudioOutputSink 零动作零抛错（降级由 UI 禁用下拉承接）', () => {
    const el = document.createElement('audio');
    // 不支持分支连 setSinkId 都不该被探测调用；这里不挂实现，若被调用会 TypeError 直接暴露
    expect(() => applyAudioOutputSink(el)).not.toThrow();
  });

  it('支持 + 已选输出 → setSinkId(<选中 id>)', () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    (HTMLMediaElement.prototype as unknown as { setSinkId: unknown }).setSinkId = setSinkId;
    saveMeetingAudioDevicePrefs({ inputDeviceId: null, outputDeviceId: 'out-3' });

    const el = document.createElement('audio');
    applyAudioOutputSink(el);
    expect(setSinkId).toHaveBeenCalledWith('out-3');
  });

  it('支持 + 未选输出 → setSinkId("")（清除绑定回系统默认）', () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    (HTMLMediaElement.prototype as unknown as { setSinkId: unknown }).setSinkId = setSinkId;

    applyAudioOutputSink(document.createElement('audio'));
    expect(setSinkId).toHaveBeenCalledWith('');
  });

  it('setSinkId 失败（设备已拔出）→ console.warn 如实记录，不向上抛', async () => {
    const setSinkId = vi.fn().mockRejectedValue(new Error('SinkIdNotFound'));
    (HTMLMediaElement.prototype as unknown as { setSinkId: unknown }).setSinkId = setSinkId;
    saveMeetingAudioDevicePrefs({ inputDeviceId: null, outputDeviceId: 'gone' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => applyAudioOutputSink(document.createElement('audio'))).not.toThrow();
    // rejection 是异步落地的，flush 微任务后断言 warn 确实发生（非静默吞掉）
    await Promise.resolve();
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ---- 6. 订阅：devicechange / storage 双通道 + 解绑 ----

describe('subscribeMeetingAudioDevices', () => {
  it('devicechange 事件 → 监听者被通知；解绑后不再通知', () => {
    const mediaDevices = installMediaDevices();
    const listener = vi.fn();
    const unsubscribe = subscribeMeetingAudioDevices(listener);

    mediaDevices.dispatchEvent(new Event('devicechange'));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    mediaDevices.dispatchEvent(new Event('devicechange'));
    expect(listener).toHaveBeenCalledTimes(1); // 仍为 1：解绑生效
  });

  it('storage 事件：本模块键（或其他键清空 null）→ 通知；无关键不通知', () => {
    installMediaDevices();
    const listener = vi.fn();
    const unsubscribe = subscribeMeetingAudioDevices(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: MEETING_AUDIO_DEVICES_KEY }));
    window.dispatchEvent(new StorageEvent('storage', { key: null })); // clear() 场景
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated_key' }));
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('本窗写路径监听者抛错不阻断其他监听者（save → notifyListeners 逐个 try/catch）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const unsub1 = subscribeMeetingAudioDevices(bad);
    const unsub2 = subscribeMeetingAudioDevices(good);

    // 写路径经 notifyListeners：坏监听者抛错被逐个捕获并 console.error，好监听者照常收到
    saveMeetingAudioDevicePrefs({ inputDeviceId: 'in-1', outputDeviceId: null });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();

    unsub1();
    unsub2();
  });
});
