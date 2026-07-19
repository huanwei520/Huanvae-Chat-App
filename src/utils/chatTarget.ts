/**
 * 聊天目标构造与判别（friend / bot 共享私聊链路）
 *
 * @location src/utils/chatTarget.ts
 *
 * bot 是真实好友行（friend_id 带 bot_ 前缀，服务端 add-bot 创建），数据形态与
 * 消息链路（messages API / WS source_type:'friend' / friend_unreads /
 * markRead('friend') 通道）与好友完全一致；'bot' 仅是 UI 呈现层的区分
 * （卡片类型 / Bot 徽标 / 顶栏副标题）。
 *
 * 不变量：数据面通道 id 一律仍用 'friend'；任何分支里 'bot' 目标都不得落进
 * 'group' else 分支 —— 判断"走私聊链路吗"统一用 isFriendLikeTarget，
 * 由 Friend 构造目标统一用 friendChatTarget。
 */

import { isBotUserId } from '../api/bots';
import type { ChatTarget, Friend } from '../types/chat';

/** friend 与 bot 目标共享 Friend 数据形态与私聊消息链路 */
export type FriendLikeTarget = Extract<ChatTarget, { type: 'friend' | 'bot' }>;

/** 判断目标是否走私聊链路（friend 或 bot） */
export function isFriendLikeTarget(t: ChatTarget | null | undefined): t is FriendLikeTarget {
  return t?.type === 'friend' || t?.type === 'bot';
}

/** 由 Friend 构造聊天目标：bot 好友分派为 'bot'，其余 'friend' */
export function friendChatTarget(friend: Friend): FriendLikeTarget {
  if (isBotUserId(friend.friend_id)) {
    return { type: 'bot', data: friend };
  }
  return { type: 'friend', data: friend };
}
