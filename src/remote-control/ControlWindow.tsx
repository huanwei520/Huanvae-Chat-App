/**
 * remote-control 独立控制窗口（设计 §4.2 窗口规格 + §7.1 帧渲染 + §7.2 输入回传）
 *
 * 独立 WebView（label=`remote-control`，DATA_PLANE_SUBWINDOWS 成员）：独立 React 根，
 * 不 import/不监听/不写入任何 meeting 窗状态（§4.3 窗口不变性结构性保证）。
 *
 * 通路（daemon 未部署时降级为「等待帧流」占位，测试面 UI 演示仍可开窗）：
 * - 帧渲染：GET /control/frame 轮询（块 A daemon 帧端点，§7.1）
 * - 输入捕获：pointer/keyboard DOM 事件 → 坐标换算 client→frame→screen（§7.2）
 *   → POST /control/input → daemon 组 0x06 InputEvent 经 P3 会话上行
 * - 状态巡检：GET /control/status（armed/grant/fps/frame_count/screen 几何）
 *
 * @module remote-control/ControlWindow
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  controlFrameUrl,
  controlInput,
  controlStatus,
  resolveControlPort,
} from './api';
import { isDevControl } from './devGate';
import {
  BUTTON_LEFT,
  BUTTON_WHEEL_DOWN,
  BUTTON_WHEEL_UP,
  domButtonsToMask,
  domKeyToKeysym,
  makeInputEvent,
  mapClientToScreen,
  type FrameGeometry,
} from './coordinates';
import type { ControlDaemonStatus } from './types';
// 跨端帧通道（本块 dstdrrek-2）：会话在位时帧源=对端 0x07 帧流（DC），不再轮询本机回环
import {
  getPeerScreen,
  getStats,
  subscribeFrames,
  type RcFrame,
} from './frameChannel';
import './remote-control.css';

/** 帧轮询间隔（测试面默认档目标 8fps，§7.1；daemon 缺席时降频探活） */
const FRAME_POLL_MS = 250;
const STATUS_POLL_MS = 1500;

/**
 * 控制面链路状态（HTTP 巡检探活派生；修复常驻「未连接」误报，2026-09-09）：
 * - probing   首探未归/尚未确证——只许显示「正在连接」，**不得**宣断（旧实现初值 null
 *             直接渲染「未连接」＝状态机初值误报）；
 * - connected 最近一次探活成功——单次瞬时失败（探针超时≈巡检间隔，负载抖动常见）
 *             **不清零不宣断**，保持上一成功快照（旧实现单败即翻「未连接」＝竞态误报）；
 * - down      连续 LINK_DOWN_STREAK 次失败才确证——此时「未连接」为真断开，如实展示。
 */
export type LinkState = 'probing' | 'connected' | 'down';

/** 连续失败多少次才宣告 down（3 次 ≈ ≥3s 连续不可达；单次抖动到不了 3） */
export const LINK_DOWN_STREAK = 3;

/** D4（块 1790313105455-rt4p73av-1）：对端帧流停滞判阈值。泵 3fps（CAPTURE_FPS）
 *  ⇒ 5s ≈ 15 帧缺失；拥塞护栏丢帧抖动到不了 5s，不误翻红。 */
export const RC_FRAME_STALL_MS = 5_000;

/** 探活一轮后的链路状态迁移（纯函数；tests/remote-control-link-state.test.ts 覆盖） */
export function nextLinkState(prev: LinkState, ok: boolean, failStreak: number): LinkState {
  if (ok) { return 'connected'; }
  return failStreak >= LINK_DOWN_STREAK ? 'down' : prev;
}

