/**
 * WebRTC 视频会议 Hook
 *
 * 完全按照 WebRTC 官方标准实现：
 * - 每个对等体只创建一个 PeerConnection（单例模式）
 * - ICE 候选者缓存机制
 * - 正确的 Offer/Answer 协商流程
 * - 支持重协商（屏幕共享等场景）
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
 * @see backend-docs/webrtc/WebRTC房间.md
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  getSignalingUrl,
  type IceServer,
  type Participant,
  type ServerMessage,
} from '../api/webrtc';

// ============================================
// 调试日志工具
// ============================================

const DEBUG = true; // 开启调试模式

/* eslint-disable no-console */

/** 调试日志：信令消息 */
function logSignaling(direction: '发送' | '接收', msg: object) {
  if (!DEBUG) {
    return;
  }
  const style = direction === '发送'
    ? 'background: #4CAF50; color: white; padding: 2px 6px; border-radius: 3px;'
    : 'background: #2196F3; color: white; padding: 2px 6px; border-radius: 3px;';
  console.log(`%c[信令 ${direction}]`, style, JSON.stringify(msg, null, 2));
}

/** 调试日志：PeerConnection 状态 */
function logPC(peerId: string, event: string, details?: object) {
  if (!DEBUG) {
    return;
  }
  console.log(
    `%c[PeerConnection ${peerId}]`,
    'background: #FF9800; color: white; padding: 2px 6px; border-radius: 3px;',
    event,
    details || '',
  );
}

/** 调试日志：协商过程 */
function logNegotiation(peerId: string, step: string, details?: object) {
  if (!DEBUG) {
    return;
  }
  console.log(
    `%c[协商 ${peerId}]`,
    'background: #9C27B0; color: white; padding: 2px 6px; border-radius: 3px;',
    step,
    details || '',
  );
}

/** 调试日志：媒体流 */
function logMedia(event: string, details?: object) {
  if (!DEBUG) {
    return;
  }
  console.log(
    '%c[媒体流]',
    'background: #E91E63; color: white; padding: 2px 6px; border-radius: 3px;',
    event,
    details || '',
  );
}

/** 调试日志：错误 */
function logError(context: string, error: unknown) {
  console.error(
    `%c[错误 ${context}]`,
    'background: #F44336; color: white; padding: 2px 6px; border-radius: 3px;',
    error,
  );
}

/** 调试日志：会议事件 */
function logMeeting(event: string, details?: object, color = '#4CAF50') {
  if (!DEBUG) {
    return;
  }
  console.log(
    `%c[会议] ${event}`,
    `background: ${color}; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;`,
    details || '',
  );
}

/** 调试日志：连接决策 */
function logDecision(peerId: string, name: string, details?: object) {
  if (!DEBUG) {
    return;
  }
  console.log(
    `%c[连接决策] ${name} (${peerId})`,
    'background: #607D8B; color: white; padding: 2px 6px; border-radius: 3px;',
    details || '',
  );
}

/** 调试日志：WebSocket */
function logWS(event: string, details?: object) {
  if (!DEBUG) {
    return;
  }
  console.log(
    `%c[WebSocket] ${event}`,
    'background: #673AB7; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;',
    details || '',
  );
}

/* eslint-enable no-console */

// ============================================
// 类型定义
// ============================================

/** 连接状态类型 */
type ConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

/** 会议状态 */
export type MeetingState = 'idle' | 'connecting' | 'connected' | 'error';

/** 媒体设备状态 */
export interface MediaDeviceState {
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
}

/** 远程参与者 */
export interface RemoteParticipant extends Participant {
  stream?: MediaStream;
  connectionState: ConnectionState;
}

/** Hook 返回值 */
export interface UseWebRTCReturn {
  // 状态
  meetingState: MeetingState;
  myParticipantId: string | null;
  participants: RemoteParticipant[];
  localStream: MediaStream | null;
  error: string | null;
  mediaState: MediaDeviceState;

