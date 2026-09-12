/**
 * androidScreenShare 模块单测（jsdom + mock @tauri-apps/api/core + fake canvas）
 *
 * 覆盖 JS 层可确定性驱动的部分：
 * - 平台/能力门禁：isAndroidPlatform（UA 判定）、isAndroidScreenShareSupported
 *   （Tauri IPC 注入探测）
 * - startAndroidScreenShare：插件命令调用形态（plugin:screen-capture|capture_start）、
 *   参数传递（width/height/fps/quality + channel）、canvas captureStream 取轨、
 *   帧消息绘帧推进（requestFrame）、用户拒绝授权（authorized:false → reject）、
 *   非安卓环境 unsupported reject
 * - stopAndroidScreenShare / track ended：capture_stop 幂等透传
 *
 * jsdom 无真实 canvas/JPEG 解码，绘帧断言为「drawImage/requestFrame 被调」级别；
 * 真实采集链路由设备级 E2E（MediaProjection 前台服务 + WebRTC 对端观看）覆盖。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- mock @tauri-apps/api/core ----
const tauriControl = vi.hoisted(() => {
  const invocations: Array<{ cmd: string; args?: unknown }> = [];
  let invokeImpl: (cmd: string, args?: unknown) => unknown = () => ({});
  class FakeChannel<T> {
    static instances: FakeChannel<unknown>[] = [];
    onmessage: ((msg: T) => void) | null = null;
    constructor() {
      FakeChannel.instances.push(this as FakeChannel<unknown>);
    }
    /** 测试助手：模拟原生帧通道下行 */
    emit(msg: T) {
      this.onmessage?.(msg);
    }
  }
  return {
    invocations,
    FakeChannel,
    setInvokeImpl: (impl: (cmd: string, args?: unknown) => unknown) => {
      invokeImpl = impl;
    },
    invoke: (cmd: string, args?: unknown) => {
      invocations.push({ cmd, args });
      return Promise.resolve(invokeImpl(cmd, args));
    },
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => tauriControl.invoke(cmd, args),
  Channel: tauriControl.FakeChannel,
}));

import {
  isAndroidPlatform,
  isAndroidScreenShareSupported,
  startAndroidScreenShare,
  stopAndroidScreenShare,
} from '../../src/meeting/androidScreenShare';

// ---- fake canvas / MediaStream ----
type FakeTrack = MediaStreamTrack & { requestFrame?: () => void; stop: () => void };

function installFakeCanvas() {
  const framesRequested: number[] = [];
  const draws: Array<{ w: number; h: number }> = [];
  const stopped: FakeTrack[] = [];
  let trackSeq = 0;

  const makeTrack = (): FakeTrack => {
    const track = {
      kind: 'video',
      id: `fake-track-${++trackSeq}`,
      readyState: 'live',
      muted: false,
      enabled: true,
      contentHint: '',
      label: 'fake-canvas',
      requestFrame: () => {
        framesRequested.push(framesRequested.length);
      },
      stop: () => {
        stopped.push(track);
        (track as unknown as { readyState: string }).readyState = 'ended';
        track.onended?.(new Event('ended'));
      },
      addEventListener: (_t: string, l: (ev: Event) => void) => {
        (track as unknown as { _endedListener?: (ev: Event) => void })._endedListener = l;
      },
      removeEventListener: () => undefined,
      onended: (null as unknown as MediaStreamTrack['onended']),
    } as unknown as FakeTrack;
    return track;
  };

  const track = makeTrack();

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => ({
      drawImage: vi.fn((_img: unknown, _x: number, _y: number, w: number, h: number) => {
        draws.push({ w, h });
      }),
      // 首帧前铺黑底（真实 ctx 行为）；断言只需其被调用即可
      fillRect: vi.fn((_x: number, _y: number, _w: number, _h: number) => undefined),
      fillStyle: '#000000',
    })),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
    configurable: true,
    value: vi.fn(() => {
      const stream = {
        getVideoTracks: () => [track],
        getTracks: () => [track],
        getCanvasCaptureMediaStreamTracks: () => [track],
      } as unknown as MediaStream;
      return stream;
    }),
  });

  return {
    framesRequested,
    draws,
    stopped,
    track,
    restore: () => {
      Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext');
      Reflect.deleteProperty(HTMLCanvasElement.prototype, 'captureStream');
    },
  };
}

/** jsdom 的 HTMLImageElement 不真解码：把 Image.onload 置为微任务后直呼 */
function installFakeImage() {
  class FakeImage {
    static instances: FakeImage[] = [];
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
    constructor() {
      FakeImage.instances.push(this);
      queueMicrotask(() => {
        if (this.src.startsWith('data:image/jpeg;base64,')) {
          this.onload?.();
        } else {
          this.onerror?.();
        }
      });
    }
  }
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
  return FakeImage;
}

const setUA = (ua: string) => {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: ua,
  });
};

