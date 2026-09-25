/**
 * 会议内远程控制——跨端帧通道（设计块B/T7；本块 1790158790317-dstdrrek-2 根因落地）
 *
 * 断链根因（前代 4r2sli2c deliverable 6.5 / pleibt4s execution.json:46 实证）：
 *  - 控制窗帧源＝api.ts baseUrl() 硬编码 127.0.0.1 轮询本机 daemon ⇒「跨端控制窗
 *  显示的是本机回环画面」（真UI真测试铁律③禁同机回环冒充跨端的反例构造面）；
 *  - App 侧无 FrameSlice(0x07) 通道（唯一 DC=speaking-status，useWebRTC.ts:894）；
 *  - sessionStore.activate() 全仓零调用者（active 死端）⇒ MobileMeetingPage 仅
 *  active 挂 <ControlWindow/> ⇒ 恒停「控制会话建立中」。
 *
 * 本模块在**会议既有 WebRTC mesh** 上加开 `control-session` DataChannel（单侧建立
 * 与 speaking-status 同模式），承载：
 *  - FrameSlice(0x07)：二进制线格式与 HuanvaeRemote hv-protocol session.rs **逐字节
 *    对齐**（tag u8 + frame_seq u64BE + slice_idx u16BE + slice_count u16BE +
 *    width u32BE + height u32BE + len u16BE + data），单帧槽重组（slice.rs 同语义：
 *    新 frame_seq 放弃未完旧帧）；
 *  - InputEvent(0x06)：tag u8 + x u16BE + y u16BE + buttons u8 + keys n u16BE +
 *    n×u16BE（coordinates.ts 的屏坐标/位掩码/keysym 域，daemon mapping 同域）；
 *  - 会话元数据（JSON 文本帧，App 通道自有，不占 0x01–0x07 协议域）：
 *    `{t:'rc-meta', screenW, screenH, maxW, fps}`（被控端真实屏几何，观看端坐标
 *    换算 mapClientToScreen 的 screenW/H 真值源）。
 *
 * 采集（被控端）：优先复用会议屏幕共享轨（useWebRTC attachLocalTrack——已被系统
 * 授权的真实采集源），无共享轨时桌面端 getDisplayMedia 补取；canvas getImageData
 * 出 RGBA8 → 降采样 ≤960 宽（设计 §7.1 默认档 max_w=960、8fps）→ 切片 ≤65512B
 * （65535−23B 头，slice.rs SLICE_DATA_MAX 同值）→ 0x07 保序发送。
 * 注入（被控端）：收到 0x06 → 先回环转发本机 daemon /control/input（块 A 标准件，
 * armed 门禁在 daemon）；daemon 不可达且为 Tauri 桌面端 → `rc_inject_input`
 * （src-tauri 原生 SendInput，本块新增）兜底；两者皆不可达如实计数丢弃。
 *
 * 激活语义（active 死端修复）：观看端 `linking` 态 + 跨端 0x07 整帧到达 = 数据面
 * 建链实证 ⇒ activate()（T7「Active 由数据面建链迁移」的 App 侧等价实现，信令面
 * 不越权）。释放（N3/本地 release）⇒ setSessionRole(null) 全拆。
 *
 * 跨窗拓扑（§4.3 窗口不变性）：DC 属主=meeting 窗 JS 上下文。
 *  - 移动端单 WebView：ControlWindow 与 useWebRTC 同上下文 ⇒ 直接订阅/直接上行；
 *  - 桌面端独立控制窗（label=remote-control）：无 DC ⇒ 帧经 Tauri 事件
 *    `rc-frame-data` 转发、输入经 `rc-input-up` 回传（与 RC_SESSION_STATE 同模式）。
 *
 * @module remote-control/frameChannel
 */

import type { ControlInputEvent } from './types';
import { useControlSessionStore } from './sessionStore';
import { CONTROL_SESSION_CHANGED, RC_PEER_RELEASED } from './bus';

// —— 线格式常量（hv-protocol session.rs 对齐；改动必须两仓同步）——

/** InputEvent 线格式 tag（session.rs TAG_INPUT_EVENT） */
export const TAG_INPUT_EVENT = 0x06;
/** FrameSlice 线格式 tag（session.rs TAG_FRAME_SLICE） */
export const TAG_FRAME_SLICE = 0x07;
/** FrameSlice 单片数据上限：65535(DC 单消息上限) − 23B 头（session.rs FRAME_SLICE_MAX_DATA） */
export const FRAME_SLICE_MAX_DATA = 65512;

/** FrameSlice 头长：tag1 + seq8 + idx2 + count2 + w4 + h4 + len2 */
const FRAME_SLICE_HEADER = 23;
/** InputEvent 头长（n=0）：tag1 + x2 + y2 + buttons1 + n2 */
const INPUT_EVENT_HEADER = 8;

// —— 采集档位（设计 §7.1 默认档；dstdrrek-2 跨端实测校准）——
/** 帧最大宽度（等比降采样上界；超标降档 960→720→640 取首档） */
export const CAPTURE_MAX_W = 960;
/** 目标帧率（跨端 RGBA8 裸流带宽受限：DC 实测可持续 <1MB/s，960 宽 RGBA 帧约 2.3MB） */
export const CAPTURE_FPS = 3;
/** 发送护栏：任一 DC bufferedAmount 超此值则整帧丢弃（防 SCTP 出向队列拥塞停滞） */
const DC_BUFFER_LIMIT = 512 * 1024;

