/**
 * HuanvaeGuard VPN management page
 *
 * Tabs: Devices | Links | Groups
 * Runs in a dedicated Tauri window.
 *
 * ## Data sources
 *   - Local service (http://127.0.0.1:19198) for tunnel control (start/stop/status)
 *   - Remote HG API (`/api/hg/*`) for device/link/group CRUD, fetched via Tauri
 *     HTTP plugin to bypass browser CORS
 *
 * ## Session handling
 *   Initial tokens arrive via URL query (base64), then kept fresh via Tauri events:
 *     - `session:tokens-updated` (listen) — main app broadcasts on proactive refresh
 *     - `session:request-tokens`  (emit on mount) — ask main app for latest on open
 *   This avoids the stale-token-on-resume problem when the HG window is long-lived.
 *
 * ## Status override
 *   Server `HgDevice.status` relies on heartbeat (not yet wired), so UI overrides
 *   the self device to "online" whenever the local tunnel is active and its
 *   address matches `HgDevice.virtual_ip`.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { platform } from '@tauri-apps/plugin-os';
import { emit, listen } from '@tauri-apps/api/event';
import { formatSize } from '../utils/format';
import { ListEmpty, ListLoading } from '../components/common/ListStates';
import { AppButton } from '../components/common/AppButton';
import { useConfirmDialog } from '../lowcode/components/ConfirmDialog';
import { getDeviceInfo } from '../services/deviceInfo';
import * as localApi from './localApi';
import * as serverApi from './serverApi';
import type {
  TunnelStatus,
  HgDevice,
  HgDeviceLink,
  HgGroup,
  GroupDetail,
  CreateLinkInviteResponse,
} from './types';
import './HuanvaeGuardPage.css';

interface WindowData {
  userId: string;
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
}

type Tab = 'devices' | 'links' | 'groups';

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

function formatHandshake(secondsAgo: number): string {
  // svc API 返回的是"距上次握手的秒数"，不是 Unix 时间戳
  if (secondsAgo === 0) return 'never';
  if (secondsAgo < 60) return `${secondsAgo}s ago`;
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  return `${Math.floor(secondsAgo / 3600)}h ago`;
}

export default function HuanvaeGuardPage() {
  const [windowData, setWindowData] = useState<WindowData | null>(null);
  const [isWindows, setIsWindows] = useState(false);
  const [serviceRunning, setServiceRunning] = useState(false);
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('devices');

  // Devices
  const [devices, setDevices] = useState<HgDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Links
  const [links, setLinks] = useState<HgDeviceLink[]>([]);
  const [pendingInvite, setPendingInvite] = useState<CreateLinkInviteResponse | null>(null);
  const [acceptToken, setAcceptToken] = useState('');
  const [acceptDeviceId, setAcceptDeviceId] = useState('');

  // Groups
  const [groups, setGroups] = useState<HgGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<GroupDetail | null>(null);
  const [groupInviteToken, setGroupInviteToken] = useState('');
  const [acceptGroupToken, setAcceptGroupToken] = useState('');
  const [acceptGroupDeviceId, setAcceptGroupDeviceId] = useState('');

  // UI
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // 复用主应用的确认对话框（替代浏览器原生 confirm()）
  const { confirm, dialogElement: confirmDialog } = useConfirmDialog();

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // Init
  useEffect(() => {
    const data = parseWindowData();
    setWindowData(data);
    try {
      setIsWindows(platform() === 'windows');
    } catch {
      setIsWindows(false);
    }
  }, []);

  const loadDevices = useCallback(async () => {
    if (!windowData) return;
    try {
      const d = await serverApi.getDevices(windowData.serverUrl, windowData.accessToken);
      setDevices(d);
      addLog(`Loaded ${d.length} devices`);
    } catch (e) {
      addLog(`Failed to load devices: ${e}`);
    }
  }, [windowData, addLog]);

  const loadLinks = useCallback(async () => {
    if (!windowData) return;
    try {
      const l = await serverApi.listLinks(windowData.serverUrl, windowData.accessToken);
      setLinks(l);
    } catch (e) {
      addLog(`Failed to load links: ${e}`);
    }
  }, [windowData, addLog]);

  const loadGroups = useCallback(async () => {
    if (!windowData) return;
    try {
      const g = await serverApi.listGroups(windowData.serverUrl, windowData.accessToken);
      setGroups(g);
    } catch (e) {
      addLog(`Failed to load groups: ${e}`);
    }
  }, [windowData, addLog]);

  // Check service + load initial data
  useEffect(() => {
    if (!windowData) return;
    localApi.checkServiceRunning().then(running => {
      setServiceRunning(running);
      if (running) addLog('Service detected on localhost:19198');
      else addLog('Service not running');
    });
    void loadDevices();
  }, [windowData, addLog, loadDevices]);

  // Load tab data on switch
  useEffect(() => {
    if (!windowData) return;
    if (activeTab === 'links') void loadLinks();
    if (activeTab === 'groups') void loadGroups();
  }, [activeTab, windowData, loadLinks, loadGroups]);

  // 订阅主应用 token 刷新事件（跨 Tauri 窗口广播）
  // - 主应用 SessionContext.updateTokens 会 emit `session:tokens-updated`
  // - HG 窗口挂载时 emit `session:request-tokens`，主应用会立即回发当前 token
  // 两种路径合流到同一个监听器，避免 URL 里的 token 陈旧或主应用中途刷新导致 401
  useEffect(() => {
    const unlistenPromise = listen<{ accessToken: string; refreshToken: string }>(
      'session:tokens-updated',
      (event) => {
        setWindowData((prev) => (prev ? {
          ...prev,
          accessToken: event.payload.accessToken,
          refreshToken: event.payload.refreshToken,
        } : prev));
        addLog('Access token synced from main window');
      },
    );
    // 挂载时主动请求一次（处理打开即过期的边界情况）
    void emit('session:request-tokens');
    return () => { void unlistenPromise.then(fn => fn()); };
  }, [addLog]);

  // Poll tunnel status
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

  // Load group detail when selected
  useEffect(() => {
    if (!windowData || !selectedGroupId) {
      setGroupDetail(null);
      return;
    }
    serverApi.getGroupDetail(windowData.serverUrl, windowData.accessToken, selectedGroupId)
      .then(setGroupDetail)
      .catch(e => addLog(`Failed to load group detail: ${e}`));
  }, [windowData, selectedGroupId, addLog]);

  // ─── Handlers: Devices ───

  const handleConnect = async () => {
    if (!windowData || !selectedDeviceId) {
      setError('Please select a device first');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      addLog('Fetching device config...');
      const config = await serverApi.getDeviceConfig(
        windowData.serverUrl, windowData.accessToken, selectedDeviceId,
      );
      if (!config.private_key) {
        setError('Server did not provide private key. Check HG_PSK_KEY env.');
        return;
      }
      addLog(`Config: ${config.peers.length} peers, address=${config.address}`);

      addLog('Starting tunnel...');
      const r = await localApi.startTunnel({
        address: config.address,
        private_key: config.private_key,
        peers: config.peers,
        obfuscation: config.obfuscation,
        dns: config.dns ?? undefined,
        mtu: config.mtu,
      });

      if (r.success) addLog('Tunnel started successfully');
      else {
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
    const name = prompt('Device name:');
    if (!name) return;
    setLoading(true);
    try {
      // 复用主应用的 deviceInfo 服务，把 MAC 作为 device_fingerprint 提交
      // 这样服务端可以做"同设备识别"，避免重复注册或会话冲突
      const { macAddress } = await getDeviceInfo();
      const resp = await serverApi.registerDevice(
        windowData.serverUrl,
        windowData.accessToken,
        name,
        'Windows',
        macAddress ?? undefined,
      );
      addLog(`Device registered: ${resp.device_id}, IP: ${resp.virtual_ip}`);
      await loadDevices();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    if (!windowData) return;
    const ok = await confirm({
      title: 'Delete device',
      message: 'Delete this device? This will remove its config from the server.',
      confirmLabel: 'Delete',
      isDanger: true,
    });
    if (!ok) return;
    try {
      await serverApi.deleteDevice(windowData.serverUrl, windowData.accessToken, deviceId);
      addLog('Device deleted');
      if (selectedDeviceId === deviceId) setSelectedDeviceId(null);
      await loadDevices();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleLockDevice = async (deviceId: string) => {
    if (!windowData) return;
    const endpoint = prompt('Lock to endpoint (IP:port):');
    if (!endpoint) return;
    try {
      await serverApi.lockDevice(windowData.serverUrl, windowData.accessToken, deviceId, endpoint);
      addLog(`Device locked to ${endpoint}`);
      await loadDevices();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleUnlockDevice = async (deviceId: string) => {
    if (!windowData) return;
    try {
      await serverApi.unlockDevice(windowData.serverUrl, windowData.accessToken, deviceId);
      addLog('Device unlocked');
      await loadDevices();
    } catch (e) {
      setError(String(e));
    }
  };

  // ─── Handlers: Links ───

  const handleCreateInvite = async () => {
    if (!windowData || !selectedDeviceId) {
      setError('Select a device on Devices tab first');
      return;
    }
    try {
      const resp = await serverApi.createLinkInvite(
        windowData.serverUrl, windowData.accessToken, selectedDeviceId,
      );
      setPendingInvite(resp);
      addLog(`Invite created: ${resp.invite_token.substring(0, 16)}...`);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAcceptInvite = async () => {
    if (!windowData || !acceptToken || !acceptDeviceId) {
      setError('Enter invite token and select target device');
      return;
    }
    try {
      const resp = await serverApi.acceptLinkInvite(
        windowData.serverUrl, windowData.accessToken, acceptToken, acceptDeviceId,
      );
      addLog(`Link created: ${resp.link_id}`);
      setAcceptToken('');
      await loadLinks();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    if (!windowData) return;
    try {
      await serverApi.deleteLink(windowData.serverUrl, windowData.accessToken, linkId);
      addLog('Link deleted');
      await loadLinks();
    } catch (e) {
      setError(String(e));
    }
  };

  // ─── Handlers: Groups ───

  const handleCreateGroup = async () => {
    if (!windowData) return;
    const name = prompt('Group name:');
    if (!name) return;
    const desc = prompt('Description (optional):') ?? undefined;
    try {
      const resp = await serverApi.createGroup(
        windowData.serverUrl, windowData.accessToken, name, desc,
      );
      addLog(`Group created: ${resp.name} (${resp.group_id})`);
      await loadGroups();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleJoinGroup = async (groupId: string) => {
    if (!windowData || !selectedDeviceId) {
      setError('Select a device on Devices tab first');
      return;
    }
    try {
      const resp = await serverApi.joinGroup(
        windowData.serverUrl, windowData.accessToken, groupId, selectedDeviceId,
      );
      addLog(`Joined group: ${resp.status}`);
      setSelectedGroupId(groupId);
      await loadGroups();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleLeaveGroup = async (groupId: string, deviceId: string) => {
    if (!windowData) return;
    try {
      await serverApi.leaveGroup(windowData.serverUrl, windowData.accessToken, groupId, deviceId);
      addLog('Left group');
      setSelectedGroupId(groupId);
      await loadGroups();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleToggleGroup = async (groupId: string) => {
    if (!windowData) return;
    try {
      const active = await serverApi.toggleGroup(windowData.serverUrl, windowData.accessToken, groupId);
      addLog(`Group ${active ? 'activated' : 'deactivated'}`);
      await loadGroups();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!windowData) return;
    const ok = await confirm({
      title: 'Delete group',
      message: 'Delete this group? Devices in the group will be removed.',
      confirmLabel: 'Delete',
      isDanger: true,
    });
    if (!ok) return;
    try {
      await serverApi.deleteGroup(windowData.serverUrl, windowData.accessToken, groupId);
      addLog('Group deleted');
      if (selectedGroupId === groupId) setSelectedGroupId(null);
      await loadGroups();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleGroupInvite = async (groupId: string) => {
    if (!windowData) return;
    try {
      const resp = await serverApi.createGroupInvite(
        windowData.serverUrl, windowData.accessToken, groupId,
      );
      setGroupInviteToken(resp.invite_token);
      addLog(`Group invite: ${resp.invite_token.substring(0, 16)}...`);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAcceptGroupInvite = async (groupId: string) => {
    if (!windowData || !acceptGroupToken || !acceptGroupDeviceId) {
      setError('Enter invite token and device ID');
      return;
    }
    try {
      await serverApi.acceptGroupInvite(
        windowData.serverUrl, windowData.accessToken,
        groupId, acceptGroupToken, acceptGroupDeviceId,
      );
      addLog('Group invite accepted');
      setAcceptGroupToken('');
      await loadGroups();
    } catch (e) {
      setError(String(e));
    }
  };

  // ─── Render ───

  if (!windowData) {
    return <ListLoading message="Loading..." />;
  }

  const isActive = tunnelStatus?.active ?? false;
  const selectedDevice = devices.find(d => d.device_id === selectedDeviceId);
  // 本机当前隧道 IP（去掉 CIDR 前缀），用于覆盖 server 返回的 offline 状态
  // 服务端状态依赖 heartbeat（目前客户端未发送），但本机隧道在用就是确凿 online
  const localTunnelIp = isActive && tunnelStatus?.address
    ? tunnelStatus.address.split('/')[0]
    : null;
  const isSelfDevice = (d: HgDevice): boolean =>
    localTunnelIp != null && d.virtual_ip === localTunnelIp;
  const displayStatus = (d: HgDevice): string =>
    isSelfDevice(d) ? 'online' : d.status;

  return (
    <div className="hg-page">
      {/* Header */}
      <header className="hg-header">
        <h2 className="hg-title">HuanvaeGuard</h2>
        <span className={`hg-status ${serviceRunning ? 'hg-status-running' : 'hg-status-stopped'}`}>
          <span className="hg-dot" />
          {serviceRunning ? 'Service Running' : 'Service Not Running'}
        </span>
        {!isWindows && <span className="hg-os-hint">Windows only</span>}
      </header>

      {/* Error */}
      {error && (
        <div className="hg-error" role="alert">
          <span className="hg-error-msg">{error}</span>
          <AppButton variant="secondary" size="sm" onClick={() => setError(null)}>dismiss</AppButton>
        </div>
      )}

      {/* Tabs */}
      <nav className="hg-tabs">
        {(['devices', 'links', 'groups'] as Tab[]).map(tab => (
          <button
            key={tab}
            type="button"
            className={`hg-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'devices' ? 'Devices' : tab === 'links' ? 'Links' : 'Groups'}
          </button>
        ))}
      </nav>

      {/* ─── Devices Tab ─── */}
      {activeTab === 'devices' && (
        <>
          <section className="hg-card">
            <div className="hg-section-head">
              <span className="hg-section-title">Devices</span>
              <AppButton variant="secondary" size="sm" onClick={handleRegisterDevice} disabled={loading}>
                + Register
              </AppButton>
            </div>

            {devices.length === 0 ? (
              <ListEmpty message="No devices registered" />
            ) : (
              <div className="hg-device-list">
                {devices.map(d => {
                  const status = displayStatus(d);
                  return (
                    <label key={d.device_id} className={`hg-device-item${selectedDeviceId === d.device_id ? ' selected' : ''}`}>
                      <input type="radio" name="device" checked={selectedDeviceId === d.device_id}
                        onChange={() => setSelectedDeviceId(d.device_id)} />
                      <span className="hg-device-name">{d.device_name}</span>
                      <span className="hg-device-ip">{d.virtual_ip}</span>
                      {isSelfDevice(d) && <span className="hg-device-self">(this device)</span>}
                      <span className={`hg-device-status${status === 'online' ? ' active' : ''}`}>
                        {status}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* Device actions */}
            {selectedDevice && (
              <div className="hg-device-detail">
                {selectedDevice.locked_endpoint && (
                  <span className="hg-detail-badge">Locked: {selectedDevice.locked_endpoint}</span>
                )}
                <div className="hg-btn-row">
                  {selectedDevice.locked_endpoint ? (
                    <AppButton variant="secondary" size="sm"
                      onClick={() => handleUnlockDevice(selectedDevice.device_id)}>Unlock</AppButton>
                  ) : (
                    <AppButton variant="secondary" size="sm"
                      onClick={() => handleLockDevice(selectedDevice.device_id)}>Lock</AppButton>
                  )}
                  <AppButton variant="danger" size="sm"
                    onClick={() => handleDeleteDevice(selectedDevice.device_id)}>Delete</AppButton>
                </div>
              </div>
            )}

            {/* Connect / Disconnect */}
            <div className="hg-btn-row" style={{ marginTop: 16, marginBottom: 0 }}>
              <AppButton variant="primary" size="md"
                loading={loading}
                onClick={handleConnect}
                disabled={isActive || !serviceRunning}>
                Connect
              </AppButton>
              <AppButton variant="danger" size="md"
                onClick={handleDisconnect}
                disabled={loading || !isActive}>
                Disconnect
              </AppButton>
            </div>
          </section>

          {/* Tunnel status */}
          {tunnelStatus && isActive && (
            <section className="hg-card">
              <div className="hg-section-head">
                <span className="hg-section-title">Tunnel</span>
              </div>
              <dl className="hg-tunnel-info">
                <dt>Interface</dt><dd>{tunnelStatus.interface_name}</dd>
                <dt>Address</dt><dd>{tunnelStatus.address}</dd>
                <dt>Listen Port</dt><dd>{tunnelStatus.listen_port}</dd>
              </dl>
              <div className="hg-peers-title">Peers ({tunnelStatus.peers.length})</div>
              <table className="hg-peers-table">
                <thead>
                  <tr>
                    <th>Public Key</th><th>Endpoint</th>
                    <th className="hg-num">RX</th><th className="hg-num">TX</th>
                    <th className="hg-num">Handshake</th>
                  </tr>
                </thead>
                <tbody>
                  {tunnelStatus.peers.map(p => (
                    <tr key={p.public_key}>
                      <td className="hg-pubkey">{p.public_key.substring(0, 16)}...</td>
                      <td>{p.endpoint}</td>
                      <td className="hg-num">{formatSize(p.rx_bytes)}</td>
                      <td className="hg-num">{formatSize(p.tx_bytes)}</td>
                      <td className="hg-num">{formatHandshake(p.last_handshake)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {/* ─── Links Tab ─── */}
      {activeTab === 'links' && (
        <section className="hg-card">
          <div className="hg-section-head">
            <span className="hg-section-title">Device Links</span>
            <AppButton variant="secondary" size="sm" onClick={handleCreateInvite}
              disabled={!selectedDeviceId}>
              Create Invite
            </AppButton>
          </div>

          {pendingInvite && (
            <div className="hg-invite-section">
              <label className="hg-label">Share this invite token:</label>
              <div className="hg-token-display">{pendingInvite.invite_token}</div>
              <span className="hg-hint">Expires: {new Date(pendingInvite.expires_at).toLocaleString()}</span>
            </div>
          )}

          <div className="hg-invite-section">
            <label className="hg-label">Accept an invite</label>
            <div className="hg-input-row">
              <input className="hg-input" placeholder="Invite token" value={acceptToken}
                onChange={e => setAcceptToken(e.target.value)} />
              <select className="hg-input" value={acceptDeviceId}
                onChange={e => setAcceptDeviceId(e.target.value)}>
                <option value="">Select device</option>
                {devices.map(d => (
                  <option key={d.device_id} value={d.device_id}>{d.device_name}</option>
                ))}
              </select>
              <AppButton variant="primary" size="sm"
                onClick={handleAcceptInvite} disabled={!acceptToken || !acceptDeviceId}>
                Accept
              </AppButton>
            </div>
          </div>

          {links.length === 0 ? (
            <ListEmpty message="No links" />
          ) : (
            <table className="hg-peers-table">
              <thead>
                <tr>
                  <th>Device A</th><th>Device B</th><th>Source</th><th></th>
                </tr>
              </thead>
              <tbody>
                {links.map(l => {
                  const nameA = devices.find(d => d.device_id === l.device_a)?.device_name ?? l.device_a.substring(0, 8);
                  const nameB = devices.find(d => d.device_id === l.device_b)?.device_name ?? l.device_b.substring(0, 8);
                  return (
                    <tr key={l.link_id}>
                      <td>{nameA}</td><td>{nameB}</td>
                      <td>{l.link_source}</td>
                      <td>
                        <AppButton variant="danger" size="sm"
                          onClick={() => handleDeleteLink(l.link_id)}>Disconnect</AppButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ─── Groups Tab ─── */}
      {activeTab === 'groups' && (
        <>
          <section className="hg-card">
            <div className="hg-section-head">
              <span className="hg-section-title">Network Groups</span>
              <AppButton variant="secondary" size="sm" onClick={handleCreateGroup}>
                + Create
              </AppButton>
            </div>

            {groups.length === 0 ? (
              <ListEmpty message="No groups" />
            ) : (
              <div className="hg-device-list">
                {groups.map(g => (
                  <div key={g.group_id}
                    className={`hg-group-item${selectedGroupId === g.group_id ? ' selected' : ''}`}
                    onClick={() => setSelectedGroupId(g.group_id === selectedGroupId ? null : g.group_id)}>
                    <span className="hg-group-name">{g.name}</span>
                    <span className={`hg-group-status${g.is_active ? ' active' : ''}`}>
                      {g.is_active ? 'active' : 'inactive'}
                    </span>
                    <div className="hg-group-actions">
                      <AppButton variant="secondary" size="sm"
                        onClick={e => { e.stopPropagation(); handleJoinGroup(g.group_id); }}
                        disabled={!selectedDeviceId}>
                        Join
                      </AppButton>
                      <AppButton variant="secondary" size="sm"
                        onClick={e => { e.stopPropagation(); handleGroupInvite(g.group_id); }}>
                        Invite
                      </AppButton>
                      <AppButton variant="secondary" size="sm"
                        onClick={e => { e.stopPropagation(); handleToggleGroup(g.group_id); }}>
                        Toggle
                      </AppButton>
                      <AppButton variant="danger" size="sm"
                        onClick={e => { e.stopPropagation(); handleDeleteGroup(g.group_id); }}>
                        Delete
                      </AppButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Group invite section */}
          {groupInviteToken && (
            <section className="hg-card">
              <div className="hg-invite-section">
                <label className="hg-label">Group invite token:</label>
                <div className="hg-token-display">{groupInviteToken}</div>
              </div>
            </section>
          )}

          {/* Accept group invite */}
          {selectedGroupId && (
            <section className="hg-card">
              <div className="hg-section-head">
                <span className="hg-section-title">Accept Group Invite</span>
              </div>
              <div className="hg-input-row">
                <input className="hg-input" placeholder="Group invite token" value={acceptGroupToken}
                  onChange={e => setAcceptGroupToken(e.target.value)} />
                <select className="hg-input" value={acceptGroupDeviceId}
                  onChange={e => setAcceptGroupDeviceId(e.target.value)}>
                  <option value="">Select device</option>
                  {devices.map(d => (
                    <option key={d.device_id} value={d.device_id}>{d.device_name}</option>
                  ))}
                </select>
                <AppButton variant="primary" size="sm"
                  onClick={() => handleAcceptGroupInvite(selectedGroupId)}
                  disabled={!acceptGroupToken || !acceptGroupDeviceId}>
                  Accept
                </AppButton>
              </div>
            </section>
          )}

          {/* Group detail */}
          {groupDetail && (
            <section className="hg-card">
              <div className="hg-section-head">
                <span className="hg-section-title">{groupDetail.group.name} — Devices</span>
              </div>
              {groupDetail.group.description && (
                <p className="hg-group-desc">{groupDetail.group.description}</p>
              )}
              {groupDetail.devices.length === 0 ? (
                <ListEmpty message="No devices in group" />
              ) : (
                <table className="hg-peers-table">
                  <thead>
                    <tr><th>Device</th><th>VPN IP</th><th>Status</th><th></th></tr>
                  </thead>
                  <tbody>
                    {groupDetail.devices.map(d => (
                      <tr key={d.device_id}>
                        <td>{devices.find(dev => dev.device_id === d.device_id)?.device_name ?? d.device_id.substring(0, 8)}</td>
                        <td>{d.virtual_ip}</td>
                        <td>{d.status ?? 'unknown'}</td>
                        <td>
                          <AppButton variant="danger" size="sm"
                            onClick={() => handleLeaveGroup(groupDetail.group.group_id, d.device_id)}>
                            Leave
                          </AppButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </>
      )}

      {/* Log panel */}
      <div className="hg-log">
        {log.length === 0 ? (
          <div className="hg-log-empty">Ready</div>
        ) : (
          log.map((l, i) => (
            <div key={i} className="hg-log-line">{l}</div>
          ))
        )}
      </div>

      {/* 共享 confirm 对话框（取代浏览器原生 confirm()）*/}
      {confirmDialog}
    </div>
  );
}