const setTauriInternals = (present: boolean) => {
  if (present) {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  } else {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
};

describe('androidScreenShare 平台/能力门禁', () => {
  beforeEach(() => {
    tauriControl.invocations.length = 0;
    tauriControl.FakeChannel.instances.length = 0;
    tauriControl.setInvokeImpl(() => Promise.resolve({}));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('安卓 UA 判定 isAndroidPlatform', () => {
    setUA('Mozilla/5.0 (Linux; Android 14; Emulator) Chrome/120 Mobile Safari/537.36');
    expect(isAndroidPlatform()).toBe(true);
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36');
    expect(isAndroidPlatform()).toBe(false);
  });

  it('isAndroidScreenShareSupported：安卓 UA + Tauri IPC 注入双条件', () => {
    setUA('Mozilla/5.0 (Linux; Android 14) Mobile Chrome/120');
    setTauriInternals(false);
    expect(isAndroidScreenShareSupported()).toBe(false);
    setTauriInternals(true);
    expect(isAndroidScreenShareSupported()).toBe(true);
    // 桌面 UA：即便有 IPC 注入也不可用（插件仅安卓注册）
    setUA('Mozilla/5.0 (Windows NT 10.0) Chrome/120');
    expect(isAndroidScreenShareSupported()).toBe(false);
  });
});

describe('startAndroidScreenShare', () => {
  beforeEach(() => {
    tauriControl.invocations.length = 0;
    tauriControl.FakeChannel.instances.length = 0;
    tauriControl.setInvokeImpl(() => Promise.resolve({}));
    setUA('Mozilla/5.0 (Linux; Android 14) Mobile Chrome/120');
    setTauriInternals(true);
  });
  afterEach(async () => {
    // 模块级单例（activeSession）跨用例清理，避免 already_active 串扰
    await stopAndroidScreenShare();
    vi.unstubAllGlobals();
  });

  it('非安卓环境直接拒绝 screen_capture_unsupported，不触达插件', async () => {
    setUA('Mozilla/5.0 (Windows NT 10.0) Chrome/120');
    await expect(startAndroidScreenShare()).rejects.toThrow('screen_capture_unsupported');
    expect(tauriControl.invocations).toHaveLength(0);
  });

  it('发起采集：命令/参数形态正确，返回带视频轨的 stream', async () => {
    const fake = installFakeCanvas();
    try {
      const session = await startAndroidScreenShare({ width: 1280, height: 720, fps: 10, quality: 60 });
      const track = session.stream.getVideoTracks()[0];
      expect(track).toBeTruthy();
      expect(track.kind).toBe('video');

      // 命令面：plugin:screen-capture|capture_start
      const startCall = tauriControl.invocations.find((c) => c.cmd === 'plugin:screen-capture|capture_start');
      expect(startCall).toBeTruthy();
      if (!startCall) {
        throw new Error('capture_start 未被调用');
      }
      const args = startCall.args as Record<string, unknown>;
      expect(args.width).toBe(1280);
      expect(args.height).toBe(720);
      expect(args.fps).toBe(10);
      expect(args.quality).toBe(60);
      // 帧通道已随参数下发
      expect(tauriControl.FakeChannel.instances).toHaveLength(1);
    } finally {
      fake.restore();
    }
  });

  it('帧消息绘入 canvas 并 requestFrame 推进（latest-only 背压）', async () => {
    const fake = installFakeCanvas();
    const FakeImage = installFakeImage();
    try {
      const session = await startAndroidScreenShare({ width: 640, height: 360 });
      const channel = tauriControl.FakeChannel.instances[0] as unknown as {
        emit: (msg: unknown) => void;
      };

      channel.emit({ type: 'frame', data: 'QUJD', width: 640, height: 360 });
      channel.emit({ type: 'frame', data: 'REVG', width: 640, height: 360 });
      // Image 解码是微任务，等一拍
      await new Promise((r) => {
        setTimeout(r, 0);
      });
      await new Promise((r) => {
        setTimeout(r, 0);
      });

      // 解码后的帧绘入 canvas（fake Image 两帧都触发 onload → drawImage ≥ 1 次）
      expect(fake.draws.length).toBeGreaterThanOrEqual(1);
      expect(fake.framesRequested.length).toBeGreaterThanOrEqual(1);
      // 收到的 base64 均被实例化为 Image
      expect(FakeImage.instances.length).toBe(2);
      session.stop();
    } finally {
      fake.restore();
    }
  });

  it('停止：track.stop 触发 capture_stop 幂等透传', async () => {
    const fake = installFakeCanvas();
    try {
      const session = await startAndroidScreenShare();
      await session.stop();
      const stopCall = tauriControl.invocations.find((c) => c.cmd === 'plugin:screen-capture|capture_stop');
      expect(stopCall).toBeTruthy();
      expect(fake.stopped).toContain(session.stream.getVideoTracks()[0]);
    } finally {
      fake.restore();
    }
  });

  it('用户拒绝系统授权弹窗（authorized:false）→ reject screen_capture_denied', async () => {
    const fake = installFakeCanvas();
    try {
      tauriControl.setInvokeImpl((_cmd, args) => {
        // 模拟插件 captureConsentResult：用户点了「取消」
        if (_cmd === 'plugin:screen-capture|capture_start') {
          const a = args as { width?: number };
          void a;
          return { ok: true, authorized: false };
        }
        return {};
      });
      await expect(startAndroidScreenShare()).rejects.toThrow('screen_capture_denied');
    } finally {
      fake.restore();
    }
  });

  it('原生 stopped 消息（用户系统投影条停止）→ 本地轨归零', async () => {
    const fake = installFakeCanvas();
    try {
      const session = await startAndroidScreenShare();
      const channel = tauriControl.FakeChannel.instances[0] as unknown as {
        emit: (msg: unknown) => void;
      };
      channel.emit({ type: 'stopped' });
      expect((session.stream.getVideoTracks()[0].readyState as string)).toBe('ended');
    } finally {
      fake.restore();
    }
  });
});

describe('stopAndroidScreenShare 模块级停止', () => {
  beforeEach(() => {
    tauriControl.invocations.length = 0;
    tauriControl.setInvokeImpl(() => Promise.resolve({}));
    setUA('Mozilla/5.0 (Linux; Android 14) Mobile Chrome/120');
    setTauriInternals(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('无会话时仅透传 capture_stop（幂等，不抛错）', async () => {
    await expect(stopAndroidScreenShare()).resolves.toBeUndefined();
    expect(
      tauriControl.invocations.some((c) => c.cmd === 'plugin:screen-capture|capture_stop'),
    ).toBe(true);
  });
});
