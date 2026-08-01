/**
 * HuanvaeGuard VPN management page
 *
 * Tabs: 设备 | 链接 | 群组
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
 *
 * ## Group join flow
 *   Joining a group is **only** via invitation: the inviter creates an invite
 *   (returns groupId + invite_token), shares both, the invitee pastes them at the
 *   top "通过邀请加入群组" form. No self-join button on group cards (they're already
 *   visible to the user — clicking "join" would be meaningless).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { platform } from '@tauri-apps/plugin-os';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { formatSize } from '../utils/format';
import { formatHandshake, osLabel } from './format';
import { ListEmpty, ListLoading } from '../components/common/ListStates';
import { AppButton } from '../components/common/AppButton';
import { useConfirmDialog, usePromptDialog } from '../lowcode/components/ConfirmDialog';
import { SecretDisplay } from '../components/common/SecretDisplay';
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
  /** macOS 开窗前 hg_ensure_installed 的失败原因（明文，由 openHuanvaeGuardWindow 透传）；无失败为 null */
  installError: string | null;
}

type Tab = 'devices' | 'links' | 'groups';

interface GroupInviteDisplay {
  groupId: string;
  token: string;
  expiresAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  online: '在线',
  offline: '离线',
  unknown: '未知',
};

const LINK_SOURCE_LABELS: Record<string, string> = {
  manual: '手动',
  invite: '邀请',
  group: '群组',
};

/** 常驻状态复查节拍（ms）：探活的唯一定时来源 */
const POLL_INTERVAL_MS = 3000;

// launchctl bootstrap 只是把 job **提交**给 launchd，返回时守护进程还没绑好端口 ——
// 修复后零等待探活必然读到 false，故按 500/1000/2000/4000ms 退避重试。
// 注意这张表只是**加速**表：它的作用仅仅是让用户点完「修复」后更快看到结论，正确性不依赖它。
// 退避预算耗尽也没关系 —— 常驻单飞探活从不停摆，晚于预算才起来的守护进程最多一拍就被接上。
const REPAIR_BACKOFF_MS = [500, 1000, 2000, 4000] as const;

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function localizeStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function localizeLinkSource(source: string): string {
  return LINK_SOURCE_LABELS[source] ?? source;
}

// macOS 三态：未安装 / 已安装未运行 / 运行中。Windows 的服务由 Tauri 进程生命周期
// 管理、没有"安装"这一步，仍沿用两态文案。
function serviceStatusLabel(os: string, running: boolean, isInstalled: boolean): string {
  if (running) { return '服务运行中'; }
  if (os !== 'macos') { return '服务未运行'; }
  return isInstalled ? '已安装未运行' : '未安装';
}

function parseWindowData(): WindowData | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const serverUrlB64 = params.get('serverUrl');
    const accessTokenB64 = params.get('accessToken');
    const refreshTokenB64 = params.get('refreshToken');
    if (!userId || !serverUrlB64 || !accessTokenB64 || !refreshTokenB64) { return null; }
    return {
      userId,
      serverUrl: atob(serverUrlB64),
      accessToken: atob(accessTokenB64),
      refreshToken: atob(refreshTokenB64),
      // 可选：仅 macOS 安装失败时才带；缺失不影响窗口数据有效性，故不进上面的必填校验
      installError: params.get('installError'),
    };
  } catch {
    return null;
  }
}