/** 控制会话 DC 标签（useWebRTC createDataChannel/ondatachannel 对齐） */
export const CONTROL_SESSION_CHANNEL = 'control-session';

// —— Tauri 跨窗事件名（bus.ts 之外的数据面通道，JSON/binary 分域）——
/** meeting 窗 → 独立控制窗：整帧 RGBA（base64）转发 */
export const RC_FRAME_DATA = 'rc-frame-data';
/** 独立控制窗 → meeting 窗：0x06 输入上行回传 */
export const RC_INPUT_UP = 'rc-input-up';

export type ControlRole = 'controller' | 'controlled';

/** 观看端重组完成的整帧（RGBA8 行主序；渲染走 putImageData） */
export interface RcFrame {
  seq: number;
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** 计数器（e2e 取证面：帧/输入跨端计数的 grep 实证源） */
export interface RcChannelStats {
  framesIn: number;
  framesOut: number;
  slicesOut: number;
  inputsOut: number;
  inputsIn: number;
  /** 注入投递失败数（daemon 不可达且无原生兜底） */
  inputsDropped: number;
  slicesIn: number;
  abandonedFrames: number;
  /** 拥塞护栏丢帧数（bufferedAmount 超限整帧丢弃） */
  framesDropped: number;
}

function emptyStats(): RcChannelStats {
  return {
    framesIn: 0,
    framesOut: 0,
    slicesOut: 0,
    inputsOut: 0,
    inputsIn: 0,
    inputsDropped: 0,
    slicesIn: 0,
    abandonedFrames: 0,
    framesDropped: 0,
  };
}

// —— 模块态（独立 JS 上下文各自一份，跨窗走 Tauri 事件）——

/** 本上下文是否拥有 DC（useWebRTC attachChannel 置位；控制窗独立上下文恒 false） */
let dcOwner = false;
const channels = new Map<string, RTCDataChannel>();
let role: ControlRole | null = null;
const stats: RcChannelStats = emptyStats();

/** 已知被控端 peer 集合（本端为 controller 时，rc-meta 发送方即被控端——只有被控端
 *  采集泵会发 rc-meta）。zmhyvb6n 整改（U1）：被控端 App 重启恢复会话后新 control-session
 *  DC open 时，controller 据此**定向**补发 rc-resume 宣告，被控端据此补接角色+横幅
 *  并重启采集泵——恢复路径不再依赖本机 daemon（dev/无 daemon 环境此前静默失败）。
 *  仅记 rc-meta 发送方，不广播全体会议 peer，避免三方会话误把无关 peer 接成被控端。 */
const controlledPeers = new Set<string>();

/** 对端真实屏几何（controller 侧由 rc-meta 写入；坐标换算 screenW/H 真值源） */
let peerScreen: { w: number; h: number } | null = null;

// —— D5（块 1790313105455-rt4p73av-1）：被控端授权免选源——自取 display 轨跨会话复用 ——
/**
 * 上次自取（acquireOwnCapture → getDisplayMedia）的 display 轨缓存。会话/泵拆除不再
 * stop 轨（旧行为 cap.owned → track.stop()）：下次授权直接复用既有轨，免除被控端
 * 每次「Choose what to share」重选（w10-69/70/71 实测：每授权重弹选源，D5-①）。
 * 轨被外部终结（用户经系统 UI 停止共享/设备变更）→ ended 事件清缓存，回落正常
 * getDisplayMedia 现选（首次授权仍需用户选一次，属系统约束）。仅本模块自取轨入
 * 缓存；会议共享轨（useWebRTC 所有，owned=false）生命周期不归本模块管。
 */
let cachedOwnTrack: MediaStreamTrack | null = null;

function cacheOwnTrack(track: MediaStreamTrack): void {
  if (track.readyState !== 'live') { return; }
  if (cachedOwnTrack === track) { return; } // 已在缓存（ended 监听已挂），不重复注册
  if (cachedOwnTrack !== null) {
    // 换源：旧缓存轨作废（本模块是其唯一持有者，负责显式停）
    try { cachedOwnTrack.stop(); } catch { /* 已停轨幂等 */ }
  }
  cachedOwnTrack = track;
  track.addEventListener('ended', () => {
    if (cachedOwnTrack === track) { cachedOwnTrack = null; }
  });
}

/** 显式释放缓存 display 轨（真实 stop；测试面/终态清理入口） */
export function releaseCachedOwnTrack(): void {
  const t = cachedOwnTrack;
  cachedOwnTrack = null;
  if (t) {
    try { t.stop(); } catch { /* 幂等 */ }
  }
}

// 重组（单帧槽，slice.rs FrameAssembler 同语义）
let assembling: {
  seq: number;
  total: number;
  received: number;
  parts: Uint8Array[];
  width: number;
  height: number;
} | null = null;

// 帧汇（ControlWindow 订阅；direct 或 Tauri 桥接回灌共用）
const frameSinks = new Set<(f: RcFrame) => void>();
let tauriBridgeReady = false;

// 被控端采集泵
interface LocalCapture {
  track: MediaStreamTrack;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  timer: number | null;
  seq: number;
  /** 采集源真实几何（屏幕域坐标换算基准） */
  srcW: number;
  srcH: number;
  owned: boolean; // 本模块自取（getDisplayMedia）→ 负责停轨
}
let capture: LocalCapture | null = null;
/** 采集获取在途标志（防并发 startControlledPump 双开 getDisplayMedia 选择器） */
let acquireInFlight = false;

/** 注入兜底 state（held keys/buttons 差分由原生端维护，这里只投事件） */

function hasTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 对端会话通道是否在位（>=1 条 open 的 control-session DC） */
export function isPeerSessionActive(): boolean {
  for (const ch of channels.values()) {
    if (ch.readyState === 'open') { return true; }
  }
  return false;
}

export function getRole(): ControlRole | null {
  return role;
}

/** 采集泵是否在跑（诊断/测试面；timer 非 null 即活） */
export function isControlledPumpActive(): boolean {
  return capture?.timer !== null && capture?.timer !== undefined;
}

export function getStats(): RcChannelStats {
  return { ...stats };
}

export function getPeerScreen(): { w: number; h: number } | null {
  return peerScreen ? { ...peerScreen } : null;
}

// —— DC 属主侧（useWebRTC 调用）——

/** 注册 control-session DC（useWebRTC：impolite create / polite ondatachannel 两路） */
export function attachChannel(peerId: string, ch: RTCDataChannel): void {
  dcOwner = true;
  ensureInputUpBridge();
  ch.binaryType = 'arraybuffer';
  channels.set(peerId, ch);
  const onOpen = (): void => {
    // 被控端通道就绪即报屏几何+开泵（controller 端坐标换算的 screenW/H 真值）
    if (role === 'controlled') {
      void startControlledPump();
    } else if (role === 'controller') {
      // zmhyvb6n 整改（U1）：被控端重启/重协商后新 DC 就绪，controller 对**已知
      // 被控端**（曾发过 rc-meta 的 peer）定向补发 resume 宣告——被控端若因重启
      // 丢了角色（横幅/角色接线晚于 attach），据此补接并自动重启采集泵。
      announceControlResume(peerId);
    }
  };
  ch.onopen = onOpen;
  // polite 侧 ondatachannel 交给本函数时通道可能已 open（此后 onopen 不再触发）——
  // 立即补派发一次，否则恢复路径的泵启动/announce 都会错过这班车间隙。
  if (ch.readyState === 'open') { onOpen(); }
  ch.onclose = () => {
    if (channels.get(peerId) === ch) {
      channels.delete(peerId);
    }
    // 🔴 dstdrrek-2 整改（U1 帧停滞根因）：旧 DC 的 close 事件可能晚于新 DC 的
    // open（对端重连/重协商竞态）——此前这里无条件 stopControlledPump()，
    // 会把仍在服务的新通道的采集泵一起杀掉（实测：被控端重启重连后帧停在 8）。
    // 收紧为「已无任何 open 通道」才停泵。
    let anyOpen = false;
    for (const c of channels.values()) {
      if (c.readyState === 'open') { anyOpen = true; break; }
    }
    if (!anyOpen) {
      stopControlledPump();
    }
  };
}

/** 注销（closePeerConnection/cleanupPeers） */
export function detachChannel(peerId: string): void {
  const ch = channels.get(peerId);
  if (ch) {
    ch.onopen = null;
    ch.onclose = null;
    ch.onmessage = null;
    channels.delete(peerId);
  }
  if (channels.size === 0) {
    stopControlledPump();
  }
}

/** control-session DC 消息路由（useWebRTC onmessage 先于此调，speaking-status 不经此） */
export function handleChannelData(peerId: string, data: unknown): void {
  void peerId;
  if (typeof data === 'string') {
    handleMetaMessage(peerId, data);
    return;
  }
  if (data instanceof ArrayBuffer) {
    handleBinary(new Uint8Array(data));
    return;
  }
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(data)) {
    handleBinary(new Uint8Array((data as ArrayBufferView).buffer));
  }
}

