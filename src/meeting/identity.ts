/**
 * 会议入会身份标识（8.2 同账号同设备禁止重复入会）
 *
 * - device_id：复用登录设备标识（桌面=MAC 地址，Android=持久化设备 UUID），
 *   来自 services/deviceInfo 的 getDeviceInfo().macAddress —— 同设备恒同值，
 *   不同设备恒不同值，正好作为「同设备」判定键。
 * - user_id：登录用户的账号 ID（访客/未登录为 undefined，不参与顶替规则）。
 *
 * 两者随 join/create 请求上报给服务端；服务端对 (user_id, device_id) 相同的
 * 第二次入会执行「顶替旧会话」（旧会话收 kicked 信令并被断开）。
 *
 * @module meeting/identity
 */

import { getDeviceInfo } from '../services/deviceInfo';

/** 8.2 入会身份（服务端同账号同设备顶替判定键） */
export interface MeetingIdentity {
  /** 登录用户 ID（未登录为 undefined） */
  userId?: string;
  /** 设备标识（桌面 MAC / Android 持久 UUID；获取失败为 undefined） */
  deviceId?: string;
}

/**
 * 获取入会设备标识。
 * 失败（非 Tauri 环境等）返回 undefined —— 服务端将本会话视为不参与顶替规则，
 * 行为与 8.2 上线前一致（零回归兜底）。
 */
export async function getMeetingDeviceId(): Promise<string | undefined> {
  try {
    const { macAddress } = await getDeviceInfo();
    return macAddress ?? undefined;
  } catch {
    return undefined;
  }
}

/** 组装入会身份（登录用户 + 设备标识） */
export async function getMeetingIdentity(userId?: string | null): Promise<MeetingIdentity> {
  const [deviceId] = await Promise.all([getMeetingDeviceId()]);
  return {
    userId: userId || undefined,
    deviceId,
  };
}
