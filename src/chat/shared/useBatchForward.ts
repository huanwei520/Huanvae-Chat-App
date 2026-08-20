/**
 * 多选批量转发的状态与取数（桌面 ChatPanel 与移动 MobileChatView 共用）
 *
 * @module chat/shared
 * @location src/chat/shared/useBatchForward.ts
 *
 * 两个消息面板的多选状态形状逐字相同（friendMessages / groupMessages /
 * selectedMessages / chatTarget），把这段抽出来是为了避免两边各写一遍
 * 「谁是发送者、哪些能转、按什么顺序发」——那三条一旦漂移就会两端行为不一致。
 */

import { useState, useMemo, useCallback } from 'react';
import { friendDisplayName } from '../../utils/friendName';
import { isFriendLikeTarget } from '../../utils/chatTarget';
import { collectForwardSources, type ForwardSource } from './forwardMessage';
import type { GroupMessage } from '../../api/groupMessages';
import type { Session } from '../../types/session';
import type { ChatTarget, Message } from '../../types/chat';

interface UseBatchForwardParams {
  session: Session;
  chatTarget: ChatTarget;
  friendMessages: Message[];
  groupMessages: GroupMessage[];
  selectedMessages: Set<string>;
}

interface UseBatchForwardReturn {
  /** 选中项里可转发的那些（按发送时间升序）；空数组 ⇒ 不给转发入口 */
  forwardSources: ForwardSource[];
  /** 转发面板是否挂载 */
  forwardOpen: boolean;
  openForward: () => void;
  closeForward: () => void;
}

export function useBatchForward({
  session,
  chatTarget,
  friendMessages,
  groupMessages,
  selectedMessages,
}: UseBatchForwardParams): UseBatchForwardReturn {
  const [forwardOpen, setForwardOpen] = useState(false);

  const forwardSources = useMemo((): ForwardSource[] => {
    if (selectedMessages.size === 0) { return []; }
    if (isFriendLikeTarget(chatTarget)) {
      const peerName = friendDisplayName(chatTarget.data);
      return collectForwardSources(
        friendMessages,
        selectedMessages,
        (m) => (m.sender_id === session.userId ? session.profile.user_nickname : peerName),
      );
    }
    if (chatTarget.type === 'group') {
      // 群消息自带发送者昵称（备注是本地视图，转发预览用消息原带的名字即可）
      return collectForwardSources(groupMessages, selectedMessages, (m) => m.sender_nickname);
    }
    // AI 会话没有可转发的服务端消息
    return [];
  }, [chatTarget, friendMessages, groupMessages, selectedMessages, session]);

  const openForward = useCallback(() => setForwardOpen(true), []);
  const closeForward = useCallback(() => setForwardOpen(false), []);

  return { forwardSources, forwardOpen, openForward, closeForward };
}
