/**
 * RustWebSocket —— 模拟浏览器 `WebSocket` 接口子集,底层走 Rust(ws_proxy.rs)。
 *
 * 为什么必须走 Rust:webview 的浏览器 `WebSocket` 用**系统信任**校验 TLS,
 * 验不过私有 CA 签发的自签 leaf(私有 CA 只内置在 App,不进系统信任库)。
 * 数据面 WS 与 HTTP/SSE(secure_net.rs)同套 TLS 策略:只信内置私有 CA。
 *
 * 设计为"近似 drop-in":仅实现项目实际用到的成员
 * (onopen/onmessage/onerror/onclose/send/close/readyState/binaryType),
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
import type { SecureHttpResolve } from './discovery.types';

/** ws_proxy.rs WsEvent(经 Channel 推回) */
type WsEvent =
  | { event: 'text'; data: string }
  | { event: 'binary'; data: number[] }
  | { event: 'close'; code: number }
  | { event: 'error'; message: string };

/** onmessage 事件(对齐浏览器 MessageEvent 的 data;文本=string,二进制=ArrayBuffer) */
export interface RustWsMessageEvent {
  data: string | ArrayBuffer;
}

/** onclose 事件(对齐浏览器 CloseEvent 的 code 子集) */
export interface RustWsCloseEvent {
  code: number;
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
  private readonly channel: Channel<WsEvent>;

  /**
   * @param url ws(s):// 地址(调用方用逻辑域名 serverUrl.replace(/^http/, 'ws') 生成);
   *   若 resolve 带 direct_ip,本构造器会把主机改写为该 IP(IP 字面量=不发 SNI 绕 ICP)。
   * @param resolve 数据面注入(内置 CA + 直连 IP/端口),通常 `resolveForSecureHttp() ?? { pin_ca: true }`
   */
  constructor(url: string, resolve?: SecureHttpResolve) {
    this.channel = new Channel<WsEvent>();
    this.channel.onmessage = (ev) => { this.handleEvent(ev); };

    // direct_ip/direct_port → 把 ws(s):// URL 主机改写为该 IP(IP 字面量=不发 SNI,绕 ICP SNI 拦截);
    // leaf SAN=IP 由 ws_proxy 内置私有 CA 验证。opts 透传(ws_proxy 只取 extra_ca_pem,忽略其余字段)。
    const finalUrl = resolve?.direct_ip && resolve.direct_port
      ? rewriteUrlHost(url, resolve.direct_ip, resolve.direct_port)
      : url;
    invoke<number>('ws_connect', {
      url: finalUrl,
      opts: resolve ?? {},
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
    }
  }

  send(data: string | ArrayBuffer | ArrayBufferView) {
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
}
