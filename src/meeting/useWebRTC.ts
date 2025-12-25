/**
 * WebRTC 视频会议 Hook
 *
 * 独立 Transceiver 架构：
 * - 每种媒体类型（麦克风、摄像头、屏幕共享）都有独立的 transceiver
 * - 发送端：使用 addTransceiver 动态添加，触发安全重协商
 * - 接收端：通过 ontrack 自动接收，完全不动
 *
 * Transceiver 结构（每个 PeerConnection）：
 * | 媒体类型 | Transceiver | 方向 |
 * |---------|-------------|------|
 * | 麦克风   | mic         | sendrecv |
 * | 摄像头   | camera      | sendrecv |
 * | 屏幕共享 | screen      | sendrecv |
 *
 * 安全重协商原则：
 * 1. 使用 addTransceiver() 创建独立通道，不复用现有 transceiver
 * 2. 只在 signalingState === 'stable' 时进行协商
 * 3. 新 transceiver 不影响现有的麦克风/摄像头/屏幕共享通道
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  getSignalingUrl,
  type IceServer,
  type Participant,
  type ServerMessage,
} from './api';

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

/** 远程参与者（包含头像信息） */
export interface RemoteParticipant extends Participant {
  stream?: MediaStream;
  connectionState: ConnectionState;
  isSpeaking?: boolean;
}

/** 每个 PeerConnection 的 Transceiver 引用 */
interface TransceiverRefs {
  mic: RTCRtpTransceiver | null;
  camera: RTCRtpTransceiver | null;
  screen: RTCRtpTransceiver | null;
}

/** Hook 返回值 */
export interface UseWebRTCReturn {
  meetingState: MeetingState;
  myParticipantId: string | null;
  participants: RemoteParticipant[];
  localStream: MediaStream | null;
  error: string | null;
  mediaState: MediaDeviceState;
  isSpeaking: boolean;
  connect: (roomId: string, token: string, iceServers: IceServer[]) => void;
  disconnect: () => void;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  initLocalStream: () => Promise<MediaStream | null>;
  stopLocalStream: () => void;
}

// ============================================
// Hook 实现
// ============================================

