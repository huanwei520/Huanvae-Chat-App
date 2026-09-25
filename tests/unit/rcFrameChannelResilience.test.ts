/**
 * 远控帧通道韧性单测（dstdrrek-2 整改轮）
 *
 * 锁两处整改行为：
 * 1. U1/帧停滞根因：attachChannel onclose 不得在仍有 open 通道时杀采集泵
 *    （旧 DC close 事件晚于新 DC open 的重连竞态，实测帧停 8）；
 * 2. U2/被控端释放通知：控制端 sendControlEnd() 在 DC 上发 rc-release 文本帧，
 *    被控端收到后本地终态＋emit RC_PEER_RELEASED（meetingBridge 据此清横幅）。
 * 另锁 U1 恢复探查：attachLocalTrack 时 role 空窗 + daemon grant active ⇒ 补 controlled。
 *
 * @module tests/unit/rcFrameChannelResilience
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emitMock = vi.hoisted(() => vi.fn());
const controlStatusMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock('../../src/remote-control/api', () => ({
  controlStatus: controlStatusMock,
  controlInput: vi.fn(),
  controlArm: vi.fn(),
  controlDisarm: vi.fn(),
}));

import {
  attachChannel,
  attachLocalTrack,
  detachChannel,
  getRole,
  handleChannelData,
  isControlledPumpActive,
  registerControlChannelRebuilder,
  releaseCachedOwnTrack,
  requestControllerRestore,
  sendControlEnd,
  setSessionRole,
} from '../../src/remote-control/frameChannel';
import { CONTROL_SESSION_CHANGED, RC_PEER_RELEASED } from '../../src/remote-control/bus';

/** jsdom 无 RTCDataChannel/MediaStream —— 最小假件 */
function fakeDc(): RTCDataChannel {
  return {
    readyState: 'open',
    bufferedAmount: 0,
    binaryType: 'arraybuffer',
    label: 'control-session',
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onclose: null,
    onmessage: null,
  } as unknown as RTCDataChannel;
}

function fakeTrack(): MediaStreamTrack {
  return {
    kind: 'video',
    readyState: 'live',
    enabled: true,
    muted: false,
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  emitMock.mockReset();
  controlStatusMock.mockReset();
  registerControlChannelRebuilder(null); // D4 钩子不跨测试泄漏
  releaseCachedOwnTrack();               // D5 缓存轨不跨测试泄漏
  (globalThis as unknown as { MediaStream?: unknown }).MediaStream =
    class {
      constructor(public tracks: MediaStreamTrack[]) {}
    };
  // jsdom 未实现 HTMLMediaElement.play()（返回 undefined ⇒ 生产码 .catch 链炸）
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as typeof HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.pause = vi.fn() as typeof HTMLMediaElement.prototype.pause;
  setSessionRole(null);
});

afterEach(() => {
  setSessionRole(null);
  attachLocalTrack(null);
  // DC 注册表不跨用例泄漏（模块态；残留 open 通道会让 isPeerSessionActive 恒真，
  // 干扰 D4 断链断言）
  for (const id of ['peerA', 'peerB', 'peerX', 'peerY', 'peerZ']) {
    detachChannel(id);
  }
});

describe('U1：DC close 竞态下采集泵存活', () => {
  it('旧通道 close 时仍有 open 通道 ⇒ 泵不被杀（帧不停）', () => {
    setSessionRole('controlled');
    const chA = fakeDc();
    const chB = fakeDc();
    attachChannel('peerA', chA);
    attachChannel('peerB', chB);
    attachLocalTrack(fakeTrack());
    expect(isControlledPumpActive()).toBe(true);

    // 旧 DC 关闭（新 DC 仍在服务）——整改前这里无条件停泵（帧停 8 的根因）
    (chA.onclose as unknown as () => void)?.();
    expect(isControlledPumpActive()).toBe(true);
  });

  it('最后一条 open 通道 close ⇒ 泵停止（正常拆除不回归）', () => {
    setSessionRole('controlled');
    const chB = fakeDc();
    attachChannel('peerB', chB);
    attachLocalTrack(fakeTrack());
    expect(isControlledPumpActive()).toBe(true);
    (chB.onclose as unknown as () => void)?.();
    expect(isControlledPumpActive()).toBe(false);
  });
});

