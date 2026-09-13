/**
 * 屏享帧流水打桩探针（诊断仪表 · opt-in，生产零自动激活）
 *
 * ## 目的（任务块 1d0t34vy #1）
 * 屏享「TUN 中继对端黑屏 / LAN 对端只见第一帧后冻结」需要逐段计数定位卡死段：
 *   采集(Kotlin) → IPC→JS(__hgSS) → canvas→captureStream → WebRTC 编码发送 →
 *   网络中继 → 解码 → 渲染(video rVFC)。
 * 本模块覆盖「编码发送 → 网络 → 解码 → 渲染」四段（采集/IPC 两段见
 * androidScreenShare 的 __hgSS 探针与 ScreenCaptureService logcat `frame #N`）。
 *
 * ## 激活纪律
 * **不自动启动**。仅当 CDP/调试者显式调用 `window.__hgSSPipe.start(opts)` 才采样，
 * 常规构建与生产路径零开销（无定时器、无 getStats 轮询）。这同 __hgSS 的
 * 「运行时调试探针」先例：设备级 E2E / 运维专用。
 *
 * ## 采样内容
 * - sender 段：screen sender 的 outbound-rtp（bytesSent/framesEncoded/
 *   keyFramesEncoded/qpSum/framesPerSecond/targetBitrate/encoderImplementation/
 *   qualityLimitationReason）Δ值序列。
 * - path 段：当前选中 candidate-pair 的 local/remote candidate 类型与地址
 *   （host/srflx/relay → 判定 LAN 直连还是中继路径），变更时记录+周期记录。
 * - receiver 段：全部视频 inbound-rtp（bytesReceived/framesDecoded/keyFramesDecoded/
 *   frameWidth/Height/freezeCount/totalFreezesDuration/pliCount/nackCount/
 *   packetsLost/jitterBufferDelay/decoderImplementation）Δ值序列。
 * - render 段：对指定 <video> 元素挂 requestVideoFrameCallback 计数
 *   （presentedFrames 推进 = 渲染段存活的直接证据）。
 *
 * ## 数据面
 * `window.__hgSSPipe.dump()` 返回全量计数 JSON（含 Δ 历史，环形截断），
 * E2E 驱动经 CDP Runtime.evaluate 取走落盘，本模块不落盘不上报。
 *
 * @module meeting/screenShareProbe
 */

/** 单次采样快照（原始读数；Δ 由 sampler 与上一帧对比计算） */
export interface RtpSample {
  t: number;
  bytes: number;
  frames: number;
  keyFrames: number;
  qpSum: number;
  fps: number;
  targetBitrate?: number;
  qualityLimitation?: string;
  packetsLost: number;
  fractionLost: number;
  rtt: number;
  width: number;
  height: number;
  freezeCount: number;
  freezesDuration: number;
  pli: number;
  nack: number;
  fir: number;
  jitterDelay: number;
  jitterEmitted: number;
  framesDropped: number;
  encoder?: string;
  decoder?: string;
}

/** 相邻两次采样的增量（诊断的最小信息单元） */
export interface RtpDelta {
  t: number;
  dtMs: number;
  bytes: number;
  frames: number;
  keyFrames: number;
  qpSum: number;
  bitrateKbps: number;
  fps: number;
  targetBitrateKbps?: number;
  qualityLimitation?: string;
  packetsLost: number;
  fractionLost: number;
  rtt: number;
  width: number;
  height: number;
  freezeCount: number;
  freezesDuration: number;
  pli: number;
  nack: number;
  fir: number;
  jitterDelayMs: number;
  framesDropped: number;
  encoder?: string;
  decoder?: string;
}

/** candidate-pair 路径快照 */
export interface PathSnapshot {
  t: number;
  state: string;
  nominated: boolean;
  localType: string;
  localAddr: string;
  remoteType: string;
  remoteAddr: string;
}

/** 渲染段探针读数 */
export interface RenderProbe {
  videoWidth: number;
  videoHeight: number;
  readyState: number;
  currentTime: number;
  presentedFrames: number;
  rVfcCount: number;
  rVfcUnsupported: boolean;
}

