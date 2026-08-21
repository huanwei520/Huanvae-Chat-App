/**
 * WebRTC 视频会议 Hook（mesh，Perfect Negotiation）
 *
 * 协商模型（MDN "Perfect Negotiation" 官方样式）：
 * - 每对 peer 用 participant id 字典序定极性：id 大者 polite、小者 impolite（发起方）。
 *   极性确定、每对恰一极，无需协调往返。
 * - 所有重协商经 `onnegotiationneeded → makeOffer`；offer/answer 走 perfect-negotiation
 *   守卫（polite 隐式 rollback，impolite 冲突时无视对端 offer）。
 * - ICE candidate 经 pending 队列缓冲：remoteDescription 未就绪时入队，就绪后一次性 flush。
 * - pc 创建即把当前已开启的媒体一次性加入（不再在 offer/answer 处理里重复加媒体）。
 *
 * 媒体轨道分类（区分摄像头/屏幕共享）：
 * - `mid` 是 per-pc、per-transceiver 标识，mesh 下每条 pc 各自协商 → mid 不跨 pc 通用。
 *   故用**定向**信令 `media_type{to,mid,media_kind}`（与 offer/answer 同形），接收端在
 *   自己那条 pc 的语境里解释 mid。发送时机：本 pc setLocalDescription 后 mid 就绪即发一次，
 *   按 mid 去重。
 * - 接收端无条件入表 `mediaTypeMaps[peerId][mid]=kind`，收到 media_type 时 + ontrack 到达时
 *   双触发重分类，保证早到不丢。
 *
 * 粗粒度媒体态（UI 与 track 解耦）：
 * - 进房即从 `joined.participants[*].media_state` 知道各对端开着什么，先渲染徽章/占位。
 * - 本端开关变化经 `media_state` 上报，服务器广播 `media_state_changed`，对端 UI 更新。
 *
 * 发言状态检测：
 * - AudioContext + AnalyserNode 分析本地音量，阈值 30 判定说话。
 * - 经**单侧** DataChannel（仅 impolite 侧 createDataChannel，消除 m-line 不对称）广播
 *   `{type:'speaking',speaking}`，远端更新 participant.isSpeaking。
 *
 * 断线重连：
 * - WS 异常关闭 → 指数退避重连；退避耗尽置 error。
 * - 重连经 rejoin 回调重新加入房间拿新 token + ICE，清 pc/dc（保留 localStream/mediaState）
 *   后重建全部 pc，joined 后上报 media_state。
 * - 心跳 ping 后若长时间无 pong，主动关闭触发重连。
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  getSignalingUrl,
  type IceServer,
  type Participant,
  type MediaKind,
  type ServerMessage,
} from './api';
import {
  computePolarity,
  shouldIgnoreOffer,
  classifyMediaTracks,
  nextBackoffDelay,
  isPongExpired,
  shouldReconnectOnClose,
  PendingCandidates,
  type TransceiverView,
} from './webrtcCore';
import { RustWebSocket } from '../services/rustWebSocket';
import { resolveForSecureHttp } from '../services/discovery';

// ============================================
// 类型定义
// ============================================

/** 连接状态 */
type ConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

/** 会议状态 */
export type MeetingState = 'idle' | 'connecting' | 'connected' | 'error';

/** 媒体设备状态 */
export interface MediaDeviceState {
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
}

/** 媒体权限错误类型 */
export type MediaErrorType = 'mic' | 'camera' | 'screen';

/** 媒体权限错误原因 */
export type MediaErrorReason = 'denied' | 'not_found' | 'not_supported' | 'in_use' | 'unknown';

/** 媒体权限错误 */
export interface MediaError {
  type: MediaErrorType;
  reason: MediaErrorReason;
  message: string;
}

/** 远程参与者（包含头像信息） */
export interface RemoteParticipant extends Participant {
  stream?: MediaStream;
  /** 摄像头视频流（与 screenStream 区分） */
  cameraStream?: MediaStream;
  /** 屏幕共享视频流（与 cameraStream 区分） */
  screenStream?: MediaStream;
  connectionState: ConnectionState;
  isSpeaking?: boolean;
}

/** 每个 PeerConnection 的 Transceiver 引用 */
interface TransceiverRefs {
  mic: RTCRtpTransceiver | null;
  camera: RTCRtpTransceiver | null;
  screen: RTCRtpTransceiver | null;
}

/** 屏幕共享分辨率选项 */
export type ScreenShareResolution = '1080p' | '2k' | '4k';

/** 屏幕共享帧率选项 */
export type ScreenShareFrameRate = 60 | 120;

/** 屏幕共享设置 */
export interface ScreenShareSettings {
  resolution: ScreenShareResolution;
  frameRate: ScreenShareFrameRate;
}

/** 分辨率映射 */
export const RESOLUTION_MAP: Record<ScreenShareResolution, { width: number; height: number }> = {
  '1080p': { width: 1920, height: 1080 },
  '2k': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
};

/** 重连回调：重新加入房间，返回新的 ws token + ICE 服务器 */
export type RejoinFn = () => Promise<{ token: string; iceServers: IceServer[] } | null>;

// ============================================
// 常量
// ============================================

/** 心跳发送间隔 */
const HEARTBEAT_INTERVAL_MS = 25_000;
/** 无 pong 判定为断连的阈值（约 2 个心跳周期） */
const PONG_TIMEOUT_MS = 60_000;
/** 重连最大尝试次数 */
const MAX_RECONNECT_ATTEMPTS = 6;
/** ICE 持续 disconnected 多久后触发 restartIce */
const ICE_DISCONNECT_RESTART_MS = 3_000;

/**
 * 获取可用的屏幕共享分辨率选项
 * 根据显示器实际分辨率过滤，避免设置超出显示器能力的分辨率
 */
export function getAvailableResolutions(): ScreenShareResolution[] {
  const screenWidth = window.screen.width * (window.devicePixelRatio || 1);
  const screenHeight = window.screen.height * (window.devicePixelRatio || 1);

  const all: ScreenShareResolution[] = ['1080p', '2k', '4k'];
  return all.filter((res) => {
    const { width, height } = RESOLUTION_MAP[res];
    return width <= screenWidth && height <= screenHeight;
  });
}

