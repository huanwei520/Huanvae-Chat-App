/**
 * 好友显示名解析（私聊场景）
 *
 * @location src/utils/friendName.ts
 *
 * 私聊里显示对方名字的优先级：备注 > 昵称 > 用户名(friend_id)。
 * 仅用于私聊；群聊一律用群昵称，不得调用本函数。
 */

/** 解析私聊好友显示名：备注 || 昵称 || friend_id（空白视为未设置） */
export function friendDisplayName(friend: {
  friend_id: string;
  friend_nickname?: string | null;
  friend_remark?: string | null;
}): string {
  const remark = friend.friend_remark?.trim();
  if (remark) {
    return remark;
  }
  const nickname = friend.friend_nickname?.trim();
  if (nickname) {
    return nickname;
  }
  return friend.friend_id;
}