const HISTORY_MAX = 600;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 原始读数 → 与上一样本的增量（纯函数，单测覆盖） */
export function deltaOf(prev: RtpSample, cur: RtpSample): RtpDelta {
  const dtMs = Math.max(1, cur.t - prev.t);
  return {
    t: cur.t,
    dtMs,
    bytes: Math.max(0, cur.bytes - prev.bytes),
    frames: Math.max(0, cur.frames - prev.frames),
    keyFrames: Math.max(0, cur.keyFrames - prev.keyFrames),
    qpSum: Math.max(0, cur.qpSum - prev.qpSum),
    bitrateKbps: Math.round((Math.max(0, cur.bytes - prev.bytes) * 8) / (dtMs / 1000) / 1000),
    fps: cur.fps,
    targetBitrateKbps: cur.targetBitrate !== undefined ? Math.round(cur.targetBitrate / 1000) : undefined,
    qualityLimitation: cur.qualityLimitation,
    packetsLost: Math.max(0, cur.packetsLost - prev.packetsLost),
    fractionLost: cur.fractionLost,
    rtt: cur.rtt,
    width: cur.width,
    height: cur.height,
    freezeCount: cur.freezeCount,
    freezesDuration: cur.freezesDuration,
    pli: cur.pli,
    nack: cur.nack,
    fir: cur.fir,
    jitterDelayMs: cur.jitterDelay > 0 && cur.jitterEmitted > 0
      ? Math.round((cur.jitterDelay / cur.jitterEmitted) * 1000)
      : 0,
    framesDropped: cur.framesDropped,
    encoder: cur.encoder,
    decoder: cur.decoder,
  };
}

/** RTCStatsReport → { sender: outbound 原始读数, receivers: inbound 原始读数(mid→) }（纯函数，单测覆盖） */
export function sampleFromStats(report: Map<string, Record<string, unknown>>): {
  sender: RtpSample | null;
  receivers: Map<string, RtpSample>;
} {
  let sender: RtpSample | null = null;
  const receivers = new Map<string, RtpSample>();
  report.forEach((s, id) => {
    if (s.type !== 'outbound-rtp' && s.type !== 'inbound-rtp') { return; }
    if (s.kind !== 'video' && s.mediaType !== 'video') { return; }
    let rtt = 0;
    const pairId = s.pairId;
    if (typeof pairId === 'string') {
      const pair = report.get(pairId);
      if (pair && typeof pair.currentRoundTripTime === 'number') { rtt = pair.currentRoundTripTime * 1000; }
    }
    const sample: RtpSample = {
      t: Date.now(),
      bytes: num(s.bytesSent) + num(s.bytesReceived),
      frames: num(s.framesEncoded) + num(s.framesDecoded),
      keyFrames: num(s.keyFramesEncoded) + num(s.keyFramesDecoded),
      qpSum: num(s.qpSum),
      fps: num(s.framesPerSecond),
      targetBitrate: typeof s.targetBitrate === 'number' ? s.targetBitrate : undefined,
      qualityLimitation: typeof s.qualityLimitationReason === 'string' ? s.qualityLimitationReason : undefined,
      packetsLost: num(s.packetsLost),
      fractionLost: num(s.fractionLost),
      rtt,
      width: num(s.frameWidth),
      height: num(s.frameHeight),
      freezeCount: num(s.freezeCount),
      freezesDuration: num(s.totalFreezesDuration),
      pli: num(s.pliCount),
      nack: num(s.nackCount),
      fir: num(s.firCount),
      jitterDelay: num(s.jitterBufferDelay),
      jitterEmitted: num(s.jitterBufferEmittedCount),
      framesDropped: num(s.framesDropped),
      encoder: typeof s.encoderImplementation === 'string' ? s.encoderImplementation : undefined,
      decoder: typeof s.decoderImplementation === 'string' ? s.decoderImplementation : undefined,
    };
    if (s.type === 'outbound-rtp') {
      if (sender === null || sample.frames > sender.frames) { sender = sample; }
    } else {
      const mid = typeof s.mid === 'string' && s.mid !== '' ? s.mid : `id:${id}`;
      receivers.set(mid, sample);
    }
  });
  return { sender, receivers };
}