describe('U1：attachLocalTrack 角色空窗时 daemon 恢复探查', () => {
  it('daemon grant active ⇒ 补 controlled 角色（泵随后可开）', async () => {
    controlStatusMock.mockResolvedValue({ ok: true, grant_state: 'active' });
    attachChannel('peerA', fakeDc());
    attachLocalTrack(fakeTrack());
    expect(getRole()).toBe(null);
    await vi.waitFor(() => expect(getRole()).toBe('controlled'));
  });

  it('daemon 缺席（null）⇒ 保持现状（dev 构建行为不变）', async () => {
    controlStatusMock.mockResolvedValue(null);
    attachLocalTrack(fakeTrack());
    await new Promise<void>((r) => {
      setTimeout(r, 20);
    });
    expect(getRole()).toBe(null);
    expect(isControlledPumpActive()).toBe(false);
  });
});

describe('U2：数据面释放通知', () => {
  it('sendControlEnd 在 open 通道上发 rc-release 文本帧', () => {
    const ch = fakeDc();
    attachChannel('peerA', ch);
    sendControlEnd();
    expect(ch.send).toHaveBeenCalledTimes(1);
    const raw = (ch.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown;
    expect(typeof raw).toBe('string');
    expect(JSON.parse(String(raw))).toEqual({ t: 'rc-release' });
  });

  it('二进制 JSON rc-release 兕底嗅探 ⇒ 同样本地终态（旧发送端兼容）', async () => {
    setSessionRole('controlled');
    attachLocalTrack(fakeTrack());
    expect(getRole()).toBe('controlled');

    handleChannelData(
      'peerA',
      new TextEncoder().encode(JSON.stringify({ t: 'rc-release' })),
    );

    expect(getRole()).toBe(null);
    await vi.waitFor(() =>
      expect(emitMock).toHaveBeenCalledWith(RC_PEER_RELEASED, { reason: 'peer-released' }),
    );
  });

  it('被控端收到 rc-release ⇒ 本地终态＋emit RC_PEER_RELEASED', async () => {    setSessionRole('controlled');
    const ch = fakeDc();
    attachChannel('peerA', ch);
    attachLocalTrack(fakeTrack());
    expect(getRole()).toBe('controlled');

    handleChannelData('peerA', JSON.stringify({ t: 'rc-release' }));

    expect(getRole()).toBe(null);
    expect(isControlledPumpActive()).toBe(false);
    // emit 走动态 import（微任务）——异步等它落地
    await vi.waitFor(() =>
      expect(emitMock).toHaveBeenCalledWith(RC_PEER_RELEASED, { reason: 'peer-released' }),
    );
  });

  it('控制端收到 rc-release（回声/异常）⇒ 幂等空操作', () => {
    setSessionRole('controller');
    handleChannelData('peerA', JSON.stringify({ t: 'rc-release' }));
    expect(getRole()).toBe('controller');
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe('zmhyvb6n U1：恢复路径补采集泵启动（rc-resume 宣告，daemon 无关）', () => {
  it('attach 早于角色接线：轨先注入、rc-resume 后到 ⇒ 角色补接+泵自动启动', async () => {
    const ch = fakeDc();
    attachChannel('peerX', ch);
    attachLocalTrack(fakeTrack()); // U1 原时序缺口：capture 在位但 role=null，泵不起
    expect(getRole()).toBe(null);
    expect(isControlledPumpActive()).toBe(false);
    // daemon 缺席（生产码 attach 时的 restoreControlledFromDaemon 探查失败）也不得阻塞恢复
    controlStatusMock.mockRejectedValue(new Error('no daemon'));

    handleChannelData('peerX', JSON.stringify({ t: 'rc-resume' }));

    expect(getRole()).toBe('controlled');
    expect(isControlledPumpActive()).toBe(true);
    await vi.waitFor(() =>
      expect(emitMock).toHaveBeenCalledWith(CONTROL_SESSION_CHANGED, { controlledByName: '对方' }),
    );
  });

  it('resume 先到、attach 后到 ⇒ attach 命中 controlled 分支开泵（两种到达序都收敛）', () => {
    const ch = fakeDc();
    attachChannel('peerX', ch);
    handleChannelData('peerX', JSON.stringify({ t: 'rc-resume' }));
    expect(getRole()).toBe('controlled');
    // 无共享轨：jsdom 无 getDisplayMedia，acquireOwnCapture 静默失败，泵暂不起
    expect(isControlledPumpActive()).toBe(false);
    attachLocalTrack(fakeTrack());
    expect(isControlledPumpActive()).toBe(true);
  });

  it('controller 对已知被控端（曾发 rc-meta）DC 就绪时定向补发 rc-resume；无关 peer 不发', () => {
    setSessionRole('controller');
    // rc-meta 只由被控端采集泵发出 → 发送方即被控端，入定向表
    handleChannelData('peerX', JSON.stringify({ t: 'rc-meta', screenW: 800, screenH: 600 }));
    const ch = fakeDc(); // readyState=open → attachChannel 立即补派发 onOpen
    attachChannel('peerX', ch);
    expect(ch.send).toHaveBeenCalledTimes(1);
    const raw = (ch.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown;
    expect(JSON.parse(String(raw))).toEqual({ t: 'rc-resume' });
    // 三方会话无关 peer（从未发过 rc-meta）不得被宣告成被控端
    const chY = fakeDc();
    attachChannel('peerY', chY);
    expect(chY.send).not.toHaveBeenCalled();
  });

  it('rc-resume 幂等/拒误伤：controller 回声不动；已恢复 controlled 二次宣告不重置', () => {
    setSessionRole('controller');
    handleChannelData('peerA', JSON.stringify({ t: 'rc-resume' }));
    expect(getRole()).toBe('controller');
    expect(emitMock).not.toHaveBeenCalledWith(
      CONTROL_SESSION_CHANGED,
      { controlledByName: '对方' },
    );

    // open DC 在位（真实被控拓扑前提；startControlledPump 需数据面活性）
    const ch = fakeDc();
    attachChannel('peerA', ch);
    setSessionRole('controlled');
    attachLocalTrack(fakeTrack());
    handleChannelData('peerA', JSON.stringify({ t: 'rc-resume' })); // 已是 controlled：不重置
    expect(getRole()).toBe('controlled');
    expect(isControlledPumpActive()).toBe(true);
  });
});

describe('rt4p73av D4：控制端拓扑断链自愈（重建 control-session DC）', () => {
  it('controller + 数据面断开 + 已知被控端 ⇒ 对每个 rc-meta 发送方触发重建钩子', () => {
    const rebuild = vi.fn();
    registerControlChannelRebuilder(rebuild);
    setSessionRole('controller');
    // 已知被控端定向表：只收曾发 rc-meta 的 peer（同 announceControlResume 判据）
    handleChannelData('peerX', JSON.stringify({ t: 'rc-meta', screenW: 800, screenH: 600 }));
    handleChannelData('peerY', JSON.stringify({ t: 'rc-meta', screenW: 800, screenH: 600 }));

    expect(requestControllerRestore()).toBe(true);
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(rebuild).toHaveBeenCalledWith('peerX');
    expect(rebuild).toHaveBeenCalledWith('peerY');
  });

  it('数据面在位（有 open DC）⇒ 空操作；无钩子 ⇒ false；单 peer 失败不拖垮其余', () => {
    const rebuild = vi.fn();
    setSessionRole('controller');
    handleChannelData('peerX', JSON.stringify({ t: 'rc-meta', screenW: 800, screenH: 600 }));
    handleChannelData('peerZ', JSON.stringify({ t: 'rc-meta', screenW: 800, screenH: 600 }));

    // 无钩子：false 且不炸
    expect(requestControllerRestore()).toBe(false);

    registerControlChannelRebuilder(rebuild);
    // 数据面在位（open 通道）⇒ 不重建
    const chX = fakeDc();
    attachChannel('peerX', chX);
    expect(requestControllerRestore()).toBe(false);
    expect(rebuild).not.toHaveBeenCalled();

    // 全部断开：单 peer 重建抛异常不外溢，其余 peer 继续（peerZ 成功 ⇒ 返回 true）
    const chZ = fakeDc();
    attachChannel('peerZ', chZ);
    (chX.onclose as unknown as () => void)?.();
    (chZ.onclose as unknown as () => void)?.();
    rebuild.mockImplementation((peerId: string) => {
      if (peerId === 'peerX') { throw new Error('pc gone'); }
    });
    expect(requestControllerRestore()).toBe(true);
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it('非 controller 角色 ⇒ 空操作（被控端/无会话不重建）', () => {
    const rebuild = vi.fn();
    registerControlChannelRebuilder(rebuild);
    setSessionRole('controlled');
    handleChannelData('peerX', JSON.stringify({ t: 'rc-meta', screenW: 800, screenH: 600 }));
    expect(requestControllerRestore()).toBe(false);
    expect(rebuild).not.toHaveBeenCalled();

    setSessionRole(null);
    expect(requestControllerRestore()).toBe(false);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('重建 DC open ⇒ 对已知被控端定向补发 rc-resume（自愈闭环接回既有恢复链）', () => {
    setSessionRole('controller');
    handleChannelData('peerX', JSON.stringify({ t: 'rc-meta', screenW: 800, screenH: 600 }));
    const rebuilt = fakeDc(); // readyState=open → attachChannel 立即补派发 onOpen
    attachChannel('peerX', rebuilt);
    const raw = (rebuilt.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown;
    expect(JSON.parse(String(raw))).toEqual({ t: 'rc-resume' });
  });
});

describe('rt4p73av D5-①：被控端授权免选源（自取 display 轨跨会话复用）', () => {
  /** getDisplayMedia mock：每次调用发一枚新假轨 */
  let gdmCalls = 0;
  const issuedTracks: MediaStreamTrack[] = [];
  const installGdm = () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: vi.fn(async () => {
          gdmCalls += 1;
          const t = fakeTrack();
          issuedTracks.push(t);
          return { getVideoTracks: () => [t] };
        }),
      },
    });
  };

  beforeEach(() => {
    gdmCalls = 0;
    issuedTracks.length = 0;
    installGdm();
  });

  it('会话拆除不再 stop 自取轨（入缓存）⇒ 下次授权复用同轨零 getDisplayMedia', async () => {
    setSessionRole('controlled');
    const ch = fakeDc();
    attachChannel('peerX', ch);
    // 泵起：无缓存 → getDisplayMedia 现选（获取异步，泵就绪要等它落地）
    await vi.waitFor(() => expect(gdmCalls).toBe(1));
    await vi.waitFor(() => expect(isControlledPumpActive()).toBe(true));
    // 等在途采集链完全收尾（外层 finally 释放 inFlight 标志）再拆，避免竞态干扰断言
    await new Promise<void>((r) => { setTimeout(r, 20); });

    // 断链：DC close → 泵停；旧实现 track.stop()，整改后入缓存
    (ch.onclose as unknown as () => void)?.();
    expect(isControlledPumpActive()).toBe(false);
    expect(issuedTracks[0].stop).not.toHaveBeenCalled();

    // 恢复：新 DC open → 泵重启复用缓存轨，不再弹选源（getDisplayMedia 零新增调用）
    attachChannel('peerX', fakeDc());
    expect(isControlledPumpActive()).toBe(true);
    expect(gdmCalls).toBe(1);
    expect(issuedTracks[0].stop).not.toHaveBeenCalled();
  });

  it('缓存轨被外部终结（ended）⇒ 缓存清零，回落 getDisplayMedia 现选', async () => {
    setSessionRole('controlled');
    attachChannel('peerX', fakeDc());
    await vi.waitFor(() => expect(gdmCalls).toBe(1));
    await vi.waitFor(() => expect(isControlledPumpActive()).toBe(true));
    // 等在途采集链完全收尾（外层 finally 释放 inFlight 标志）再拆
    await new Promise<void>((r) => { setTimeout(r, 20); });
    const first = issuedTracks[0];

    // 泵停 → 轨入缓存（ended 监听在入缓存时才挂上）
    attachLocalTrack(null);
    const endedCb = (first.addEventListener as ReturnType<typeof vi.fn>).mock.calls
      .find(([ev]: unknown[]) => ev === 'ended')?.[1] as () => void;
    expect(typeof endedCb).toBe('function');
    // 模拟用户经系统 UI 停止共享：readyState 置终态并触发 ended → 缓存清零
    (first as unknown as { readyState: string }).readyState = 'ended';
    endedCb();

    // 新 DC open → 泵重启：缓存已失效 → 第二次 getDisplayMedia
    attachChannel('peerX', fakeDc());
    await vi.waitFor(() => expect(gdmCalls).toBe(2));
  });

  it('releaseCachedOwnTrack 显式释放 ⇒ 真实 stop 轨', async () => {
    setSessionRole('controlled');
    attachChannel('peerX', fakeDc());
    await vi.waitFor(() => expect(gdmCalls).toBe(1));
    await vi.waitFor(() => expect(isControlledPumpActive()).toBe(true));
    await new Promise<void>((r) => { setTimeout(r, 20); }); // 在途采集链收尾
    attachLocalTrack(null); // 泵停（轨入缓存）
    releaseCachedOwnTrack();
    expect(issuedTracks[0].stop).toHaveBeenCalledTimes(1);
  });
});
