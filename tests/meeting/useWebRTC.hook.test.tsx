/**
 * useWebRTC hook 信令/装配状态机测试（jsdom + fake RustWebSocket + fake RTCPeerConnection）
 *
 * 覆盖 hook 层 JS 侧可确定性驱动的部分：connect/disconnect、handleMessage switch
 * （joined / peer_joined / peer_left / offer / candidate / media_state_changed /
 * room_closed / error）、candidate 队列 flush 时机、DataChannel 单侧创建极性、
 * 断线重连调度（退避 + rejoin + 旧 pc 清理 + 新 token 重开 WS）。
 *
 * jsdom 无真实 WebRTC，以下不在本文件覆盖范围（属集成/真机层验证，不做假覆盖）：
 * - 真实 SDP/ICE 交换（fake pc 的 setLocal/setRemoteDescription 只做协商状态转移）
 * - 真实媒体轨道与 getUserMedia / getDisplayMedia（toggleMic/Camera/ScreenShare 的设备路径）
 * - AudioContext + AnalyserNode 音量检测（isSpeaking 判定与广播）
 * - DataChannel 实际传输（只断言创建侧/监听侧接线，不模拟 open/message）
 *
 * webrtcCore 纯函数（computePolarity / shouldIgnoreOffer / classifyMediaTracks /
 * nextBackoffDelay / isPongExpired / shouldReconnectOnClose / PendingCandidates）
 * 已由 tests/meeting/useWebRTC.*.test.ts 覆盖，此处不重复。
 *
 * 注意：多数用例不触发 ws.onopen（onopen 才会建心跳 interval；onmessage 处理不依赖
 * onopen），fake ws 的 readyState 初始即 OPEN(1) 使 sendMessage 可用，从而无悬挂定时器。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---- mock RustWebSocket（仿 tests/unit/webSocketMarkReadChain.test.ts 惯用模式）----
const wsControl = vi.hoisted(() => {
  class FakeRustWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    /** 初始即 OPEN：sendMessage 门槛只看 readyState，无需触发 onopen（避免心跳 interval） */
    readyState = 1;
    sent: string[] = [];
    url: string;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    onclose: ((ev: { code: number }) => void) | null = null;
    constructor(url: string) {
      this.url = url;
      instances.push(this);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.readyState = FakeRustWebSocket.CLOSED;
    }
  }
  const instances: InstanceType<typeof FakeRustWebSocket>[] = [];
  return { FakeRustWebSocket, instances };
});
vi.mock('../../src/services/rustWebSocket', () => ({
  RustWebSocket: wsControl.FakeRustWebSocket,
}));

vi.mock('../../src/services/discovery', () => ({
  resolveForSecureHttp: () => null,
}));

import { useWebRTC } from '../../src/meeting/useWebRTC';
import type { IceServer } from '../../src/meeting/api';

type FakeWs = InstanceType<typeof wsControl.FakeRustWebSocket>;

// ---- fake RTCPeerConnection / RTCIceCandidate / MediaStream（jsdom 无 WebRTC 全局）----

interface SessionDesc {
  type: string;
  sdp: string;
}