// —— 角色接线（MeetingPage/MobileMeetingPage=controller；meetingBridge=controlled）——

/**
 * 设定本端会话角色（null=无会话/已释放，全拆）。
 * - controller：清重组槽，等 0x07（首帧到达 activate）；
 * - controlled：通道 open 即开采集泵。
 */
export function setSessionRole(next: ControlRole | null): void {
  if (role === next) { return; }
  role = next;
  peerScreen = null;
  assembling = null;
  if (next === 'controlled') {
    stopControllerRestoreWatchdog();
    void startControlledPump();
  } else {
    if (next === null) { controlledPeers.clear(); } // 会话终态：resume 定向表随之失效
    stopControlledPump();
    if (next === 'controller') {
      // D4（块 1790313105455-rt4p73av-1）：控制端断链自愈看门狗随角色挂拆
      ensureControllerRestoreWatchdog();
    } else {
      stopControllerRestoreWatchdog();
    }
  }
}

// —— D4（块 1790313105455-rt4p73av-1）：控制端拓扑断链自动续传（移动控制端缺口）——
// ae6fbn0x 实测根因：传输层断链恢复后 control-session DC 不会自行复活（ICE restart
// 只修媒体面；旧 DC 恒 closed），桌面拓扑靠参与者重同步重建 PC 收敛，移动控制端
// （Android 单 WebView）无此臂 ⇒ 帧计数恒冻结、logcat 零重协商。修复＝控制端
// 「恢复事件 + 周期看门狗」→ 重建 control-session DC（useWebRTC 重建钩子）→
// 新 DC open → announceControlResume 定向宣告 → 被控端 handleControlResume/
// onOpen 重拉 0x07 帧泵（pumpOneFrame）——与 restoreControlledFromDaemon（role
// 空窗 daemon 探查）同源的「数据面断链 → 显式探针重建」模式。