/** Hook 返回值 */
export interface UseWebRTCReturn {
  meetingState: MeetingState;
  myParticipantId: string | null;
  participants: RemoteParticipant[];
  localStream: MediaStream | null;
  error: string | null;
  /** 媒体权限错误（麦克风/摄像头/屏幕共享） */
  mediaError: MediaError | null;
  mediaState: MediaDeviceState;
  isSpeaking: boolean;
  connect: (
    roomId: string,
    token: string,
    iceServers: IceServer[],
    serverUrl: string,
    rejoin?: RejoinFn,
  ) => void;
  disconnect: () => void;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  /** 切换屏幕共享，可传入设置参数 */
  toggleScreenShare: (settings?: ScreenShareSettings) => Promise<void>;
  initLocalStream: () => Promise<boolean>;
  stopLocalStream: () => void;
  /** 清除媒体错误 */
  clearMediaError: () => void;
}

// ============================================
// Hook 实现
// ============================================

/** 获取媒体类型的中文名称 */
function getMediaTypeName(type: MediaErrorType): string {
  if (type === 'mic') {
    return '麦克风';
  }
  if (type === 'camera') {
    return '摄像头';
  }
  return '屏幕共享';
}

/**
 * 解析媒体错误，返回用户友好的错误信息
 */
function parseMediaError(err: unknown, type: MediaErrorType): MediaError {
  const typeName = getMediaTypeName(type);

  if (err instanceof Error) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return {
          type,
          reason: 'denied',
          message: `${typeName}权限被拒绝`,
        };
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return {
          type,
          reason: 'not_found',
          message: type === 'screen' ? '未检测到可共享的屏幕' : `未检测到${typeName}`,
        };
      case 'NotSupportedError':
        return {
          type,
          reason: 'not_supported',
          message: '当前环境不支持此功能',
        };
      case 'NotReadableError':
      case 'TrackStartError':
        return {
          type,
          reason: 'in_use',
          message: type === 'screen' ? '屏幕共享失败' : `${typeName}被其他应用占用`,
        };
      case 'AbortError':
        // 用户取消，不显示错误
        return { type, reason: 'unknown', message: '' };
      default:
        return {
          type,
          reason: 'unknown',
          message: `${typeName}出错: ${err.message}`,
        };
    }
  }
  return {
    type,
    reason: 'unknown',
    message: '未知错误',
  };
}

