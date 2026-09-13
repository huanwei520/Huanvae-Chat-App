/**
 * 安卓屏幕共享采集桥（MediaProjection 插件 → canvas → MediaStream）
 *
 * ## 为什么独立成模块
 * Android WebView 不支持 navigator.mediaDevices.getDisplayMedia（桌面端屏幕共享
 * 的取流入口），屏幕画面须由原生层 MediaProjection 采集后送入 WebView。本模块把
 * 「插件帧通道 → canvas 绘帧 → canvas.captureStream()」封装成与 getDisplayMedia
 * 同形的取流 API，useWebRTC.toggleScreenShare 按 Android 平台分流调用，其余
 * WebRTC 链路（screen transceiver / media_state / 对端渲染）桌面移动共用零分叉。
 *
 * ## 原生链路（tauri-plugin-screen-capture，仅安卓注册）
 *   invoke('plugin:screen-capture|capture_start', { channel, … })
 *     → 系统授权弹窗（createScreenCaptureIntent，用户可拒绝）
 *     → mediaProjection 前台服务（Android 14：FOREGROUND_SERVICE_MEDIA_PROJECTION）
 *     → VirtualDisplay + ImageReader → JPEG Base64 帧 → Channel
 *   本模块逐帧绘入 canvas；captureStream(0) + requestFrame() 精确按帧推进。
 *
 * ## 停止语义（与桌面 track.onended 同构）
 * - 本端主动停止：useWebRTC.stopScreenShareInternal 会 track.stop() → 本模块
 *   'ended' 监听同步调 capture_stop（幂等）；
 * - 用户从系统投影条/通知停止：原生发 { type:'stopped' } → 本模块 track.stop()
 *   → useWebRTC 既有 onended → stopScreenShareInternal（UI 状态归零）。
 *
 * ## 隐私红线
 * 帧数据只经内存通道流动（插件侧不落盘不打日志）；发起共享前的敏感内容提示
 * 由 UI 层（MobileMeetingPage 确认弹窗）负责。
 *
 * @module meeting/androidScreenShare
 */

import { invoke, Channel } from '@tauri-apps/api/core';

/** 插件命令面（tauri-plugin-screen-capture，仅安卓注册） */
const CMD = {
  start: 'plugin:screen-capture|capture_start',
  stop: 'plugin:screen-capture|capture_stop',
} as const;

/** 采集参数（插件侧带安全缺省与钳制） */
export interface AndroidScreenShareOptions {
  /** 虚拟显示宽（像素，缺省 720，#4 起与设备纵横比联动由调用方计算） */
  width?: number;
  /** 虚拟显示高（像素，缺省 1600） */
  height?: number;
  /** 帧率上限（缺省 15，插件钳制 1-30） */
  fps?: number;
  /** JPEG 质量 20-90（缺省 70） */
  quality?: number;
}

/** 一次屏幕共享采集会话（stream 注入 useWebRTC，stop 幂等释放原生采集） */
export interface AndroidScreenShareSession {
  stream: MediaStream;
  stop: () => Promise<void>;
}

/** 插件帧通道下行消息 */
interface CaptureMessage {
  type: 'frame' | 'started' | 'stopped' | 'consent' | 'error';
  width?: number;
  height?: number;
  data?: string;
  authorized?: boolean;
  message?: string;
}

/** 运行中会话（模块级单例：同一时刻至多一路屏幕共享） */
let activeSession: {
  sessionId: number;
  cleanup: () => void;
} | null = null;

/** 会话序号发生器（单例身份判定） */
let sessionCounter = 0;

/** 运行时调试探针（设备级 E2E / 运维用：window.__hgSS） */
interface ScreenShareDebugProbe {
  framesRcvd: number;
  drawn: number;
  lastFrameAt: number;
  err: string;
  consentOk: boolean;
  canvas: { w: number; h: number } | null;
  trackMuted: boolean | null;
  /** requestFrame 泵累计强采帧数（静屏持续推流计数） */
  pumped: number;
  // —— 1d0t34vy 打桩扩展（IPC→JS 段计数；卡帧逐段定位用）——
  /** 收到的 base64 字符长度累计（≈帧载荷字节，含 base64 膨胀） */
  bytesRcvd: number;
  /** Image 解码失败次数 */
  decodeErr: number;
  /** 最近一次帧解码+绘制耗时（ms，从帧挂起到 onload 绘毕） */
  decodeMsLast: number;
  /** 帧处理耗时峰值（ms） */
  decodeMsMax: number;
  /** 帧处理耗时均值（ms） */
  decodeMsAvg: number;
  /** 原生帧到达间隔峰值（ms；持续 > 2×帧周期 = 采集/IPC 段疑似停流） */
  nativeGapMsMax: number;
  /** 当前挂起帧年龄（ms；持续增长不回落 = 解码链卡死） */
  readonly pendingAgeMs: number;
  /** 最近一次绘帧时间戳（0 = 尚未绘出任何帧） */
  drawnAt: number;
}
const debugProbe: ScreenShareDebugProbe = {
  framesRcvd: 0,
  drawn: 0,
  lastFrameAt: 0,
  err: '',
  consentOk: false,
  canvas: null,
  trackMuted: null,
  pumped: 0,
  bytesRcvd: 0,
  decodeErr: 0,
  decodeMsLast: 0,
  decodeMsMax: 0,
  decodeMsAvg: 0,
  nativeGapMsMax: 0,
  get pendingAgeMs() {
    return pendingFrameAt > 0 ? Date.now() - pendingFrameAt : 0;
  },
  drawnAt: 0,
};