export function ControlWindow() {
  const [status, setStatus] = useState<ControlDaemonStatus | null>(null);
  /** 链路状态机（初值 probing：首探未归不得宣断，见 LinkState 注） */
  const [link, setLink] = useState<LinkState>('probing');
  /** 连续探活失败计数（成功即归零；达 LINK_DOWN_STREAK 才判 down） */
  const failStreakRef = useRef(0);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);
  const [droppedKeys, setDroppedKeys] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  // —— 跨端会话帧面（dstdrrek-2）：true = 对端 0x07 帧流在位，canvas 渲染 + 停回环轮询 ——
  const [peerMode, setPeerMode] = useState(false);
  const [peerFrameCount, setPeerFrameCount] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peerModeRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLImageElement>(null);
  const heldKeysRef = useRef<Set<number>>(new Set());
  const geometryRef = useRef<FrameGeometry | null>(null);

  // —— 跨端帧订阅（对端真实画面；断链根修：控制窗帧源不再走 127.0.0.1 回环）——
  // D4：同步记帧到达时刻——停滞（断链）期状态条置红＋断开提示（此前 peerMode 一旦
  // 置位恒亮绿点，帧冻结 26 仍显示「帧流中」，ae6fbn0x 实测证据）。
  const lastFrameAtRef = useRef(0);
  const [peerStalled, setPeerStalled] = useState(false);
  useEffect(() => {
    const draw = (f: RcFrame) => {
      setPeerMode(true);
      peerModeRef.current = true;
      setPeerStalled(false);
      lastFrameAtRef.current = Date.now();
      setFrameSize({ w: f.width, h: f.height });
      setPeerFrameCount(getStats().framesIn);
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = f.width;
        canvas.height = f.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // 拷贝出定长 ArrayBuffer 视图（TS ArrayBufferLike 域防御）
          const clamped = new Uint8ClampedArray(f.rgba);
          ctx.putImageData(new ImageData(clamped, f.width, f.height), 0, 0);
        }
      }
    };
    return subscribeFrames(draw);
  }, []);

  // —— D4：帧流停滞看门（peerMode 在位时每秒检查；≥RC_FRAME_STALL_MS 无帧 ⇒ 置红）——
  useEffect(() => {
    if (!peerMode) {
      setPeerStalled(false);
      return undefined;
    }
    const t = window.setInterval(() => {
      const last = lastFrameAtRef.current;
      setPeerStalled(last > 0 && Date.now() - last > RC_FRAME_STALL_MS);
    }, 1_000);
    return () => { window.clearInterval(t); };
  }, [peerMode]);

  // —— 状态巡检（兼探活；probing/connected/down 三态去抖，不因单次超时翻「未连接」）——
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      const s = await controlStatus();
      if (stopped) {
        return;
      }
      if (s) {
        failStreakRef.current = 0;
        setLink('connected');
        setStatus(s); // connected 态始终持有最新成功快照
      } else {
        // 失败不清空 status：保持上一成功快照，避免 armed/grant 展示位闪烁；
        // 只有连续 LINK_DOWN_STREAK 次失败才把链路判为 down（真断开才如实宣断）。
        failStreakRef.current += 1;
        setLink((prev) => nextLinkState(prev, false, failStreakRef.current));
      }
      const sw = s?.screen?.width ?? 0;
      const sh = s?.screen?.height ?? 0;
      if (sw > 0 && sh > 0 && geometryRef.current) {
        geometryRef.current = { ...geometryRef.current, screenW: sw, screenH: sh };
      }
    };
    void poll();
    const t = setInterval(poll, STATUS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  // —— 帧轮询（cache-bust；daemon 404/不可达 → 回退占位态）——
  // ⚠️ 遗留面（dstdrrek-2）：仅无跨端会话时运行（单机回环演示链）；跨端会话在位
  // （对端 0x07 帧到达置 peerModeRef）即停——本机回环帧不得冒充对端屏。
  useEffect(() => {
    let stopped = false;
    let t: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (stopped || peerModeRef.current) {
        if (t !== null) {
          clearInterval(t);
          t = null;
        }
        return;
      }
      const probe = new Image();
      probe.onload = () => {
        if (stopped || peerModeRef.current) { return; }
        setFrameUrl(controlFrameUrl());
        setFrameSize({ w: probe.naturalWidth, h: probe.naturalHeight });
        setLastError(null);
      };
      probe.onerror = () => {
        if (stopped || peerModeRef.current) { return; }
        setFrameUrl((prev) => (prev === null ? null : prev));
      };
      probe.src = controlFrameUrl();
    };
    tick();
    t = setInterval(tick, FRAME_POLL_MS);
    return () => {
      stopped = true;
      if (t !== null) {
        clearInterval(t);
      }
    };
  }, []);

  // —— 几何维护（container × frame × screen）——
  // screen 几何真值源（dstdrrek-2）：跨端会话 = 被控端 rc-meta 报的真实屏几何；
  // 无会话遗留面 = daemon status.screen（或帧尺寸兑底）。
  const refreshGeometry = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !frameSize) { return; }
    const peerScreen = peerMode ? getPeerScreen() : null;
    geometryRef.current = {
      containerW: vp.clientWidth,
      containerH: vp.clientHeight,
      frameW: frameSize.w,
      frameH: frameSize.h,
      screenW: peerScreen?.w ?? status?.screen?.width ?? frameSize.w,
      screenH: peerScreen?.h ?? status?.screen?.height ?? frameSize.h,
    };
  }, [frameSize, status, peerMode]);

  useEffect(() => {
    refreshGeometry();
    const onResize = () => refreshGeometry();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [refreshGeometry]);

  /** 换算并上行一个 pointer 事件（几何未就绪/帧外静默丢弃，§7.2 越界拒绝） */
  const emitPointer = useCallback((e: React.PointerEvent, buttons?: number) => {
    const geo = geometryRef.current;
    const vp = viewportRef.current;
    if (!geo || !vp) { return; }
    const rect = vp.getBoundingClientRect();
    const p = mapClientToScreen(e.clientX - rect.left, e.clientY - rect.top, geo);
    if (!p) { return; }
    const mask = domButtonsToMask(buttons ?? e.buttons);
    void controlInput(makeInputEvent(p.x, p.y, mask, heldKeysRef.current));
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => emitPointer(e), [emitPointer]);
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      emitPointer(e, e.buttons | BUTTON_LEFT);
    },
    [emitPointer],
  );
  const onPointerUp = useCallback((e: React.PointerEvent) => emitPointer(e), [emitPointer]);

  // —— 键盘捕获：按下集合快照（0x06 keys 域）＋最小键位表（表外丢弃计数留痕，§7.2）——
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    const sym = domKeyToKeysym(e.key);
    if (sym === null) {
      setDroppedKeys((n) => n + 1);
      return;
    }
    heldKeysRef.current.add(sym);
    const geo = geometryRef.current;
    const vp = viewportRef.current;
    if (geo && vp) {
      const rect = vp.getBoundingClientRect();
      const hover = mapClientToScreen(
        (e as unknown as { clientX?: number }).clientX ?? rect.width / 2,
        (e as unknown as { clientY?: number }).clientY ?? rect.height / 2,
        geo,
      );
      void controlInput(
        makeInputEvent(hover?.x ?? 0, hover?.y ?? 0, 0, heldKeysRef.current),
      );
    }
  }, []);

  const onKeyUp = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    const sym = domKeyToKeysym(e.key);
    if (sym === null) { return; }
    heldKeysRef.current.delete(sym);
    const geo = geometryRef.current;
    if (geo) {
      void controlInput(makeInputEvent(0, 0, 0, heldKeysRef.current));
    }
  }, []);

  // —— 滚轮捕获（块 pz3oo1tp：滚轮此前完全未捕获——owner 复测项硬缺口）——
  // 滚轮是瞬时事件（无按住态），编码为 buttons bit3(上)/bit4(下) 的单发 0x06
  // （既有 buttons 域空闲位，非新协议域；被控端消费见 rc_inject.rs Windows 臂；
  // daemon 标准件映射缺口已在 coordinates.ts 登记为产品级待裁决项）。
  // React 17+ 对 wheel 在根节点按 passive 挂载，JSX onWheel 无法 preventDefault
  // （控制窗自身会跟着滚）——改在 viewport 元素上挂非 passive 原生监听。
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) { return undefined; }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const geo = geometryRef.current;
      if (!geo) { return; }
      const rect = vp.getBoundingClientRect();
      const p = mapClientToScreen(e.clientX - rect.left, e.clientY - rect.top, geo);
      if (!p) { return; } // letterbox 黑边/帧外越界拒绝（§7.2 同语义）
      const mask = e.deltaY < 0 ? BUTTON_WHEEL_UP : BUTTON_WHEEL_DOWN;
      void controlInput(makeInputEvent(p.x, p.y, mask, heldKeysRef.current));
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => { vp.removeEventListener('wheel', onWheel); };
  }, []);

  // —— dev 门控键位触发（测试自动化，仅 VITE_DEV_CONTROL=1 渲染）：在视口元素上
  //    派发真实 KeyboardEvent，走与物理键盘完全相同的既有捕获链
  //    （onKeyDown → domKeyToKeysym → POST /control/input）。
  //    单机同屏拓扑下被控端 X focus 指向靶窗口（xev），注入不回环进本窗。 ——
  const devFireKey = useCallback((key: string) => {
    const vp = viewportRef.current;
    if (!vp) { return; }
    vp.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    window.setTimeout(() => {
      vp.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    }, 120);
  }, []);

  const armed = status?.armed === true;
  const grantState = (status?.grant_state as string | undefined) ?? null;
  const loopback = `127.0.0.1:${resolveControlPort()}`;

  // 状态栏链路展示（三态 + 跨端会话帧面；data-testid 供 e2e 断言，与截图 OCR 双通道验证）
  let linkDotClass = ''; // probing：中性点，不亮成功/告警色
  if (peerMode && peerStalled) {
    // D4（块 1790313105455-rt4p73av-1）：断链期不再亮绿点——置红＋断开提示
    linkDotClass = 'rc-window__dot--down';
  } else if (peerMode) {
    linkDotClass = 'rc-window__dot--ok'; // 跨端 0x07 帧流在位 = 数据面建链实证
  } else if (link === 'down') {
    linkDotClass = 'rc-window__dot--down';
  } else if (link === 'connected') {
    linkDotClass = armed ? 'rc-window__dot--ok' : 'rc-window__dot--warn';
  }
  let linkText: string;
  if (peerMode) {
    linkText = peerStalled
      ? `对端帧流中断（≥${RC_FRAME_STALL_MS / 1000}s 无帧，断链自愈探针进行中） · 帧 ${peerFrameCount} · 注入 ${getStats().inputsOut}`
      : `对端帧流中（control-session DC · FrameSlice 0x07） · 帧 ${peerFrameCount} · 注入 ${getStats().inputsOut}`;
  } else if (link === 'probing') {
    linkText = `正在连接控制 daemon（${loopback}）…`;
  } else if (link === 'connected') {
    linkText = `daemon 已连接 · ${armed ? '受戒(armed)' : '未受戒'}${grantState ? ` · grant=${grantState}` : ''}${status?.inject_count !== undefined ? ` · 注入 ${status.inject_count}` : ''}${status?.frame_count !== undefined ? ` · 帧 ${status.frame_count}` : ''}`;
  } else {
    linkText = `控制 daemon 未连接（回环 ${loopback}，自动重试中，见设计 §7.3）`;
  }

  // 帧面三分支（dstdrrek-2）：跨端 0x07 帧（canvas）→ 回环遗留面（img）→ 占位
  let frameContent: ReactNode;
  if (peerMode) {
    frameContent = (
      <canvas
        ref={canvasRef}
        className="rc-window__frame"
        aria-label="被控端屏幕帧流（对端 DC 帧源）"
        data-testid="rc-peer-frame"
      />
    );
  } else if (frameUrl && frameSize) {
    frameContent = (
      <img
        ref={frameRef}
        className="rc-window__frame"
        src={frameUrl}
        alt="被控端屏幕帧流"
        draggable={false}
      />
    );
  } else {
    frameContent = (
      <div className="rc-window__placeholder">
        <h3>等待被控端帧流</h3>
        <p>
          本窗口为 remote-control 独立控制窗口（label=`remote-control`）。
          <br />
          跨端会话帧源＝control-session DataChannel 上的 FrameSlice(0x07)
          对端真实画面（设计 §7.1；dstdrrek-2 前的本机回环轮询旧面已摘除）。
          <br />
          无跨端会话时回退本机 daemon 回环帧端点（GET /control/frame，
          单机演示遗留面）。
        </p>
      </div>
    );
  }

  return (
    <div className="rc-window">
      <div className="rc-window__statusbar">
        <span className={`rc-window__dot ${linkDotClass}`} data-testid="rc-link-dot" />
        <span data-testid="rc-link-state">{linkText}</span>
        {droppedKeys > 0 && <span>表外键丢弃 {droppedKeys}</span>}
        {lastError && <span>{lastError}</span>}
        {isDevControl() && (
          <span className="rc-window__devkeys" data-testid="rc-devkeys">
            <button onClick={() => devFireKey('a')}>键a</button>
            <button onClick={() => devFireKey('Enter')}>键Enter</button>
          </span>
        )}
        <span className="rc-window__brand">远程控制 · dev</span>
      </div>

      <div
        className="rc-window__viewport"
        ref={viewportRef}
        tabIndex={0}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {frameContent}
        <div className="rc-window__hint">
          点击/移动＝注入（0x06 InputEvent） · Esc 释放焦点
        </div>
      </div>
    </div>
  );
}

export default ControlWindow;
