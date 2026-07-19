/**
 * RustWebSocket —— 模拟浏览器 `WebSocket` 接口子集,底层走 Rust(ws_proxy.rs)。
 *
 * 为什么必须走 Rust:webview 的浏览器 `WebSocket` 用**系统信任**校验 TLS,
 * 验不过私有 CA 签发的自签 leaf(私有 CA 只内置在 App,不进系统信任库)。
 * 数据面 WS 与 HTTP/SSE(secure_net.rs)同套 TLS 策略:只信内置私有 CA。
 *
 * 设计为"近似 drop-in":仅实现项目实际用到的成员
 * (onopen/onmessage/onerror/onclose/send/close/terminate/lastActivityAt/readyState/binaryType),
 * readyState 用标准数值(0/1/2/3),故 `ws.readyState === WebSocket.OPEN` 仍等价。
 *
 * 事件顺序保证:onopen 必先于任何 message/close —— open 前到达的帧先缓冲,
 * onopen 后按序回放(浏览器语义)。
 *
 * 见工作区 DESIGN-app-discovery-selfsigned-tls.md。
 * @module services/rustWebSocket
 */

import { invoke, Channel } from '@tauri-apps/api/core';
import { rewriteUrlHost } from './secureFetch';
import { isE2E } from './e2eMode';
import type { SecureHttpResolve } from './discovery.types';

/** ws_proxy.rs WsEvent(经 Channel 推回) */
type WsEvent =
  | { event: 'text'; data: string }
  | { event: 'binary'; data: number[] }
  | { event: 'close'; code: number }
  | { event: 'error'; message: string }
  // 协议层 Ping/Pong 转发,仅活性信号
  | { event: 'ping' };

/** onmessage 事件(对齐浏览器 MessageEvent 的 data;文本=string,二进制=ArrayBuffer) */
export interface RustWsMessageEvent {
  data: string | ArrayBuffer;
}

/** onclose 事件(对齐浏览器 CloseEvent 的 code 子集) */
export interface RustWsCloseEvent {
  code: number;
}

/** RustWebSocket 本地建连选项（透传 ws_proxy，非 discovery resolve 的一部分） */
export interface RustWsConnectLocalOpts {
  /** 入站空闲超时（秒）→ ws_proxy `idle_timeout_secs`：超窗无任何入站帧判半开、上抛 Error */
  idleTimeoutSecs?: number;
}

