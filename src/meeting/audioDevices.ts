/**
 * 会议音频设备管理模块
 *
 * 桌面端「会议音频」设备选择的纯逻辑层：
 * - enumerateDevices 过滤 audioinput / audiooutput（未授权时 label 为空 → 序号化名）
 * - devicechange（设备插拔）+ storage（跨窗口：主窗设置改动 → 会议窗感知）双通道订阅
 * - 选择持久化：localStorage JSON，参照 src/meeting/api.ts:319 模式，坏 JSON 回退默认
 * - getUserMedia audio constraints 构建：有选择注入 deviceId:{exact}，无选择 = { audio: true }
 * - 输出选择 feature-detect：'setSinkId' in HTMLMediaElement.prototype（WebView2=Chromium 系
 *   支持；WebKitGTK 不支持 → 上层下拉禁用并提示，禁止静默无效果）
 *
 * 移动端红线：本模块只有 isDesktop() 时才允许产生持久化写入与约束注入
 * （buildAudioConstraints 内 isDesktop() 兜底），移动端既有行为恒为 { audio: true }。
 *
 * @module meeting/audioDevices
 */

import { isDesktop } from '../utils/platform';

/** 会议音频设备选择持久化结构 */
export interface MeetingAudioDevicePrefs {
  /** 麦克风（audioinput）deviceId；null = 系统默认 */
  inputDeviceId: string | null;
  /** 扬声器（audiooutput）deviceId；null = 系统默认 */
  outputDeviceId: string | null;
}

/** localStorage 键名（参照 src/meeting/api.ts:315 MEETING_DATA_KEY 命名风格） */
export const MEETING_AUDIO_DEVICES_KEY = 'huanvae_meeting_audio_devices';

/** 默认偏好：全部走系统默认设备 */
export function defaultMeetingAudioPrefs(): MeetingAudioDevicePrefs {
  return { inputDeviceId: null, outputDeviceId: null };
}

/**
 * 从 localStorage 读取会议音频设备偏好
 * 容灾：键不存在 / 坏 JSON / 结构不符（含 deviceId 非字符串非 null）→ 回退默认
 */
export function loadMeetingAudioDevicePrefs(): MeetingAudioDevicePrefs {
  try {
    const raw = localStorage.getItem(MEETING_AUDIO_DEVICES_KEY);
    if (!raw) {
      return defaultMeetingAudioPrefs();
    }
    const parsed = JSON.parse(raw) as Partial<MeetingAudioDevicePrefs> | null;
    if (!parsed || typeof parsed !== 'object') {
      return defaultMeetingAudioPrefs();
    }
    const validId = (v: unknown): string | null =>
      typeof v === 'string' && v.length > 0 ? v : null;
    return {
      inputDeviceId: validId(parsed.inputDeviceId),
      outputDeviceId: validId(parsed.outputDeviceId),
    };
  } catch {
    // 坏 JSON（参照 src/meeting/api.ts:328-332 容灾模式）
    return defaultMeetingAudioPrefs();
  }
}

/** 订阅回调类型 */
export type MeetingAudioDevicesListener = () => void;

const listeners = new Set<MeetingAudioDevicesListener>();

function notifyListeners(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error('[audioDevices] listener 执行失败:', err);
    }
  });
}

/** 写入会议音频设备偏好并广播（含跨窗口：storage 事件会通知其他窗口） */
export function saveMeetingAudioDevicePrefs(prefs: MeetingAudioDevicePrefs): void {
  const next: MeetingAudioDevicePrefs = {
    inputDeviceId: typeof prefs.inputDeviceId === 'string' && prefs.inputDeviceId.length > 0
      ? prefs.inputDeviceId
      : null,
    outputDeviceId: typeof prefs.outputDeviceId === 'string' && prefs.outputDeviceId.length > 0
      ? prefs.outputDeviceId
      : null,
  };
  localStorage.setItem(MEETING_AUDIO_DEVICES_KEY, JSON.stringify(next));
  // 本窗监听者立即通知（storage 事件只在其他窗口触发，不覆盖本窗）
  notifyListeners();
}

/** 当前选中的麦克风 deviceId（null = 默认） */
export function getSelectedAudioInputId(): string | null {
  return loadMeetingAudioDevicePrefs().inputDeviceId;
}

/** 当前选中的扬声器 deviceId（null = 默认） */
export function getSelectedAudioOutputId(): string | null {
  return loadMeetingAudioDevicePrefs().outputDeviceId;
}

/** 选中麦克风（null = 回到默认）并广播 */
export function setSelectedAudioInputId(deviceId: string | null): void {
  saveMeetingAudioDevicePrefs({ ...loadMeetingAudioDevicePrefs(), inputDeviceId: deviceId });
}

/** 选中扬声器（null = 回到默认）并广播 */
export function setSelectedAudioOutputId(deviceId: string | null): void {
  saveMeetingAudioDevicePrefs({ ...loadMeetingAudioDevicePrefs(), outputDeviceId: deviceId });
}

/**
 * 构建 getUserMedia 的 audio 约束
 * - 有选择：{ audio: { deviceId: { exact: <id> } } }（exact：选了就严格用这台）
 * - 无选择：{ audio: true }（系统默认，与既有行为完全一致）
 * - 移动端兜底：恒 { audio: true }（移动端无设置入口、无持久化写入，
 *   此处再挡一层，保证移动端行为零改动）
 *
 * 每次返回全新对象，避免调用方复用时约束被意外共享。
 */