/** DC 重建钩子（useWebRTC 注册；frameChannel 保持不反向 import useWebRTC 的分层） */
let controlChannelRebuilder: ((peerId: string) => void) | null = null;

/** useWebRTC 挂载时注册重建钩子（传 null 注销）；钩子为 peer 重建 control-session DC */
export function registerControlChannelRebuilder(fn: ((peerId: string) => void) | null): void {
  controlChannelRebuilder = fn;
}

/** 断链自愈探针周期（看门狗节奏；恢复事件之外兜底重试，直至数据面重建成功） */
export const CONTROLLER_RESTORE_PROBE_MS = 8_000;

/**
 * 控制端数据面自愈探针（单次，幂等）：对每个已知被控端（曾发 rc-meta）重建
 * control-session DC。role 非 controller / 数据面仍在 / 无钩子 / 无已知被控端时
 * 空操作返回 false。由信令重连（MobileMeetingPage onReconnected）、网络 online
 * 事件与看门狗周期三路触发。
 */
export function requestControllerRestore(): boolean {
  if (role !== 'controller' || isPeerSessionActive()) { return false; }
  const fn = controlChannelRebuilder;
  if (!fn || controlledPeers.size === 0) { return false; }
  let triggered = false;
  for (const peerId of controlledPeers) {
    try {
      fn(peerId);
      triggered = true;
    } catch { /* 单 peer 重建失败不拖垮其余 */ }
  }
  return triggered;
}

// 控制端断链看门狗（dcOwner 上下文单例；controller 角色挂上即起、拆下即停）
let controllerRestoreWatchdog: number | null = null;
let controllerRestoreOnlineHook: (() => void) | null = null;

function ensureControllerRestoreWatchdog(): void {
  if (controllerRestoreWatchdog !== null || typeof window === 'undefined') { return; }
  controllerRestoreOnlineHook = () => { requestControllerRestore(); };
  window.addEventListener('online', controllerRestoreOnlineHook);
  controllerRestoreWatchdog = window.setInterval(() => {
    // 断链期周期重试（缺恢复事件也收敛）；数据面在位/角色已拆时空转
    if (role === 'controller' && !isPeerSessionActive()) {
      requestControllerRestore();
    }
  }, CONTROLLER_RESTORE_PROBE_MS);
}

function stopControllerRestoreWatchdog(): void {
  if (controllerRestoreWatchdog !== null) {
    clearInterval(controllerRestoreWatchdog);
    controllerRestoreWatchdog = null;
  }
  if (controllerRestoreOnlineHook !== null) {
    window.removeEventListener('online', controllerRestoreOnlineHook);
    controllerRestoreOnlineHook = null;
  }
}

// —— 帧汇订阅（ControlWindow 两形态共用）——

/**
 * 订阅对端整帧。DC 属主上下文：直连重组输出；独立控制窗上下文：经
 * `rc-frame-data` Tauri 事件桥接（meeting 窗转发 base64 帧）。
 */
export function subscribeFrames(cb: (f: RcFrame) => void): () => void {
  frameSinks.add(cb);
  if (!dcOwner && hasTauri() && !tauriBridgeReady) {
    tauriBridgeReady = true;
    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<{ w: number; h: number; seq: number; rgbaB64: string }>(RC_FRAME_DATA, (ev) => {
          const rgba = base64ToBytes(ev.payload.rgbaB64);
          if (rgba && rgba.length === ev.payload.w * ev.payload.h * 4) {
            for (const sink of frameSinks) {
              sink({ seq: ev.payload.seq, width: ev.payload.w, height: ev.payload.h, rgba });
            }
          }
        }),
      )
      .catch(() => undefined);
  }
  return () => {
    frameSinks.delete(cb);
  };
}

// —— 输入上行（ControlWindow 唯一入口；跨端寻址在端内，不再有 127.0.0.1 硬编码）——

/**
 * 上行一个 0x06 InputEvent 到会话对端：
 * - DC 属主（meeting 窗/移动端）：直接 DC 发送；
 * - 独立控制窗：Tauri 事件 `rc-input-up` 回传 meeting 窗转发。
 * 返回 false = 无会话通道（调用方回退既有本地回环路径）。
 */