async function pathSnapshot(pc: RTCPeerConnection): Promise<PathSnapshot | null> {
  let report: RTCStatsReport;
  try {
    report = await pc.getStats();
  } catch {
    return null;
  }
  const stats: Record<string, unknown>[] = [];
  report.forEach((s) => {
    stats.push(s as unknown as Record<string, unknown>);
  });
  const byId = new Map(stats.map((s) => [String(s.id), s]));
  const pair = stats.find((s) => s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated === true)
    ?? stats.find((s) => s.type === 'candidate-pair' && s.state === 'succeeded');
  if (!pair) { return null; }
  const read = (id: unknown): { type: string; addr: string } => {
    if (typeof id !== 'string') { return { type: '?', addr: '?' }; }
    const c = byId.get(id);
    if (!c) { return { type: '?', addr: '?' }; }
    return {
      type: typeof c.candidateType === 'string' ? c.candidateType : '?',
      addr: typeof c.ip === 'string' ? `${c.ip}:${String(c.port ?? '?')}` : '?',
    };
  };
  return {
    t: Date.now(),
    state: String(pair.state ?? '?'),
    nominated: pair.nominated === true,
    localType: read(pair.localCandidateId).type,
    localAddr: read(pair.localCandidateId).addr,
    remoteType: read(pair.remoteCandidateId).type,
    remoteAddr: read(pair.remoteCandidateId).addr,
  };
}

/** 全局单例状态（window.__hgSSPipe） */
export interface ScreenSharePipeProbe {
  /** 采样周期 ms（缺省 1000） */
  intervalMs: number;
  running: boolean;
  startedAt: number;
  /** sender Δ 序列（按采样顺序） */
  senderHistory: RtpDelta[];
  /** receiver Δ 序列（key = inbound mid） */
  receiverHistory: Map<string, RtpDelta[]>;
  /** candidate path 快照序列 */
  pathHistory: PathSnapshot[];
  /** 渲染段（installRenderProbe 后存在） */
  render: RenderProbe | null;
  /** 最近一次错误（getStats 抛错等） */
  err: string;
  start: (opts?: { intervalMs?: number }) => void;
  stop: () => void;
  dump: () => string;
  installRenderProbe: (video: HTMLVideoElement) => void;
}

let singleton: ScreenSharePipeProbe | null = null;

/**
 * 收集当前页面的全部 RTCPeerConnection（由 useWebRTC 注入 window.__hgPCs）。
 * 返回数组拷贝；无注入时返回空。
 */
export function collectPeerConnections(): RTCPeerConnection[] {
  const holder = (window as unknown as { __hgPCs?: Map<string, RTCPeerConnection> }).__hgPCs;
  if (!holder || typeof holder.values !== 'function') { return []; }
  return Array.from(holder.values());
}

