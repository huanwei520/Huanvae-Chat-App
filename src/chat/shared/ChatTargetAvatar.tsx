/**
 * 会话顶栏头像（桌面 / 移动共用）
 *
 * @module chat/shared
 * @location src/chat/shared/ChatTargetAvatar.tsx
 *
 * huanwei 2026-08-14 拍板：私聊气泡区的双方头像整块删掉，头像**移到顶栏昵称左边**。
 * 顶栏只有两个渲染点（桌面 `ChatPanel` 的 `.chat-header`、移动 `MobileChatView` 的
 * `.mobile-chat-header`），两处放的必须是同一张图 —— 所以「放谁的头像」这条规则收在这里
 * 一处判定，不让两个顶栏各写一遍 if。
 *
 * 规则：
 * - `friend` / `bot` ⇒ **对方**头像（`FriendAvatar`）
 * - `group`          ⇒ **群**头像（`GroupAvatar`），与左侧会话列表用同一张图
 * - `ai`             ⇒ 不放（AI 会话没有稳定的「对方身份」）
 *
 * **自己的头像不在这里**：它已经常驻左侧边栏左上角，会话里再画一遍没有信息量。
 *
 * 单独抽成模块（而不是写在 ChatPanel 里让移动端 import 过去）的理由见
 * `.claude/rules/common.md`「跨端复用 pure function 时检查源文件的依赖污染」——
 * `ChatPanel.tsx` 顶层拖着一整棵桌面聊天树，移动端 import 它会把那棵树打进 Android bundle。
 */

import { FriendAvatar, GroupAvatar } from '../../components/common/Avatar';
import { isFriendLikeTarget } from '../../utils/chatTarget';
import type { ChatTarget } from '../../types/chat';

/** 该会话类型顶栏是否有头像可放（AI 会话没有） */
export function hasChatTargetAvatar(chatTarget: ChatTarget): boolean {
  return isFriendLikeTarget(chatTarget) || chatTarget.type === 'group';
}

/** 顶栏头像本体；尺寸由外层容器（`.chat-header-avatar` / `.mobile-chat-avatar`）控制 */
export function ChatTargetAvatar({ chatTarget }: { chatTarget: ChatTarget }) {
  if (isFriendLikeTarget(chatTarget)) {
    return <FriendAvatar friend={chatTarget.data} />;
  }
  if (chatTarget.type === 'group') {
    return <GroupAvatar group={chatTarget.data} />;
  }
  return null;
}
