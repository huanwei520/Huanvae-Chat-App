/**
 * HuanvaeGuard VPN 管理页面（最简功能版）
 *
 * 功能：连接/断开隧道、状态查看、设备管理
 * 运行在独立 Tauri 窗口中
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { platform } from '@tauri-apps/plugin-os';
import * as localApi from './localApi';
import * as serverApi from './serverApi';
import type { TunnelStatus, HgDevice } from './types';

interface WindowData {
  userId: string;
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
}

function parseWindowData(): WindowData | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const serverUrlB64 = params.get('serverUrl');
    const accessTokenB64 = params.get('accessToken');
    const refreshTokenB64 = params.get('refreshToken');
    if (!userId || !serverUrlB64 || !accessTokenB64 || !refreshTokenB64) return null;
    return {
      userId,
      serverUrl: atob(serverUrlB64),
      accessToken: atob(accessTokenB64),
      refreshToken: atob(refreshTokenB64),
    };
  } catch {
    return null;
  }
}

/** 本地存储密钥对 */
function getOrCreatePrivateKey(): { privateKey: string; publicKey: string } | null {
  // 简单方案：使用 localStorage 存储。生产环境应使用 keyring
  const stored = localStorage.getItem('hg_keypair');
  if (stored) {
    try { return JSON.parse(stored); } catch { /* regenerate */ }
  }
  // 需要 Web Crypto 生成 X25519 密钥对
  // 浏览器环境不原生支持 X25519，这里用占位提示
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatHandshake(ts: number): string {
  if (ts === 0) return 'never';
  const ago = Math.floor(Date.now() / 1000 - ts);
  if (ago < 60) return `${ago}s ago`;
  if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
  return `${Math.floor(ago / 3600)}h ago`;
}

export default function HuanvaeGuardPage() {
  const [windowData, setWindowData] = useState<WindowData | null>(null);
  const [isWindows, setIsWindows] = useState(false);
  const [serviceRunning, setServiceRunning] = useState(false);
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);
  const [devices, setDevices] = useState<HgDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // Init
  useEffect(() => {
    const data = parseWindowData();
    setWindowData(data);
    platform().then(p => setIsWindows(p === 'windows')).catch(() => {});
  }, []);

  // Check service + load devices
  useEffect(() => {
    if (!windowData) return;

    localApi.checkServiceRunning().then(running => {
      setServiceRunning(running);
      if (running) addLog('Service detected on localhost:19198');
      else addLog('Service not running');
    });

    serverApi.getDevices(windowData.serverUrl, windowData.accessToken)
      .then(d => { setDevices(d); addLog(`Loaded ${d.length} devices`); })
      .catch(e => addLog(`Failed to load devices: ${e}`));
  }, [windowData, addLog]);

  // Poll status when connected
  useEffect(() => {
    if (!serviceRunning) return;
    const poll = async () => {
      try {
        const r = await localApi.getStatus();
        if (r.success && r.data) setTunnelStatus(r.data);
      } catch { /* ignore */ }
    };
    void poll();
    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, [serviceRunning]);

  const handleConnect = async () => {
    if (!windowData || !selectedDeviceId) {
      setError('Please select a device first');
      return;
    }

    const keypair = getOrCreatePrivateKey();
    if (!keypair) {
      setError('No WireGuard keypair found. Please generate a keypair first (Web Crypto X25519 not yet implemented).');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      addLog('Fetching device config...');
      const config = await serverApi.getDeviceConfig(
        windowData.serverUrl, windowData.accessToken, selectedDeviceId
      );
      addLog(`Config: ${config.peers.length} peers, address=${config.address}`);

      addLog('Starting tunnel...');
      const r = await localApi.startTunnel({
        address: config.address,
        private_key: keypair.privateKey,
        peers: config.peers,
        obfuscation: config.obfuscation,
        dns: config.dns ?? undefined,
        mtu: config.mtu,
      });

      if (r.success) {
        addLog('Tunnel started successfully');
      } else {
        setError(r.error ?? 'Unknown error');
        addLog(`Start failed: ${r.error}`);
      }
    } catch (e) {
      setError(String(e));
      addLog(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      const r = await localApi.stopTunnel();
      if (r.success) addLog('Tunnel stopped');
      else addLog(`Stop failed: ${r.error}`);
    } catch (e) {
      addLog(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterDevice = async () => {
    if (!windowData) return;
    const keypair = getOrCreatePrivateKey();
    if (!keypair) {
      setError('No keypair. Web Crypto X25519 generation not yet implemented.');
      return;
    }

    const name = prompt('Device name:');
    if (!name) return;

    setLoading(true);
    try {
      const resp = await serverApi.registerDevice(
        windowData.serverUrl, windowData.accessToken,
        name, keypair.publicKey, 'Windows'
      );
      addLog(`Device registered: ${resp.device_id}, IP: ${resp.virtual_ip}`);
      // Refresh
      const d = await serverApi.getDevices(windowData.serverUrl, windowData.accessToken);
      setDevices(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!windowData) {
    return <div style={{ padding: 20 }}>Loading...</div>;
  }

  const isActive = tunnelStatus?.active ?? false;

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', fontSize: 13, color: '#e0e0e0', background: '#1a1a2e', minHeight: '100vh' }}>
      <h2 style={{ margin: '0 0 16px', color: '#00d4ff' }}>HuanvaeGuard</h2>

      {/* Service status */}
      <div style={{ marginBottom: 12 }}>
        <span style={{ color: serviceRunning ? '#4caf50' : '#f44336' }}>
          {serviceRunning ? '● Service Running' : '● Service Not Running'}
        </span>
        {!isWindows && <span style={{ color: '#ff9800', marginLeft: 12 }}>(Windows only)</span>}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: '#4a1a1a', padding: 8, borderRadius: 4, marginBottom: 12, color: '#ff6b6b' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 8, cursor: 'pointer' }}>dismiss</button>
        </div>
      )}

      {/* Devices */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <strong>Devices</strong>
          <button onClick={handleRegisterDevice} disabled={loading}
            style={{ padding: '2px 8px', cursor: 'pointer' }}>
            + Register
          </button>
        </div>
        {devices.length === 0 ? (
          <div style={{ color: '#888' }}>No devices registered</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {devices.map(d => (
              <label key={d.device_id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: 6,
                background: selectedDeviceId === d.device_id ? '#2a2a4e' : 'transparent',
                borderRadius: 4, cursor: 'pointer',
              }}>
                <input
                  type="radio"
                  name="device"
                  checked={selectedDeviceId === d.device_id}
                  onChange={() => setSelectedDeviceId(d.device_id)}
                />
                <span>{d.device_name}</span>
                <span style={{ color: '#888' }}>{d.virtual_ip}</span>
                <span style={{ color: d.status === 'active' ? '#4caf50' : '#888', fontSize: 11 }}>
                  {d.status}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Connect / Disconnect */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={handleConnect}
          disabled={loading || isActive || !serviceRunning}
          style={{
            padding: '6px 16px', cursor: 'pointer',
            background: '#4caf50', color: '#fff', border: 'none', borderRadius: 4,
            opacity: (loading || isActive || !serviceRunning) ? 0.5 : 1,
          }}
        >
          {loading ? 'Working...' : 'Connect'}
        </button>
        <button
          onClick={handleDisconnect}
          disabled={loading || !isActive}
          style={{
            padding: '6px 16px', cursor: 'pointer',
            background: '#f44336', color: '#fff', border: 'none', borderRadius: 4,
            opacity: (loading || !isActive) ? 0.5 : 1,
          }}
        >
          Disconnect
        </button>
      </div>

      {/* Tunnel status */}
      {tunnelStatus && isActive && (
        <div style={{ background: '#1e1e3a', padding: 12, borderRadius: 6, marginBottom: 16 }}>
          <div><strong>Interface:</strong> {tunnelStatus.interface_name}</div>
          <div><strong>Address:</strong> {tunnelStatus.address}</div>
          <div><strong>Listen Port:</strong> {tunnelStatus.listen_port}</div>
          <div style={{ marginTop: 8 }}>
            <strong>Peers ({tunnelStatus.peers.length})</strong>
            <table style={{ width: '100%', marginTop: 4, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={{ textAlign: 'left', padding: 4 }}>Public Key</th>
                  <th style={{ textAlign: 'left', padding: 4 }}>Endpoint</th>
                  <th style={{ textAlign: 'right', padding: 4 }}>RX</th>
                  <th style={{ textAlign: 'right', padding: 4 }}>TX</th>
                  <th style={{ textAlign: 'right', padding: 4 }}>Handshake</th>
                </tr>
              </thead>
              <tbody>
                {tunnelStatus.peers.map(p => (
                  <tr key={p.public_key} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: 4, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.public_key.substring(0, 16)}...
                    </td>
                    <td style={{ padding: 4 }}>{p.endpoint}</td>
                    <td style={{ padding: 4, textAlign: 'right' }}>{formatBytes(p.rx_bytes)}</td>
                    <td style={{ padding: 4, textAlign: 'right' }}>{formatBytes(p.tx_bytes)}</td>
                    <td style={{ padding: 4, textAlign: 'right' }}>{formatHandshake(p.last_handshake)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Log */}
      <div style={{ background: '#0d0d1a', padding: 8, borderRadius: 4, maxHeight: 200, overflow: 'auto', fontSize: 11, color: '#888' }}>
        {log.map((l, i) => <div key={i}>{l}</div>)}
        {log.length === 0 && <div>Ready</div>}
      </div>
    </div>
  );
}
