/**
 * 分享会议邀请
 *
 * @module meeting/components
 * @location src/meeting/components/ShareMeetingModal.tsx
 *
 * 「发给谁」那一半已迁到通用的 components/share/ShareTargetPicker（A 版快捷卡：
 * 最近/好友/群组合并成一条列表 + 已选 chip 行，不再有 tab）。本文件只剩两件事：
 * 顶部预览区放什么（会议名 + 房间号），以及选中之后怎么发。
 *
 * 🔴 迁移只换选择器 UI —— 发送语义与请求体逐字未变：仍是同一份 JSON content +
 * `message_type: 'meeting_invite'`，好友走 sendMessage、群走 sendGroupMessage，
 * 多目标并行。唯一变的文案是底部计数（「已选 N 个」→「已选 N 个会话」），
 * 那是 A 版规格对选择器本身的规定，由共用组件统一提供。
 */

import { useCallback } from 'react';
import { useApi } from '../../contexts/SessionContext';
import { sendMessage } from '../../api/messages';
import { sendGroupMessage } from '../../api/groupMessages';
import { ShareTargetPicker, type ShareTarget } from '../../components/share/ShareTargetPicker';
import './ShareMeetingModal.css';

interface ShareMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  meetingData: {
    roomId: string;
    password: string;
    roomName: string;
    creatorName: string;
    creatorAvatar: string;
  };
}

export function ShareMeetingModal({ isOpen, onClose, meetingData }: ShareMeetingModalProps) {
  const api = useApi();

  const handleConfirm = useCallback(async (targets: ShareTarget[]) => {
    const content = JSON.stringify({
      room_id: meetingData.roomId,
      password: meetingData.password,
      room_name: meetingData.roomName,
      creator_name: meetingData.creatorName,
      creator_avatar: meetingData.creatorAvatar,
    });

    await Promise.all(targets.map((item) => (item.type === 'friend'
      ? sendMessage(api, {
        receiver_id: item.id,
        message_content: content,
        message_type: 'meeting_invite',
      })
      : sendGroupMessage(api, {
        group_id: item.id,
        message_content: content,
        message_type: 'meeting_invite',
      }))));
  }, [api, meetingData]);

  if (!isOpen) { return null; }

  return (
    <ShareTargetPicker
      title="分享会议邀请"
      preview={(
        <div className="share-meeting-info">
          <span className="share-meeting-room-name">{meetingData.roomName}</span>
          <span className="share-meeting-room-id">#{meetingData.roomId}</span>
        </div>
      )}
      onConfirm={handleConfirm}
      onClose={onClose}
    />
  );
}
