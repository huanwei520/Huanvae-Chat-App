/**
 * HuanvaeGuard VPN 管理页面
 *
 * 配色与设置面板统一，变量来源：variables.css + ThemeProvider
 * Tab 切换：设备 / 链接 / 群组
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { platform } from '@tauri-apps/plugin-os';
import { invoke } from '@tauri-apps/api/core';
import * as localApi from './localApi';
import { createHgApiClient, type HgApiClient } from './serverApi';
import { getOrCreateKeyPair } from './crypto';
import { createTopologySync, type TopologySyncHandle } from './topologySync';
import type {
  TunnelStatus, HgDevice, HgDeviceLink, HgGroup, HgGroupDetail, TopologyPeer,
} from './types';
import './HuanvaeGuard.css';

type TabKey = 'devices' | 'links' | 'groups';

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

function formatTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function HuanvaeGuardPage() {
  const [windowData] = useState<WindowData | null>(() => parseWindowData());
  const [isWindows] = useState(() => { try { return platform() === 'windows'; } catch { return false; } });
  const [serviceRunning, setServiceRunning] = useState(false);
  const [serviceStarting, setServiceStarting] = useState(false);
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('devices');

  // 设备
  const [devices, setDevices] = useState<HgDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // 链接
  const [links, setLinks] = useState<HgDeviceLink[]>([]);

  // 群组
  const [groups, setGroups] = useState<HgGroup[]>([]);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<HgGroupDetail | null>(null);

  // 在线拓扑（仅 UI 展示）
  const [onlinePeers, setOnlinePeers] = useState<TopologyPeer[]>([]);

  // 邀请 token 展示
  const [inviteToken, setInviteToken] = useState<{ token: string; expiresAt: string; type: string; groupId?: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const topoRef = useRef<TopologySyncHandle | null>(null);
  const svcPollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const startedRef = useRef(false);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const api = useMemo<HgApiClient | null>(() => {
    if (!windowData) return null;
    return createHgApiClient({
      serverUrl: windowData.serverUrl,
      accessToken: windowData.accessToken,
      refreshToken: windowData.refreshToken,
      onTokenRefresh: (a, r) => addLog(`Token 已刷新: ${a.slice(0, 8)}… / ${r.slice(0, 8)}…`),
      onSessionExpired: () => { setError('会话已过期，请关闭窗口重新打开'); addLog('会话已过期'); },
    });
  }, [windowData, addLog]);

  // ─── 服务启动 ───
  const startService = useCallback(async () => {
    setServiceStarting(true);
    try {
      const msg = await invoke<string>('start_hg_service');
      addLog(msg);
    } catch (e) {
      addLog(`启动失败: ${e}`);
      setServiceStarting(false);
      return;
    }
    let attempts = 0;
    const maxAttempts = 30;
    svcPollRef.current = setInterval(async () => {
      attempts++;
      const ready = await localApi.checkServiceRunning();
      if (ready || attempts >= maxAttempts) {
        clearInterval(svcPollRef.current);
        svcPollRef.current = undefined;
        setServiceStarting(false);
        setServiceRunning(ready);
        addLog(ready ? '服务已就绪' : '服务启动超时，请确认 UAC 弹窗并允许');
      }
    }, 1000);
  }, [addLog]);

  // ─── 初始化 ───
  useEffect(() => {
    if (!api) return;
    if (startedRef.current) return;
    startedRef.current = true;

    const init = async () => {
      const running = await localApi.checkServiceRunning();
      if (running) {
        setServiceRunning(true);
        addLog('Service detected on localhost:19198');
      } else if (isWindows) {
        addLog('服务未运行，正在自动启动…');
        void startService();
      } else {
        addLog('Service not running (non-Windows platform)');
      }
      api.getDevices()
        .then(d => { setDevices(d); addLog(`Loaded ${d.length} devices`); })
        .catch(e => addLog(`Failed to load devices: ${e}`));
    };
    void init();

    return () => {
      if (svcPollRef.current) { clearInterval(svcPollRef.current); svcPollRef.current = undefined; }
    };
  }, [api, addLog, isWindows, startService]);

  // ─── 隧道状态轮询 ───
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

  useEffect(() => {
    return () => { topoRef.current?.stop(); };
  }, []);

  // ─── Tab 切换时加载数据 ───
  useEffect(() => {
    if (!api) return;
    if (activeTab === 'links') {
      api.getLinks().then(setLinks).catch(e => addLog(`加载链接失败: ${e}`));
    } else if (activeTab === 'groups') {
      api.getGroups().then(setGroups).catch(e => addLog(`加载群组失败: ${e}`));
    }
  }, [api, activeTab, addLog]);

  // ─── 连接/断开 ───
  const handleConnect = useCallback(async () => {
    if (!api || !selectedDeviceId) { setError('请先选择一个设备'); return; }
    const keypair = getOrCreateKeyPair();
    setLoading(true);
    setError(null);
    try {
      addLog('获取设备配置…');
      const config = await api.getDeviceConfig(selectedDeviceId);
      addLog(`配置: ${config.peers.length} peers, address=${config.address}`);

      const doStart = async () => localApi.startTunnel({
        address: config.address,
        private_key: keypair.privateKey,
        peers: config.peers,
        obfuscation: config.obfuscation,
        dns: config.dns ?? undefined,
        mtu: config.mtu,
      });

      addLog('创建隧道…');
      let r = await doStart();

      if (!r.success) {
        const err = r.error ?? '';
        const isPipeBusy = err.includes('231') || err.includes('管道') || err.includes('pipe') || err.includes('adapter');
        if (isPipeBusy) {
          addLog('检测到管道冲突，正在重启服务…');
          try {
            const msg = await invoke<string>('restart_hg_service');
            addLog(msg);
            await new Promise(resolve => setTimeout(resolve, 3000));
            addLog('重试创建隧道…');
            r = await doStart();
          } catch (e) {
            addLog(`服务重启失败: ${e}`);
          }
        }
      }

      if (r.success) {
        addLog('隧道已启动');
        topoRef.current?.stop();
        const sync = createTopologySync({
          api,
          deviceId: selectedDeviceId,
          onLog: addLog,
          onTopologyUpdated: (peers) => setOnlinePeers(peers),
        });
        topoRef.current = sync;
        sync.start();
      } else {
        setError(r.error ?? '未知错误');
        addLog(`启动失败: ${r.error}`);
      }
    } catch (e) {
      setError(String(e));
      addLog(`错误: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [api, selectedDeviceId, addLog]);

  const handleDisconnect = useCallback(async () => {
    setLoading(true);
    try {
      topoRef.current?.stop();
      topoRef.current = null;
      setOnlinePeers([]);
      const r = await localApi.stopTunnel();
      addLog(r.success ? '隧道已停止，等待管道释放…' : `停止失败: ${r.error}`);
      if (r.success) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        addLog('就绪');
      }
    } catch (e) {
      addLog(`错误: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [addLog]);

  // ─── 设备操作 ───
  const handleRegisterDevice = useCallback(async () => {
    if (!api) return;
    const keypair = getOrCreateKeyPair();
    const name = prompt('设备名称:');
    if (!name) return;
    setLoading(true);
    try {
      const resp = await api.registerDevice(name, keypair.publicKey, 'Windows');
      addLog(`设备已注册: ${resp.device_id}, IP: ${resp.virtual_ip}`);
      setDevices(await api.getDevices());
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [api, addLog]);

  const handleDeleteDevice = useCallback(async (deviceId: string) => {
    if (!api || !confirm('确定删除此设备？如设备正在连接中，请先断开隧道。')) return;
    const isActive = tunnelStatus?.active && selectedDeviceId === deviceId;
    if (isActive) {
      setError('请先断开当前设备的隧道连接后再删除');
      return;
    }
    setLoading(true);
    try {
      await api.deleteDevice(deviceId);
      addLog(`设备已删除: ${deviceId.slice(0, 8)}…`);
      setDevices(await api.getDevices());
      if (selectedDeviceId === deviceId) setSelectedDeviceId(null);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('500') || msg.includes('内部')) {
        setError(`删除失败: 服务器内部错误，该设备可能仍有活跃连接或关联的链接/群组，请先清理后重试`);
      } else {
        setError(msg);
      }
      addLog(`删除设备失败: ${msg}`);
    } finally { setLoading(false); }
  }, [api, selectedDeviceId, tunnelStatus, addLog]);

  const handleLockDevice = useCallback(async (deviceId: string) => {
    if (!api) return;
    const endpoint = prompt('输入设备当前 endpoint（如 1.2.3.4:51820）:');
    if (!endpoint) return;
    setLoading(true);
    try {
      const result = await api.lockDevice(deviceId, endpoint);
      addLog(`设备已锁定, PSK: ${result.psk.slice(0, 12)}…`);
      setDevices(await api.getDevices());
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [api, addLog]);

  const handleUnlockDevice = useCallback(async (deviceId: string) => {
    if (!api || !confirm('确定解锁此设备？')) return;
    setLoading(true);
    try {
      await api.unlockDevice(deviceId);
      addLog('设备已解锁');
      setDevices(await api.getDevices());
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [api, addLog]);

  // ─── 链接操作 ───
  const handleCreateInvite = useCallback(async () => {
    if (!api || !selectedDeviceId) { setError('请先在"设备"页选择一个设备'); return; }
    setLoading(true);
    try {
      const resp = await api.createInvite(selectedDeviceId);
      try { await navigator.clipboard.writeText(resp.invite_token); } catch { /* clipboard may fail */ }
      setInviteToken({ token: resp.invite_token, expiresAt: resp.expires_at, type: '设备邀请' });
      addLog(`邀请已创建 (过期: ${formatTime(resp.expires_at)})`);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [api, selectedDeviceId, addLog]);

  const handleAcceptInvite = useCallback(async () => {
    if (!api || !selectedDeviceId) { setError('请先在"设备"页选择一个设备'); return; }
    const token = prompt('粘贴邀请 Token:');
    if (!token) return;
    setLoading(true);
    try {
      const resp = await api.acceptInvite(token.trim(), selectedDeviceId);
      addLog(`链接已建立: ${resp.link_id.slice(0, 8)}…`);
      setLinks(await api.getLinks());
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [api, selectedDeviceId, addLog]);

  const handleDeleteLink = useCallback(async (linkId: string) => {
    if (!api || !confirm('确定断开此链接？')) return;
    try {
      await api.deleteLink(linkId);
      addLog('链接已断开');
      setLinks(await api.getLinks());
    } catch (e) { setError(String(e)); }
  }, [api, addLog]);

  // ─── 群组操作 ───
  const handleCreateGroup = useCallback(async () => {
    if (!api) return;
    const name = prompt('群组名称:');
    if (!name) return;
    const desc = prompt('群组描述 (可选):') || undefined;
    setLoading(true);
    try {
      const resp = await api.createGroup(name, desc);
      addLog(`群组已创建: ${resp.name}`);
      setGroups(await api.getGroups());
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [api, addLog]);

  const handleToggleGroupDetail = useCallback(async (groupId: string) => {
    if (!api) return;
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null);
      setGroupDetail(null);
      return;
    }
    try {
      const detail = await api.getGroupDetail(groupId);
      setGroupDetail(detail);
      setExpandedGroupId(groupId);
    } catch (e) { addLog(`加载群组详情失败: ${e}`); }
  }, [api, expandedGroupId, addLog]);

  const handleJoinGroup = useCallback(async (groupId: string) => {
    if (!api || !selectedDeviceId) { setError('请先在"设备"页选择一个设备'); return; }
    setLoading(true);
    try {
      const resp = await api.joinGroup(groupId, selectedDeviceId);
      addLog(`已加入群组, 待同步 peers: ${resp.pending_peers}`);
      setGroups(await api.getGroups());
      if (expandedGroupId === groupId) {
        const detail = await api.getGroupDetail(groupId);
        setGroupDetail(detail);
      }
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [api, selectedDeviceId, expandedGroupId, addLog]);

  const handleLeaveGroup = useCallback(async (groupId: string) => {
    if (!api || !selectedDeviceId || !confirm('确定退出此群组？')) return;
    try {
      await api.leaveGroup(groupId, selectedDeviceId);
      addLog('已退出群组');
      setGroups(await api.getGroups());
      if (expandedGroupId === groupId) {
        const detail = await api.getGroupDetail(groupId);
        setGroupDetail(detail);
      }
    } catch (e) { setError(String(e)); }
  }, [api, selectedDeviceId, expandedGroupId, addLog]);

  const handleToggleGroup = useCallback(async (groupId: string) => {
    if (!api) return;
    try {
      const active = await api.toggleGroup(groupId);
      addLog(`群组已${active ? '启用' : '停用'}`);
      setGroups(await api.getGroups());
    } catch (e) { setError(String(e)); }
  }, [api, addLog]);

  const handleDeleteGroup = useCallback(async (groupId: string) => {
    if (!api || !confirm('确定解散此群组？此操作不可撤销。')) return;
    try {
      await api.deleteGroup(groupId);
      addLog('群组已解散');
      setGroups(await api.getGroups());
      if (expandedGroupId === groupId) { setExpandedGroupId(null); setGroupDetail(null); }
    } catch (e) { setError(String(e)); }
  }, [api, expandedGroupId, addLog]);

  const handleCreateGroupInvite = useCallback(async (groupId: string) => {
    if (!api) return;
    setLoading(true);
    try {
      const resp = await api.createGroupInvite(groupId);
      try { await navigator.clipboard.writeText(resp.invite_token); } catch { /* clipboard may fail */ }
      setInviteToken({ token: resp.invite_token, expiresAt: resp.expires_at, type: '群组邀请', groupId });
      addLog(`群组邀请已创建 (过期: ${formatTime(resp.expires_at)})`);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [api, addLog]);

  const handleAcceptGroupInvite = useCallback(async (groupId?: string) => {
    if (!api || !selectedDeviceId) { setError('请先在"设备"页选择一个设备'); return; }
    const token = prompt('粘贴群组邀请 Token:');
    if (!token) return;
    const gid = groupId || prompt('输入群组 ID:');
    if (!gid) return;
    setLoading(true);
    try {
      const resp = await api.acceptGroupInvite(gid.trim(), token.trim(), selectedDeviceId);
      addLog(`已通过邀请加入群组, 待同步 peers: ${resp.pending_peers}`);
      setGroups(await api.getGroups());
      if (expandedGroupId === gid) {
        const detail = await api.getGroupDetail(gid);
        setGroupDetail(detail);
      }
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [api, selectedDeviceId, expandedGroupId, addLog]);

  if (!windowData || !api) {
    return <div className="hg-page"><p>加载中…</p></div>;
  }

  const isActive = tunnelStatus?.active ?? false;
  const selectedDevice = devices.find(d => d.device_id === selectedDeviceId);

  return (
    <div className="hg-page">
      <h2>HuanvaeGuard</h2>

      {/* 服务状态 */}
      <div className="hg-service-status">
        <span className={`hg-status-dot ${serviceRunning ? 'running' : serviceStarting ? 'starting' : 'stopped'}`} />
        <span>{serviceRunning ? '服务运行中' : serviceStarting ? '正在启动服务…' : '服务未运行'}</span>
        {!isWindows && <span className="hg-platform-warn">(仅 Windows 可用)</span>}
        {!serviceRunning && !serviceStarting && isWindows && (
          <button className="hg-btn hg-btn-sm" onClick={() => void startService()}>启动服务</button>
        )}
      </div>

      {/* 错误 */}
      {error && (
        <div className="hg-error">
          <span>{error}</span>
          <button className="hg-error-dismiss" onClick={() => setError(null)}>关闭</button>
        </div>
      )}

      {/* 邀请 Token 展示 */}
      {inviteToken && (
        <div className="hg-invite-card">
          <div className="hg-invite-header">
            <strong>{inviteToken.type}</strong>
            <span className="hg-invite-expires">过期: {formatTime(inviteToken.expiresAt)}</span>
            <button className="hg-error-dismiss" onClick={() => setInviteToken(null)}>关闭</button>
          </div>
          {inviteToken.groupId && (
            <div className="hg-invite-token-row">
              <span className="hg-invite-label">群组 ID</span>
              <code className="hg-invite-token">{inviteToken.groupId}</code>
              <button
                className="hg-btn hg-btn-sm"
                onClick={() => { void navigator.clipboard.writeText(inviteToken.groupId!); addLog('群组 ID 已复制'); }}
              >
                复制
              </button>
            </div>
          )}
          <div className="hg-invite-token-row">
            <span className="hg-invite-label">Token</span>
            <code className="hg-invite-token">{inviteToken.token}</code>
            <button
              className="hg-btn hg-btn-sm"
              onClick={() => { void navigator.clipboard.writeText(inviteToken.token); addLog('Token 已复制'); }}
            >
              复制
            </button>
          </div>
        </div>
      )}

      {/* 连接/断开 */}
      <div className="hg-actions">
        <button
          className="hg-btn-connect"
          onClick={() => void handleConnect()}
          disabled={loading || isActive || !serviceRunning || !selectedDeviceId}
        >
          {loading ? '处理中…' : '连接'}
        </button>
        <button
          className="hg-btn-disconnect"
          onClick={() => void handleDisconnect()}
          disabled={loading || !isActive}
        >
          断开
        </button>
        {selectedDevice && (
          <span className="hg-selected-device">
            当前设备: {selectedDevice.device_name} ({selectedDevice.virtual_ip})
          </span>
        )}
      </div>

      {/* 隧道状态 */}
      {tunnelStatus && isActive && (
        <div className="hg-tunnel-status">
          <div className="hg-tunnel-info">
            <div><strong>接口:</strong> {tunnelStatus.interface_name}</div>
            <div><strong>地址:</strong> {tunnelStatus.address}</div>
            <div><strong>端口:</strong> {tunnelStatus.listen_port}</div>
          </div>
          <div style={{ marginTop: 8 }}>
            <strong>Peers ({tunnelStatus.peers.length})</strong>
            <table className="hg-peer-table">
              <thead>
                <tr>
                  <th>Public Key</th>
                  <th>Endpoint</th>
                  <th className="right">RX</th>
                  <th className="right">TX</th>
                  <th className="right">Handshake</th>
                </tr>
              </thead>
              <tbody>
                {tunnelStatus.peers.map(p => (
                  <tr key={p.public_key}>
                    <td className="key">{p.public_key.substring(0, 16)}…</td>
                    <td>{p.endpoint}</td>
                    <td className="right">{formatBytes(p.rx_bytes)}</td>
                    <td className="right">{formatBytes(p.tx_bytes)}</td>
                    <td className="right">{formatHandshake(p.last_handshake)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 在线设备（拓扑 — 仅 UI 展示） */}
      {isActive && onlinePeers.length > 0 && (
        <div className="hg-tunnel-status">
          <strong>在线设备 ({onlinePeers.length})</strong>
          <table className="hg-peer-table">
            <thead>
              <tr>
                <th>设备 ID</th>
                <th>虚拟 IP</th>
                <th>Endpoint</th>
                <th>同节点</th>
              </tr>
            </thead>
            <tbody>
              {onlinePeers.map(p => (
                <tr key={p.device_id}>
                  <td className="key">{p.device_id.slice(0, 8)}…</td>
                  <td>{p.virtual_ip}</td>
                  <td>{p.endpoint ?? '-'}</td>
                  <td>{p.is_same_node ? '是' : '否'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="hg-tabs">
        {(['devices', 'links', 'groups'] as TabKey[]).map(tab => (
          <button
            key={tab}
            className={`hg-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {{ devices: '设备', links: '链接', groups: '群组' }[tab]}
          </button>
        ))}
      </div>

      {/* ─── 设备 Tab ─── */}
      {activeTab === 'devices' && (
        <div className="hg-tab-panel">
          <div className="hg-section-header">
            <span className="hg-section-title">设备列表</span>
            <button className="hg-btn" onClick={handleRegisterDevice} disabled={loading}>+ 注册</button>
          </div>
          {devices.length === 0 ? (
            <div className="hg-empty">暂无注册设备</div>
          ) : (
            <div className="hg-device-list">
              {devices.map(d => (
                <div
                  key={d.device_id}
                  className={`hg-device-item${selectedDeviceId === d.device_id ? ' selected' : ''}`}
                >
                  <label className="hg-device-label">
                    <input
                      type="radio"
                      name="device"
                      checked={selectedDeviceId === d.device_id}
                      onChange={() => setSelectedDeviceId(d.device_id)}
                    />
                    <span className="hg-device-name">{d.device_name}</span>
                    <span className="hg-device-ip">{d.virtual_ip}</span>
                    <span className={`hg-device-status ${d.status === 'active' ? 'active' : 'inactive'}`}>
                      {d.status}
                    </span>
                  </label>
                  <div className="hg-device-ops">
                    {d.locked_endpoint ? (
                      <>
                        <span className="hg-device-locked" title={`锁定于 ${d.locked_endpoint}`}>🔒</span>
                        <button className="hg-btn hg-btn-sm" onClick={() => void handleUnlockDevice(d.device_id)}>
                          解锁
                        </button>
                      </>
                    ) : (
                      <button className="hg-btn hg-btn-sm" onClick={() => void handleLockDevice(d.device_id)}>
                        锁定
                      </button>
                    )}
                    <button className="hg-device-delete" onClick={() => void handleDeleteDevice(d.device_id)}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── 链接 Tab ─── */}
      {activeTab === 'links' && (
        <div className="hg-tab-panel">
          <div className="hg-section-header">
            <span className="hg-section-title">设备链接</span>
            <button className="hg-btn" onClick={handleCreateInvite} disabled={loading || !selectedDeviceId}>
              + 创建邀请
            </button>
            <button className="hg-btn" onClick={handleAcceptInvite} disabled={loading || !selectedDeviceId}>
              接受邀请
            </button>
          </div>
          {!selectedDeviceId && (
            <div className="hg-hint">请先在"设备"页选择一个设备后再操作链接</div>
          )}
          {links.length === 0 ? (
            <div className="hg-empty">暂无设备链接</div>
          ) : (
            <div className="hg-link-list">
              {links.map(l => (
                <div key={l.link_id} className="hg-link-item">
                  <div className="hg-link-info">
                    <span className="hg-link-devices">
                      {l.device_a.slice(0, 8)}… ↔ {l.device_b.slice(0, 8)}…
                    </span>
                    <span className="hg-link-source">{l.link_source}</span>
                    <span className="hg-link-time">{formatTime(l.created_at)}</span>
                  </div>
                  <button className="hg-device-delete" onClick={() => void handleDeleteLink(l.link_id)}>
                    断开
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── 群组 Tab ─── */}
      {activeTab === 'groups' && (
        <div className="hg-tab-panel">
          <div className="hg-section-header">
            <span className="hg-section-title">群组管理</span>
            <button className="hg-btn" onClick={handleCreateGroup} disabled={loading}>+ 创建群组</button>
            <button className="hg-btn" onClick={() => void handleAcceptGroupInvite()} disabled={loading || !selectedDeviceId}>
              接受群组邀请
            </button>
          </div>
          {groups.length === 0 ? (
            <div className="hg-empty">暂无群组</div>
          ) : (
            <div className="hg-group-list">
              {groups.map(g => (
                <div key={g.group_id} className="hg-group-card">
                  <div className="hg-group-header" onClick={() => void handleToggleGroupDetail(g.group_id)}>
                    <div className="hg-group-title">
                      <span className={`hg-group-active-dot ${g.is_active ? 'on' : 'off'}`} />
                      <strong>{g.name}</strong>
                      <span className="hg-group-id" title={g.group_id}>{g.group_id.slice(0, 8)}…</span>
                      {g.description && <span className="hg-group-desc">{g.description}</span>}
                    </div>
                    <span className="hg-group-chevron">{expandedGroupId === g.group_id ? '▾' : '▸'}</span>
                  </div>

                  {expandedGroupId === g.group_id && groupDetail && (
                    <div className="hg-group-body">
                      <div className="hg-group-id-full">
                        <span className="hg-invite-label">群组 ID</span>
                        <code className="hg-invite-token">{g.group_id}</code>
                        <button
                          className="hg-btn hg-btn-sm"
                          onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(g.group_id); addLog('群组 ID 已复制'); }}
                        >
                          复制
                        </button>
                      </div>
                      <div className="hg-group-actions">
                        <button className="hg-btn hg-btn-sm" onClick={() => void handleJoinGroup(g.group_id)} disabled={!selectedDeviceId}>
                          加入
                        </button>
                        <button className="hg-btn hg-btn-sm" onClick={() => void handleLeaveGroup(g.group_id)} disabled={!selectedDeviceId}>
                          退出
                        </button>
                        <button className="hg-btn hg-btn-sm" onClick={() => void handleCreateGroupInvite(g.group_id)}>
                          创建邀请
                        </button>
                        <button className="hg-btn hg-btn-sm" onClick={() => void handleAcceptGroupInvite(g.group_id)} disabled={!selectedDeviceId}>
                          接受邀请
                        </button>
                        {g.owner_id === windowData.userId && (
                          <>
                            <button className="hg-btn hg-btn-sm" onClick={() => void handleToggleGroup(g.group_id)}>
                              {g.is_active ? '停用' : '启用'}
                            </button>
                            <button className="hg-btn hg-btn-sm hg-btn-danger" onClick={() => void handleDeleteGroup(g.group_id)}>
                              解散
                            </button>
                          </>
                        )}
                      </div>

                      <div className="hg-group-members">
                        <strong>成员 ({groupDetail.devices.length})</strong>
                        {groupDetail.devices.length === 0 ? (
                          <div className="hg-empty">暂无成员设备</div>
                        ) : (
                          <table className="hg-peer-table">
                            <thead>
                              <tr>
                                <th>设备 ID</th>
                                <th>虚拟 IP</th>
                                <th>Endpoint</th>
                                <th>状态</th>
                                <th>最后心跳</th>
                              </tr>
                            </thead>
                            <tbody>
                              {groupDetail.devices.map(d => (
                                <tr key={d.device_id}>
                                  <td className="key">{d.device_id.slice(0, 8)}…</td>
                                  <td>{d.virtual_ip}</td>
                                  <td>{d.endpoint ?? '-'}</td>
                                  <td>
                                    <span className={`hg-device-status ${d.status === 'active' ? 'active' : 'inactive'}`}>
                                      {d.status ?? '-'}
                                    </span>
                                  </td>
                                  <td>{formatTime(d.last_heartbeat ?? null)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 日志 */}
      <div className="hg-log">
        {log.map((l, i) => <div key={i}>{l}</div>)}
        {log.length === 0 && <div>Ready</div>}
      </div>
    </div>
  );
}
