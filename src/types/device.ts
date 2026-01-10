/**
 * 设备类型定义
 *
 * 用于设备管理功能，对应后端 /api/auth/devices 接口
 *
 * @module types/device
 */

/**
 * 设备信息
 */
export interface Device {
  /** 设备 ID */
  device_id: string;
  /** 设备信息描述（如浏览器、操作系统等） */
  device_info: string;
  /** MAC 地址 */
  mac_address?: string;
  /** 是否为当前设备 */
  is_current: boolean;
  /** 创建时间（ISO 格式） */
  created_at: string;
  /** 最后活跃时间（ISO 格式） */
  last_active_at?: string;
}

/**
 * 获取设备列表响应
 */
export interface DevicesResponse {
  devices: Device[];
}