export function sendInput(ev: ControlInputEvent): boolean {
  if (dcOwner && isPeerSessionActive()) {
    sendBinary(encodeInputEvent(ev));
    stats.inputsOut += 1;
    return true;
  }
  if (!dcOwner && hasTauri()) {
    void import('@tauri-apps/api/event')
      .then(({ emit }) => emit(RC_INPUT_UP, ev))
      .catch(() => undefined);
    stats.inputsOut += 1;
    return true;
  }
  return false;
}

// meeting 窗：接独立控制窗回传的输入（dcOwner 侧注册一次）
let inputUpBridgeReady = false;
function ensureInputUpBridge(): void {
  if (inputUpBridgeReady || !dcOwner || !hasTauri()) { return; }
  inputUpBridgeReady = true;
  void import('@tauri-apps/api/event')
    .then(({ listen }) =>
      listen<ControlInputEvent>(RC_INPUT_UP, (ev) => {
        if (isPeerSessionActive()) {
          sendBinary(encodeInputEvent(ev.payload));
          stats.inputsOut += 1;
        }
      }),
    )
    .catch(() => undefined);
}

// —— 线格式编码（session.rs encode 对齐，大端）——

function encodeInputEvent(ev: ControlInputEvent): Uint8Array {
  const keys = ev.keys ?? [];
  const buf = new Uint8Array(INPUT_EVENT_HEADER + keys.length * 2);
  const dv = new DataView(buf.buffer);
  let o = 0;
  dv.setUint8(o, TAG_INPUT_EVENT); o += 1;
  dv.setUint16(o, ev.x & 0xffff, false); o += 2;
  dv.setUint16(o, ev.y & 0xffff, false); o += 2;
  dv.setUint8(o, ev.buttons & 0xff); o += 1;
  dv.setUint16(o, keys.length, false); o += 2;
  for (const k of keys) {
    dv.setUint16(o, k & 0xffff, false); o += 2;
  }
  return buf;
}

function encodeFrameSlice(
  seq: number,
  idx: number,
  count: number,
  width: number,
  height: number,
  data: ArrayLike<number>,
): Uint8Array {
  const buf = new Uint8Array(FRAME_SLICE_HEADER + data.length);
  const dv = new DataView(buf.buffer);
  let o = 0;
  dv.setUint8(o, TAG_FRAME_SLICE); o += 1;
  // u64 BE 手写两半写（seq 由泵钳制 <2^32，高位恒 0；避免 BigUint64 lib 依赖）
  dv.setUint32(o, 0, false); o += 4;
  dv.setUint32(o, seq >>> 0, false); o += 4;
  dv.setUint16(o, idx, false); o += 2;
  dv.setUint16(o, count, false); o += 2;
  dv.setUint32(o, width, false); o += 4;
  dv.setUint32(o, height, false); o += 4;
  dv.setUint16(o, data.length, false); o += 2;
  buf.set(data, o);
  return buf;
}

// —— 二进制解码（controller 收 0x07 重组；controlled 收 0x06 注入）——

function handleBinary(u8: Uint8Array): void {
  if (u8.length < 1) { return; }
  const tag = u8[0];
  if (tag === TAG_FRAME_SLICE) {
    if (u8.length < FRAME_SLICE_HEADER) { return; }
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // u64 BE 手写两半读（高位恒 0 时等价 Number(seq)；防御性按组合数读）
    const seqHi = dv.getUint32(1, false);
    const seqLo = dv.getUint32(5, false);
    const seq = seqHi * 0x100000000 + seqLo;
    const idx = dv.getUint16(9, false);
    const count = dv.getUint16(11, false);
    const width = dv.getUint32(13, false);
    const height = dv.getUint32(17, false);
    const len = dv.getUint16(21, false);
    if (u8.length < FRAME_SLICE_HEADER + len) { return; }
    stats.slicesIn += 1;
    ingestSlice(seq, idx, count, width, height, u8.slice(FRAME_SLICE_HEADER, FRAME_SLICE_HEADER + len));
  } else if (tag === TAG_INPUT_EVENT) {
    if (u8.length < INPUT_EVENT_HEADER) { return; }
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const x = dv.getUint16(1, false);
    const y = dv.getUint16(3, false);
    const buttons = dv.getUint8(5);
    const n = dv.getUint16(6, false);
    if (u8.length < INPUT_EVENT_HEADER + n * 2) { return; }
    const keys: number[] = [];
    for (let i = 0; i < n; i++) {
      keys.push(dv.getUint16(8 + i * 2, false));
    }
    stats.inputsIn += 1;
    void relayInjection({ x, y, buttons, keys });
  } else {
    sniffBinaryMeta(u8);
  }
  // 其余 tag（0x01–0x05 daemon 会话域）不进 App 通道，静默丢弃
}

