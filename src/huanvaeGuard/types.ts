/**
 * HuanvaeGuard 类型定义
 *
 * 分两部分：
 *   1. Local Windows Service types — 对应本机 svc 的 API 结构。地址是回环控制端口
 *      （127.0.0.1，端口由 Rust 侧解析给出，默认 19198 —— 见 localApi.ts）
 *      （由本仓 src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe 实现）
 *   2. Server API types — 对应远端 `/api/hg/*` 的结构
 *      （后端为独立仓库，本仓仅消费 JSON；字段以后端 OpenAPI/文档为准）
 */

// ─── Local Windows Service types（回环控制端口，端口由 Rust 侧解析，默认 19198）───

export interface ObfuscationParams {
  h1: [number, number];
  h2: [number, number];
  h3: [number, number];
  h4: [number, number];
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  jc: number;
  jmin: number;
  jmax: number;
}

export interface PeerConfig {
  public_key: string;
  endpoint?: string;
  allowed_ips: string;
  persistent_keepalive?: number;
  preshared_key?: string;
}

/**
 * 控制面凭据 —— 守护进程拿它**自己**连 master，所以它比"多传几个字段"重要得多。
 *
 * 不传它的后果不是"少一个功能"，而是**一个看不出来的功能缺失**：
 * `/api/tunnel/start` 照样 200、界面照样显示「已连接」，但这条隧道的 peer 集
 * 在启动那一刻就**冻住**了 —— 之后加入的设备它永远不知道
 * （守护进程侧走的是 `CONTROL_PLANE_ABSENT` 那条只打一行 warn 就 return 的分支）。
 *
 * 字段逐字镜像守护进程的 `ControlCredentials`
 * （HuanvaeGuard 仓 `client/common/src/daemon.rs`，macOS / Windows 两端共用同一份定义）。
 * 🔴 四个字段的键名不许在这里"顺手改得更 TS 一点" —— 它是 JSON 线格式，改一个字母就静默失效。
 */
export interface ControlCredentials {
  /** master 源站，形如 `https://<host>:<port>`；运行时值，**不许写死任何地址** */
  master_url: string;
  /** 本设备 UUID，守护进程用它寻址 `/api/hg/devices/{id}/…` */
  device_id: string;
  /** WebSocket 与拉配置用的用户 JWT */
  access_token: string;
  /**
   * 续期用。守护进程侧是 `Option`，缺它不会拒绝启动 ——
   * 但控制链会在**第一次 access_token 过期时死掉且回不来**（daemon.rs 原文注释）。
   * 所以"可缺"不等于"可以静默地缺"：调用方缺它时必须说出来。
   */
  refresh_token?: string;
}

/**
 * 控制面（配置热更新链路）的健康状况，逐字镜像守护进程的 `ControlPlaneStatus`
 * （`client/common/src/daemon.rs`）。
 *
 * 存在的理由就一句：**这条链路坏掉时和"没什么可报告"长得一模一样**，
 * 而隧道两种情况下都照样说自己 `active: true`。没有这份读数，界面只能显示成功。
 *
 * 🔴 可选性按守护进程的序列化属性来，不是按"看着像可选"来：
 *   - `applied_at` / `last_error` 带 `skip_serializing_if = "Option::is_none"` ⇒ 可缺；
 *   - `enabled` / `connected` / `applied_peers` / `auth_failures` **无条件序列化** ⇒ 必填。
 */
export interface ControlPlaneStatus {
  /** `false` = 本次启动没拿到凭据（老的「冻结 peer 集」模式），或控制链启动失败 */
  enabled: boolean;
  /** WebSocket 此刻是否连着 */
  connected: boolean;
  /** 最近一次从 master 应用下来的 peer 数 */
  applied_peers: number;
  /** 最近一次成功应用的 unix 秒 */
  applied_at?: number;
  /** 链路不健康的原因 */
  last_error?: string;
  /** 启动以来 master 拒绝凭据的次数 */
  auth_failures: number;
}

export interface TunnelStatus {
  active: boolean;
  interface_name?: string;
  address?: string;
  listen_port?: number;
  peers: PeerStatus[];
  /**
   * 配置热更新链路的健康状况。
   *
   * 🔴 **本身可选、内部字段必填**，两者的含义不同，不能压成一个：
   *   - `undefined` = 守护进程**根本没下发这个字段** ⇒ 它是旧版本，压根没有热更新能力；
   *   - `{ enabled: false, … }` = 新版守护进程明确说「本次没启用」。
   * 前者要提示升级守护进程，后者要提示这次启动没带凭据 —— 处置不同，所以读数必须能分开。
   */
  control_plane?: ControlPlaneStatus;
}

export interface PeerStatus {
  public_key: string;
  endpoint: string;
  last_handshake: number;
  rx_bytes: number;
  tx_bytes: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Server API types (backend /api/hg/*) ───

/** 客户端隧道配置（后端下发） */
export interface HgClientConfig {
  address: string;
  dns: string | null;
  mtu: number;
  peers: PeerConfig[];
  obfuscation: ObfuscationParams;
  private_key?: string;
}

/** 设备信息 */
export interface HgDevice {
  device_id: string;
  user_id: string;
  device_name: string;
  public_key: string;
  virtual_ip: string;
  node_id: string | null;
  psk_hash: string | null;
  os: string | null;
  device_fingerprint: string | null;
  status: string;
  locked_endpoint: string | null;
  last_heartbeat: string | null;
  created_at: string;
  updated_at: string;
}

/** 设备注册响应 */
export interface DeviceRegisterResponse {
  device_id: string;
  virtual_ip: string;
  node_endpoint: string | null;
  topology: HgPeerInfo[];
}

/** 对端设备信息（设备/链接/群组查询共用） */
export interface HgPeerInfo {
  device_id: string;
  public_key: string;
  virtual_ip: string;
  endpoint: string | null;
  is_same_node: boolean;
  psk_encrypted: string | null;
  psk_nonce: string | null;
  status: string | null;
  last_heartbeat: string | null;
}

/** 设备拓扑（增量同步） */
export interface DeviceTopology {
  device_id: string;
  virtual_ip: string;
  peers: HgPeerInfo[];
  topology_version: number;
}

// ─── Links ───

/** 设备互联链接 */
export interface HgDeviceLink {
  link_id: string;
  device_a: string;
  device_b: string;
  link_source: string;
  source_id: string | null;
  created_at: string;
  updated_at: string;
}

/** 创建互联邀请响应 */
export interface CreateLinkInviteResponse {
  invite_id: string;
  invite_token: string;
  expires_at: string;
}

/** 接受互联邀请响应 */
export interface AcceptLinkInviteResponse {
  link_id: string;
  peer: HgPeerInfo;
}

// ─── Groups ───

/** VPN 组 */
export interface HgGroup {
  group_id: string;
  name: string;
  owner_id: string;
  description: string | null;
  is_active: boolean;
  max_devices: number | null;
  created_at: string;
  updated_at: string;
}

/** 组详情（组 + 成员设备） */
export interface GroupDetail {
  group: HgGroup;
  devices: HgPeerInfo[];
}

/** 创建组响应 */
export interface CreateGroupResponse {
  group_id: string;
  name: string;
}

/** 加入组响应 */
export interface JoinGroupResponse {
  group_id: string;
  status: string;
  pending_peers: number;
}