  // 操作
  connect: (roomId: string, token: string, iceServers: IceServer[]) => void;
  disconnect: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
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
    micEnabled: true,
    cameraEnabled: true,
    screenSharing: false,
  });

  // ========== Refs ==========
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const iceServersRef = useRef<IceServer[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const myIdRef = useRef<string | null>(null);

  // ICE 候选者类型
  type IceCandidateData = { candidate: string; sdpMLineIndex: number | null; sdpMid: string | null };

  // ICE 候选者缓存：在 remoteDescription 设置之前收到的候选者
  const pendingCandidatesRef = useRef<Map<string, IceCandidateData[]>>(new Map());

  // Perfect Negotiation 状态：跟踪每个对等体的协商状态
  // makingOffer: 是否正在创建 offer
  // ignoreOffer: 是否应该忽略收到的 offer（用于解决冲突）
  const negotiationStateRef = useRef<Map<string, { makingOffer: boolean }>>(new Map());

  // ========== 工具函数 ==========

  /** 发送 WebSocket 消息 */
  const sendMessage = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      logSignaling('发送', message);
      wsRef.current.send(JSON.stringify(message));
    } else {
      logError('发送消息', 'WebSocket 未连接');
    }
  }, []);

  /** 获取当前应该发送的流（屏幕共享优先） */
  const getCurrentStream = useCallback((): MediaStream | null => {
    const stream = screenStreamRef.current || localStreamRef.current;
    logMedia('获取当前流', {
      isScreenShare: !!screenStreamRef.current,
      hasStream: !!stream,
      tracks: stream?.getTracks().map((t) => ({ kind: t.kind, id: t.id, enabled: t.enabled })),
    });
    return stream;
  }, []);

  // ========== PeerConnection 管理 ==========

  /**
   * 判断是否是 "礼让方"（polite peer）
   * Perfect Negotiation 模式中，ID 较大的一方为礼让方
   * 礼让方在发生冲突时会回滚自己的 offer
   */
  const isPolite = useCallback((peerId: string): boolean => {
    const polite = (myIdRef.current || '') > peerId;
    logNegotiation(peerId, '判断礼让方', { myId: myIdRef.current, peerId, isPolite: polite });
    return polite;
  }, []);

  /**
   * 添加本地轨道到 PeerConnection
   * 由调用者在适当时机调用，避免 onnegotiationneeded 冲突
   */
  const addLocalTracks = useCallback((pc: RTCPeerConnection, peerId: string) => {
    const stream = getCurrentStream();
    if (stream) {
      // 检查是否已经添加过这些轨道
      const existingSenders = pc.getSenders();
      const existingTrackIds = new Set(existingSenders.map((s) => s.track?.id).filter(Boolean));

      logPC(peerId, '添加本地轨道', {
        streamTracks: stream.getTracks().map((t) => ({ kind: t.kind, id: t.id })),
        existingTrackIds: Array.from(existingTrackIds),
      });

      stream.getTracks().forEach((track) => {
        if (!existingTrackIds.has(track.id)) {
          logPC(peerId, `添加轨道: ${track.kind}`, { trackId: track.id });
          pc.addTrack(track, stream);
        } else {
          logPC(peerId, `轨道已存在，跳过: ${track.kind}`, { trackId: track.id });
        }
      });
    } else {
      logPC(peerId, '无本地流可添加');
    }
  }, [getCurrentStream]);

  /**
   * 获取或创建 PeerConnection（单例模式）
   * 注意：不自动添加轨道，由调用者决定何时添加
   */
  const getOrCreatePeerConnection = useCallback((peerId: string): RTCPeerConnection => {
    // 检查是否已存在
    const existingPc = peerConnectionsRef.current.get(peerId);
    if (existingPc) {
      logPC(peerId, '复用已有 PeerConnection', { signalingState: existingPc.signalingState });
      return existingPc;
    }

    logPC(peerId, '创建新的 PeerConnection', { iceServers: iceServersRef.current });

    // 初始化协商状态
    negotiationStateRef.current.set(peerId, { makingOffer: false });

    // 创建新的 PeerConnection（不添加轨道）
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 10,
    });

    // ICE 候选者事件：收集到候选者后发送给对方
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        logPC(peerId, 'ICE 候选者收集', {
          candidate: `${event.candidate.candidate.substring(0, 50)}...`,
          type: event.candidate.type,
        });
        sendMessage({
          type: 'candidate',
          to: peerId,
          candidate: {
            candidate: event.candidate.candidate,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            sdpMid: event.candidate.sdpMid,
          },
        });
      } else {
        logPC(peerId, 'ICE 候选者收集完成');
      }
    };

    // ICE 连接状态变化
    pc.oniceconnectionstatechange = () => {
      logPC(peerId, 'ICE 连接状态变化', { iceConnectionState: pc.iceConnectionState });
    };

    // ICE 收集状态变化
    pc.onicegatheringstatechange = () => {
      logPC(peerId, 'ICE 收集状态变化', { iceGatheringState: pc.iceGatheringState });
    };

    // 信令状态变化
    pc.onsignalingstatechange = () => {
      logPC(peerId, '信令状态变化', { signalingState: pc.signalingState });
    };

    // 连接状态变化：更新参与者状态
    pc.onconnectionstatechange = () => {
      logPC(peerId, '连接状态变化', { connectionState: pc.connectionState });
      setParticipants((prev) =>
        prev.map((p) =>
          p.id === peerId ? { ...p, connectionState: pc.connectionState as ConnectionState } : p,
        ),
      );
    };

    // 接收远程流：当对方的轨道到达时触发
    pc.ontrack = (event) => {
      const track = event.track;

      logMedia(`收到远程轨道 [${peerId}]`, {
        kind: track.kind,
        trackId: track.id,
        readyState: track.readyState,
        muted: track.muted,
        streams: event.streams.map((s) => s.id),
      });

      // 监听远程轨道的生命周期事件
      track.onended = () => {
        logMedia(`远程轨道结束 [${peerId}]`, { kind: track.kind, trackId: track.id });
        // 从参与者的流中移除该轨道，触发 UI 更新显示占位符
        setParticipants((prev) =>
          prev.map((p) => {
            if (p.id === peerId && p.stream) {
              // 创建新的流，不包含已结束的轨道
              const newStream = new MediaStream(
                p.stream.getTracks().filter((t) => t.id !== track.id && t.readyState === 'live'),
              );
              return { ...p, stream: newStream.getTracks().length > 0 ? newStream : undefined };
            }
            return p;
          }),
        );
      };

      track.onmute = () => {
        logMedia(`远程轨道静音 [${peerId}]`, { kind: track.kind, trackId: track.id });
      };

      track.onunmute = () => {
        logMedia(`远程轨道恢复 [${peerId}]`, { kind: track.kind, trackId: track.id });
      };

      setParticipants((prev) => {
        // 获取或创建 MediaStream
        // event.streams[0] 可能不存在（当 replaceTrack 没有关联 stream 时）
        let remoteStream = event.streams[0];

        if (!remoteStream) {
          // 如果没有关联的 stream，需要创建新的 MediaStream
          // 重要：必须创建新对象以触发 React 重新渲染
          const existingParticipant = prev.find((p) => p.id === peerId);
          const existingTracks = existingParticipant?.stream?.getTracks() || [];

          // 创建新的 MediaStream，包含现有轨道 + 新轨道
          remoteStream = new MediaStream([
            ...existingTracks.filter((t) => t.id !== track.id && t.readyState === 'live'),
            track,
          ]);

          logMedia(`创建/更新远程流 [${peerId}]`, {
            streamId: remoteStream.id,
            trackCount: remoteStream.getTracks().length,
            tracks: remoteStream.getTracks().map((t) => ({ kind: t.kind, id: t.id })),
          });
        }

        return prev.map((p) => (p.id === peerId ? { ...p, stream: remoteStream } : p));
      });
    };

    // Perfect Negotiation: onnegotiationneeded 事件处理
    pc.onnegotiationneeded = async () => {
      const state = negotiationStateRef.current.get(peerId);
      if (!state) {
        logNegotiation(peerId, 'onnegotiationneeded: 无协商状态，跳过');
        return;
      }

      logNegotiation(peerId, 'onnegotiationneeded 触发', {
        makingOffer: state.makingOffer,
        signalingState: pc.signalingState,
      });

      try {
        // 标记正在创建 offer
        state.makingOffer = true;

        // 使用 setLocalDescription() 无参数形式，让浏览器自动处理
        logNegotiation(peerId, '调用 setLocalDescription()');
        await pc.setLocalDescription();

        // 只有在成功设置本地描述后才发送
        if (pc.localDescription) {
          logNegotiation(peerId, 'Offer 创建成功', {
            type: pc.localDescription.type,
            sdpLength: pc.localDescription.sdp?.length,
          });
          sendMessage({
            type: 'offer',
            to: peerId,
            sdp: pc.localDescription.sdp,
          });
        }
      } catch (err) {
        // 忽略 InvalidStateError（在非 stable 状态下触发协商）
        if (err instanceof Error && err.name !== 'InvalidStateError') {
          logError(`协商失败 [${peerId}]`, err);
        } else {
          logNegotiation(peerId, '协商被忽略（非 stable 状态）', { error: String(err) });
        }
      } finally {
        state.makingOffer = false;
      }
    };

    // 存储并返回
    peerConnectionsRef.current.set(peerId, pc);
    return pc;
  }, [sendMessage]);

  /**
   * 关闭并移除指定的 PeerConnection
   */
  const closePeerConnection = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      logPC(peerId, '关闭 PeerConnection');
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }
    pendingCandidatesRef.current.delete(peerId);
    negotiationStateRef.current.delete(peerId);
  }, []);

  /**
   * 添加缓存的 ICE 候选者
   * 在 setRemoteDescription 之后调用
   */
  const flushPendingCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const pending = pendingCandidatesRef.current.get(peerId);
    if (pending && pending.length > 0) {
      logPC(peerId, `添加 ${pending.length} 个缓存的 ICE 候选者`);
      const addPromises = pending.map(async (candidate) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          logPC(peerId, 'ICE 候选者添加成功');
        } catch (err) {
          logError(`添加缓存候选者失败 [${peerId}]`, err);
        }
      });
      await Promise.all(addPromises);
      pendingCandidatesRef.current.delete(peerId);
    }
  }, []);

  // ========== 信令处理 ==========

  /**
   * 发起 Offer
   * 使用 Perfect Negotiation 模式
   */
  const createOffer = useCallback(async (peerId: string) => {
    logNegotiation(peerId, '开始创建 Offer');

    const pc = getOrCreatePeerConnection(peerId);

    // 在创建 offer 之前添加本地轨道
    addLocalTracks(pc, peerId);

    // 确保协商状态存在
    let negotiationState = negotiationStateRef.current.get(peerId);
    if (!negotiationState) {
      negotiationState = { makingOffer: false };
      negotiationStateRef.current.set(peerId, negotiationState);
    }

    try {
      negotiationState.makingOffer = true;

      // 使用无参数形式，让浏览器自动处理 SDP
      logNegotiation(peerId, '调用 setLocalDescription() 创建 Offer');
      await pc.setLocalDescription();

      logNegotiation(peerId, 'Offer 创建成功', {
        type: pc.localDescription?.type,
        sdpLength: pc.localDescription?.sdp?.length,
        signalingState: pc.signalingState,
      });

      sendMessage({
        type: 'offer',
        to: peerId,
        sdp: pc.localDescription?.sdp,
      });
    } catch (err) {
      logError(`创建 Offer 失败 [${peerId}]`, err);
    } finally {
      negotiationState.makingOffer = false;
    }
  }, [getOrCreatePeerConnection, sendMessage, addLocalTracks]);

  /**
   * 处理收到的 Offer
   * 使用 Perfect Negotiation 模式处理冲突
   * 按照官方标准流程：先设置 remoteDescription，再添加本地轨道
   */
  const handleOffer = useCallback(async (peerId: string, sdp: string) => {
    logNegotiation(peerId, '收到 Offer', { sdpLength: sdp.length });

    const pc = getOrCreatePeerConnection(peerId);
    const state = negotiationStateRef.current.get(peerId);
    const polite = isPolite(peerId);

    // 检测冲突：正在创建 offer 或 signaling state 不是 stable
    const offerCollision = state?.makingOffer || pc.signalingState !== 'stable';

    logNegotiation(peerId, '冲突检测', {
      makingOffer: state?.makingOffer,
      signalingState: pc.signalingState,
      offerCollision,
      isPolite: polite,
    });

    // 如果发生冲突且我是不礼让方，忽略这个 offer
    if (offerCollision && !polite) {
      logNegotiation(peerId, '❌ 忽略 Offer（我是不礼让方，发生冲突）');
      return;
    }

    try {
      // 如果发生冲突且我是礼让方，先回滚当前的 offer
      if (offerCollision && polite) {
        logNegotiation(peerId, '回滚当前 Offer（我是礼让方）');
        await Promise.all([
          pc.setLocalDescription({ type: 'rollback' }),
          pc.setRemoteDescription({ type: 'offer', sdp }),
        ]);
      } else {
        logNegotiation(peerId, '设置远程描述 (Offer)');
        await pc.setRemoteDescription({ type: 'offer', sdp });
      }

      logNegotiation(peerId, 'setRemoteDescription 成功', { signalingState: pc.signalingState });

      // 设置远程描述后，添加缓存的 ICE 候选者
      await flushPendingCandidates(peerId, pc);

      // ✅ 官方标准：在 setRemoteDescription 之后添加本地轨道
      // 这样 answer 会包含本地轨道的信息
      addLocalTracks(pc, peerId);

      // 创建并发送 Answer
      logNegotiation(peerId, '调用 setLocalDescription() 创建 Answer');
      await pc.setLocalDescription();

      logNegotiation(peerId, 'Answer 创建成功', {
        type: pc.localDescription?.type,
        sdpLength: pc.localDescription?.sdp?.length,
        signalingState: pc.signalingState,
      });

      sendMessage({
        type: 'answer',
        to: peerId,
        sdp: pc.localDescription?.sdp,
      });
    } catch (err) {
      logError(`处理 Offer 失败 [${peerId}]`, err);
    }
  }, [getOrCreatePeerConnection, sendMessage, flushPendingCandidates, isPolite, addLocalTracks]);

  /**
   * 处理收到的 Answer
   * Perfect Negotiation: 只有在 have-local-offer 状态下才处理
   */
  const handleAnswer = useCallback(async (peerId: string, sdp: string) => {
    logNegotiation(peerId, '收到 Answer', { sdpLength: sdp.length });

    const pc = peerConnectionsRef.current.get(peerId);

    if (!pc) {
      logNegotiation(peerId, '❌ 无对应的 PeerConnection');
      return;
    }

    // 只有在等待 answer 的状态下才处理
    if (pc.signalingState !== 'have-local-offer') {
      logNegotiation(peerId, '❌ 忽略 Answer（当前状态不是 have-local-offer）', {
        signalingState: pc.signalingState,
      });
      return;
    }

    try {
      logNegotiation(peerId, '设置远程描述 (Answer)');
      await pc.setRemoteDescription({ type: 'answer', sdp });

      logNegotiation(peerId, 'setRemoteDescription 成功', { signalingState: pc.signalingState });

      // 设置远程描述后，添加缓存的 ICE 候选者
      await flushPendingCandidates(peerId, pc);
    } catch (err) {
      logError(`处理 Answer 失败 [${peerId}]`, err);
    }
  }, [flushPendingCandidates]);

  /**
   * 处理收到的 ICE 候选者
   * 如果 PC 不存在或远程描述未设置，则缓存
   */
  const handleCandidate = useCallback(async (
    peerId: string,
    candidate: IceCandidateData,
  ) => {
    logPC(peerId, '收到 ICE 候选者', {
      candidate: `${candidate.candidate.substring(0, 50)}...`,
    });

    const pc = peerConnectionsRef.current.get(peerId);

    // 如果 PC 不存在或远程描述未设置，缓存候选者
    if (!pc || !pc.remoteDescription) {
      logPC(peerId, 'ICE 候选者已缓存（等待远程描述）', {
        hasPC: !!pc,
        hasRemoteDescription: !!pc?.remoteDescription,
      });
      const pending = pendingCandidatesRef.current.get(peerId) || [];
      pending.push(candidate);
      pendingCandidatesRef.current.set(peerId, pending);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      logPC(peerId, 'ICE 候选者添加成功');
    } catch (err) {
      logError(`添加 ICE 候选者失败 [${peerId}]`, err);
    }
  }, []);

  // ========== WebSocket 消息处理 ==========

  /**
   * 处理服务器消息
   */
  const handleMessage = useCallback((msg: ServerMessage) => {
    logSignaling('接收', msg);

    switch (msg.type) {
      case 'joined': {
        logMeeting('成功加入房间', {
          myId: msg.participant_id,
          participantsCount: msg.participants.length,
          participants: msg.participants.map((p) => ({ id: p.id, name: p.name, is_creator: p.is_creator })),
        }, '#4CAF50');

        myIdRef.current = msg.participant_id;
        setMyParticipantId(msg.participant_id);
        setParticipants(
          msg.participants.map((p) => ({
            ...p,
            connectionState: 'new' as ConnectionState,
          })),
        );
        setMeetingState('connected');

        // 向每个现有参与者建立连接
        // 规则：ID 较小的一方发起 Offer，避免冲突
        msg.participants.forEach((p) => {
          const shouldOffer = msg.participant_id < p.id;
          logDecision(p.id, p.name, {
            myId: msg.participant_id,
            peerId: p.id,
            shouldOffer,
            reason: shouldOffer ? '我的 ID 更小，我发起 Offer' : '对方 ID 更小，等待对方 Offer',
          });
          if (shouldOffer) {
            createOffer(p.id);
          }
        });
        break;
      }

      case 'peer_joined': {
        logMeeting('新参与者加入', msg.participant, '#03A9F4');

        setParticipants((prev) => [
          ...prev,
          {
            ...msg.participant,
            connectionState: 'new' as ConnectionState,
          },
        ]);

        // 如果我的 ID 较小，我发起 Offer
        const shouldOffer = myIdRef.current && myIdRef.current < msg.participant.id;
        logDecision(msg.participant.id, msg.participant.name, {
          myId: myIdRef.current,
          peerId: msg.participant.id,
          shouldOffer,
        });
        if (shouldOffer) {
          createOffer(msg.participant.id);
        }
        break;
      }

      case 'peer_left': {
        logMeeting('参与者离开', { participant_id: msg.participant_id }, '#FF5722');
        setParticipants((prev) => prev.filter((p) => p.id !== msg.participant_id));
        closePeerConnection(msg.participant_id);
        break;
      }

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
        logMeeting('房间已关闭', { reason: msg.reason }, '#F44336');
        setError(`房间已关闭: ${msg.reason}`);
        setMeetingState('error');
        break;

      case 'error':
        logError('服务器错误', { code: (msg as { code?: string }).code, message: msg.message });
        setError(msg.message);
        break;
    }
  }, [createOffer, handleOffer, handleAnswer, handleCandidate, closePeerConnection]);

  // 使用 ref 保存最新的 handleMessage，避免闭包陷阱
  const handleMessageRef = useRef(handleMessage);
  useEffect(() => {
    handleMessageRef.current = handleMessage;
  }, [handleMessage]);

  // ========== 媒体流管理 ==========

  /**
   * 初始化本地媒体流
   */
  const initLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    logMedia('初始化本地媒体流');
    try {
      // 枚举设备
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasVideo = devices.some((d) => d.kind === 'videoinput');
      const hasAudio = devices.some((d) => d.kind === 'audioinput');

      logMedia('设备检测', { hasVideo, hasAudio, devices: devices.map((d) => ({ kind: d.kind, label: d.label })) });

      if (!hasVideo && !hasAudio) {
        logMedia('没有检测到音视频设备');
        return null;
      }

      const constraints: { video?: boolean; audio?: boolean } = {};
      if (hasVideo) {
        constraints.video = true;
      }
      if (hasAudio) {
        constraints.audio = true;
      }

      logMedia('请求媒体权限', constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      logMedia('媒体流获取成功', {
        streamId: stream.id,
        tracks: stream.getTracks().map((t) => ({ kind: t.kind, id: t.id, label: t.label })),
      });

      localStreamRef.current = stream;
      setLocalStream(stream);
      setMediaState({
        micEnabled: hasAudio,
        cameraEnabled: hasVideo,
        screenSharing: false,
      });

      return stream;
    } catch (err) {
      logError('获取媒体设备失败', err);

      // 降级：尝试仅音频
      try {
        logMedia('降级：尝试仅音频');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setMediaState({
          micEnabled: true,
          cameraEnabled: false,
          screenSharing: false,
        });
        return stream;
      } catch (audioErr) {
        logError('音频设备也获取失败', audioErr);
        return null;
      }
    }
  }, []);

  /**
   * 停止本地媒体流
   */
  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      logMedia('停止本地媒体流');
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
  }, []);

  // ========== 连接管理 ==========

  /**
   * 清理所有资源
   */
  const cleanup = useCallback(() => {
    logMedia('清理所有资源');

    // 关闭所有 PeerConnection
    peerConnectionsRef.current.forEach((pc, peerId) => {
      logPC(peerId, '关闭');
      pc.close();
    });
    peerConnectionsRef.current.clear();

    // 清理 ICE 候选者缓存和协商状态
    pendingCandidatesRef.current.clear();
    negotiationStateRef.current.clear();

    // 停止屏幕共享
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }

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

  /**
   * 连接信令服务器
   */
  const connect = useCallback((
    roomId: string,
    token: string,
    iceServers: IceServer[],
  ) => {
    const url = getSignalingUrl(roomId, token);
    logWS('连接信令服务器', { url, iceServersCount: iceServers.length });

    iceServersRef.current = iceServers;
    setMeetingState('connecting');
    setError(null);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      logWS('连接已建立');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        handleMessageRef.current(msg);
      } catch (err) {
        logError('解析消息失败', err);
      }
    };

    ws.onerror = (err) => {
      logError('信令连接错误', err);
      setError('信令连接失败');
      setMeetingState('error');
    };

    ws.onclose = (event) => {
      logWS('连接已关闭', { code: event.code, reason: event.reason });
    };
  }, []);

  /**
   * 断开连接
   */
  const disconnect = useCallback(() => {
    logMeeting('主动断开连接', undefined, '#FF9800');
    sendMessage({ type: 'leave' });
    cleanup();
  }, [sendMessage, cleanup]);

  // ========== 媒体控制 ==========

  /**
   * 切换麦克风
   */
  const toggleMic = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        logMedia('切换麦克风', { enabled: audioTrack.enabled });
        setMediaState((prev) => ({ ...prev, micEnabled: audioTrack.enabled }));
      }
    }
  }, []);

  /**
   * 切换摄像头
   */
  const toggleCamera = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        logMedia('切换摄像头', { enabled: videoTrack.enabled });
        setMediaState((prev) => ({ ...prev, cameraEnabled: videoTrack.enabled }));
      }
    }
  }, []);

  /**
   * 切换屏幕共享
   */
  const toggleScreenShare = useCallback(async () => {
    logMedia('切换屏幕共享', { currentlySharing: mediaState.screenSharing });

    if (mediaState.screenSharing) {
      // ========== 停止屏幕共享 ==========
      logMedia('停止屏幕共享');
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
      }

      // 恢复摄像头流到所有 PeerConnection
      if (localStreamRef.current) {
        const cameraTrack = localStreamRef.current.getVideoTracks()[0];
        if (cameraTrack) {
          logMedia('恢复摄像头轨道到所有连接');
          peerConnectionsRef.current.forEach((pc, peerId) => {
            // 使用 transceiver 查找视频发送器
            const videoTransceiver = pc.getTransceivers().find(
              (t) => t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video',
            );
            if (videoTransceiver?.sender) {
              logPC(peerId, '替换视频轨道为摄像头');
              videoTransceiver.sender.replaceTrack(cameraTrack);
            }
          });
        }
      }

      setLocalStream(localStreamRef.current);
      setMediaState((prev) => ({ ...prev, screenSharing: false }));
    } else {
      // ========== 开始屏幕共享 ==========
      logMedia('开始屏幕共享');
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

        logMedia('屏幕流获取成功', {
          streamId: screenStream.id,
          tracks: screenStream.getTracks().map((t) => ({ kind: t.kind, id: t.id })),
        });

        screenStreamRef.current = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];

        // 更新本地预览
        setLocalStream(screenStream);

        // 替换所有 PeerConnection 中的视频轨道
        const replacePromises = Array.from(peerConnectionsRef.current.entries()).map(
          async ([peerId, pc]) => {
            // 使用 transceiver 查找视频相关的 transceiver
            const videoTransceiver = pc.getTransceivers().find(
              (t) => t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video',
            );

            logPC(peerId, '屏幕共享轨道处理', {
              hasTransceiver: !!videoTransceiver,
              direction: videoTransceiver?.direction,
              senderTrack: videoTransceiver?.sender.track?.kind,
              receiverTrack: videoTransceiver?.receiver.track?.kind,
            });

            if (videoTransceiver) {
              const videoSender = videoTransceiver.sender;
              const currentDirection = videoTransceiver.direction;

              if (videoSender.track) {
                // 已有视频轨道，直接替换（不触发重协商）
                logPC(peerId, '替换视频轨道为屏幕共享（不触发重协商）');
                await videoSender.replaceTrack(screenTrack);
              } else {
                // 有 transceiver 但 sender 没有 track，需要触发重协商
                logPC(peerId, '空 sender 添加屏幕共享轨道', { currentDirection });

                // 先添加轨道
                await videoSender.replaceTrack(screenTrack);

                // 确保触发 onnegotiationneeded
                if (currentDirection === 'recvonly' || currentDirection === 'inactive') {
                  // 修改 direction 会触发 onnegotiationneeded
                  logPC(peerId, `修改 transceiver 方向: ${currentDirection} -> sendrecv`);
                  videoTransceiver.direction = 'sendrecv';
                } else if (currentDirection === 'sendrecv') {
                  // direction 已是 sendrecv，replaceTrack 不会触发重协商
                  // 需要手动创建 Offer 通知远端
                  logPC(peerId, 'direction 已是 sendrecv，手动触发重协商');
                  const state = negotiationStateRef.current.get(peerId);
                  if (state && !state.makingOffer && pc.signalingState === 'stable') {
                    try {
                      state.makingOffer = true;
                      await pc.setLocalDescription();
                      if (pc.localDescription) {
                        logNegotiation(peerId, '手动发送 Offer（屏幕共享）');
                        sendMessage({
                          type: 'offer',
                          to: peerId,
                          sdp: pc.localDescription.sdp,
                        });
                      }
                    } catch (err) {
                      logError(`手动重协商失败 [${peerId}]`, err);
                    } finally {
                      state.makingOffer = false;
                    }
                  }
                }
              }
            } else {
              // 没有视频 transceiver，添加新轨道（触发 onnegotiationneeded）
              logPC(peerId, '添加屏幕共享轨道（将触发重协商）');
              pc.addTrack(screenTrack, screenStream);
            }
          },
        );
        await Promise.all(replacePromises);

        // 监听用户点击"停止共享"按钮
        screenTrack.onended = () => {
          logMedia('用户停止了屏幕共享');
          setMediaState((prev) => ({ ...prev, screenSharing: false }));
          setLocalStream(localStreamRef.current);

          // 恢复摄像头轨道
          if (localStreamRef.current) {
            const cameraTrack = localStreamRef.current.getVideoTracks()[0];
            if (cameraTrack) {
              peerConnectionsRef.current.forEach((pc, peerId) => {
                const videoTransceiver = pc.getTransceivers().find(
                  (t) => t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video',
                );
                if (videoTransceiver?.sender) {
                  logPC(peerId, '恢复摄像头轨道');
                  videoTransceiver.sender.replaceTrack(cameraTrack);
                }
              });
            }
          }
          screenStreamRef.current = null;
        };

        setMediaState((prev) => ({ ...prev, screenSharing: true }));
      } catch (err) {
        logError('屏幕共享失败', err);
      }
    }
  }, [mediaState.screenSharing, sendMessage]);

  // ========== 生命周期 ==========

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      cleanup();
      stopLocalStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========== 返回值 ==========

  return {
    meetingState,
    myParticipantId,
    participants,
    localStream,
    error,
    mediaState,
    connect,
    disconnect,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    initLocalStream,
    stopLocalStream,
  };
}
