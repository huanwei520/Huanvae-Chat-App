/** HuanvaeGuard 类型定义 */

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

/** 服务端 config API 响应 */
export interface HgClientConfig {
  address: string;
  dns: string | null;
  mtu: number;
  peers: PeerConfig[];
  obfuscation: ObfuscationParams;
}

/** 服务端设备注册响应 */
export interface DeviceRegisterResponse {
  device_id: string;
  virtual_ip: string;
  node_endpoint: string | null;
  topology: TopologyPeer[];
}

export interface TopologyPeer {
  device_id: string;
  public_key: string;
  virtual_ip: string;
  endpoint: string | null;
  is_same_node: boolean;
}

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

/** 设备链接 */
export interface HgDeviceLink {
  link_id: string;
  device_a: string;
  device_b: string;
  link_source: 'self' | 'manual' | 'group';
  source_id: string | null;
  created_at: string;
  updated_at: string;
}

/** 群组 */
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

/** 群组详情（含成员设备） */
export interface HgGroupDetail {
  group: HgGroup;
  devices: Array<TopologyPeer & { status?: string; last_heartbeat?: string }>;
}

/** 邀请创建响应 */
export interface HgInviteResponse {
  invite_id: string;
  invite_token: string;
  expires_at: string;
}

/** 加入群组响应 */
export interface HgJoinGroupResponse {
  group_id: string;
  status: string;
  pending_peers: number;
}

/** 锁定设备响应 */
export interface HgLockDeviceResult {
  psk: string;
  psk_hash: string;
}
