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
  device_name: string;
  public_key: string;
  virtual_ip: string;
  status: string;
  os: string | null;
}
