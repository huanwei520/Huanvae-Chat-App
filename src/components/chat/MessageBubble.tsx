/**
 * 消息气泡组件
 */

import { UserAvatar, FriendAvatar, type SessionInfo } from '../common/Avatar';
import { formatMessageTime } from '../../utils/time';
import type { Friend, Message } from '../../types/chat';

interface MessageBubbleProps {
    message: Message;
    isOwn: boolean;
    session: SessionInfo;
    friend: Friend;
}

export function MessageBubble({ message, isOwn, session, friend }: MessageBubbleProps) {
  return (
    <div className={`message-bubble ${isOwn ? 'own' : 'other'}`}>
      <div className="bubble-avatar">
        {isOwn ? <UserAvatar session={session} /> : <FriendAvatar friend={friend} size={32} />}
      </div>
      <div className="bubble-content">
        <div className="bubble-text">{message.message_content}</div>
        <div className="bubble-time">{formatMessageTime(message.send_time)}</div>
      </div>
    </div>
  );
}