/** 单帧槽重组（slice.rs FrameAssembler 同语义：新 seq 放弃未完旧帧） */
function ingestSlice(
  seq: number,
  idx: number,
  count: number,
  width: number,
  height: number,
  data: Uint8Array,
): void {
  if (count === 0) { return; }
  if (!assembling || assembling.seq !== seq) {
    if (assembling) {
      stats.abandonedFrames += 1;
    }
    assembling = { seq, total: count, received: 0, parts: new Array(count), width, height };
  }
  const a = assembling;
  if (idx >= a.total || a.parts[idx]) { return; }
  a.parts[idx] = data;
  a.received += 1;
  if (a.received < a.total) { return; }
  // 片齐：校验 RGBA8 域（不给渲染层脏帧，slice.rs 同防御）
  const expected = a.width * a.height * 4;
  const rgba = new Uint8Array(expected);
  let o = 0;
  for (const p of a.parts) {
    if (!p) { return; } // 不可能（received==total），防御
    if (o + p.length > expected) { assembling = null; return; }
    rgba.set(p, o);
    o += p.length;
  }
  assembling = null;
  if (o !== expected) { return; }
  stats.framesIn += 1;
  deliverFrame({ seq, width: a.width, height: a.height, rgba });
}

/** 整帧交付：activate 死端修复 + 直连帧汇 + 跨窗转发 */
function deliverFrame(f: RcFrame): void {
  // T7 等价激活：观看端 linking 态收到对端整帧 = 数据面建链实证 → active
  try {
    const st = useControlSessionStore.getState();
    if (role === 'controller' && st.state === 'linking') {
      st.activate();
    }
  } catch { /* store 未挂（独立控制窗上下文）忽略 */ }
  for (const sink of frameSinks) {
    try {
      sink(f);
    } catch { /* 单汇异常不拖垮通道 */ }
  }
  // 桌面独立控制窗桥接（仅 DC 属主上下文转发；独立窗自己是桥接消费端）
  if (dcOwner && hasTauri()) {
    void import('@tauri-apps/api/event')
      .then(({ emit }) =>
        emit(RC_FRAME_DATA, {
          w: f.width,
          h: f.height,
          seq: f.seq,
          rgbaB64: bytesToBase64(f.rgba),
        }),
      )
      .catch(() => undefined);
  }
}

// —— 会话元数据（JSON 文本帧）——

function sendMeta(): void {
  if (!capture) { return; }
  const meta = {
    t: 'rc-meta',
    screenW: capture.srcW,
    screenH: capture.srcH,
    maxW: CAPTURE_MAX_W,
    fps: CAPTURE_FPS,
  };
  const payload = JSON.stringify(meta);
  for (const ch of channels.values()) {
    if (ch.readyState === 'open') {
      try {
        ch.send(payload);
      } catch { /* 单通道异常不拖垮其余 */ }
    }
  }
}

function handleMetaMessage(peerId: string, raw: string): void {
  try {
    const msg = JSON.parse(raw) as { t?: string; screenW?: number; screenH?: number };
    if (msg?.t === 'rc-meta' && msg.screenW && msg.screenH) {
      peerScreen = { w: msg.screenW, h: msg.screenH };
      // zmhyvb6n 整改（U1）：rc-meta 只由被控端采集泵发出 → 发送方即被控端，
      // 记入定向表（controller 侧重连时 announceControlResume 的目标判据）。
      controlledPeers.add(peerId);
      return;
    }
    // 控制端数据面释放通知（dstdrrek-2 整改 U2）：服务端 release 回执仅路由
    // sender 侧（meetingBridge 缺口②注释实证），被控端无信令可清横幅——
    // 控制端释放前在本 DC 上发 rc-release 文本帧，被控端据此本地终态。
    if (msg?.t === 'rc-release') {
      handlePeerReleased();
      return;
    }
    // zmhyvb6n 整改（U1）：控制端 resume 宣告——被控端重启后角色/横幅接线
    // 晚于共享轨 attach 时（原 U1 根因），据此补接并自动重启采集泵。
    if (msg?.t === 'rc-resume') {
      handleControlResume();
    }
  } catch { /* 非 JSON 文本忽略 */ }
}

/** 二进制帧兜底嗅探：sendControlEnd 旧实现误用 TextEncoder 发 JSON 二进制，
 *  handleBinary 的 tag 路由会把 {t:'rc-release'}（首字节 0x7B）静默丢弃——
 *  dstdrrek-2 U2 真机复测实证横幅不撤，这里对未知 tag 尝试 JSON 文本解析兜底。 */
function sniffBinaryMeta(u8: Uint8Array): void {
  if (u8.length === 0 || u8[0] !== 0x7b) { return; } // 仅嗅探 '{' 开头
  try {
    const msg = JSON.parse(new TextDecoder().decode(u8)) as { t?: string };
    if (msg?.t === 'rc-release') {
      handlePeerReleased();
    }
  } catch { /* 非JSON不处理 */ }
}

/** 被控端收到对端释放：本地终态＋广播（幂等；role 已非 controlled 即空操作） */
function handlePeerReleased(): void {
  if (role !== 'controlled') { return; }
  setSessionRole(null);
  if (!hasTauri()) { return; }
  void import('@tauri-apps/api/event')
    .then(({ emit }) => emit(RC_PEER_RELEASED, { reason: 'peer-released' }))
    .catch(() => undefined);
}