interface FakeTransceiver {
  mid: string | null;
  direction: string | undefined;
  receiver: { track: null };
  sender: { replaceTrack: ReturnType<typeof vi.fn> };
}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = [];

  localDescription: SessionDesc | null = null;
  remoteDescription: SessionDesc | null = null;
  signalingState = 'stable';
  connectionState = 'new';
  iceConnectionState = 'new';

  onicecandidate: ((ev: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ontrack: ((ev: unknown) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  ondatachannel: ((ev: unknown) => void) | null = null;

  private transceivers: FakeTransceiver[] = [];

  constructor(_config?: unknown) {
    FakeRTCPeerConnection.instances.push(this);
  }

  addTransceiver = vi.fn((_track: unknown, init?: { direction?: string }) => {
    const t: FakeTransceiver = {
      mid: null,
      direction: init?.direction,
      receiver: { track: null },
      sender: { replaceTrack: vi.fn() },
    };
    this.transceivers.push(t);
    return t;
  });

  /** 按当前协商状态生成 answer/offer（have-remote-offer → answer 回 stable） */
  async setLocalDescription(): Promise<void> {
    if (this.signalingState === 'have-remote-offer') {
      this.localDescription = { type: 'answer', sdp: 'fake-sdp' };
      this.signalingState = 'stable';
    } else {
      this.localDescription = { type: 'offer', sdp: 'fake-sdp' };
      this.signalingState = 'have-local-offer';
    }
  }

  async setRemoteDescription(d: SessionDesc): Promise<void> {
    this.remoteDescription = d;
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  addIceCandidate = vi.fn(async (_candidate: unknown) => {});

  createDataChannel = vi.fn((_label: string, _opts?: unknown) => ({
    label: 'speaking-status',
    readyState: 'connecting',
    onopen: null,
    onclose: null,
    onmessage: null,
    send: vi.fn(),
    close: vi.fn(),
  }));

  getTransceivers() {
    return [...this.transceivers];
  }

  close = vi.fn();
  restartIce = vi.fn();
}

class FakeRTCIceCandidate {
  candidate = '';
  sdpMLineIndex: number | null = null;
  sdpMid: string | null = null;
  constructor(init?: Record<string, unknown>) {
    Object.assign(this, init);
  }
}

class FakeMediaStream {
  private t: Array<{ kind: string; id?: string }>;
  constructor(tracks: Array<{ kind: string; id?: string }> = []) {
    this.t = [...tracks];
  }
  getTracks() {
    return this.t;
  }
  getVideoTracks() {
    return this.t.filter((x) => x.kind === 'video');
  }
  getAudioTracks() {
    return this.t.filter((x) => x.kind === 'audio');
  }
  addTrack(x: { kind: string; id?: string }) {
    this.t.push(x);
  }
}

// ---- 测试工具 ----

const ICE: IceServer[] = [{ urls: ['stun:s'] }];

const JOINED = {
  type: 'joined',
  participant_id: 'p_aaa',
  participants: [{ id: 'p_zzz', name: 'Z', is_creator: false }],
};

/** 多级 await（handleOffer 内 setRemoteDescription → flush → setLocalDescription）需多轮微任务 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

/** 投递一条服务器信令消息并等其异步处理完成 */
async function feed(ws: FakeWs, msg: object): Promise<void> {
  await act(async () => {
    ws.onmessage?.({ data: JSON.stringify(msg) });
    await flushAsync();
  });
}

function sentMessages(ws: FakeWs): Array<Record<string, unknown>> {
  return ws.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
}

describe('useWebRTC hook：信令/装配状态机', () => {
  beforeEach(() => {
    wsControl.instances.length = 0;
    FakeRTCPeerConnection.instances.length = 0;
    globalThis.RTCPeerConnection =
      FakeRTCPeerConnection as unknown as typeof RTCPeerConnection;
    globalThis.RTCIceCandidate =
      FakeRTCIceCandidate as unknown as typeof RTCIceCandidate;
    globalThis.MediaStream = FakeMediaStream as unknown as typeof MediaStream;
  });

  /** connect + 返回 hook 与信令 ws（不触发 onopen） */
  function setup() {
    const rendered = renderHook(() => useWebRTC());
    act(() => {
      rendered.result.current.connect('room1', 'tok', ICE, 'https://api.example.com');
    });
    return { ...rendered, ws: wsControl.instances[wsControl.instances.length - 1] };
  }

  it('1. connect：置 connecting，恰建一条信令 WS 且 URL 正确', () => {
    const { result } = setup();
    expect(result.current.meetingState).toBe('connecting');
    expect(wsControl.instances).toHaveLength(1);
    expect(wsControl.instances[0].url).toBe(
      'wss://api.example.com/ws/webrtc/rooms/room1?token=tok',
    );
  });

  it('2. joined（本端 impolite）：connected + 建 pc + createDataChannel + 上报一条 media_state', async () => {
    const { result, ws } = setup();
    await feed(ws, JOINED);

    expect(result.current.meetingState).toBe('connected');
    expect(result.current.myParticipantId).toBe('p_aaa');
    expect(result.current.participants).toHaveLength(1);
    expect(result.current.participants[0]).toMatchObject({
      id: 'p_zzz',
      connectionState: 'new',
    });

    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    const pc = FakeRTCPeerConnection.instances[0];
    // 'p_aaa' < 'p_zzz' → 本端 impolite → 由本端建 DataChannel
    expect(pc.createDataChannel).toHaveBeenCalledWith('speaking-status', { ordered: true });

    const mediaStates = sentMessages(ws).filter((m) => m.type === 'media_state');
    expect(mediaStates).toEqual([
      { type: 'media_state', mic: false, camera: false, screen: false },
    ]);
  });

  it('3. joined（本端 polite，peer id 更小）：不建 DataChannel，改为监听 ondatachannel', async () => {
    const { ws } = setup();
    await feed(ws, {
      type: 'joined',
      participant_id: 'p_aaa',
      participants: [{ id: 'p_000', name: 'O', is_creator: false }],
    });

    expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    const pc = FakeRTCPeerConnection.instances[0];
    // 'p_aaa' > 'p_000' → 本端 polite → 不主动建 DataChannel（负向分支）
    expect(pc.createDataChannel).not.toHaveBeenCalled();
    expect(typeof pc.ondatachannel).toBe('function');
  });

  it('4. peer_joined：追加参与者并新建第二条 pc', async () => {
    const { result, ws } = setup();
    await feed(ws, JOINED);
    await feed(ws, {
      type: 'peer_joined',
      participant: { id: 'p_mmm', name: 'M', is_creator: false },
    });

    expect(result.current.participants.map((p) => p.id)).toEqual(['p_zzz', 'p_mmm']);
    expect(FakeRTCPeerConnection.instances).toHaveLength(2);
  });

  it('5. offer：setRemoteDescription 收下并回 answer 信令', async () => {
    const { ws } = setup();
    await feed(ws, JOINED);
    const pc = FakeRTCPeerConnection.instances[0];

    await feed(ws, { type: 'offer', from: 'p_zzz', sdp: 'remote-sdp' });

    expect(pc.remoteDescription).toEqual({ type: 'offer', sdp: 'remote-sdp' });
    const answers = sentMessages(ws).filter((m) => m.type === 'answer');
    expect(answers).toEqual([{ type: 'answer', to: 'p_zzz', sdp: 'fake-sdp' }]);
  });

  it('6. candidate 队列：remoteDescription 就绪前入队、offer 处理时 flush、就绪后直加', async () => {
    const { ws } = setup();
    await feed(ws, JOINED);
    const pc = FakeRTCPeerConnection.instances[0];

    // remoteDescription 尚为 null → 入队不 add
    await feed(ws, {
      type: 'candidate',
      from: 'p_zzz',
      candidate: { candidate: 'c1', sdpMLineIndex: 0, sdpMid: '0' },
    });
    expect(pc.addIceCandidate).not.toHaveBeenCalled();

    // offer 处理中 setRemoteDescription 后 flushPendingCandidates → c1 被加
    await feed(ws, { type: 'offer', from: 'p_zzz', sdp: 'remote-sdp' });
    expect(pc.addIceCandidate).toHaveBeenCalledTimes(1);
    const first = pc.addIceCandidate.mock.calls[0][0] as FakeRTCIceCandidate;
    expect(first).toBeInstanceOf(FakeRTCIceCandidate);
    expect(first.candidate).toBe('c1');
    expect(first.sdpMLineIndex).toBe(0);
    expect(first.sdpMid).toBe('0');

    // remoteDescription 已就绪 → 新 candidate 直接加（第 2 次调用）
    await feed(ws, {
      type: 'candidate',
      from: 'p_zzz',
      candidate: { candidate: 'c2', sdpMLineIndex: 0, sdpMid: '0' },
    });
    expect(pc.addIceCandidate).toHaveBeenCalledTimes(2);
    const second = pc.addIceCandidate.mock.calls[1][0] as FakeRTCIceCandidate;
    expect(second.candidate).toBe('c2');
  });

  it('7. media_state_changed：对应参与者 media_state 精确更新', async () => {
    const { result, ws } = setup();
    await feed(ws, JOINED);
    await feed(ws, {
      type: 'media_state_changed',
      participant_id: 'p_zzz',
      media_state: { mic: true, camera: false, screen: true },
    });

    expect(result.current.participants[0].media_state).toEqual({
      mic: true,
      camera: false,
      screen: true,
    });
  });

  it('8. peer_left：关闭该 peer 的 pc 并移出参与者列表', async () => {
    const { result, ws } = setup();
    await feed(ws, JOINED);
    const pc = FakeRTCPeerConnection.instances[0];

    await feed(ws, { type: 'peer_left', participant_id: 'p_zzz' });

    expect(pc.close).toHaveBeenCalledTimes(1);
    expect(result.current.participants).toEqual([]);
  });

  it('9. room_closed：置 error 并抑制重连（异常 close 后 error 不被覆盖、不建新 WS）', async () => {
    const { result, ws } = setup();
    await feed(ws, JOINED);
    await feed(ws, { type: 'room_closed', reason: 'creator left' });

    expect(result.current.meetingState).toBe('error');
    expect(result.current.error).toBe('房间已关闭: creator left');

    // 用异常码 1006（正常码 1000 本就不会触发重连，测不出 suppress 的作用）：
    // 若 suppress 失效，scheduleReconnect 会把 error 覆盖为「信令连接已断开」
    const before = wsControl.instances.length;
    await act(async () => {
      ws.onclose?.({ code: 1006 });
      await flushAsync();
    });
    expect(wsControl.instances.length).toBe(before);
    expect(result.current.error).toBe('房间已关闭: creator left');
  });

  it('10. error 消息：error 置为服务器 message', async () => {
    const { result, ws } = setup();
    await feed(ws, { type: 'error', code: 'X', message: 'bad room' });
    expect(result.current.error).toBe('bad room');
  });

  it('11. 异常关闭且无 rejoin：置「信令连接已断开」+ error 态', async () => {
    const { result, ws } = setup(); // connect 未传 rejoin
    await act(async () => {
      ws.onclose?.({ code: 1006 });
      await flushAsync();
    });
    expect(result.current.error).toBe('信令连接已断开');
    expect(result.current.meetingState).toBe('error');
  });

  it('12. disconnect：发 leave 帧并完整复位（idle / 空参与者 / 空 id）', async () => {
    const { result, ws } = setup();
    await feed(ws, JOINED);
    const pc = FakeRTCPeerConnection.instances[0];

    act(() => {
      result.current.disconnect();
    });

    const leaves = sentMessages(ws).filter((m) => m.type === 'leave');
    expect(leaves).toEqual([{ type: 'leave' }]);
    expect(pc.close).toHaveBeenCalledTimes(1);
    expect(result.current.meetingState).toBe('idle');
    expect(result.current.participants).toEqual([]);
    expect(result.current.myParticipantId).toBeNull();
  });

  it('13. 重连 happy path：异常断开 → 首次退避 1s → rejoin → 清旧 pc → 新 WS 带新 token', async () => {
    vi.useFakeTimers();
    try {
      const rejoin = vi.fn().mockResolvedValue({ token: 'tok2', iceServers: [] });
      const { result, unmount } = renderHook(() => useWebRTC());
      act(() => {
        result.current.connect('room1', 'tok', ICE, 'https://api.example.com', rejoin);
      });
      const ws = wsControl.instances[0];
      await feed(ws, JOINED);
      const oldPc = FakeRTCPeerConnection.instances[0];

      await act(async () => {
        ws.onclose?.({ code: 1006 });
        await flushAsync();
      });
      expect(result.current.meetingState).toBe('connecting');
      expect(rejoin).not.toHaveBeenCalled(); // 退避期内还未触发

      // 首次退避 = nextBackoffDelay(0) = 1000ms
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(rejoin).toHaveBeenCalledTimes(1);
      expect(oldPc.close).toHaveBeenCalledTimes(1);
      expect(wsControl.instances).toHaveLength(2);
      expect(wsControl.instances[1].url).toBe(
        'wss://api.example.com/ws/webrtc/rooms/room1?token=tok2',
      );

      unmount(); // 在假定时器环境内显式卸载，清掉 hook 内部定时器
    } finally {
      vi.useRealTimers();
    }
  });
});