/** 当前挂起帧的入队时间戳（0 = 无挂起帧；pendingAgeMs getter 读它） */
let pendingFrameAt = 0;
/** 帧处理耗时累计（均值分母 = 已完成帧数） */
let decodeMsTotal = 0;
let decodeMsCount = 0;

const pushProbe = () => {
  (window as unknown as { __hgSS?: ScreenShareDebugProbe }).__hgSS = debugProbe;
};
pushProbe();

/**
 * 当前是否为安卓平台（UA 关键词判定，与 utils/platform 同策略）
 */
export function isAndroidPlatform(): boolean {
  return /android/.test(navigator.userAgent.toLowerCase());
}

/**
 * 安卓屏幕共享是否可用：安卓 UA + Tauri IPC 注入存在。
 * 插件未注册（非 Tauri 环境预览等）时返回 false，UI 层据此隐藏入口。
 */
export function isAndroidScreenShareSupported(): boolean {
  const tauriInternals = (
    window as unknown as { __TAURI_INTERNALS__?: unknown }
  ).__TAURI_INTERNALS__;
  return isAndroidPlatform() && typeof tauriInternals !== 'undefined';
}

/**
 * 发起安卓屏幕共享采集（对齐桌面 getDisplayMedia 形态的取流入口）。
 *
 * 流程：创建帧通道 → invoke capture_start（阻塞至系统授权弹窗出结果）→
 * 授权成功后原生逐帧推送 → canvas 绘帧 → captureStream 返回。
 * 用户拒绝授权：reject 'screen_capture_denied'。
 */