export default function HuanvaeGuardPage() {
  const [windowData, setWindowData] = useState<WindowData | null>(null);
  const [osPlatform, setOsPlatform] = useState<string>('');
  const [serviceRunning, setServiceRunning] = useState(false);
  // 「文件是否装好」与「守护进程是否在跑」是两件事：半装态 = installed && !serviceRunning
  const [installed, setInstalled] = useState(false);
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
  const [groupInvite, setGroupInvite] = useState<GroupInviteDisplay | null>(null);
  const [acceptGroupId, setAcceptGroupId] = useState('');
  const [acceptGroupToken, setAcceptGroupToken] = useState('');
  const [acceptGroupDeviceId, setAcceptGroupDeviceId] = useState('');

  // UI
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  /** 在途探活（单飞）：同一时刻最多一个 /api/tunnel/status 请求 */
  const probeInFlightRef = useRef<Promise<boolean> | null>(null);
  /** 上次已写进日志的服务状态；只在跃迁时记一行，避免每 3 秒刷屏 */
  const lastLoggedRunningRef = useRef<boolean | null>(null);
  /** handleRepair 退避耗尽时写下的提示原文；服务真起来后按原文比对精确收掉 */
  const repairHintRef = useRef<string | null>(null);
  // 复用主应用的对话框（替代浏览器原生 confirm()/prompt()）
  const { confirm, dialogElement: confirmDialog } = useConfirmDialog();
  const { prompt: showPrompt, dialogElement: promptDialog } = usePromptDialog();

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // ── 探活唯一权威 ──────────────────────────────────────────────────────────
  // serviceRunning / tunnelStatus 只能由这里写。之前有三个互不协调的写者（挂载 effect、
  // 3s 轮询、handleRepair），彼此无序：慢响应回来时旧结果会盖掉新结果，一次令牌刷新也会
  // 顺带重探一次。现在收敛成一个单飞探活：
  //   - 单飞 → 同一时刻至多一个请求在途，后到的调用复用在途那个，天然不会乱序覆盖，
  //     也不会在守护进程半死态下每 3 秒堆一个请求上去；
  //   - 落地即清 in-flight ref → 下一拍照常发新请求，不会退化成"轮询停摆"。
  // 注：handleRepair 退避表的第 1 次探活有可能复用一个「repair 之前就发出」的在途请求
  // （即结论早于本次修复）。第 2 次起不会再读到这种陈旧结论：单飞保证同一时刻至多一个
  // 请求在途，而第 1 次已经 await 到它落地（落地即清 in-flight ref），之后复用到的只可能
  // 是 repair 之后发出的请求。即便退避期间一直读到 false，常驻探活最多一拍就会纠正。
  const probeService = useCallback((): Promise<boolean> => {
    const inFlight = probeInFlightRef.current;
    if (inFlight) { return inFlight; }

    const run = async (): Promise<boolean> => {
      let running = false;
      let status: TunnelStatus | null = null;
      try {
        const r = await localApi.getStatus();
        if (r.success && r.data) {
          running = true;
          status = r.data;
        }
      } catch {
        // 连接被拒 / 超时 —— 本地控制面此刻不可用，按未运行处理（localApi 已有超时上限兜住）
      }
      setServiceRunning(running);
      setTunnelStatus(status);

      if (lastLoggedRunningRef.current !== running) {
        lastLoggedRunningRef.current = running;
        addLog(running ? '已检测到本地服务（localhost:19198）' : '本地服务未运行');
      }

      // 服务确实起来了就收掉"修复超时"那条提示：否则 header 写着运行中、横幅还写着没起来，
      // 两处自相矛盾且永不消失。按原文比对，只清这一条，绝不误伤用户遇到的其它错误。
      const hint = repairHintRef.current;
      if (running && hint !== null) {
        repairHintRef.current = null;
        setError((prev) => (prev === hint ? null : prev));
      }
      return running;
    };

    const p = run().finally(() => { probeInFlightRef.current = null; });
    probeInFlightRef.current = p;
    return p;
  }, [addLog]);

  // macOS 专用：查询 LaunchDaemon 是否已安装，返回最新值（调用方常需要立即用，不能等 state 落地）
  const refreshInstalled = useCallback(async (): Promise<boolean> => {
    if (osPlatform !== 'macos') { return false; }
    try {
      const ok = await invoke<boolean>('hg_is_installed');
      setInstalled(ok);
      return ok;
    } catch (e) {
      // 查询失败按"未安装"处理，但必须留痕（静默吞会让三态文案凭空退回"未安装"且无从解释）
      setInstalled(false);
      addLog(`查询服务安装状态失败：${e}`);
      return false;
    }
  }, [osPlatform, addLog]);

  // Init
  useEffect(() => {
    const data = parseWindowData();
    setWindowData(data);
    // 开窗前的安装失败原因（由 openHuanvaeGuardWindow 经 URL 透传）：挂载时一次性显示成
    // 错误横幅 + 日志，用户才知道是"取消了授权"还是别的原因，而不是只看到"未安装"
    if (data?.installError) {
      setError(data.installError);
      addLog(`服务安装未完成：${data.installError}`);
    }
    try {
      setOsPlatform(platform());
    } catch {
      setOsPlatform('');
    }
  }, [addLog]);

  // 安装状态首查（osPlatform 就绪后触发；非 macOS 直接短路）
  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  const loadDevices = useCallback(async () => {
    if (!windowData) { return; }
    try {
      const d = await serverApi.getDevices(windowData.serverUrl, windowData.accessToken);
      setDevices(d);
      addLog(`已加载 ${d.length} 个设备`);
    } catch (e) {
      addLog(`加载设备失败：${e}`);
    }
  }, [windowData, addLog]);

  const loadLinks = useCallback(async () => {
    if (!windowData) { return; }
    try {
      const l = await serverApi.listLinks(windowData.serverUrl, windowData.accessToken);
      setLinks(l);
    } catch (e) {
      addLog(`加载链接失败：${e}`);
    }
  }, [windowData, addLog]);

  const loadGroups = useCallback(async () => {
    if (!windowData) { return; }
    try {
      const g = await serverApi.listGroups(windowData.serverUrl, windowData.accessToken);
      setGroups(g);
    } catch (e) {
      addLog(`加载群组失败：${e}`);
    }
  }, [windowData, addLog]);

  // 首屏数据加载（服务状态由上面的常驻单飞探活负责，此处不再另开一个写者：
  // windowData 会随令牌刷新换引用，在这里探活等于每次刷新 token 都多一个不受控的状态写者）
  useEffect(() => {
    if (!windowData) { return; }
    void loadDevices();
  }, [windowData, loadDevices]);

  // Load tab data on switch
  useEffect(() => {
    if (!windowData) { return; }
    if (activeTab === 'links') { void loadLinks(); }
    if (activeTab === 'groups') { void loadGroups(); }
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
        addLog('已从主窗口同步访问令牌');
      },
    );
    // 挂载时主动请求一次（处理打开即过期的边界情况）
    void emit('session:request-tokens');
    return () => { void unlistenPromise.then(fn => fn()); };
  }, [addLog]);

  // 常驻状态复查：唯一的定时探活来源。故意不用 serviceRunning 做门控 —— 旧实现
  // `if (!serviceRunning) { return; }` 会在 false 时直接关掉唯一的轮询，从此再也恢复不了
  // （粘滞 false），哪怕守护进程随后已经起来。
  useEffect(() => {
    void probeService();
    const id = setInterval(() => { void probeService(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [probeService]);

  // Load group detail when selected
  useEffect(() => {
    if (!windowData || !selectedGroupId) {
      setGroupDetail(null);
      return;
    }
    serverApi.getGroupDetail(windowData.serverUrl, windowData.accessToken, selectedGroupId)
      .then(setGroupDetail)
      .catch(e => addLog(`加载群组详情失败：${e}`));
  }, [windowData, selectedGroupId, addLog]);

  // ─── Handlers: Devices ───

  const handleConnect = async () => {
    if (!windowData || !selectedDeviceId) {
      setError('请先选择一个设备');
      return;
    }
    // 打开 VPN 前生物识别门禁：本机有 Touch ID 则优先验证（macOS）；通过或本机无 Touch ID（含
    // Windows/Linux，命令返回 'unavailable'）→ 继续；取消/失败 → 抛错 → 中止打开。
    try {
      await invoke('biometric_authenticate', { reason: '打开 VPN 前验证身份' });
    } catch {
      setError('需要 Touch ID 验证才能打开 VPN');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      addLog('正在获取设备配置...');
      const config = await serverApi.getDeviceConfig(
        windowData.serverUrl, windowData.accessToken, selectedDeviceId,
      );
      if (!config.private_key) {
        setError('服务器未返回私钥，请检查服务端配置');
        return;
      }
      addLog(`配置已获取：${config.peers.length} 个对端，地址=${config.address}`);

      addLog('正在启动隧道...');
      const r = await localApi.startTunnel({
        address: config.address,
        private_key: config.private_key,
        peers: config.peers,
        obfuscation: config.obfuscation,
        // 注：macOS daemon 当前不应用 dns（IP-only）；
        // Windows daemon 生效。如需 macOS VPN 内域名解析需另做 networksetup/scutil（暂未实现）。
        dns: config.dns ?? undefined,
        mtu: config.mtu,
      });

      if (r.success) { addLog('隧道已启动'); }
      else {
        setError(r.error ?? '未知错误');
        addLog(`启动失败：${r.error}`);
      }
    } catch (e) {
      setError(String(e));
      addLog(`错误：${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      const r = await localApi.stopTunnel();
      if (r.success) { addLog('隧道已停止'); }
      else { addLog(`停止失败：${r.error}`); }
    } catch (e) {
      addLog(`错误：${e}`);
    } finally {
      setLoading(false);
    }
  };

  // macOS 专用：强制重装/修复 LaunchDaemon（恢复"文件在但服务没起"的半装态）
  // Windows 服务由 Tauri 进程生命周期管理，无需此入口（按钮仅 macOS + 服务未运行时显示）
  const handleRepair = async () => {
    setError(null);
    // 上一轮的"修复超时"提示已随 setError(null) 一起清掉，ref 也要跟着复位，
    // 否则它会残留成一条永远等不到的待清原文
    repairHintRef.current = null;
    setLoading(true);
    try {
      await invoke('hg_repair');
      addLog('已提交安装/修复请求，正在等待服务启动...');
      let running = false;
      for (const delay of REPAIR_BACKOFF_MS) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(delay);
        // eslint-disable-next-line no-await-in-loop
        running = await probeService();
        if (running) { break; }
      }
      // 这里不再 setServiceRunning —— probeService 已经写过了，再写一次就是第二个写者（本次要修的 bug）
      const nowInstalled = await refreshInstalled();
      if (running) {
        addLog('服务已就绪');
        return;
      }
      // 两种失败要给不同的下一步：装上了但没起来 → 看 daemon 日志；压根没装上 → 重试并授权
      const hint = nowInstalled
        ? '服务文件已安装，但守护进程未启动。请查看守护进程日志 /var/log/huanvaeguard/launchd-stderr.log'
        : '服务安装未完成。请重试，并在系统弹出管理员授权时点击「允许」';
      // 记下原文：守护进程晚于退避预算起来时，常驻探活按这份原文把这条提示收掉
      repairHintRef.current = hint;
      setError(hint);
      addLog(`服务仍未运行：${hint}`);
    } catch (e) {
      // Rust 侧 Err(String) 是给用户看的中文原因，必须进错误横幅（只写日志等于没说）
      const reason = String(e);
      setError(`修复失败：${reason}`);
      addLog(`修复失败：${reason}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterDevice = async () => {
    if (!windowData) { return; }
    const name = await showPrompt({ title: '注册设备', placeholder: '设备名称' });
    if (!name) { return; }
    setLoading(true);
    try {
      // 复用主应用的 deviceInfo 服务，把 MAC 作为 device_fingerprint 提交
      // 这样服务端可以做"同设备识别"，避免重复注册或会话冲突
      const { macAddress } = await getDeviceInfo();
      const resp = await serverApi.registerDevice(
        windowData.serverUrl,
        windowData.accessToken,
        name,
        osLabel(osPlatform),
        macAddress ?? undefined,
      );
      addLog(`设备已注册：${resp.device_id}，IP：${resp.virtual_ip}`);
      await loadDevices();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDevice = async (deviceId: string) => {
    if (!windowData) { return; }
    const ok = await confirm({
      title: '删除设备',
      message: '确定删除此设备？这将从服务器移除该设备的配置。',
      confirmLabel: '删除',
      isDanger: true,
    });
    if (!ok) { return; }
    try {
      await serverApi.deleteDevice(windowData.serverUrl, windowData.accessToken, deviceId);
      addLog('设备已删除');
      if (selectedDeviceId === deviceId) { setSelectedDeviceId(null); }
      await loadDevices();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleLockDevice = async (deviceId: string) => {
    if (!windowData) { return; }
    const endpoint = await showPrompt({
      title: '锁定设备',
      message: '锁定后该设备将固定连接到指定节点',
      placeholder: 'IP:端口',
    });
    if (!endpoint) { return; }
    try {
      await serverApi.lockDevice(windowData.serverUrl, windowData.accessToken, deviceId, endpoint);
      addLog(`设备已锁定到 ${endpoint}`);
      await loadDevices();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleUnlockDevice = async (deviceId: string) => {
    if (!windowData) { return; }
    try {
      await serverApi.unlockDevice(windowData.serverUrl, windowData.accessToken, deviceId);
      addLog('设备已解锁');
      await loadDevices();
    } catch (e) {
      setError(String(e));
    }
  };

  // ─── Handlers: Links ───

  const handleCreateInvite = async () => {
    if (!windowData || !selectedDeviceId) {
      setError('请先在「设备」选项卡中选择一个设备');
      return;
    }
    try {
      const resp = await serverApi.createLinkInvite(
        windowData.serverUrl, windowData.accessToken, selectedDeviceId,
      );
      setPendingInvite(resp);
      addLog(`已生成链接邀请码：${resp.invite_token.substring(0, 16)}...`);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAcceptInvite = async () => {
    if (!windowData || !acceptToken || !acceptDeviceId) {
      setError('请输入邀请令牌并选择目标设备');
      return;
    }
    try {
      const resp = await serverApi.acceptLinkInvite(
        windowData.serverUrl, windowData.accessToken, acceptToken, acceptDeviceId,
      );
      addLog(`链接已建立：${resp.link_id}`);
      setAcceptToken('');
      await loadLinks();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    if (!windowData) { return; }
    try {
      await serverApi.deleteLink(windowData.serverUrl, windowData.accessToken, linkId);
      addLog('链接已删除');
      await loadLinks();
    } catch (e) {
      setError(String(e));
    }
  };

  // ─── Handlers: Groups ───

  const handleCreateGroup = async () => {
    if (!windowData) { return; }
    const name = await showPrompt({ title: '创建群组', placeholder: '群组名称' });
    if (!name) { return; }
    const desc = await showPrompt({
      title: '群组描述',
      placeholder: '描述（可选）',
      required: false,
    });
    // desc 取消（null）则视为不填；空串也视为不填
    const description = desc && desc.trim() ? desc : undefined;
    try {
      const resp = await serverApi.createGroup(
        windowData.serverUrl, windowData.accessToken, name, description,
      );
      addLog(`群组已创建：${resp.name}（${resp.group_id}）`);
      await loadGroups();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleLeaveGroup = async (groupId: string, deviceId: string) => {
    if (!windowData) { return; }
    try {
      await serverApi.leaveGroup(windowData.serverUrl, windowData.accessToken, groupId, deviceId);
      addLog('已退出群组');
      await loadGroups();
      // 退出后立即刷新当前展开的群组详情（无法依赖 setSelectedGroupId 触发，
      // 因为传同值不会触发 useState 的副作用 dispatch）
      const detail = await serverApi.getGroupDetail(
        windowData.serverUrl, windowData.accessToken, groupId,
      );
      setGroupDetail(detail);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleToggleGroup = async (groupId: string) => {
    if (!windowData) { return; }
    try {
      const active = await serverApi.toggleGroup(windowData.serverUrl, windowData.accessToken, groupId);
      addLog(`群组已${active ? '启用' : '停用'}`);
      await loadGroups();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!windowData) { return; }
    const ok = await confirm({
      title: '删除群组',
      message: '确定删除此群组？群组内的设备将被移除。',
      confirmLabel: '删除',
      isDanger: true,
    });
    if (!ok) { return; }
    try {
      await serverApi.deleteGroup(windowData.serverUrl, windowData.accessToken, groupId);
      addLog('群组已删除');
      if (selectedGroupId === groupId) { setSelectedGroupId(null); }
      await loadGroups();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleGroupInvite = async (groupId: string) => {
    if (!windowData) { return; }
    try {
      const resp = await serverApi.createGroupInvite(
        windowData.serverUrl, windowData.accessToken, groupId,
      );
      setGroupInvite({ groupId, token: resp.invite_token, expiresAt: resp.expires_at });
      addLog(`已生成群组邀请码（过期时间：${new Date(resp.expires_at).toLocaleString()}）`);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAcceptGroupInvite = async () => {
    if (!windowData) { return; }
    if (!acceptGroupId || !acceptGroupToken || !acceptGroupDeviceId) {
      setError('请输入群组 ID 和邀请令牌，并选择设备');
      return;
    }
    try {
      await serverApi.acceptGroupInvite(
        windowData.serverUrl, windowData.accessToken,
        acceptGroupId, acceptGroupToken, acceptGroupDeviceId,
      );
      addLog('已接受群组邀请');
      setAcceptGroupId('');
      setAcceptGroupToken('');
      setAcceptGroupDeviceId('');
      await loadGroups();
    } catch (e) {
      setError(String(e));
    }
  };

  // ─── Render ───

  if (!windowData) {
    return <ListLoading message="加载中..." />;
  }

  const isActive = tunnelStatus?.active ?? false;
  const isSupported = osPlatform === 'windows' || osPlatform === 'macos';
  // macOS 三态：未安装 / 已安装未运行 / 运行中。Windows 的服务由 Tauri 进程生命周期
  // 管理、没有"安装"这一步，仍沿用两态文案。
  const serviceLabel = serviceStatusLabel(osPlatform, serviceRunning, installed);
  const selectedDevice = devices.find(d => d.device_id === selectedDeviceId);
  // 本机当前隧道 IP（去掉 CIDR 前缀），用于覆盖 server 返回的 offline 状态
  // 服务端状态依赖 heartbeat（目前客户端未发送），但本机隧道在用就是确凿 online
  const localTunnelIp = isActive && tunnelStatus?.address
    ? tunnelStatus.address.split('/')[0]
    : null;
  const isSelfDevice = (d: HgDevice): boolean =>
    localTunnelIp !== null && d.virtual_ip === localTunnelIp;
  const displayStatusKey = (d: HgDevice): string =>
    isSelfDevice(d) ? 'online' : d.status;

  const tabLabel: Record<Tab, string> = {
    devices: '设备',
    links: '链接',
    groups: '群组',
  };

  return (
    <div className="hg-page">
      {/* Header */}
      <header className="hg-header">
        <h2 className="hg-title">HuanvaeGuard</h2>
        <span className={`hg-status ${serviceRunning ? 'hg-status-running' : 'hg-status-stopped'}`}>
          <span className="hg-dot" />
          {serviceLabel}
        </span>
        {osPlatform !== '' && !isSupported && <span className="hg-os-hint">仅 Windows / macOS 支持</span>}
        {osPlatform === 'macos' && !serviceRunning && (
          <AppButton variant="secondary" size="sm" loading={loading} onClick={handleRepair}>
            {installed ? '修复服务' : '安装服务'}
          </AppButton>
        )}
      </header>

      {/* Error */}
      {error && (
        <div className="hg-error" role="alert">
          <span className="hg-error-msg">{error}</span>
          <AppButton variant="secondary" size="sm" onClick={() => setError(null)}>关闭</AppButton>
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
            {tabLabel[tab]}
          </button>
        ))}
      </nav>

      {/* ─── Devices Tab ─── */}
      {activeTab === 'devices' && (
        <>
          <section className="hg-card">
            <div className="hg-section-head">
              <span className="hg-section-title">设备</span>
              <AppButton variant="secondary" size="sm" onClick={handleRegisterDevice} disabled={loading}>
                + 注册设备
              </AppButton>
            </div>

            {devices.length === 0 ? (
              <ListEmpty message="暂无注册设备" />
            ) : (
              <div className="hg-device-list">
                {devices.map(d => {
                  const statusKey = displayStatusKey(d);
                  return (
                    <label key={d.device_id} className={`hg-device-item${selectedDeviceId === d.device_id ? ' selected' : ''}`}>
                      <input type="radio" name="device" checked={selectedDeviceId === d.device_id}
                        onChange={() => setSelectedDeviceId(d.device_id)} />
                      <span className="hg-device-name">{d.device_name}</span>
                      <span className="hg-device-ip">{d.virtual_ip}</span>
                      {isSelfDevice(d) && <span className="hg-device-self">（本机）</span>}
                      <span className={`hg-device-status${statusKey === 'online' ? ' active' : ''}`}>
                        {localizeStatus(statusKey)}
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
                  <span className="hg-detail-badge">已锁定：{selectedDevice.locked_endpoint}</span>
                )}
                <div className="hg-btn-row">
                  {selectedDevice.locked_endpoint ? (
                    <AppButton variant="secondary" size="sm"
                      onClick={() => handleUnlockDevice(selectedDevice.device_id)}>解锁</AppButton>
                  ) : (
                    <AppButton variant="secondary" size="sm"
                      onClick={() => handleLockDevice(selectedDevice.device_id)}>锁定</AppButton>
                  )}
                  <AppButton variant="danger" size="sm"
                    onClick={() => handleDeleteDevice(selectedDevice.device_id)}>删除</AppButton>
                </div>
              </div>
            )}

            {/* Connect / Disconnect */}
            <div className="hg-btn-row" style={{ marginTop: 16, marginBottom: 0 }}>
              <AppButton variant="primary" size="md"
                loading={loading}
                onClick={handleConnect}
                disabled={isActive || !serviceRunning}>
                连接
              </AppButton>
              <AppButton variant="danger" size="md"
                onClick={handleDisconnect}
                disabled={loading || !isActive}>
                断开
              </AppButton>
            </div>
          </section>

          {/* Tunnel status */}
          {tunnelStatus && isActive && (
            <section className="hg-card">
              <div className="hg-section-head">
                <span className="hg-section-title">隧道</span>
              </div>
              <dl className="hg-tunnel-info">
                <dt>接口</dt><dd>{tunnelStatus.interface_name}</dd>
                <dt>地址</dt><dd>{tunnelStatus.address}</dd>
                <dt>监听端口</dt><dd>{tunnelStatus.listen_port}</dd>
              </dl>
              <div className="hg-peers-title">对端（{tunnelStatus.peers.length}）</div>
              <table className="hg-peers-table">
                <thead>
                  <tr>
                    <th>公钥</th><th>节点地址</th>
                    <th className="hg-num">接收</th><th className="hg-num">发送</th>
                    <th className="hg-num">握手</th>
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
            <span className="hg-section-title">设备链接</span>
            <AppButton variant="secondary" size="sm" onClick={handleCreateInvite}
              disabled={!selectedDeviceId}>
              创建邀请
            </AppButton>
          </div>

          {/* 链接邀请码一次性展示：portal 到 body + fixed z-10001（.hg-card 的 backdrop-filter
              会把 absolute overlay 困在卡片内，必须脱离卡片 DOM） */}
          {pendingInvite &&
            createPortal(
              <div style={{ position: 'fixed', inset: 0, zIndex: 10001 }}>
                <SecretDisplay
                  title="链接邀请码"
                  warningText={`过期时间：${new Date(pendingInvite.expires_at).toLocaleString()}`}
                  fields={[{ label: '邀请令牌', value: pendingInvite.invite_token }]}
                  onClose={() => setPendingInvite(null)}
                  closeLabel="关闭"
                />
              </div>,
              document.body,
            )}

          <div className="hg-invite-section">
            <label className="hg-label">接受邀请</label>
            <div className="hg-input-row">
              <input className="hg-input" placeholder="邀请令牌" value={acceptToken}
                onChange={e => setAcceptToken(e.target.value)} />
              <select className="hg-input" value={acceptDeviceId}
                onChange={e => setAcceptDeviceId(e.target.value)}>
                <option value="">选择设备</option>
                {devices.map(d => (
                  <option key={d.device_id} value={d.device_id}>{d.device_name}</option>
                ))}
              </select>
              <AppButton variant="primary" size="sm"
                onClick={handleAcceptInvite} disabled={!acceptToken || !acceptDeviceId}>
                接受
              </AppButton>
            </div>
          </div>

          {links.length === 0 ? (
            <ListEmpty message="暂无链接" />
          ) : (
            <table className="hg-peers-table">
              <thead>
                <tr>
                  <th>设备 A</th><th>设备 B</th><th>来源</th><th />
                </tr>
              </thead>
              <tbody>
                {links.map(l => {
                  const nameA = devices.find(d => d.device_id === l.device_a)?.device_name ?? l.device_a.substring(0, 8);
                  const nameB = devices.find(d => d.device_id === l.device_b)?.device_name ?? l.device_b.substring(0, 8);
                  return (
                    <tr key={l.link_id}>
                      <td>{nameA}</td><td>{nameB}</td>
                      <td>{localizeLinkSource(l.link_source)}</td>
                      <td>
                        <AppButton variant="danger" size="sm"
                          onClick={() => handleDeleteLink(l.link_id)}>断开</AppButton>
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
          {/* 通过邀请加入群组（顶部独立入口，无需先展开任何群组） */}
          <section className="hg-card">
            <div className="hg-section-head">
              <span className="hg-section-title">通过邀请加入群组</span>
            </div>
            <div className="hg-input-row">
              <input className="hg-input" placeholder="群组 ID" value={acceptGroupId}
                onChange={e => setAcceptGroupId(e.target.value)} />
              <input className="hg-input" placeholder="邀请令牌" value={acceptGroupToken}
                onChange={e => setAcceptGroupToken(e.target.value)} />
              <select className="hg-input" value={acceptGroupDeviceId}
                onChange={e => setAcceptGroupDeviceId(e.target.value)}>
                <option value="">选择设备</option>
                {devices.map(d => (
                  <option key={d.device_id} value={d.device_id}>{d.device_name}</option>
                ))}
              </select>
              <AppButton variant="primary" size="sm"
                onClick={handleAcceptGroupInvite}
                disabled={!acceptGroupId || !acceptGroupToken || !acceptGroupDeviceId}>
                加入
              </AppButton>
            </div>
          </section>

          <section className="hg-card">
            <div className="hg-section-head">
              <span className="hg-section-title">网络群组</span>
              <AppButton variant="secondary" size="sm" onClick={handleCreateGroup}>
                + 创建群组
              </AppButton>
            </div>

            {groups.length === 0 ? (
              <ListEmpty message="暂无群组" />
            ) : (
              <div className="hg-device-list">
                {groups.map(g => (
                  <div key={g.group_id}
                    className={`hg-group-item${selectedGroupId === g.group_id ? ' selected' : ''}`}
                    onClick={() => setSelectedGroupId(g.group_id === selectedGroupId ? null : g.group_id)}>
                    <span className="hg-group-name">{g.name}</span>
                    <span className={`hg-group-status${g.is_active ? ' active' : ''}`}>
                      {g.is_active ? '已启用' : '已停用'}
                    </span>
                    <div className="hg-group-actions">
                      <AppButton variant="secondary" size="sm"
                        onClick={e => { e.stopPropagation(); handleGroupInvite(g.group_id); }}>
                        邀请
                      </AppButton>
                      <AppButton variant="secondary" size="sm"
                        onClick={e => { e.stopPropagation(); handleToggleGroup(g.group_id); }}>
                        切换状态
                      </AppButton>
                      <AppButton variant="danger" size="sm"
                        onClick={e => { e.stopPropagation(); handleDeleteGroup(g.group_id); }}>
                        删除
                      </AppButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 群组邀请码一次性展示：portal 到 body + fixed z-10001（父级无定位时 absolute
              overlay 锚到文档顶部，页面滚动后会看不见） */}
          {groupInvite &&
            createPortal(
              <div style={{ position: 'fixed', inset: 0, zIndex: 10001 }}>
                <SecretDisplay
                  title="群组邀请码"
                  warningText={`过期时间：${new Date(groupInvite.expiresAt).toLocaleString()}`}
                  fields={[
                    { label: '群组 ID', value: groupInvite.groupId },
                    { label: '邀请令牌', value: groupInvite.token },
                  ]}
                  onClose={() => setGroupInvite(null)}
                  closeLabel="关闭"
                />
              </div>,
              document.body,
            )}

          {/* Group detail */}
          {groupDetail && (
            <section className="hg-card">
              <div className="hg-section-head">
                <span className="hg-section-title">{groupDetail.group.name} — 设备</span>
              </div>
              {groupDetail.group.description && (
                <p className="hg-group-desc">{groupDetail.group.description}</p>
              )}
              {groupDetail.devices.length === 0 ? (
                <ListEmpty message="群组内暂无设备" />
              ) : (
                <table className="hg-peers-table">
                  <thead>
                    <tr><th>设备</th><th>VPN IP</th><th>状态</th><th /></tr>
                  </thead>
                  <tbody>
                    {groupDetail.devices.map(d => (
                      <tr key={d.device_id}>
                        <td>{devices.find(dev => dev.device_id === d.device_id)?.device_name ?? d.device_id.substring(0, 8)}</td>
                        <td>{d.virtual_ip}</td>
                        <td>{localizeStatus(d.status ?? 'unknown')}</td>
                        <td>
                          <AppButton variant="danger" size="sm"
                            onClick={() => handleLeaveGroup(groupDetail.group.group_id, d.device_id)}>
                            退出
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
          <div className="hg-log-empty">就绪</div>
        ) : (
          log.map((l, i) => (
            <div key={i} className="hg-log-line">{l}</div>
          ))
        )}
      </div>

      {/* 共享对话框（取代浏览器原生 confirm()/prompt()） */}
      {confirmDialog}
      {promptDialog}
    </div>
  );
}