/** zmhyvb6n 整改（U1）：被控端收到控制端 rc-resume 宣告 → 恢复路径补角色+横幅。
 *  时序缺口封闭：共享轨 attach（capture 在位）早于角色接线时，本函数经
 *  setSessionRole('controlled') → startControlledPump() 自动续帧；反之（attach 未到）
 *  则等 attachLocalTrack 命中 role==='controlled' 分支开泵——两种到达序都收敛。
 *  幂等：role 已非 null（controller 回声/已恢复）一律不动。daemon 无关。 */
function handleControlResume(): void {
  if (role !== null) { return; }
  setSessionRole('controlled');
  if (!hasTauri()) { return; }
  void import('@tauri-apps/api/event')
    .then(({ emit }) => emit(CONTROL_SESSION_CHANGED, { controlledByName: '对方' }))
    .catch(() => undefined);
}

/** zmhyvb6n 整改（U1）：controller 侧 DC open 时对已知被控端定向补发 resume 宣告。
 *  目标判据=controlledPeers（曾发 rc-meta 的 peer）；未知 peer（三方会话无关方/
 *  双端同重启后角色皆空）不发——后者由被控端 daemon 探查兜底（生产桌面路径）。 */
function announceControlResume(peerId: string): void {
  if (role !== 'controller' || !controlledPeers.has(peerId)) { return; }
  const ch = channels.get(peerId);
  if (!ch || ch.readyState !== 'open') { return; }
  try {
    ch.send(JSON.stringify({ t: 'rc-resume' }));
  } catch { /* 单通道异常不拖垮会话 */ }
}

/** 控制端释放前调用：在 control-session DC 上通知被控端（fire-and-forget）。
 *  dstdrrek-2 U2 真机复测整改：接收端仅把「字符串」帧路由给 handleMetaMessage，
 *  原先 TextEncoder→binary 的 rc-release 会被 handleBinary 按 tag 丢弃（横幅不撤
 *  实证）。改发文本帧，并保留二进制嗅探兜底（sniffBinaryMeta）。 */
export function sendControlEnd(): void {
  const payload = JSON.stringify({ t: 'rc-release' });
  for (const ch of channels.values()) {
    if (ch.readyState === 'open') {
      try {
        ch.send(payload);
      } catch { /* 单通道异常不拖垮其余 */ }
    }
  }
  // 兜底：若文本帧发送失败（无 open 通道等），信令面 M3 仍照发
}

// —— 被控端采集泵 ——
// 注：本地轨由 useWebRTC attachLocalTrack 注入（共享中＝系统已授权的真实采集）；
// 无共享轨时桌面端 getDisplayMedia 补取（Android 被控不支持——isControllablePlatform
// 判据本就排除 Android，泵不会被叫起）。

/** 注入会议屏幕共享轨（useWebRTC toggleScreenShare 成路径调用；stop 路径传 null） */
export function attachLocalTrack(track: MediaStreamTrack | null): void {
  if (track) {
    if (capture?.track === track) { return; }
    stopControlledPump();
    capture = {
      track,
      video: document.createElement('video'),
      canvas: document.createElement('canvas'),
      timer: null,
      seq: 0,
      srcW: 0,
      srcH: 0,
      owned: false,
    };
    capture.video.muted = true;
    capture.video.playsInline = true;
    capture.video.srcObject = new MediaStream([track]);
    void capture.video.play().catch(() => undefined);
    if (role === 'controlled') {
      startControlledPump();
    } else if (role === null) {
      // dstdrrek-2 整改（U1）：共享轨先于角色恢复到达时（被控端 App 重启/重协商
      // 竞态），回查本机 daemon 会话态补角色——角色在位即由 setSessionRole 开泵。
      // daemon 缺席（dev 构建）静默跳过，行为与此前一致。
      void restoreControlledFromDaemon();
    }
  } else {
    stopControlledPump();
  }
}

/** role 空窗时的会话恢复探查：daemon grant 活跃 ⇒ 补 controlled 角色（开泵） */
async function restoreControlledFromDaemon(): Promise<void> {
  if (role !== null || capture === null) { return; }
  try {
    const { controlStatus } = await import('./api');
    const s = await controlStatus();
    if (s?.grant_state === 'active' && role === null && capture !== null) {
      setSessionRole('controlled');
    }
  } catch { /* daemon 不可达：保持现状 */ }
}

/** 无共享轨时补取（桌面 getDisplayMedia；被控端桌面即 Windows/macOS/Linux） */
async function acquireOwnCapture(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: CAPTURE_FPS } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    attachLocalTrack(track);
    if (capture) {
      capture.owned = true; // 本模块自取 → 停泵时停轨
    }
    return true;
  } catch {
    return false;
  }
}

