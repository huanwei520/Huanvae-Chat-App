/**
 * 会议音频设备选择器测试（src/components/settings/MeetingAudioSettings.tsx）
 *
 * 覆盖任务卡 §实现5 的平台门控与 setSinkId 降级分支要求：
 *   - 移动端门控（isMobile=true）：零 DOM 渲染、零设备枚举、零监听挂载（红线自证）
 *   - 桌面端渲染：麦克风/扬声器两个下拉，枚举真实设备 label（含未授权序号化名）
 *   - setSinkId feature-detect 降级：不支持内核 → 输出下拉 disabled + 如实标注（非静默无效果）
 *   - 选择交互 → 持久化写入（功能性 localStorage 真读写）
 *   - devicechange → 枚举刷新（新设备出现在下拉）
 *
 * 平台门控参照 tests/update/androidPendingInstall.test.tsx 的 vi.hoisted 可控 flag 模式。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const platformMock = vi.hoisted(() => ({ mobile: false }));
vi.mock('../../src/utils/platform', () => ({
  isMobile: () => platformMock.mobile,
  isDesktop: () => !platformMock.mobile,
}));

import { MeetingAudioSettings } from '../../src/components/settings/MeetingAudioSettings';
import { MEETING_AUDIO_DEVICES_KEY } from '../../src/meeting/audioDevices';

// ---------- 基建：与 tests/unit/meetingAudioDevices.test.ts 同款（注释见彼处）----------

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
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  return store;
}

function makeDevice(kind: 'audioinput' | 'audiooutput' | 'videoinput', deviceId: string, label: string): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: 'g1', toJSON: () => ({}) } as MediaDeviceInfo;
}

// enumerateDevices 的返回值用变量控制，devicechange 刷新用例改它再派发事件
let enumerateResult: MediaDeviceInfo[] = [];

function installMediaDevices() {
  const target = new EventTarget() as EventTarget & {
    enumerateDevices: () => Promise<MediaDeviceInfo[]>;
  };
  target.enumerateDevices = () => Promise.resolve(enumerateResult);
  Object.defineProperty(navigator, 'mediaDevices', { value: target, configurable: true });
  return target;
}

beforeEach(() => {
  cleanup();
  installFunctionalStorage();
  enumerateResult = [];
  platformMock.mobile = false;
  installMediaDevices();
});

afterEach(() => {
  delete (navigator as unknown as { mediaDevices?: MediaDevices }).mediaDevices;
  delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId;
  vi.restoreAllMocks();
});

// ---- 平台门控（移动端零渲染零逻辑红线自证）----

describe('MeetingAudioSettings 平台门控', () => {
  it('isMobile=true：零 DOM、零枚举、零监听（devicechange/storage 都不挂）', () => {
    platformMock.mobile = true;

    const enumerateSpy = vi.fn().mockResolvedValue([]);
    (navigator.mediaDevices as unknown as { enumerateDevices: () => Promise<MediaDeviceInfo[]> })
      .enumerateDevices = enumerateSpy;
    const deviceChangeSpy = vi.spyOn(navigator.mediaDevices, 'addEventListener');
    const storageSpy = vi.spyOn(window, 'addEventListener');

    const { container } = render(<MeetingAudioSettings />);

    expect(container.innerHTML).toBe('');
    expect(enumerateSpy).not.toHaveBeenCalled();
    expect(deviceChangeSpy).not.toHaveBeenCalled();
    // 不挂任何 storage 监听（存储写入走不到移动端）
    const storageCalls = storageSpy.mock.calls.filter(([type]) => type === 'storage');
    expect(storageCalls).toHaveLength(0);
  });

  it('isMobile=false（桌面）：渲染麦克风/扬声器两个下拉', async () => {
    enumerateResult = [
      makeDevice('audioinput', 'in-1', '内置麦克风'),
      makeDevice('audiooutput', 'out-1', '内置扬声器'),
    ];
    render(<MeetingAudioSettings />);

    expect(await screen.findByLabelText('会议麦克风设备')).toBeInTheDocument();
    expect(screen.getByLabelText('会议扬声器设备')).toBeInTheDocument();
  });
});

// ---- 桌面渲染：枚举 label + 未授权化名 ----

describe('MeetingAudioSettings 桌面渲染', () => {
  it('下拉选项展示真实设备 label + 系统默认项', async () => {
    enumerateResult = [
      makeDevice('audioinput', 'in-1', 'USB 麦克风'),
      makeDevice('audiooutput', 'out-1', 'HDMI 扬声器'),
    ];
    render(<MeetingAudioSettings />);

    const micSelect = await screen.findByLabelText('会议麦克风设备');
    const micOptions = Array.from(micSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(micOptions).toEqual(['系统默认', 'USB 麦克风']);

    const spkSelect = screen.getByLabelText('会议扬声器设备');
    const spkOptions = Array.from(spkSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(spkOptions).toEqual(['系统默认', 'HDMI 扬声器']);
  });

  it('未授权（label 空）→ 序号化名「麦克风 1」兜底', async () => {
    enumerateResult = [makeDevice('audioinput', 'in-1', '')];
    render(<MeetingAudioSettings />);

    const micSelect = await screen.findByLabelText('会议麦克风设备');
    const texts = Array.from(micSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(texts).toContain('麦克风 1');
  });

  it('回读已持久化的选择作为当前值', async () => {
    localStorage.setItem(
      MEETING_AUDIO_DEVICES_KEY,
      JSON.stringify({ inputDeviceId: 'in-1', outputDeviceId: null }),
    );
    enumerateResult = [makeDevice('audioinput', 'in-1', 'USB 麦克风')];
    render(<MeetingAudioSettings />);

    const micSelect = await screen.findByLabelText('会议麦克风设备');
    await waitFor(() => expect((micSelect as HTMLSelectElement).value).toBe('in-1'));
  });
});

// ---- setSinkId 降级分支（不支持 → 禁用 + 如实标注）----

describe('MeetingAudioSettings 输出能力降级', () => {
  it('内核不支持 setSinkId（jsdom 默认=WebKitGTK 同构）→ 输出下拉禁用 + 标注提示', async () => {
    enumerateResult = [makeDevice('audiooutput', 'out-1', 'HDMI 扬声器')];
    render(<MeetingAudioSettings />);

    const spkSelect = await screen.findByLabelText('会议扬声器设备');
    expect(spkSelect).toBeDisabled();
    expect(screen.getByText(/当前内核不支持输出设备选择/)).toBeInTheDocument();
  });

  it('内核支持 setSinkId（补 prototype 方法=WebView2/Chromium 同构）→ 可用无提示', async () => {
    (HTMLMediaElement.prototype as unknown as { setSinkId: () => Promise<void> }).setSinkId = () =>
      Promise.resolve();
    enumerateResult = [makeDevice('audiooutput', 'out-1', 'HDMI 扬声器')];
    render(<MeetingAudioSettings />);

    const spkSelect = await screen.findByLabelText('会议扬声器设备');
    expect(spkSelect).toBeEnabled();
    expect(screen.queryByText(/当前内核不支持输出设备选择/)).not.toBeInTheDocument();
  });
});

// ---- 选择交互 → 持久化 ----

describe('MeetingAudioSettings 选择交互', () => {
  it('选麦克风 → 持久化 JSON 含 deviceId；选「系统默认」→ 归一为 null', async () => {
    const store = installFunctionalStorage();
    enumerateResult = [makeDevice('audioinput', 'in-1', 'USB 麦克风')];
    render(<MeetingAudioSettings />);

    const micSelect = await screen.findByLabelText('会议麦克风设备');
    fireEvent.change(micSelect, { target: { value: 'in-1' } });

    const saved = JSON.parse(store.get(MEETING_AUDIO_DEVICES_KEY) as string);
    expect(saved.inputDeviceId).toBe('in-1');

    fireEvent.change(micSelect, { target: { value: '' } });
    const saved2 = JSON.parse(store.get(MEETING_AUDIO_DEVICES_KEY) as string);
    expect(saved2.inputDeviceId).toBeNull();
  });
});

// ---- devicechange 枚举刷新 ----

describe('MeetingAudioSettings 设备热插拔刷新', () => {
  it('devicechange 后新设备出现在下拉（枚举刷新）', async () => {
    const mediaDevices = installMediaDevices();
    enumerateResult = [makeDevice('audioinput', 'in-1', '内置麦克风')];
    render(<MeetingAudioSettings />);

    expect(await screen.findByLabelText('会议麦克风设备')).toBeInTheDocument();
    expect(screen.queryByText('USB 麦克风')).not.toBeInTheDocument();

    // 插入新设备 → devicechange → 重新枚举
    enumerateResult = [
      makeDevice('audioinput', 'in-1', '内置麦克风'),
      makeDevice('audioinput', 'in-2', 'USB 麦克风'),
    ];
    mediaDevices.dispatchEvent(new Event('devicechange'));

    await waitFor(() => expect(screen.getByText('USB 麦克风')).toBeInTheDocument());
  });
});
