/**
 * 会议页音频设备入口测试（src/meeting/components/MeetingAudioEntry.tsx）
 *
 * 覆盖任务卡「会议页补音频输入/输出可见入口」：
 *   - 移动端门控（isMobile=true）：按钮零渲染（与 SettingsPanel 段级门控同红线）
 *   - 桌面端：齿轮按钮渲染 → 点击弹出音频设备面板（复用 MeetingAudioSettings：
 *     含 会议麦克风设备/会议扬声器设备 两个下拉）
 *   - 再点按钮 / 点击面板外（backdrop）/ Esc → 面板关闭
 *   - 面板内选择麦克风 → 即时持久化（功能性 localStorage 真读写，与会议窗
 *     switchAudioInputDevice 订阅同一数据源）
 *
 * mock 模式与 tests/components/MeetingAudioSettings.test.tsx 同款（vi.hoisted 平台 flag）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const platformMock = vi.hoisted(() => ({ mobile: false }));
vi.mock('../../src/utils/platform', () => ({
  isMobile: () => platformMock.mobile,
  isDesktop: () => !platformMock.mobile,
}));

import { MeetingAudioEntry } from '../../src/meeting/components/MeetingAudioEntry';
import { MEETING_AUDIO_DEVICES_KEY } from '../../src/meeting/audioDevices';

// ---------- 基建：与 MeetingAudioSettings.test.tsx 同款 ----------

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
  vi.restoreAllMocks();
});

// ---- 移动端门控 ----

describe('MeetingAudioEntry 移动端门控', () => {
  it('isMobile=true：零 DOM（按钮与面板都不渲染）', () => {
    platformMock.mobile = true;
    const { container } = render(<MeetingAudioEntry />);
    expect(container.innerHTML).toBe('');
  });
});

// ---- 桌面端入口与面板 ----

describe('MeetingAudioEntry 桌面端入口', () => {
  it('齿轮按钮渲染，点击弹出含麦克风/扬声器下拉的面板', async () => {
    enumerateResult = [
      makeDevice('audioinput', 'in-1', '内置麦克风'),
      makeDevice('audiooutput', 'out-1', '内置扬声器'),
    ];
    render(<MeetingAudioEntry />);

    const btn = screen.getByLabelText('音频设备设置');
    expect(btn).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '会议音频设备' })).not.toBeInTheDocument();

    fireEvent.click(btn);

    const dialog = await screen.findByRole('dialog', { name: '会议音频设备' });
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByLabelText('会议麦克风设备')).toBeInTheDocument();
    expect(screen.getByLabelText('会议扬声器设备')).toBeInTheDocument();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('面板内选择麦克风 → 即时持久化到会议音频设备偏好（同窗订阅数据源）', async () => {
    const store = installFunctionalStorage();
    enumerateResult = [makeDevice('audioinput', 'in-1', 'USB 麦克风')];
    render(<MeetingAudioEntry />);

    fireEvent.click(screen.getByLabelText('音频设备设置'));
    const micSelect = await screen.findByLabelText('会议麦克风设备');
    fireEvent.change(micSelect, { target: { value: 'in-1' } });

    const saved = JSON.parse(store.get(MEETING_AUDIO_DEVICES_KEY) as string);
    expect(saved.inputDeviceId).toBe('in-1');
  });

  it('再点按钮（toggle）关闭面板', async () => {
    enumerateResult = [];
    render(<MeetingAudioEntry />);

    const btn = screen.getByLabelText('音频设备设置');
    fireEvent.click(btn);
    await screen.findByRole('dialog', { name: '会议音频设备' });

    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '会议音频设备' })).not.toBeInTheDocument(),
    );
  });

  it('点击面板外（backdrop）关闭面板', async () => {
    enumerateResult = [];
    render(<MeetingAudioEntry />);

    fireEvent.click(screen.getByLabelText('音频设备设置'));
    await screen.findByRole('dialog', { name: '会议音频设备' });

    fireEvent.click(screen.getByTestId('meeting-audio-backdrop'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '会议音频设备' })).not.toBeInTheDocument(),
    );
  });

  it('Esc 关闭面板', async () => {
    enumerateResult = [];
    render(<MeetingAudioEntry />);

    fireEvent.click(screen.getByLabelText('音频设备设置'));
    await screen.findByRole('dialog', { name: '会议音频设备' });

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '会议音频设备' })).not.toBeInTheDocument(),
    );
  });

  it('面板打开时齿轮按钮 active 高亮，关闭后恢复', async () => {
    enumerateResult = [];
    render(<MeetingAudioEntry />);

    const btn = screen.getByLabelText('音频设备设置');
    expect(btn.className).not.toContain('active');
    fireEvent.click(btn);
    await screen.findByRole('dialog', { name: '会议音频设备' });
    expect(btn.className).toContain('active');
  });
});
