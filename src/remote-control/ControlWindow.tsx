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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  controlFrameUrl,
  controlInput,
  controlStatus,
  resolveControlPort,
} from './api';
import { isDevControl } from './devGate';
import {
  BUTTON_LEFT,
  domButtonsToMask,
  domKeyToKeysym,
  makeInputEvent,
  mapClientToScreen,
  type FrameGeometry,
} from './coordinates';
import type { ControlDaemonStatus } from './types';
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLImageElement>(null);
  const heldKeysRef = useRef<Set<number>>(new Set());
  const geometryRef = useRef<FrameGeometry | null>(null);

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
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (stopped) { return; }
      const probe = new Image();
      probe.onload = () => {
        if (stopped) { return; }
        setFrameUrl(controlFrameUrl());
        setFrameSize({ w: probe.naturalWidth, h: probe.naturalHeight });
        setLastError(null);
      };
      probe.onerror = () => {
        if (stopped) { return; }
        setFrameUrl((prev) => (prev === null ? null : prev));
      };
      probe.src = controlFrameUrl();
    };
    tick();
    const t = setInterval(tick, FRAME_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  // —— 几何维护（container × frame × screen）——
  const refreshGeometry = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !frameSize) { return; }
    geometryRef.current = {
      containerW: vp.clientWidth,
      containerH: vp.clientHeight,
      frameW: frameSize.w,
      frameH: frameSize.h,
      screenW: status?.screen?.width ?? frameSize.w,
      screenH: status?.screen?.height ?? frameSize.h,
    };
  }, [frameSize, status]);

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

  // 状态栏链路展示（三态；data-testid 供 e2e 断言，与截图 OCR 双通道验证）
  let linkDotClass = ''; // probing：中性点，不亮成功/告警色
  if (link === 'down') {
    linkDotClass = 'rc-window__dot--down';
  } else if (link === 'connected') {
    linkDotClass = armed ? 'rc-window__dot--ok' : 'rc-window__dot--warn';
  }
  let linkText: string;
  if (link === 'probing') {
    linkText = `正在连接控制 daemon（${loopback}）…`;
  } else if (link === 'connected') {
    linkText = `daemon 已连接 · ${armed ? '受戒(armed)' : '未受戒'}${grantState ? ` · grant=${grantState}` : ''}${status?.inject_count !== undefined ? ` · 注入 ${status.inject_count}` : ''}${status?.frame_count !== undefined ? ` · 帧 ${status.frame_count}` : ''}`;
  } else {
    linkText = `控制 daemon 未连接（回环 ${loopback}，自动重试中，见设计 §7.3）`;
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
      >
        {frameUrl && frameSize ? (
          <img
            ref={frameRef}
            className="rc-window__frame"
            src={frameUrl}
            alt="被控端屏幕帧流"
            draggable={false}
          />
        ) : (
          <div className="rc-window__placeholder">
            <h3>等待被控端帧流</h3>
            <p>
              本窗口为 remote-control 独立控制窗口（label=`remote-control`）。
              <br />
              帧流来自本机控制 daemon 的回环帧端点（GET /control/frame，设计 §7.1/§7.3）。
              <br />
              daemon（块 A hv-control-daemon）未运行或未受戒时显示此占位——
              <br />
              建链/指纹锚定/帧分片协议见设计 §5.1/§7.1。
            </p>
          </div>
        )}
        <div className="rc-window__hint">
          点击/移动＝注入（0x06 InputEvent） · Esc 释放焦点
        </div>
      </div>
    </div>
  );
}

export default ControlWindow;
