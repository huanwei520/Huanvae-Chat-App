/**
 * HuanvaeGuard 类型定义
 *
 * 分两部分：
 *   1. Local Windows Service types — 对应本机 svc (localhost:19198) 的 API 结构
 *      （由本仓 src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe 实现）
 *   2. Server API types — 对应远端 `/api/hg/*` 的结构
 *      （后端为独立仓库，本仓仅消费 JSON；字段以后端 OpenAPI/文档为准）
 *
 * 注：历史注释曾写"与后端 src/huanvaeguard/models/*.rs 对齐"，但该 Rust 路径不在本仓。
 */

// ─── Local Windows Service types (localhost:19198) ───

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

export interface TunnelStatus {
  active: boolean;
  interface_name?: string;
  address?: string;
  listen_port?: number;
  peers: PeerStatus[];
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

/** models/config.rs — HgClientConfig */
export interface HgClientConfig {
  address: string;
  dns: string | null;
  mtu: number;
  peers: PeerConfig[];
  obfuscation: ObfuscationParams;
  private_key?: string;
}

/** models/device.rs — HgDevice */
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

/** models/device.rs — DeviceRegisterResponse */
export interface DeviceRegisterResponse {
  device_id: string;
  virtual_ip: string;
  node_endpoint: string | null;
  topology: HgPeerInfo[];
}

/** models/device.rs — HgPeerInfo (shared across device/link/group queries) */
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

/** models/device.rs — DeviceTopology (incremental sync) */
export interface DeviceTopology {
  device_id: string;
  virtual_ip: string;
  peers: HgPeerInfo[];
  topology_version: number;
}

// ─── Links ───

/** models/link.rs — HgDeviceLink */
export interface HgDeviceLink {
  link_id: string;
  device_a: string;
  device_b: string;
  link_source: string;
  source_id: string | null;
  created_at: string;
  updated_at: string;
}

/** models/link.rs — CreateLinkInviteResponse */
export interface CreateLinkInviteResponse {
  invite_id: string;
  invite_token: string;
  expires_at: string;
}

/** models/link.rs — AcceptLinkInviteResponse */
export interface AcceptLinkInviteResponse {
  link_id: string;
  peer: HgPeerInfo;
}

// ─── Groups ───

/** models/group.rs — HgGroup */
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

/** models/group.rs — GroupDetail */
export interface GroupDetail {
  group: HgGroup;
  devices: HgPeerInfo[];
}

/** models/group.rs — CreateGroupResponse */
export interface CreateGroupResponse {
  group_id: string;
  name: string;
}

/** models/group.rs — JoinGroupResponse */
export interface JoinGroupResponse {
  group_id: string;
  status: string;
  pending_peers: number;
}