export async function startAndroidScreenShare(
  options: AndroidScreenShareOptions = {},
): Promise<AndroidScreenShareSession> {
  if (!isAndroidScreenShareSupported()) {
    throw new Error('screen_capture_unsupported');
  }
  if (activeSession) {
    throw new Error('screen_capture_already_active');
  }

  const channel = new Channel<CaptureMessage>();

  // canvas：原生帧的绘制面（尺寸按采集参数，drawImage 等比填充）
  const canvas = document.createElement('canvas');
  canvas.width = options.width ?? 1280;
  canvas.height = options.height ?? 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('screen_capture_no_canvas_context');
  }
  // 首帧前先铺黑底：requestFrame 泵在原生帧到达前也能产出有效帧（轨道不因空画布失效）
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // captureStream(0)：手动 requestFrame 推帧，避免与解码节奏竞速产生空帧
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  if (!track) {
    throw new Error('screen_capture_no_track');
  }

  // ---- 帧泵：仅保留最新帧（背压丢弃），解码完即绘 + requestFrame ----
  let pendingFrame: string | null = null;
  let decoding = false;
  /** 上一原生帧到达时刻（间隔峰值 = nativeGapMsMax） */
  let prevFrameAt = 0;

  // ---- requestFrame 泵（静态屏幕关键防线 · WebView 变体）----
  // MediaProjection 只在屏幕内容变化时产新帧；会议页静止时原生零帧。
  // 实测（2026-09-10 模拟器）：WebView 上对「内容未变的 canvas」requestFrame()
  // 会被去重为空采（loopback 实验同内容零编码帧，sender bytes=0），仅重画
  // （canvas 自拷贝 drawImage）再 requestFrame 才真实产帧。故每拍先自拷贝
  // dirty 化画布再强采：静屏也持续推最后一帧，轨道保持 unmuted，与桌面
  // getDisplayMedia 行为对齐。
  const pumpFps = options.fps ?? 15;
  const framePump = setInterval(() => {
    if (channelClosed) { return; }
    try {
      ctx.drawImage(canvas, 0, 0);
    } catch {
      /* 画布不可绘时跳过 dirty 化，requestFrame 仍按原节奏尝试 */
    }
    if (typeof track.requestFrame === 'function') {
      track.requestFrame();
      debugProbe.pumped += 1;
    }
  }, Math.max(33, Math.floor(1000 / pumpFps)));

  const drawPending = () => {
    if (pendingFrame === null) {
      decoding = false;
      pendingFrameAt = 0;
      return;
    }
    const src = pendingFrame;
    pendingFrame = null;
    const startedAt = Date.now();
    const img = new Image();
    img.onload = () => {
      const decodeMs = Date.now() - startedAt;
      debugProbe.decodeMsLast = decodeMs;
      debugProbe.decodeMsMax = Math.max(debugProbe.decodeMsMax, decodeMs);
      decodeMsTotal += decodeMs;
      decodeMsCount += 1;
      debugProbe.decodeMsAvg = Math.round(decodeMsTotal / Math.max(1, decodeMsCount));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      debugProbe.drawn += 1;
      debugProbe.drawnAt = Date.now();
      if (typeof track.requestFrame === 'function') {
        track.requestFrame();
      } else {
        debugProbe.err = 'requestFrame unavailable';
      }
      pushProbe();
      drawPending();
    };
    img.onerror = () => {
      debugProbe.err = 'image decode failed';
      debugProbe.decodeErr += 1;
      pushProbe();
      drawPending();
    };
    img.src = `data:image/jpeg;base64,${src}`;
  };

  // ---- 会话句柄 ----
  let channelClosed = false;
  const sessionId = ++sessionCounter;
  debugProbe.framesRcvd = 0;
  debugProbe.drawn = 0;
  debugProbe.err = '';
  debugProbe.consentOk = false;
  debugProbe.canvas = { w: canvas.width, h: canvas.height };
  debugProbe.pumped = 0;
  debugProbe.bytesRcvd = 0;
  debugProbe.decodeErr = 0;
  debugProbe.decodeMsLast = 0;
  debugProbe.decodeMsMax = 0;
  debugProbe.decodeMsAvg = 0;
  debugProbe.nativeGapMsMax = 0;
  debugProbe.drawnAt = 0;
  decodeMsTotal = 0;
  decodeMsCount = 0;
  pushProbe();

  const cleanup = () => {
    if (channelClosed) { return; }
    channelClosed = true;
    pendingFrame = null;
    pendingFrameAt = 0;
    prevFrameAt = 0;
    clearInterval(framePump);
    // 触发 useWebRTC 既有 track.onended → stopScreenShareInternal（幂等）
    try {
      track.stop();
    } catch {
      /* 已停止 */
    }
    if (activeSession?.sessionId === sessionId) {
      activeSession = null;
    }
  };

  const stop = async () => {
    try {
      await invoke(CMD.stop);
    } finally {
      cleanup();
    }
  };

  const session: AndroidScreenShareSession = { stream, stop };

  channel.onmessage = (message: CaptureMessage) => {
    switch (message.type) {
      case 'frame':
        if (message.data && !channelClosed) {
          const now = Date.now();
          debugProbe.framesRcvd += 1;
          debugProbe.bytesRcvd += message.data.length;
          debugProbe.lastFrameAt = now;
          if (debugProbe.framesRcvd >= 2) {
            debugProbe.nativeGapMsMax = Math.max(
              debugProbe.nativeGapMsMax,
              now - prevFrameAt,
            );
          }
          prevFrameAt = now;
          debugProbe.trackMuted = track.muted;
          pushProbe();
          if (debugProbe.framesRcvd <= 3 || debugProbe.framesRcvd % 100 === 0) {
            console.warn(
              `[androidScreenShare] frame#${debugProbe.framesRcvd} bytes=${message.data.length} muted=${track.muted}`,
            );
          }
          pendingFrame = message.data;
          pendingFrameAt = now;
          if (!decoding) {
            decoding = true;
            drawPending();
          }
        }
        break;
      case 'started':
        debugProbe.consentOk = true;
        pushProbe();
        break;
      case 'consent':
        if (message.authorized === false && !channelClosed) {
          // 用户拒绝系统授权弹窗
          cleanup();
        }
        break;
      case 'stopped':
        // 用户从系统投影条/通知停止 → 归零整条链路
        cleanup();
        break;
      case 'error':
        console.warn('[androidScreenShare] capture error:', message.message);
        cleanup();
        break;
    }
  };

  // canvas 轨被外部 stop（useWebRTC 停止链路）→ 同步停原生采集（幂等）
  track.addEventListener('ended', () => {
    void invoke(CMD.stop).catch(() => undefined);
  });

  try {
    const ret = await invoke<{ ok?: boolean; authorized?: boolean }>(CMD.start, {
      channel,
      width: canvas.width,
      height: canvas.height,
      fps: options.fps ?? 15,
      quality: options.quality ?? 70,
    });
    if (ret?.authorized === false) {
      throw new Error('screen_capture_denied');
    }
    activeSession = { sessionId, cleanup };
    return session;
  } catch (err) {
    cleanup();
    void invoke(CMD.stop).catch(() => undefined);
    throw err;
  }
}

/**
 * 停止当前采集会话（幂等；无会话时仅透传插件 stop）。
 */
export async function stopAndroidScreenShare(): Promise<void> {
  activeSession?.cleanup();
  activeSession = null;
  try {
    await invoke(CMD.stop);
  } catch {
    /* 幂等：插件未注册/未启动时忽略 */
  }
}
