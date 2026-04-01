/**
 * 单个 xterm.js 终端实例
 *
 * 每个实例管理一条 WebSocket 连接 (/ws/terminal/{machine_id})
 * 输入/输出均为 Base64 编码
 *
 * 使用延迟连接策略避免 React StrictMode 双重挂载导致的
 * "WebSocket is closed before the connection is established" 错误
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { RemoteDevApiClient } from '../../services/apiClient';

/** UTF-8 字符串 → Base64（支持中文等多字节字符） */
function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Base64 → Uint8Array（用于 xterm.write 直接写入原始字节） */
function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface TerminalInstanceProps {
  api: RemoteDevApiClient;
  machineId: string;
  visible: boolean;
}

export function TerminalInstance({ api, machineId, visible }: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const getWsUrl = useCallback(() => {
    const serverUrl = api.getServerUrl();
    const token = api.getAccessToken();
    const wsProto = serverUrl.startsWith('https') ? 'wss' : 'ws';
    const host = serverUrl.replace(/^https?:\/\//, '');
    return `${wsProto}://${host}/ws/terminal/${machineId}?token=${encodeURIComponent(token)}`;
  }, [api, machineId]);

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(56, 139, 253, 0.4)',
        black: '#0d1117',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d353',
        white: '#c9d1d9',
      },
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    void (async () => {
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl');
        if (cancelled) return;
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // fallback to canvas renderer
      }
    })();

    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    let inputDisposable: { dispose: () => void } | null = null;
    let resizeDisposable: { dispose: () => void } | null = null;

    // 延迟创建 WebSocket，避免 StrictMode 第一次挂载时立即被清理
    const connectTimer = setTimeout(() => {
      if (cancelled) return;

      const url = getWsUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;
      let initSent = false;

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        setStatus('connected');
        const { cols, rows } = term;
        ws.send(JSON.stringify({ type: 'init', cols, rows }));
        initSent = true;
      };

      ws.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === 'output' && msg.data) {
            term.write(decodeBase64(msg.data));
          } else if (msg.type === 'status') {
            if (msg.message) {
              term.writeln(`\r\n\x1b[36m[系统] ${msg.message}\x1b[0m`);
            }
          } else if (msg.type === 'error') {
            term.writeln(`\r\n\x1b[31m[错误] ${msg.message || '未知错误'}\x1b[0m`);
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = (ev) => {
        if (cancelled) return;
        setStatus('disconnected');
        term.writeln(`\r\n\x1b[33m[断开] WebSocket 关闭 (code=${ev.code})\x1b[0m`);
      };

      ws.onerror = () => {
        if (cancelled) return;
        setStatus('disconnected');
        term.writeln('\r\n\x1b[31m[错误] WebSocket 连接失败\x1b[0m');
      };

      inputDisposable = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: encodeBase64(data) }));
        }
      });

      resizeDisposable = term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN && initSent) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });
    }, 0);

    // ResizeObserver 替代 window.resize，精确感知容器尺寸变化
    // 覆盖：窗口缩放、拖拽分割手柄、面板显示/隐藏切换
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (!cancelled) {
          requestAnimationFrame(() => fit.fit());
        }
      });
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      cancelled = true;
      clearTimeout(connectTimer);
      resizeObserver?.disconnect();
      inputDisposable?.dispose();
      resizeDisposable?.dispose();
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        if (wsRef.current.readyState === WebSocket.OPEN ||
            wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [machineId, getWsUrl]);

  useEffect(() => {
    if (visible && fitRef.current) {
      // 延迟两帧确保 DOM 完成布局
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitRef.current?.fit();
        });
      });
    }
  }, [visible]);

  return (
    <div
      ref={containerRef}
      className="rd-xterm-container"
      style={{ display: visible ? 'block' : 'none' }}
    >
      {status !== 'connected' && (
        <div className="rd-xterm-status-badge" data-status={status}>
          {status === 'connecting' ? '连接中…' : '已断开'}
        </div>
      )}
    </div>
  );
}
