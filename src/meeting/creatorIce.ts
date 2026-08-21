/**
 * 会议创建者的 ICE 配置获取
 *
 * @module meeting/creatorIce
 * @location src/meeting/creatorIce.ts
 *
 * ## 为什么创建者要单独取一次
 * `POST /api/webrtc/rooms`（createRoom）的响应里**没有** `ice_servers`，只有参与者走的
 * `joinRoom` 才带（见 api.ts 的 `CreateRoomResponse` / `JoinRoomResponse` 两个类型）。
 * 于是创建者保存的 `MeetingWindowData.iceServers` 一直是 undefined，会议窗口只能退到
 * 硬编码的公共 STUN —— 既用不上自家 TURN 中继（对称 NAT / 双 NAT 下建不了连），
 * 又把每次开会的 ICE 探测流量送给第三方。`MeetingWindowData.iceServers` 的字段注释
 * 「创建者需要单独获取」说的就是这一步，本模块把它补上。
 *
 * ## 取不到时为什么不阻断
 * 这一步失败**只影响连通质量**，不影响「能不能进自己刚建的会」。让它抛错会把
 * 「后端 ICE 端点临时不可用」升级成「开不了会」，代价明显不对等。所以取不到就
 * 返回 `undefined`，由会议窗口沿用它自己的兜底，并在控制台留下可诊断的一行。
 * 🔴 这是**错误路径**的降级，不是给旧实现留的兼容分支。
 */

import type { ApiClient } from '../api/client';
import { getIceServers, type IceServer } from './api';

/**
 * 取创建者用的 ICE 服务器列表
 *
 * @returns 后端下发的列表；端点失败或返回空列表时 `undefined`（调用方按「没拿到」处理）
 */
export async function fetchCreatorIceServers(api: ApiClient): Promise<IceServer[] | undefined> {
  try {
    const config = await getIceServers(api);
    return config.ice_servers?.length ? config.ice_servers : undefined;
  } catch (error) {
    console.error('[Meeting] 获取 ICE 服务器配置失败，本次会议将使用兜底配置:', error);
    return undefined;
  }
}