export function useWebRTC(): UseWebRTCReturn {
  // ========== 状态 ==========
  const [meetingState, setMeetingState] = useState<MeetingState>('idle');
  const [myParticipantId, setMyParticipantId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaState, setMediaState] = useState<MediaDeviceState>({
    micEnabled: false,
    cameraEnabled: false,
    screenSharing: false,
  });
  const [isSpeaking] = useState(false);

  // ========== Refs ==========
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const iceServersRef = useRef<IceServer[]>([]);
  const myIdRef = useRef<string | null>(null);

  // 媒体流 Refs
  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Transceiver 引用（每个 PeerConnection 独立管理）
  const transceiverMapRef = useRef<Map<string, TransceiverRefs>>(new Map());

  // 协商锁（防止并发协商）
  const negotiatingRef = useRef<Set<string>>(new Set());

  // ========== 工具函数 ==========

  /** 发送 WebSocket 消息 */
  const sendMessage = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  /** 获取或初始化 Transceiver 引用 */
  const getTransceiverRefs = useCallback((peerId: string): TransceiverRefs => {
    let refs = transceiverMapRef.current.get(peerId);
    if (!refs) {
      refs = { mic: null, camera: null, screen: null };
      transceiverMapRef.current.set(peerId, refs);
    }
    return refs;
  }, []);

  // ========== 安全重协商 ==========

  /**
   * 安全地进行重协商
   * - 检查信令状态是否为 stable
   * - 使用锁防止并发协商
   * - 创建 Offer 并发送
   */
  const safeNegotiate = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    // 检查是否正在协商
    if (negotiatingRef.current.has(peerId)) {
      return;
    }

    // 检查信令状态
    if (pc.signalingState !== 'stable') {
      return;
    }

    try {
      negotiatingRef.current.add(peerId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendMessage({
        type: 'offer',
        to: peerId,
        sdp: pc.localDescription?.sdp,
      });
    } finally {
      negotiatingRef.current.delete(peerId);
    }
  }, [sendMessage]);

  // ========== PeerConnection 管理 ==========

  /**
   * 创建 PeerConnection
   * - 不预先创建任何 transceiver
   * - transceiver 在开始共享时动态添加
   */
  const createPeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });

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

    // 连接状态变化
    pc.onconnectionstatechange = () => {
      setParticipants((prev) =>
        prev.map((p) =>
          p.id === peerId ? { ...p, connectionState: pc.connectionState as ConnectionState } : p,
        ),
      );
    };

    /**
     * 接收远程轨道
     * 接收端逻辑完全不动，只需要将轨道添加到对应参与者的流中
     */
    pc.ontrack = (event) => {
      setParticipants((prev) => {
        const existing = prev.find((p) => p.id === peerId);
        if (!existing) {
          return prev;
        }

        // 创建或更新远程流
        let remoteStream = existing.stream;
        if (!remoteStream) {
          remoteStream = new MediaStream();
        } else {
          // 创建新的 MediaStream 以触发 React 重新渲染
          remoteStream = new MediaStream(remoteStream.getTracks());
        }

        // 添加新轨道（如果不存在）
        const track = event.track;
        if (!remoteStream.getTracks().find((t) => t.id === track.id)) {
          remoteStream.addTrack(track);
        }

        // 监听轨道结束
        track.onended = () => {
          setParticipants((p) =>
            p.map((participant) => {
              if (participant.id === peerId && participant.stream) {
                const newStream = new MediaStream(
                  participant.stream.getTracks().filter((t) => t.id !== track.id),
                );
                return { ...participant, stream: newStream.getTracks().length > 0 ? newStream : undefined };
              }
              return participant;
            }),
          );
        };

        return prev.map((p) => (p.id === peerId ? { ...p, stream: remoteStream } : p));
      });
    };

    /**
     * onnegotiationneeded 事件
     * 当添加 transceiver 时自动触发，执行安全重协商
     */
    pc.onnegotiationneeded = () => {
      safeNegotiate(peerId, pc);
    };

    peerConnectionsRef.current.set(peerId, pc);
    return pc;
  }, [sendMessage, getTransceiverRefs, safeNegotiate]);

  /** 关闭 PeerConnection */
  const closePeerConnection = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }
    transceiverMapRef.current.delete(peerId);
    negotiatingRef.current.delete(peerId);
    setParticipants((prev) => prev.filter((p) => p.id !== peerId));
  }, []);

  // ========== Transceiver 管理 ==========

  /**
   * 添加或更新麦克风 Transceiver
   * - 如果没有 transceiver，使用 addTransceiver 添加（触发重协商）
   * - 如果已有 transceiver，使用 replaceTrack 更新（不触发重协商）
   */
  const addMicTransceiver = useCallback(async (peerId: string, track: MediaStreamTrack) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (!pc) {
      return;
    }

    const refs = getTransceiverRefs(peerId);

    if (!refs.mic) {
      // 首次添加：创建新的 transceiver，触发 onnegotiationneeded
      const stream = micStreamRef.current;
      refs.mic = pc.addTransceiver(track, {
        direction: 'sendrecv',
        streams: stream ? [stream] : [],
      });
    } else {
      // 已有 transceiver：只替换轨道，不触发重协商
      await refs.mic.sender.replaceTrack(track);
      // 确保方向正确
      if (refs.mic.direction !== 'sendrecv') {
        refs.mic.direction = 'sendrecv';
      }
    }
  }, [getTransceiverRefs]);

  /**
   * 停止麦克风 Transceiver
   * - 将轨道替换为 null
   * - 将方向设为 inactive
   */
  const stopMicTransceiver = useCallback(async (peerId: string) => {
    const refs = getTransceiverRefs(peerId);
    if (refs.mic) {
      await refs.mic.sender.replaceTrack(null);
      refs.mic.direction = 'inactive';
    }
  }, [getTransceiverRefs]);

  /**
   * 添加或更新摄像头 Transceiver
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

  /**
   * 停止摄像头 Transceiver
   */
  const stopCameraTransceiver = useCallback(async (peerId: string) => {
    const refs = getTransceiverRefs(peerId);
    if (refs.camera) {
      await refs.camera.sender.replaceTrack(null);
      refs.camera.direction = 'inactive';
    }
  }, [getTransceiverRefs]);

  /**
   * 添加或更新屏幕共享 Transceiver
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
   */
  const stopScreenTransceiver = useCallback(async (peerId: string) => {
    const refs = getTransceiverRefs(peerId);
    if (refs.screen) {
      await refs.screen.sender.replaceTrack(null);
      refs.screen.direction = 'inactive';
    }
  }, [getTransceiverRefs]);

  // ========== 信令处理 ==========

  /** 发起 Offer（用于新加入的参与者） */
  const createInitialOffer = useCallback(async (peerId: string) => {
    let pc = peerConnectionsRef.current.get(peerId);
    if (!pc) {
      pc = createPeerConnection(peerId);
    }

    // 添加当前已开启的媒体
    if (mediaState.micEnabled && micStreamRef.current) {
      const track = micStreamRef.current.getAudioTracks()[0];
      if (track) {
        await addMicTransceiver(peerId, track);
      }
    }

    if (mediaState.cameraEnabled && cameraStreamRef.current) {
      const track = cameraStreamRef.current.getVideoTracks()[0];
      if (track) {
        await addCameraTransceiver(peerId, track);
      }
    }

    if (mediaState.screenSharing && screenStreamRef.current) {
      const track = screenStreamRef.current.getVideoTracks()[0];
      if (track) {
        await addScreenTransceiver(peerId, track);
      }
    }

    // 如果没有任何 transceiver，需要手动触发协商
    // 否则 onnegotiationneeded 会自动触发
    if (!peerConnectionsRef.current.get(peerId)?.getTransceivers().length) {
      await safeNegotiate(peerId, pc);
    }
  }, [createPeerConnection, mediaState, addMicTransceiver, addCameraTransceiver, addScreenTransceiver, safeNegotiate]);

  /** 处理 Offer */
  const handleOffer = useCallback(async (peerId: string, sdp: string) => {
    let pc = peerConnectionsRef.current.get(peerId);
    if (!pc) {
      pc = createPeerConnection(peerId);
    }

    await pc.setRemoteDescription({ type: 'offer', sdp });

    // 添加当前已开启的媒体到 transceiver
    if (mediaState.micEnabled && micStreamRef.current) {
      const track = micStreamRef.current.getAudioTracks()[0];
      if (track) {
        await addMicTransceiver(peerId, track);
      }
    }

    if (mediaState.cameraEnabled && cameraStreamRef.current) {
      const track = cameraStreamRef.current.getVideoTracks()[0];
      if (track) {
        await addCameraTransceiver(peerId, track);
      }
    }

    if (mediaState.screenSharing && screenStreamRef.current) {
      const track = screenStreamRef.current.getVideoTracks()[0];
      if (track) {
        await addScreenTransceiver(peerId, track);
      }
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    sendMessage({
      type: 'answer',
      to: peerId,
      sdp: answer.sdp,
    });
  }, [createPeerConnection, sendMessage, mediaState, addMicTransceiver, addCameraTransceiver, addScreenTransceiver]);

  /** 处理 Answer */
  const handleAnswer = useCallback(async (peerId: string, sdp: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc && pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription({ type: 'answer', sdp });
    }
  }, []);

  /** 处理 ICE 候选者 */
  const handleCandidate = useCallback(async (
    peerId: string,
    candidate: { candidate: string; sdpMLineIndex: number | null; sdpMid: string | null },
  ) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }, []);

  /** 处理服务器消息 */
  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'joined':
        myIdRef.current = msg.participant_id;
        setMyParticipantId(msg.participant_id);
        setParticipants(msg.participants.map((p) => ({ ...p, connectionState: 'new' as ConnectionState })));
        setMeetingState('connected');
        // 向现有参与者发起连接（ID 小的一方发起）
        msg.participants.forEach((p) => {
          if (msg.participant_id < p.id) {
            createInitialOffer(p.id);
          }
        });
        break;

      case 'peer_joined':
        setParticipants((prev) => [...prev, { ...msg.participant, connectionState: 'new' as ConnectionState }]);
        if (myIdRef.current && myIdRef.current < msg.participant.id) {
          createInitialOffer(msg.participant.id);
        }
        break;

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

      case 'room_closed':
        setError(`房间已关闭: ${msg.reason}`);
        setMeetingState('error');
        break;

      case 'error':
        setError(msg.message);
        break;
    }
  }, [createInitialOffer, handleOffer, handleAnswer, handleCandidate, closePeerConnection]);

  // ========== 媒体控制 ==========

  /**
   * 初始化本地媒体流
   * 只获取权限，不开始共享
   */
  const initLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    try {
      // 检查设备
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasAudio = devices.some((d) => d.kind === 'audioinput');

      if (!hasAudio) {
        return null;
      }

      // 预请求权限（用于检测权限状态）
      try {
        const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        testStream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        if (err instanceof Error && err.name === 'NotAllowedError') {
          await invoke<string>('reset_webview_permissions');
          await new Promise((r) => { setTimeout(r, 500); });
        }
      }

      // 创建一个空的本地流用于预览
      const previewStream = new MediaStream();
      setLocalStream(previewStream);

      return previewStream;
    } catch {
      return null;
    }
  }, []);

  /** 停止所有本地媒体流 */
  const stopLocalStream = useCallback(() => {
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
  }, []);

  /**
   * 切换麦克风
   * - 开启：获取麦克风流，向所有参与者添加 transceiver
   * - 关闭：停止麦克风流，停止所有 transceiver
   */
  const toggleMic = useCallback(async () => {
    if (mediaState.micEnabled) {
      // ========== 关闭麦克风 ==========
      // 停止所有 PeerConnection 的麦克风 transceiver
      const stopPromises = Array.from(peerConnectionsRef.current.keys()).map((peerId) =>
        stopMicTransceiver(peerId),
      );
      await Promise.all(stopPromises);

      // 停止本地流
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }

      // 更新本地预览流
      setLocalStream((prev) => {
        if (!prev) {
          return null;
        }
        const newStream = new MediaStream(prev.getTracks().filter((t) => t.kind !== 'audio'));
        return newStream.getTracks().length > 0 ? newStream : null;
      });

      setMediaState((prev) => ({ ...prev, micEnabled: false }));
    } else {
      // ========== 开启麦克风 ==========
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
        const track = stream.getAudioTracks()[0];

        // 向所有 PeerConnection 添加麦克风 transceiver
        const addPromises = Array.from(peerConnectionsRef.current.keys()).map((peerId) =>
          addMicTransceiver(peerId, track),
        );
        await Promise.all(addPromises);

        // 更新本地预览流
        setLocalStream((prev) => {
          const newStream = prev ? new MediaStream(prev.getTracks()) : new MediaStream();
          newStream.addTrack(track);
          return newStream;
        });

        setMediaState((prev) => ({ ...prev, micEnabled: true }));
      } catch {
        // 用户拒绝权限
      }
    }
  }, [mediaState.micEnabled, addMicTransceiver, stopMicTransceiver]);

  /**
   * 切换摄像头
   * - 开启：获取摄像头流，向所有参与者添加 transceiver
   * - 关闭：停止摄像头流，停止所有 transceiver
   */
  const toggleCamera = useCallback(async () => {
    if (mediaState.cameraEnabled) {
      // ========== 关闭摄像头 ==========
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

      setMediaState((prev) => ({ ...prev, cameraEnabled: false }));
    } else {
      // ========== 开启摄像头 ==========
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

        setMediaState((prev) => ({ ...prev, cameraEnabled: true }));
      } catch {
        // 用户拒绝权限
      }
    }
  }, [mediaState.cameraEnabled, addCameraTransceiver, stopCameraTransceiver]);

  /**
   * 切换屏幕共享
   * - 开启：获取屏幕流，向所有参与者添加 transceiver
   * - 关闭：停止屏幕流，停止所有 transceiver
   */
  const toggleScreenShare = useCallback(async () => {
    if (mediaState.screenSharing) {
      // ========== 停止屏幕共享 ==========
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

      setMediaState((prev) => ({ ...prev, screenSharing: false }));
    } else {
      // ========== 开始屏幕共享 ==========
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        const track = stream.getVideoTracks()[0];

        const addPromises = Array.from(peerConnectionsRef.current.keys()).map((peerId) =>
          addScreenTransceiver(peerId, track),
        );
        await Promise.all(addPromises);

        // 监听用户点击"停止共享"按钮
        track.onended = () => {
          // 递归调用关闭逻辑
          toggleScreenShare();
        };

        setLocalStream((prev) => {
          const newStream = prev ? new MediaStream(prev.getTracks()) : new MediaStream();
          newStream.addTrack(track);
          return newStream;
        });

        setMediaState((prev) => ({ ...prev, screenSharing: true }));
      } catch {
        // 用户取消
      }
    }
  }, [mediaState.screenSharing, addScreenTransceiver, stopScreenTransceiver]);

  // ========== 连接管理 ==========

  /** 清理所有资源 */
  const cleanup = useCallback(() => {
    // 关闭所有 PeerConnection
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    transceiverMapRef.current.clear();
    negotiatingRef.current.clear();

    // 关闭 WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // 重置状态
    setMeetingState('idle');
    setMyParticipantId(null);
    setParticipants([]);
    setError(null);
    myIdRef.current = null;
  }, []);

  /** 连接信令服务器 */
  const connect = useCallback((roomId: string, token: string, iceServers: IceServer[]) => {
    const url = getSignalingUrl(roomId, token);
    iceServersRef.current = iceServers;
    setMeetingState('connecting');
    setError(null);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    // 心跳定时器
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    ws.onopen = () => {
      heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        handleMessage(msg);
      } catch {
        // 忽略解析错误
      }
    };

    ws.onerror = () => {
      setError('信令连接失败');
      setMeetingState('error');
    };

    ws.onclose = (event) => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      if (event.code !== 1000 && event.code !== 1001) {
        setError('信令连接已断开');
        setMeetingState('error');
      }
    };
  }, [handleMessage]);

  /** 断开连接 */
  const disconnect = useCallback(() => {
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
    mediaState,
    isSpeaking,
    connect,
    disconnect,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    initLocalStream,
    stopLocalStream,
  };
}