export class RustWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** 标准 WebSocket readyState 数值 */
  readyState: number = RustWebSocket.CONNECTING;
  /** 仅兼容赋值(如 ws.binaryType='arraybuffer');本实现二进制恒以 ArrayBuffer 投递 */
  binaryType: 'arraybuffer' | 'blob' = 'blob';
  /** 最近一次收到任何入站事件（含协议层 ping 转发）的时刻，供上层活性看门狗判半开 */
  lastActivityAt: number = Date.now();

  onopen: (() => void) | null = null;
  onmessage: ((ev: RustWsMessageEvent) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onclose: ((ev: RustWsCloseEvent) => void) | null = null;

  private connId: number | null = null;
  private opened = false;
  /** 终态(close 事件/error/主动 close 后)→ 不再派发任何事件 */
  private terminated = false;
  /** open 前到达的事件缓冲,onopen 后按序回放 */
  private pending: WsEvent[] = [];
  private readonly channel: Channel<WsEvent> | null;
  private nativeWs: WebSocket | null = null;

  /**
   * @param url ws(s):// 地址(调用方用逻辑域名 serverUrl.replace(/^http/, 'ws') 生成);
   *   若 resolve 带 direct_ip,本构造器会把主机改写为该 IP(IP 字面量=不发 SNI 绕 ICP)。
   * @param resolve 数据面注入(内置 CA + 直连 IP/端口),通常 `resolveForSecureHttp() ?? { pin_ca: true }`
   * @param localOpts 本地建连选项(入站空闲超时等,透传 ws_proxy)
   */
  constructor(url: string, resolve?: SecureHttpResolve, localOpts?: RustWsConnectLocalOpts) {
    if (isE2E()) {
      // e2e(L2.5-web)：原生 WebSocket 直连本地集群（明文,无 TLS 面），外部 API 面不变。
      // resolve 忽略（e2e 下 resolveForSecureHttp 返 null，无直连 IP 改写）。
      this.channel = null;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.nativeWs = ws;
      ws.onopen = () => {
        this.opened = true;
        this.lastActivityAt = Date.now();
        this.readyState = RustWebSocket.OPEN;
        this.onopen?.();
      };
      ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
        if (this.terminated) { return; }
        this.lastActivityAt = Date.now();
        this.onmessage?.({ data: ev.data });
      };
      ws.onerror = () => {
        if (this.terminated) { return; }
        this.onerror?.(new Error('websocket error'));
      };
      ws.onclose = (ev) => {
        if (this.terminated) { return; }
        this.terminated = true;
        this.readyState = RustWebSocket.CLOSED;
        this.onclose?.({ code: ev.code });
      };
      return;
    }

    this.channel = new Channel<WsEvent>();
    this.channel.onmessage = (ev) => { this.handleEvent(ev); };

    // direct_ip/direct_port → 把 ws(s):// URL 主机改写为该 IP(IP 字面量=不发 SNI,绕 ICP SNI 拦截);
    // leaf SAN=IP 由 ws_proxy 内置私有 CA 验证。opts 透传(ws_proxy 只取 extra_ca_pem/idle_timeout_secs,忽略其余字段)。
    const finalUrl = resolve?.direct_ip && resolve.direct_port
      ? rewriteUrlHost(url, resolve.direct_ip, resolve.direct_port)
      : url;
    const opts: Record<string, unknown> = { ...(resolve ?? {}) };
    if (localOpts?.idleTimeoutSecs !== undefined) {
      opts.idle_timeout_secs = localOpts.idleTimeoutSecs;
    }
    invoke<number>('ws_connect', {
      url: finalUrl,
      opts,
      onEvent: this.channel,
    })
      .then((id) => {
        if (this.terminated) {
          // 建连返回前已被 close():立即关闭刚建好的连接
          void invoke('ws_close', { connId: id });
          this.readyState = RustWebSocket.CLOSED;
          return;
        }
        this.connId = id;
        this.opened = true;
        this.lastActivityAt = Date.now();
        this.readyState = RustWebSocket.OPEN;
        this.onopen?.();
        const buffered = this.pending;
        this.pending = [];
        for (const ev of buffered) { this.dispatch(ev); }
      })
      .catch((e: unknown) => {
        if (this.terminated) { return; }
        this.terminated = true;
        this.readyState = RustWebSocket.CLOSED;
        this.onerror?.(e);
        this.onclose?.({ code: 1006 });
      });
  }

  private handleEvent(ev: WsEvent) {
    if (this.terminated) { return; }
    // 任何入站事件(含协议层 ping 转发)都刷新活性时刻,供上层看门狗判半开
    this.lastActivityAt = Date.now();
    if (!this.opened) {
      this.pending.push(ev);
      return;
    }
    this.dispatch(ev);
  }

  private dispatch(ev: WsEvent) {
    if (this.terminated) { return; }
    switch (ev.event) {
      case 'text':
        this.onmessage?.({ data: ev.data });
        break;
      case 'binary':
        this.onmessage?.({ data: new Uint8Array(ev.data).buffer });
        break;
      case 'close':
        this.terminated = true;
        this.readyState = RustWebSocket.CLOSED;
        this.onclose?.({ code: ev.code });
        break;
      case 'error':
        this.terminated = true;
        this.readyState = RustWebSocket.CLOSED;
        this.onerror?.(new Error(ev.message));
        this.onclose?.({ code: 1006 });
        break;
      case 'ping':
        // 协议层心跳:仅作活性信号(浏览器 WebSocket 亦不暴露 ping),不派发 onmessage
        break;
    }
  }

  send(data: string | ArrayBuffer | ArrayBufferView) {
    if (this.nativeWs) {
      if (this.readyState !== RustWebSocket.OPEN) { return; }
      this.nativeWs.send(data);
      return;
    }
    if (this.connId === null || this.readyState !== RustWebSocket.OPEN) { return; }
    if (typeof data === 'string') {
      void invoke('ws_send_text', { connId: this.connId, data });
      return;
    }
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    void invoke('ws_send_binary', { connId: this.connId, data: Array.from(bytes) });
  }

  close(code?: number, reason?: string) {
    if (this.nativeWs) {
      if (this.terminated) {
        this.readyState = RustWebSocket.CLOSED;
        return;
      }
      this.readyState = RustWebSocket.CLOSING;
      this.nativeWs.close(code, reason);
      return;
    }
    if (this.terminated) {
      this.readyState = RustWebSocket.CLOSED;
      return;
    }
    this.readyState = RustWebSocket.CLOSING;
    if (this.connId !== null) {
      void invoke('ws_close', { connId: this.connId, code, reason });
    } else {
      // 建连尚未返回:标记终态,由 ws_connect 的 .then 兜底关闭
      this.terminated = true;
    }
  }

  /**
   * 本地强制终止(上层看门狗判半开时用):立即置终态并同步派发 onclose,不等对端 Close 回应。
   * 半开连接发出的 Close 帧得不到对端回应 → 常规 close() 的 onclose 永不触发,重连闭环卡死;
   * terminate 保证 onclose 必触发。Rust 侧经 ws_close 尽力清理(残留读任务由 ws_proxy
   * 的入站空闲超时回收)。code 缺省 4008(私有段,区别于对端关闭)。
   */
  terminate(code = 4008) {
    if (this.nativeWs) {
      if (this.terminated) {
        this.readyState = RustWebSocket.CLOSED;
        return;
      }
      this.terminated = true;
      this.readyState = RustWebSocket.CLOSED;
      this.nativeWs.close();
      this.onclose?.({ code });
      return;
    }
    if (this.terminated) {
      this.readyState = RustWebSocket.CLOSED;
      return;
    }
    this.terminated = true;
    this.readyState = RustWebSocket.CLOSED;
    if (this.connId !== null) {
      void invoke('ws_close', { connId: this.connId, code, reason: 'liveness timeout' });
    }
    this.onclose?.({ code });
  }
}