export function buildAudioConstraints(selectedInputDeviceId: string | null): {
  audio: boolean | { deviceId: { exact: string } };
} {
  if (!isDesktop()) {
    return { audio: true };
  }
  if (typeof selectedInputDeviceId === 'string' && selectedInputDeviceId.length > 0) {
    return { audio: { deviceId: { exact: selectedInputDeviceId } } };
  }
  return { audio: true };
}

/**
 * 枚举会议可用的音频设备（过滤 audioinput / audiooutput，丢弃其他 kind）
 * 无 navigator.mediaDevices 环境（极老内核 / 非安全上下文）返回空列表。
 */
export async function enumerateMeetingAudioDevices(): Promise<{
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}> {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
    return { inputs: [], outputs: [] };
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: devices.filter((d) => d.kind === 'audioinput'),
    outputs: devices.filter((d) => d.kind === 'audiooutput'),
  };
}

/**
 * 本页生命周期内只做一次「标签补齐」尝试：
 * Chromium 系内核（含 WebView2 / WebKitGTK）在来源未获 getUserMedia 授权前，
 * enumerateDevices 返回的设备 label 为空甚至完全不上报设备（WebKitGTK 直接给空列表），
 * 设置页下拉因此只有「系统默认」可选 —— 选择功能形同虚设。
 * 补齐：首次刷新若无任何标签，做一次瞬时 getUserMedia({audio:true}) 触发授权
 * （生产 WebView2 会弹系统权限框，用户允许后本源永久获得标签；拒绝则保持现状），
 * 轨道立即停止，不留采集。失败静默（维持旧行为），且每页只试一次防提示轰炸。
 */
let labelBootstrapAttempted = false;
export async function enumerateMeetingAudioDevicesLabeled(): Promise<{
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}> {
  const first = await enumerateMeetingAudioDevices();
  const hasLabel = first.inputs.some((d) => d.label) || first.outputs.some((d) => d.label);
  if (hasLabel || labelBootstrapAttempted) {
    return first;
  }
  labelBootstrapAttempted = true;
  if (!isDesktop() || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return first;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    // 用户拒绝 / 无设备：维持无标签枚举现状，不报错（与既有设计一致）
  }
  return enumerateMeetingAudioDevices();
}

/**
 * 设备显示名：未授权时 enumerateDevices 返回的 label 为空字符串
 * （Chromium 系授权前只给 kind + deviceId）。
 * 取舍：不做「先 getUserMedia 触发授权」——设置页被动展示不该弹权限框（侵扰 UX，
 * 且桌面 Tauri webview 可能已有持久授权、也可能没有，行为不可预期）；
 * 直接以「麦克风 N / 扬声器 N」序号化名兜底，用户点了具体设备（exact 约束）
 * getUserMedia 的授权弹窗会自然补齐 label，下次枚举即为真名。
 */
export function deviceDisplayLabel(device: MediaDeviceInfo, index: number): string {
  if (device.label && device.label.length > 0) {
    return device.label;
  }
  const kindName = device.kind === 'audioinput' ? '麦克风' : '扬声器';
  return `${kindName} ${index + 1}`;
}

/** 当前内核是否支持输出设备选择（setSinkId） */
export function supportsAudioOutputSelection(): boolean {
  return typeof HTMLMediaElement !== 'undefined'
    && 'setSinkId' in HTMLMediaElement.prototype;
}

/**
 * 将当前选中的输出设备应用到 <audio>/<video> 元素
 * - 不支持 setSinkId：静默跳过（上层 UI 已禁用输出下拉并标注，非静默无效果）
 * - 未选输出：重置为默认输出（setSinkId('') 清除绑定）
 * - 设备已拔出等失败：console.warn，不抛出（音频仍走原输出，UI 枚举刷新由 devicechange 负责）
 */
export function applyAudioOutputSink(element: HTMLMediaElement): void {
  if (!supportsAudioOutputSelection()) {
    return;
  }
  const outputId = getSelectedAudioOutputId();
  const target = outputId ?? '';
  try {
    const result = element.setSinkId(target) as unknown as Promise<void> | undefined;
    if (result && typeof result.then === 'function') {
      result.catch((err: unknown) => {
        console.warn('[audioDevices] setSinkId 应用失败（设备可能已断开）:', err);
      });
    }
  } catch (err) {
    console.warn('[audioDevices] setSinkId 调用异常:', err);
  }
}

/**
 * 订阅设备/偏好变化（双通道）：
 * - devicechange：设备插拔（含枚举刷新后 label 从化名变真名的场景）
 * - storage：其他窗口写入 MEETING_AUDIO_DEVICES_KEY（主窗设置 → 会议窗热切换）
 * 返回解绑函数；移动端（无设置入口）不应调用本函数（调用层 isDesktop 门控）。
 */
export function subscribeMeetingAudioDevices(listener: MeetingAudioDevicesListener): () => void {
  listeners.add(listener);

  const mediaDevices = navigator.mediaDevices;
  const onDeviceChange = () => listener();
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === MEETING_AUDIO_DEVICES_KEY || ev.key === null) {
      listener();
    }
  };

  if (mediaDevices && typeof mediaDevices.addEventListener === 'function') {
    mediaDevices.addEventListener('devicechange', onDeviceChange);
  }
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    if (mediaDevices && typeof mediaDevices.removeEventListener === 'function') {
      mediaDevices.removeEventListener('devicechange', onDeviceChange);
    }
    window.removeEventListener('storage', onStorage);
  };
}