async function startControlledPump(): Promise<void> {
  if (!isPeerSessionActive() || role !== 'controlled') { return; }
  if (!capture) {
    // 采集获取在途（选择器未归/缓存复接中）⇒ 不叠加第二次 getDisplayMedia——
    // 否则角色接线与 DC open 双触发会在对方 promise resolve 前各弹一次选源（D5 错乱态）。
    // 在途那次完成后经 attachLocalTrack → startControlledPump 内层重入开泵。
    if (acquireInFlight) { return; }
    acquireInFlight = true;
    try {
      // D5（块 1790313105455-rt4p73av-1）：优先复用缓存的自取 display 轨（免选源）；
      // 无缓存/已失效才走 getDisplayMedia 现选（首次授权仍需用户选一次）。
      const cached = cachedOwnTrack;
      if (cached && cached.readyState === 'live') {
        attachLocalTrack(cached);
      } else {
        const ok = await acquireOwnCapture();
        if (!ok) {
          stats.inputsDropped += 0; // 计数面不混用；采集失败如实留痕（无帧=观看端占位）
          return;
        }
      }
    } finally {
      acquireInFlight = false;
    }
  }
  const cap = capture;
  if (!cap || cap.timer !== null) { return; }
  sendMeta();
  const interval = Math.round(1000 / CAPTURE_FPS);
  cap.timer = window.setInterval(() => {
    pumpOneFrame();
  }, interval);
}

function stopControlledPump(): void {
  const cap = capture;
  if (cap?.timer !== null && cap?.timer !== undefined) {
    clearInterval(cap.timer);
    cap.timer = null;
  }
  if (cap) {
    cap.video.srcObject = null;
    if (cap.owned) {
      // D5（块 1790313105455-rt4p73av-1）：自取 display 轨不再随泵停而 stop——
      // 入缓存供下次授权免选复用（w10-69/70/71 每授权重弹选源缺陷）。
      cacheOwnTrack(cap.track);
    }
    capture = null;
  }
}

/** 取一帧：drawImage → 降采样 ≤960 宽 → getImageData(RGBA8) → 切片发送 */
function pumpOneFrame(): void {
  const cap = capture;
  if (!cap || role !== 'controlled') { return; }
  const v = cap.video;
  if (v.readyState < 2 || v.videoWidth === 0 || v.videoHeight === 0) { return; }
  if (cap.srcW !== v.videoWidth || cap.srcH !== v.videoHeight) {
    cap.srcW = v.videoWidth;
    cap.srcH = v.videoHeight;
    // 源几何变化（切屏/改分辨率）→ 重报 rc-meta
    sendMeta();
  }
  const scale = v.videoWidth > CAPTURE_MAX_W ? CAPTURE_MAX_W / v.videoWidth : 1;
  const w = Math.max(1, Math.round(v.videoWidth * scale));
  const h = Math.max(1, Math.round(v.videoHeight * scale));
  cap.canvas.width = w;
  cap.canvas.height = h;
  const ctx = cap.canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) { return; }
  // 拥塞护栏（dstdrrek-2 实测：无护栏时 8fps×2.3MB 洪泛 SCTP 出向队列，帧流停滞后输入仍通）
  let congested = false;
  for (const ch of channels.values()) {
    if (ch.readyState === 'open' && ch.bufferedAmount > DC_BUFFER_LIMIT) { congested = true; break; }
  }
  if (congested) {
    stats.framesDropped += 1;
    return;
  }
  ctx.drawImage(v, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const rgba = img.data;
  cap.seq = (cap.seq + 1) % 0xffffffff;
  const total = Math.max(1, Math.ceil(rgba.byteLength / FRAME_SLICE_MAX_DATA));
  stats.framesOut += 1;
  for (let idx = 0; idx < total; idx++) {
    const chunk = rgba.subarray(idx * FRAME_SLICE_MAX_DATA, (idx + 1) * FRAME_SLICE_MAX_DATA);
    stats.slicesOut += 1;
    sendBinary(encodeFrameSlice(cap.seq, idx, total, w, h, chunk));
  }
}

function sendBinary(u8: Uint8Array): void {
  for (const ch of channels.values()) {
    if (ch.readyState === 'open') {
      try {
        // TS lib 的 send 参数收窄为 ArrayBufferView<ArrayBuffer>：运行时恒普通视图
        ch.send(u8 as unknown as ArrayBufferView<ArrayBuffer>);
      } catch { /* 单通道异常不拖垮其余 */ }
    }
  }
}

// —— 注入投递（被控端；daemon 标准件优先，原生 SendInput 兜底）——

/** 0x06 到达被控端 → 注入投递：本机 daemon 回环（armed 门禁在 daemon）→ 原生兜底 */
async function relayInjection(ev: ControlInputEvent): Promise<void> {
  // 1) 块 A 标准件：本机 hv-control-daemon /control/input（回环；X11 XTEST/系统级注入）
  try {
    const { postLocalInput } = await import('./api');
    if (await postLocalInput(ev)) {
      return;
    }
  } catch { /* 落兜底 */ }
  // 2) Tauri 桌面原生兜底（src-tauri rc_inject_input，Windows SendInput FFI）
  if (hasTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('rc_inject_input', {
        event: { x: ev.x, y: ev.y, buttons: ev.buttons, keys: ev.keys ?? [] },
      });
      return;
    } catch { /* 落计数 */ }
  }
  stats.inputsDropped += 1;
}

// —— base64（跨窗帧转发；分块避免 call stack 爆栈）——

function bytesToBase64(u8: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      u8[i] = bin.charCodeAt(i);
    }
    return u8;
  } catch {
    return null;
  }
}