/** 取全局探针单例（惰性创建，挂到 window.__hgSSPipe） */
export function getScreenSharePipeProbe(): ScreenSharePipeProbe {
  if (singleton) { return singleton; }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let renderInstalledAt = 0;
  const prevSender = new WeakMap<RTCPeerConnection, RtpSample>();
  const prevReceivers = new WeakMap<RTCPeerConnection, Map<string, RtpSample>>();

  const probe: ScreenSharePipeProbe = {
    intervalMs: 1000,
    running: false,
    startedAt: 0,
    senderHistory: [],
    receiverHistory: new Map(),
    pathHistory: [],
    render: null,
    err: '',
    start(opts) {
      probe.intervalMs = Math.max(200, opts?.intervalMs ?? 1000);
      if (probe.running) { return; }
      probe.running = true;
      probe.startedAt = Date.now();
      probe.err = '';
      const tick = async () => {
        if (!probe.running) { return; }
        try {
          // 逐 PC 顺序采样（诊断探针，PC 量级 ≤ 2，无需并行）
          for (const pc of collectPeerConnections()) {
            // eslint-disable-next-line no-await-in-loop
            const report = await pc.getStats();
            const statsMap = new Map<string, Record<string, unknown>>();
            report.forEach((s) => {
              statsMap.set(s.id, s as unknown as Record<string, unknown>);
            });
            const { sender, receivers } = sampleFromStats(statsMap);
            if (sender) {
              const prevRaw = prevSender.get(pc);
              if (prevRaw) {
                probe.senderHistory.push(deltaOf(prevRaw, sender));
                if (probe.senderHistory.length > HISTORY_MAX) { probe.senderHistory.shift(); }
              }
              prevSender.set(pc, sender);
            }
            receivers.forEach((cur, mid) => {
              const prevMap = prevReceivers.get(pc) ?? new Map<string, RtpSample>();
              const prevRaw = prevMap.get(mid);
              if (prevRaw) {
                let hist = probe.receiverHistory.get(mid);
                if (!hist) {
                  hist = [];
                  probe.receiverHistory.set(mid, hist);
                }
                hist.push(deltaOf(prevRaw, cur));
                if (hist.length > HISTORY_MAX) { hist.shift(); }
              }
              prevMap.set(mid, cur);
              prevReceivers.set(pc, prevMap);
            });
            // path 快照：变更时或每 10 拍记录
            // eslint-disable-next-line no-await-in-loop
            const snap = await pathSnapshot(pc);
            if (snap) {
              const last = probe.pathHistory[probe.pathHistory.length - 1];
              const changed = !last
                || last.localAddr !== snap.localAddr
                || last.remoteAddr !== snap.remoteAddr
                || last.localType !== snap.localType
                || last.remoteType !== snap.remoteType;
              const periodic = probe.senderHistory.length % 10 === 0;
              if (changed || periodic) {
                probe.pathHistory.push(snap);
                if (probe.pathHistory.length > HISTORY_MAX) { probe.pathHistory.shift(); }
              }
            }
          }
        } catch (e) {
          probe.err = e instanceof Error ? e.message : String(e);
        }
        if (probe.running) {
          timer = setTimeout(tick, probe.intervalMs);
        }
      };
      timer = setTimeout(tick, 0);
      pushToWindow();
    },
    stop() {
      probe.running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    dump() {
      return JSON.stringify({
        startedAt: probe.startedAt,
        running: probe.running,
        intervalMs: probe.intervalMs,
        err: probe.err,
        sender: probe.senderHistory,
        receivers: Object.fromEntries(probe.receiverHistory),
        path: probe.pathHistory,
        render: probe.render,
        renderInstalledAt,
      });
    },
    installRenderProbe(video) {
      renderInstalledAt = Date.now();
      const base: RenderProbe = {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        currentTime: video.currentTime,
        presentedFrames: 0,
        rVfcCount: 0,
        rVfcUnsupported: false,
      };
      probe.render = base;
      const anyVideo = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, meta: { presentedFrames: number }) => void) => number;
      };
      if (typeof anyVideo.requestVideoFrameCallback !== 'function') {
        base.rVfcUnsupported = true;
        pushToWindow();
        return;
      }
      const rVfc = anyVideo.requestVideoFrameCallback.bind(anyVideo);
      const loop = (_now: number, meta: { presentedFrames: number }) => {
        base.presentedFrames = meta.presentedFrames;
        base.rVfcCount += 1;
        base.videoWidth = video.videoWidth;
        base.videoHeight = video.videoHeight;
        base.readyState = video.readyState;
        base.currentTime = video.currentTime;
        pushToWindow();
        rVfc(loop);
      };
      rVfc(loop);
    },
  };

  const pushToWindow = () => {
    (window as unknown as { __hgSSPipe?: ScreenSharePipeProbe }).__hgSSPipe = probe;
  };
  singleton = probe;
  pushToWindow();
  return probe;
}

/** 便于单测的内部纯函数导出 */
export const __probeInternals = { deltaOf, sampleFromStats };