export function useWebRTC(): UseWebRTCReturn {
  // ========== 状态 ==========
  const [meetingState, setMeetingState] = useState<MeetingState>('idle');
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<MediaError | null>(null);
  const [mediaState, setMediaState] = useState<MediaDeviceState>({
    micEnabled: false,
    cameraEnabled: false,
    screenSharing: false,
  });
  const [isSpeaking, setIsSpeaking] = useState(false);

  /** 清除媒体错误 */
  const clearMediaError = useCallback(() => {
    setMediaError(null);
  }, []);

  // ========== Refs ==========
  const wsRef = useRef<RustWebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const iceServersRef = useRef<IceServer[]>([]);
  const myIdRef = useRef<string | null>(null);

  // 媒体流 Refs
  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Transceiver 引用（每个 PeerConnection 独立管理）
  const transceiverMapRef = useRef<Map<string, TransceiverRefs>>(new Map());

  // DataChannel 引用（用于广播发言状态，单侧建）
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());

  // 媒体状态 Ref（避免回调闭包读到过期状态）
  const mediaStateRef = useRef<MediaDeviceState>(mediaState);

  // 媒体类型映射（接收端用于区分摄像头/屏幕共享）Map<peerId, Map<mid, MediaKind>>
  const mediaTypeMapsRef = useRef<Map<string, Map<string, MediaKind>>>(new Map());

  // 远端流的真值源 Map<peerId, MediaStream>。
  // 🔴 不能只往 participants 里写：`ontrack` 触发时 participants 里未必已经有这个 peer
  // （offer 先于 peer_joined 到达时，handleOffer 会先把 pc 建出来），而 ontrack 对同一条
  // track **只触发一次** —— 当场丢掉就永远回不来了（peer_joined 分支只往列表里塞一条空壳，
  // 不重扫 pc.getReceivers()；reclassifyStreams 也只管 camera/screen，救不回 p.stream，
  // 而音频恰恰只从 p.stream 播）。所以 track 一律先落这里，participants 里有就同步过去、
  // 没有就等 peer_joined 来认领。
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());

  // ===== Perfect Negotiation 每对 peer 状态 =====
  const politeRef = useRef<Map<string, boolean>>(new Map());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const ignoreOfferRef = useRef<Map<string, boolean>>(new Map());
  const isSettingRemoteAnswerPendingRef = useRef<Map<string, boolean>>(new Map());
  const pendingCandidatesRef = useRef<PendingCandidates>(new PendingCandidates());
  // 每对 peer 已发过 media_type 的 mid（去重，mid 生命周期内稳定）
  const sentMediaTypeMidsRef = useRef<Map<string, Set<string>>>(new Map());
  // ICE 持续 disconnected 的 restartIce 定时器
  const iceRestartTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // 音频分析相关（用于检测本地发言状态）
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastSpeakingRef = useRef<boolean>(false);

  // ===== 重连相关 =====
  const connectParamsRef = useRef<{ roomId: string; serverUrl: string } | null>(null);
  const rejoinRef = useRef<RejoinFn | null>(null);
  const suppressReconnectRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPongAtRef = useRef(0);
  // 长生命周期 WS 回调走 ref，始终调最新实现，避免闭包过期
  const handleMessageRef = useRef<(msg: ServerMessage) => void>(() => {});
  const openSignalingRef = useRef<(token: string) => void>(() => {});
  const scheduleReconnectRef = useRef<() => void>(() => {});

  // 同步 mediaState 到 ref
  useEffect(() => {
    mediaStateRef.current = mediaState;
  }, [mediaState]);

  // ========== 工具函数 ==========

  /** 发送 WebSocket 消息 */
  const sendMessage = useCallback((message: object) => {
    if (wsRef.current?.readyState === RustWebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  /** 广播发言状态到所有 DataChannel */
  const broadcastSpeakingStatus = useCallback((speaking: boolean) => {
    const message = JSON.stringify({ type: 'speaking', speaking });
    dataChannelsRef.current.forEach((channel) => {
      if (channel.readyState === 'open') {
        channel.send(message);
      }
    });
  }, []);

  /**
   * 处理接收到的 DataChannel 消息（仅发言状态）
   */
  const handleDataChannelMessage = useCallback((peerId: string, data: string) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'speaking') {
        setParticipants((prev) =>
          prev.map((p) => (p.id === peerId ? { ...p, isSpeaking: msg.speaking } : p)),
        );
      }
    } catch {
      // 忽略解析错误
    }
  }, []);

  /**
   * 启动音量检测
   * 使用 AudioContext + AnalyserNode 分析麦克风音量
   */
  const startVolumeDetection = useCallback((stream: MediaStream) => {
    // 清理之前的检测
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const SPEAKING_THRESHOLD = 30; // 音量阈值

    const detectVolume = () => {
      if (!analyserRef.current) {
        return;
      }

      analyserRef.current.getByteFrequencyData(dataArray);

      // 计算平均音量
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;

      // 判断是否在说话
      const speaking = average > SPEAKING_THRESHOLD;

      // 只在状态变化时更新和广播
      if (speaking !== lastSpeakingRef.current) {
        lastSpeakingRef.current = speaking;
        setIsSpeaking(speaking);
        broadcastSpeakingStatus(speaking);
      }

      animationFrameRef.current = requestAnimationFrame(detectVolume);
    };

    detectVolume();
  }, [broadcastSpeakingStatus]);

  /** 停止音量检测 */
  const stopVolumeDetection = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    lastSpeakingRef.current = false;
    setIsSpeaking(false);
    broadcastSpeakingStatus(false);
  }, [broadcastSpeakingStatus]);

  /** 获取或初始化 Transceiver 引用 */
  const getTransceiverRefs = useCallback((peerId: string): TransceiverRefs => {
    let refs = transceiverMapRef.current.get(peerId);
    if (!refs) {
      refs = { mic: null, camera: null, screen: null };
      transceiverMapRef.current.set(peerId, refs);
    }
    return refs;
  }, []);

  /**
   * 按 mid→媒体类型映射，重新把某 peer 的接收视频轨分到 cameraStream/screenStream。
   * 收到 media_type 时 + ontrack 到达时均调用，保证早到不丢、双触发一致。
   */
  const reclassifyStreams = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    const peerMap = mediaTypeMapsRef.current.get(peerId);
    if (!pc || !peerMap) {
      return;
    }

    const transceivers = pc.getTransceivers();
    const views: TransceiverView[] = transceivers.map((t) => ({
      mid: t.mid,
      track: t.receiver.track ? { id: t.receiver.track.id, kind: t.receiver.track.kind } : null,
    }));
    const { cameraTrackId, screenTrackId } = classifyMediaTracks(views, peerMap);

    const trackById = new Map<string, MediaStreamTrack>();
    transceivers.forEach((t) => {
      const tr = t.receiver.track;
      if (tr) {
        trackById.set(tr.id, tr);
      }
    });

    setParticipants((prev) =>
      prev.map((p) => {
        if (p.id !== peerId) {
          return p;
        }

        let cameraStream = p.cameraStream;
        let screenStream = p.screenStream;
        let needsUpdate = false;

        // 摄像头
        const camTrack = cameraTrackId ? trackById.get(cameraTrackId) : undefined;
        const existingCam = cameraStream?.getVideoTracks()[0];
        if (camTrack) {
          if (!existingCam || existingCam.id !== camTrack.id) {
            cameraStream = new MediaStream([camTrack]);
            needsUpdate = true;
          }
        } else if (existingCam) {
          cameraStream = undefined;
          needsUpdate = true;
        }

        // 屏幕共享
        const scrTrack = screenTrackId ? trackById.get(screenTrackId) : undefined;
        const existingScr = screenStream?.getVideoTracks()[0];
        if (scrTrack) {
          if (!existingScr || existingScr.id !== scrTrack.id) {
            screenStream = new MediaStream([scrTrack]);
            needsUpdate = true;
          }
        } else if (existingScr) {
          screenStream = undefined;
          needsUpdate = true;
        }

        return needsUpdate ? { ...p, cameraStream, screenStream } : p;
      }),
    );
  }, []);

  /** 上报本端粗粒度媒体开关全量快照（默认读最新 ref，可显式传入切换后的快照） */
  const sendMediaState = useCallback((snapshot?: MediaDeviceState) => {
    const s = snapshot ?? mediaStateRef.current;
    sendMessage({
      type: 'media_state',
      mic: s.micEnabled,
      camera: s.cameraEnabled,
      screen: s.screenSharing,
    });
  }, [sendMessage]);

  /** remoteDescription 就绪后，flush 该 peer 缓冲的 candidate（一次性、按序） */
  const flushPendingCandidates = useCallback(async (peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (!pc) {
      return;
    }
    const queued = pendingCandidatesRef.current.drain(peerId);
    if (queued.length === 0) {
      return;
    }
    await Promise.all(
      queued.map(async (candidate) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          // 忽略期（impolite 冲突无视对端 offer）内的候选者报错是预期的
          if (!ignoreOfferRef.current.get(peerId)) {
            console.error('[WebRTC] addIceCandidate 失败:', err);
          }
        }
      }),
    );
  }, []);

  /**
   * 本 pc setLocalDescription 后，mid 已就绪：对摄像头/屏幕共享 transceiver 各发一次
   * 定向 media_type（按 mid 去重）。
   */
  const sendPendingMediaTypes = useCallback((peerId: string) => {
    const refs = transceiverMapRef.current.get(peerId);
    if (!refs) {
      return;
    }
    let sent = sentMediaTypeMidsRef.current.get(peerId);
    if (!sent) {
      sent = new Set();
      sentMediaTypeMidsRef.current.set(peerId, sent);
    }
    const entries: Array<[RTCRtpTransceiver | null, MediaKind]> = [
      [refs.camera, 'camera'],
      [refs.screen, 'screen'],
    ];
    for (const [transceiver, kind] of entries) {
      const mid = transceiver?.mid;
      if (mid && !sent.has(mid)) {
        sendMessage({ type: 'media_type', to: peerId, mid, media_kind: kind });
        sent.add(mid);
      }
    }
  }, [sendMessage]);

  /**
   * 发起 Offer（Perfect Negotiation）：无参 setLocalDescription 按状态自动生成 offer，
   * makingOffer 防重入；setLocalDescription 后 mid 就绪，补发定向 media_type。
   */
  const makeOffer = useCallback(async (peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (!pc) {
      return;
    }
    try {
      makingOfferRef.current.set(peerId, true);
      await pc.setLocalDescription();
      if (pc.localDescription) {
        sendMessage({ type: 'offer', to: peerId, sdp: pc.localDescription.sdp });
      }
      sendPendingMediaTypes(peerId);
    } catch (err) {
      console.error('[WebRTC] makeOffer 失败:', err);
    } finally {
      makingOfferRef.current.set(peerId, false);
    }
  }, [sendMessage, sendPendingMediaTypes]);

  // ========== Transceiver 管理 ==========

  /**
   * 添加或更新麦克风 Transceiver
   * - 无 transceiver：addTransceiver 添加（触发 onnegotiationneeded）
   * - 已有 transceiver：replaceTrack 更新（不触发重协商）
   */
  const addMicTransceiver = useCallback(async (peerId: string, track: MediaStreamTrack) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (!pc) {
      return;
    }

    const refs = getTransceiverRefs(peerId);

    if (!refs.mic) {
      const stream = micStreamRef.current;
      refs.mic = pc.addTransceiver(track, {
        direction: 'sendrecv',
        streams: stream ? [stream] : [],
      });
    } else {
      await refs.mic.sender.replaceTrack(track);
      if (refs.mic.direction !== 'sendrecv') {
        refs.mic.direction = 'sendrecv';
      }
    }
  }, [getTransceiverRefs]);

  /** 停止麦克风 Transceiver */
  const stopMicTransceiver = useCallback(async (peerId: string) => {
    const refs = getTransceiverRefs(peerId);
    if (refs.mic) {
      await refs.mic.sender.replaceTrack(null);
      refs.mic.direction = 'inactive';
    }
  }, [getTransceiverRefs]);

  /**
   * 添加或更新摄像头 Transceiver
   * media_type 由 makeOffer 在 setLocalDescription 后按 mid 补发，这里不再广播。
   */
  const addCameraTransceiver = useCallback(async (peerId: string, track: MediaStreamTrack) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (!pc) {
      return;
    }

    const refs = getTransceiverRefs(peerId);

    if (!refs.camera) {
      const stream = cameraStreamRef.current;
      refs.camera = pc.addTransceiver(track, {
        direction: 'sendrecv',
        streams: stream ? [stream] : [],
      });
    } else {
      await refs.camera.sender.replaceTrack(track);
      if (refs.camera.direction !== 'sendrecv') {
        refs.camera.direction = 'sendrecv';
      }
    }
  }, [getTransceiverRefs]);

  /** 停止摄像头 Transceiver */
  const stopCameraTransceiver = useCallback(async (peerId: string) => {
    const refs = getTransceiverRefs(peerId);
    if (refs.camera) {
      await refs.camera.sender.replaceTrack(null);
      refs.camera.direction = 'inactive';
    }
  }, [getTransceiverRefs]);

  /**
   * 添加或更新屏幕共享 Transceiver
   * media_type 由 makeOffer 在 setLocalDescription 后按 mid 补发，这里不再广播。
   */
  const addScreenTransceiver = useCallback(async (peerId: string, track: MediaStreamTrack) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (!pc) {
      return;
    }

    const refs = getTransceiverRefs(peerId);

    if (!refs.screen) {
      const stream = screenStreamRef.current;
      refs.screen = pc.addTransceiver(track, {
        direction: 'sendrecv',
        streams: stream ? [stream] : [],
      });
    } else {
      await refs.screen.sender.replaceTrack(track);
      if (refs.screen.direction !== 'sendrecv') {
        refs.screen.direction = 'sendrecv';
      }
    }
  }, [getTransceiverRefs]);

  /**
   * 停止屏幕共享 Transceiver
   * 保留 transceiver 引用（复用同一 mid），避免接收端无法识别流。
   */
  const stopScreenTransceiver = useCallback(async (peerId: string) => {
    const refs = getTransceiverRefs(peerId);
    if (refs.screen) {
      await refs.screen.sender.replaceTrack(null);
      refs.screen.direction = 'inactive';
    }
  }, [getTransceiverRefs]);

  // ========== PeerConnection 管理 ==========

  /**
   * 创建 PeerConnection
   * @param polite 本端在该对 peer 中是否为 polite（id 大者）
   * - impolite 侧建单条 DataChannel（保证至少一条 m-line 可协商）；polite 侧仅监听
   * - pc 创建即把当前已开启的媒体一次性加入，触发 onnegotiationneeded → makeOffer
   */
  const createPeerConnection = useCallback((peerId: string, polite: boolean): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    peerConnectionsRef.current.set(peerId, pc);
    politeRef.current.set(peerId, polite);

    // 初始化 transceiver 引用
    getTransceiverRefs(peerId);

    // ICE 候选者
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendMessage({
          type: 'candidate',
          to: peerId,
          candidate: {
            candidate: event.candidate.candidate,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            sdpMid: event.candidate.sdpMid,
          },
        });
      }
    };

    // 连接状态变化（更新 UI；failed 兜底 restartIce）
    pc.onconnectionstatechange = () => {
      setParticipants((prev) =>
        prev.map((p) =>
          p.id === peerId ? { ...p, connectionState: pc.connectionState as ConnectionState } : p,
        ),
      );
      if (pc.connectionState === 'failed') {
        pc.restartIce();
      }
    };

    // ICE 连接状态：failed 立即 restartIce；disconnected 持续超时后 restartIce
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      if (state === 'failed') {
        pc.restartIce();
        return;
      }
      if (state === 'disconnected') {
        if (!iceRestartTimersRef.current.has(peerId)) {
          const timer = setTimeout(() => {
            iceRestartTimersRef.current.delete(peerId);
            const current = peerConnectionsRef.current.get(peerId);
            if (
              current &&
              (current.iceConnectionState === 'disconnected' ||
                current.iceConnectionState === 'failed')
            ) {
              current.restartIce();
            }
          }, ICE_DISCONNECT_RESTART_MS);
          iceRestartTimersRef.current.set(peerId, timer);
        }
        return;
      }
      // 恢复：清掉待触发的 restart 定时器
      const timer = iceRestartTimersRef.current.get(peerId);
      if (timer) {
        clearTimeout(timer);
        iceRestartTimersRef.current.delete(peerId);
      }
    };

    // 接收远程轨道：加轨到 stream，然后按 mid 重分类
    pc.ontrack = (event) => {
      const track = event.track;

      // 先落 ref（participants 里有没有这个 peer 都要收下），再同步到列表。
      // 每次都新建 MediaStream 实例：引用变了 React 才会重渲染。
      const previous = remoteStreamsRef.current.get(peerId);
      const remoteStream = previous
        ? new MediaStream(previous.getTracks())
        : new MediaStream();
      if (!remoteStream.getTracks().find((t) => t.id === track.id)) {
        remoteStream.addTrack(track);
      }
      remoteStreamsRef.current.set(peerId, remoteStream);

      track.onended = () => {
        const current = remoteStreamsRef.current.get(peerId);
        if (current) {
          const left = new MediaStream(current.getTracks().filter((t) => t.id !== track.id));
          if (left.getTracks().length > 0) {
            remoteStreamsRef.current.set(peerId, left);
          } else {
            remoteStreamsRef.current.delete(peerId);
          }
        }
        setParticipants((p) =>
          p.map((participant) => {
            if (participant.id === peerId && participant.stream) {
              const newStream = new MediaStream(
                participant.stream.getTracks().filter((t) => t.id !== track.id),
              );
              return {
                ...participant,
                stream: newStream.getTracks().length > 0 ? newStream : undefined,
              };
            }
            return participant;
          }),
        );
      };

      // 列表里还没有这个 peer 时这一步是 no-op —— 流已经在 ref 里，等 peer_joined 认领。
      setParticipants((prev) =>
        prev.map((p) => (p.id === peerId ? { ...p, stream: remoteStream } : p)),
      );
      reclassifyStreams(peerId);
    };

    // 重协商：统一经 makeOffer（Perfect Negotiation）
    pc.onnegotiationneeded = () => {
      void makeOffer(peerId);
    };

    // DataChannel 单侧：仅 impolite 侧建，polite 侧监听
    if (!polite) {
      const dataChannel = pc.createDataChannel('speaking-status', { ordered: true });
      dataChannel.onopen = () => {
        dataChannelsRef.current.set(peerId, dataChannel);
      };
      dataChannel.onclose = () => {
        dataChannelsRef.current.delete(peerId);
      };
      dataChannel.onmessage = (event) => {
        handleDataChannelMessage(peerId, event.data);
      };
    } else {
      pc.ondatachannel = (event) => {
        const channel = event.channel;
        if (channel.label === 'speaking-status') {
          channel.onopen = () => {
            dataChannelsRef.current.set(peerId, channel);
          };
          channel.onclose = () => {
            dataChannelsRef.current.delete(peerId);
          };
          channel.onmessage = (e) => {
            handleDataChannelMessage(peerId, e.data);
          };
        }
      };
    }

    // pc 创建即加当前已开启的媒体（触发 onnegotiationneeded → makeOffer）
    const ms = mediaStateRef.current;
    if (ms.micEnabled && micStreamRef.current) {
      const track = micStreamRef.current.getAudioTracks()[0];
      if (track) {
        void addMicTransceiver(peerId, track);
      }
    }
    if (ms.cameraEnabled && cameraStreamRef.current) {
      const track = cameraStreamRef.current.getVideoTracks()[0];
      if (track) {
        void addCameraTransceiver(peerId, track);
      }
    }
    if (ms.screenSharing && screenStreamRef.current) {
      const track = screenStreamRef.current.getVideoTracks()[0];
      if (track) {
        void addScreenTransceiver(peerId, track);
      }
    }

    return pc;
  }, [
    sendMessage,
    getTransceiverRefs,
    makeOffer,
    handleDataChannelMessage,
    reclassifyStreams,
    addMicTransceiver,
    addCameraTransceiver,
    addScreenTransceiver,
  ]);

  /** 关闭 PeerConnection 并清理该 peer 的全部状态 */
  const closePeerConnection = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }
    transceiverMapRef.current.delete(peerId);
    dataChannelsRef.current.delete(peerId);
    mediaTypeMapsRef.current.delete(peerId);
    remoteStreamsRef.current.delete(peerId);
    politeRef.current.delete(peerId);
    makingOfferRef.current.delete(peerId);
    ignoreOfferRef.current.delete(peerId);
    isSettingRemoteAnswerPendingRef.current.delete(peerId);
    pendingCandidatesRef.current.remove(peerId);
    sentMediaTypeMidsRef.current.delete(peerId);
    const timer = iceRestartTimersRef.current.get(peerId);
    if (timer) {
      clearTimeout(timer);
      iceRestartTimersRef.current.delete(peerId);
    }
    setParticipants((prev) => prev.filter((p) => p.id !== peerId));
  }, []);

  // ========== 信令处理 ==========

  /** 处理 Offer（Perfect Negotiation） */
  const handleOffer = useCallback(async (peerId: string, sdp: string) => {
    let pc = peerConnectionsRef.current.get(peerId);
    if (!pc) {
      const { polite } = computePolarity(myIdRef.current ?? '', peerId);
      pc = createPeerConnection(peerId, polite);
    }

    const polite = politeRef.current.get(peerId) ?? false;
    const makingOffer = makingOfferRef.current.get(peerId) ?? false;
    const settingAnswerPending = isSettingRemoteAnswerPendingRef.current.get(peerId) ?? false;
    const ignore = shouldIgnoreOffer(polite, makingOffer, pc.signalingState, settingAnswerPending);
    ignoreOfferRef.current.set(peerId, ignore);
    if (ignore) {
      return;
    }

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await flushPendingCandidates(peerId);
      await pc.setLocalDescription();
      if (pc.localDescription) {
        sendMessage({ type: 'answer', to: peerId, sdp: pc.localDescription.sdp });
      }
      sendPendingMediaTypes(peerId);
    } catch (err) {
      console.error('[WebRTC] handleOffer 失败:', err);
    }
  }, [createPeerConnection, sendMessage, flushPendingCandidates, sendPendingMediaTypes]);

  /** 处理 Answer（Perfect Negotiation） */
  const handleAnswer = useCallback(async (peerId: string, sdp: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (!pc) {
      return;
    }
    isSettingRemoteAnswerPendingRef.current.set(peerId, true);
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp });
      await flushPendingCandidates(peerId);
    } catch (err) {
      console.error('[WebRTC] handleAnswer 失败:', err);
    } finally {
      isSettingRemoteAnswerPendingRef.current.set(peerId, false);
    }
  }, [flushPendingCandidates]);

  /** 处理 ICE 候选者：remoteDescription 未就绪时入队，否则直接加 */
  const handleCandidate = useCallback(async (
    peerId: string,
    candidate: { candidate: string; sdpMLineIndex: number | null; sdpMid: string | null },
  ) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (!pc || !pc.remoteDescription) {
      pendingCandidatesRef.current.add(peerId, candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      if (!ignoreOfferRef.current.get(peerId)) {
        console.error('[WebRTC] addIceCandidate 失败:', err);
      }
    }
  }, []);

  /** 处理服务器消息 */
  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'joined': {
        myIdRef.current = msg.participant_id;
        setMyParticipantId(msg.participant_id);
        setParticipants(msg.participants.map((p) => ({
          ...p,
          connectionState: 'new' as ConnectionState,
          stream: remoteStreamsRef.current.get(p.id),
        })));
        setMeetingState('connected');
        reconnectAttemptsRef.current = 0;
        // 双向为每个现有参与者建 pc（impolite 侧经 onnegotiationneeded 发起）
        msg.participants.forEach((p) => {
          const { polite } = computePolarity(msg.participant_id, p.id);
          createPeerConnection(p.id, polite);
        });
        // 上报当前媒体态（重连时让对端获知本端开关；首次进房为全 false，无害）
        sendMediaState();
        break;
      }

      case 'peer_joined': {
        // 认领 ontrack 先收下的远端流：offer 先于本消息到达时，那条流已经躺在 ref 里，
        // 这里不接就永远接不上了（ontrack 对同一条 track 只触发一次）。
        const buffered = remoteStreamsRef.current.get(msg.participant.id);
        setParticipants((prev) => [
          ...prev,
          { ...msg.participant, connectionState: 'new' as ConnectionState, stream: buffered },
        ]);
        const myId = myIdRef.current;
        if (myId) {
          const { polite } = computePolarity(myId, msg.participant.id);
          createPeerConnection(msg.participant.id, polite);
        }
        if (buffered) {
          // 摄像头/屏幕的分流也要一起补（reclassifyStreams 从 pc.getTransceivers() 现读）
          reclassifyStreams(msg.participant.id);
        }
        break;
      }

      case 'peer_left':
        closePeerConnection(msg.participant_id);
        break;

      case 'offer':
        handleOffer(msg.from, msg.sdp);
        break;

      case 'answer':
        handleAnswer(msg.from, msg.sdp);
        break;

      case 'candidate':
        handleCandidate(msg.from, msg.candidate);
        break;

      case 'media_type': {
        let peerMap = mediaTypeMapsRef.current.get(msg.from);
        if (!peerMap) {
          peerMap = new Map();
          mediaTypeMapsRef.current.set(msg.from, peerMap);
        }
        peerMap.set(msg.mid, msg.media_kind);
        reclassifyStreams(msg.from);
        break;
      }

      case 'media_state_changed':
        setParticipants((prev) =>
          prev.map((p) => (p.id === msg.participant_id ? { ...p, media_state: msg.media_state } : p)),
        );
        break;

      case 'pong':
        lastPongAtRef.current = Date.now();
        break;

      case 'room_closed':
        suppressReconnectRef.current = true;
        setError(`房间已关闭: ${msg.reason}`);
        setMeetingState('error');
        break;

      case 'error':
        setError(msg.message);
        break;
    }
  }, [createPeerConnection, handleOffer, handleAnswer, handleCandidate, closePeerConnection, reclassifyStreams, sendMediaState]);

  // ========== 媒体控制 ==========

  /**
   * 初始化本地媒体流
   * 检查设备可用性，不实际获取流（流在开启麦克风/摄像头时获取）
   */
  const initLocalStream = useCallback(async (): Promise<boolean> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasAudio = devices.some((d) => d.kind === 'audioinput');
      const hasVideo = devices.some((d) => d.kind === 'videoinput');

      if (!hasAudio && !hasVideo) {
        setError('未检测到音视频设备');
        return false;
      }

      setMediaError(null);
      return true;
    } catch (err) {
      console.error('[WebRTC] 初始化媒体流失败:', err);
      return false;
    }
  }, []);

  /** 停止所有本地媒体流 */
  const stopLocalStream = useCallback(() => {
    stopVolumeDetection();

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setLocalStream(null);
    setMediaState({ micEnabled: false, cameraEnabled: false, screenSharing: false });
  }, [stopVolumeDetection]);

  /**
   * 切换麦克风
   * - 开启：获取麦克风流，向所有参与者添加 transceiver，启动音量检测
   * - 关闭：停止麦克风流，停止所有 transceiver，停止音量检测
   */
  const toggleMic = useCallback(async () => {
    if (mediaState.micEnabled) {
      stopVolumeDetection();

      const stopPromises = Array.from(peerConnectionsRef.current.keys()).map((peerId) =>
        stopMicTransceiver(peerId),
      );
      await Promise.all(stopPromises);

      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }

      setLocalStream((prev) => {
        if (!prev) {
          return null;
        }
        const newStream = new MediaStream(prev.getTracks().filter((t) => t.kind !== 'audio'));
        return newStream.getTracks().length > 0 ? newStream : null;
      });

      const next = { ...mediaStateRef.current, micEnabled: false };
      setMediaState((prev) => ({ ...prev, micEnabled: false }));
      sendMediaState(next);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
        const track = stream.getAudioTracks()[0];

        startVolumeDetection(stream);

        const addPromises = Array.from(peerConnectionsRef.current.keys()).map((peerId) =>
          addMicTransceiver(peerId, track),
        );
        await Promise.all(addPromises);

        setLocalStream((prev) => {
          const newStream = prev ? new MediaStream(prev.getTracks()) : new MediaStream();
          newStream.addTrack(track);
          return newStream;
        });

        const next = { ...mediaStateRef.current, micEnabled: true };
        setMediaState((prev) => ({ ...prev, micEnabled: true }));
        setMediaError(null);
        sendMediaState(next);
      } catch (err) {
        const mediaErr = parseMediaError(err, 'mic');
        if (mediaErr.message) {
          setMediaError(mediaErr);
        }
      }
    }
  }, [mediaState.micEnabled, addMicTransceiver, stopMicTransceiver, startVolumeDetection, stopVolumeDetection, sendMediaState]);

  /**
   * 切换摄像头
   * - 开启：获取摄像头流，向所有参与者添加 transceiver
   * - 关闭：停止摄像头流，停止所有 transceiver
   */
  const toggleCamera = useCallback(async () => {
    if (mediaState.cameraEnabled) {
      const stopPromises = Array.from(peerConnectionsRef.current.keys()).map((peerId) =>
        stopCameraTransceiver(peerId),
      );
      await Promise.all(stopPromises);

      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }

      setLocalStream((prev) => {
        if (!prev) {
          return null;
        }
        // 移除摄像头轨道，但保留屏幕共享轨道
        const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
        const newStream = new MediaStream(
          prev.getTracks().filter((t) => t.kind !== 'video' || t.id === screenTrack?.id),
        );
        return newStream.getTracks().length > 0 ? newStream : null;
      });

      const next = { ...mediaStateRef.current, cameraEnabled: false };
      setMediaState((prev) => ({ ...prev, cameraEnabled: false }));
      sendMediaState(next);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        cameraStreamRef.current = stream;
        const track = stream.getVideoTracks()[0];

        const addPromises = Array.from(peerConnectionsRef.current.keys()).map((peerId) =>
          addCameraTransceiver(peerId, track),
        );
        await Promise.all(addPromises);

        setLocalStream((prev) => {
          const newStream = prev ? new MediaStream(prev.getTracks()) : new MediaStream();
          newStream.addTrack(track);
          return newStream;
        });

        const next = { ...mediaStateRef.current, cameraEnabled: true };
        setMediaState((prev) => ({ ...prev, cameraEnabled: true }));
        setMediaError(null);
        sendMediaState(next);
      } catch (err) {
        const mediaErr = parseMediaError(err, 'camera');
        if (mediaErr.message) {
          setMediaError(mediaErr);
        }
      }
    }
  }, [mediaState.cameraEnabled, addCameraTransceiver, stopCameraTransceiver, sendMediaState]);

  /** 停止屏幕共享（供切换与 track.onended 复用，非递归） */
  const stopScreenShareInternal = useCallback(async () => {
    const stopPromises = Array.from(peerConnectionsRef.current.keys()).map((peerId) =>
      stopScreenTransceiver(peerId),
    );
    await Promise.all(stopPromises);

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }

    setLocalStream((prev) => {
      if (!prev) {
        return null;
      }
      // 移除屏幕共享轨道，但保留摄像头轨道
      const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
      const newStream = new MediaStream(
        prev.getTracks().filter((t) => t.kind !== 'video' || t.id === cameraTrack?.id),
      );
      return newStream.getTracks().length > 0 ? newStream : null;
    });

    const next = { ...mediaStateRef.current, screenSharing: false };
    setMediaState((prev) => ({ ...prev, screenSharing: false }));
    sendMediaState(next);
  }, [stopScreenTransceiver, sendMediaState]);

  /**
   * 切换屏幕共享
   * @param settings 屏幕共享设置（分辨率和帧率）
   */
  const toggleScreenShare = useCallback(async (settings?: ScreenShareSettings) => {
    if (mediaState.screenSharing) {
      await stopScreenShareInternal();
    } else {
      try {
        const resolution = settings?.resolution ?? '1080p';
        const frameRate = settings?.frameRate ?? 60;
        const { width, height } = RESOLUTION_MAP[resolution];

        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: frameRate, max: frameRate },
            width: { ideal: width },
            height: { ideal: height },
          },
          audio: false,
        });
        screenStreamRef.current = stream;
        const track = stream.getVideoTracks()[0];

        // 告知编码器这是动态内容，优先帧率
        if ('contentHint' in track) {
          (track as MediaStreamTrack & { contentHint: string }).contentHint = 'motion';
        }

        const addPromises = Array.from(peerConnectionsRef.current.keys()).map((peerId) =>
          addScreenTransceiver(peerId, track),
        );
        await Promise.all(addPromises);

        // 用户点击浏览器/系统"停止共享"时，走同一停止分支（非递归）
        track.onended = () => {
          void stopScreenShareInternal();
        };

        setLocalStream((prev) => {
          const newStream = prev ? new MediaStream(prev.getTracks()) : new MediaStream();
          newStream.addTrack(track);
          return newStream;
        });

        const next = { ...mediaStateRef.current, screenSharing: true };
        setMediaState((prev) => ({ ...prev, screenSharing: true }));
        setMediaError(null);
        sendMediaState(next);
      } catch (err) {
        const mediaErr = parseMediaError(err, 'screen');
        // AbortError 表示用户取消，不显示错误
        if (mediaErr.message && mediaErr.reason !== 'unknown') {
          setMediaError(mediaErr);
        }
      }
    }
  }, [mediaState.screenSharing, addScreenTransceiver, stopScreenShareInternal, sendMediaState]);

  // ========== 连接管理 ==========

  /** 关闭并清理所有 PeerConnection / DataChannel（保留 localStream/mediaState，用于重连） */
  const cleanupPeers = useCallback(() => {
    dataChannelsRef.current.forEach((channel) => channel.close());
    dataChannelsRef.current.clear();

    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();

    transceiverMapRef.current.clear();
    mediaTypeMapsRef.current.clear();
    remoteStreamsRef.current.clear();
    politeRef.current.clear();
    makingOfferRef.current.clear();
    ignoreOfferRef.current.clear();
    isSettingRemoteAnswerPendingRef.current.clear();
    pendingCandidatesRef.current.clear();
    sentMediaTypeMidsRef.current.clear();
    iceRestartTimersRef.current.forEach((timer) => clearTimeout(timer));
    iceRestartTimersRef.current.clear();
  }, []);

  /** 建立信令 WebSocket（含心跳 + pong 超时检测 + 异常关闭触发重连） */
  const openSignaling = useCallback((token: string) => {
    const params = connectParamsRef.current;
    if (!params) {
      return;
    }
    const url = getSignalingUrl(params.roomId, token, params.serverUrl);
    const ws = new RustWebSocket(url, resolveForSecureHttp() ?? { pin_ca: true });
    wsRef.current = ws;
    lastPongAtRef.current = Date.now();

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    // 本端因 pong 超时主动关闭时，关闭帧的 code 是干净的 1000，需据此强制重连
    // （否则 onclose 会把 1000 当作服务器正常关闭而不重连）。
    let pongTimedOut = false;

    ws.onopen = () => {
      lastPongAtRef.current = Date.now();
      heartbeat = setInterval(() => {
        if (ws.readyState !== RustWebSocket.OPEN) {
          return;
        }
        if (isPongExpired(lastPongAtRef.current, Date.now(), PONG_TIMEOUT_MS)) {
          pongTimedOut = true;
          ws.close(); // 触发 onclose → 重连
          return;
        }
        ws.send(JSON.stringify({ type: 'ping' }));
      }, HEARTBEAT_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        handleMessageRef.current(msg);
      } catch {
        // 忽略解析错误
      }
    };

    ws.onerror = () => {
      // onclose 紧随其后，重连逻辑集中在 onclose
    };

    ws.onclose = (event) => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (shouldReconnectOnClose(event.code, suppressReconnectRef.current, pongTimedOut)) {
        scheduleReconnectRef.current();
      }
    };
  }, []);

  /** 指数退避重连：rejoin 拿新 token/ICE → 清 pc → 重开 WS；耗尽则置 error */
  const scheduleReconnect = useCallback(() => {
    if (suppressReconnectRef.current) {
      return;
    }
    const rejoin = rejoinRef.current;
    if (!rejoin) {
      setError('信令连接已断开');
      setMeetingState('error');
      return;
    }
    const attempt = reconnectAttemptsRef.current;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      setError('信令连接已断开');
      setMeetingState('error');
      return;
    }
    reconnectAttemptsRef.current = attempt + 1;
    setMeetingState('connecting');
    const delay = nextBackoffDelay(attempt);

    reconnectTimerRef.current = setTimeout(() => {
      void (async () => {
        if (suppressReconnectRef.current) {
          return;
        }
        let result: { token: string; iceServers: IceServer[] } | null = null;
        try {
          result = await rejoin();
        } catch {
          result = null;
        }
        if (suppressReconnectRef.current) {
          return;
        }
        if (!result) {
          scheduleReconnectRef.current();
          return;
        }
        iceServersRef.current = result.iceServers;
        cleanupPeers();
        openSignalingRef.current(result.token);
      })();
    }, delay);
  }, [cleanupPeers]);

  // 长生命周期回调走 ref，保证 WS/定时器始终调到最新实现
  useEffect(() => {
    handleMessageRef.current = handleMessage;
    openSignalingRef.current = openSignaling;
    scheduleReconnectRef.current = scheduleReconnect;
  }, [handleMessage, openSignaling, scheduleReconnect]);

  /** 连接信令服务器 */
  const connect = useCallback((
    roomId: string,
    token: string,
    iceServers: IceServer[],
    serverUrl: string,
    rejoin?: RejoinFn,
  ) => {
    iceServersRef.current = iceServers;
    rejoinRef.current = rejoin ?? null;
    connectParamsRef.current = { roomId, serverUrl };
    suppressReconnectRef.current = false;
    reconnectAttemptsRef.current = 0;
    setMeetingState('connecting');
    setError(null);
    openSignaling(token);
  }, [openSignaling]);

  /** 清理所有资源（完全断开） */
  const cleanup = useCallback(() => {
    suppressReconnectRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    stopVolumeDetection();
    cleanupPeers();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setMeetingState('idle');
    setMyParticipantId(null);
    setParticipants([]);
    setError(null);
    myIdRef.current = null;
  }, [stopVolumeDetection, cleanupPeers]);

  /** 断开连接 */
  const disconnect = useCallback(() => {
    suppressReconnectRef.current = true;
    sendMessage({ type: 'leave' });
    stopLocalStream();
    cleanup();
  }, [sendMessage, stopLocalStream, cleanup]);

  // ========== 生命周期 ==========

  useEffect(() => {
    return () => {
      cleanup();
      stopLocalStream();
    };
  }, [cleanup, stopLocalStream]);

  return {
    meetingState,
    myParticipantId,
    participants,
    localStream,
    error,
    mediaError,
    mediaState,
    isSpeaking,
    connect,
    disconnect,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    initLocalStream,
    stopLocalStream,
    clearMediaError,
  };
}
