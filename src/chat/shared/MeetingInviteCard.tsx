import { useState, useCallback } from 'react';
import { useApi, useSession } from '../../contexts/SessionContext';
import { joinRoom, saveMeetingData } from '../../meeting/api';
import { openMeetingWindow } from '../../meeting/components/MeetingEntryModal';
import { isMobile } from '../../utils/platform';
import { useChatStore } from '../../stores/chatStore';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import type { MeetingInvitePayload } from '../../types/chat';
import './MeetingInviteCard.css';

interface MeetingInviteCardProps {
  messageContent: string;
}

export function MeetingInviteCard({ messageContent }: MeetingInviteCardProps) {
  const api = useApi();
  const { session } = useSession();
  const [joining, setJoining] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let payload: MeetingInvitePayload | null = null;
  try {
    payload = JSON.parse(messageContent) as MeetingInvitePayload;
  } catch {
    // parse failed
  }

  const handleJoin = useCallback(async () => {
    if (!payload || joining || expired) { return; }

    setJoining(true);
    setError(null);

    try {
      const displayName = session?.profile.user_nickname || '参会者';
      const avatarUrl = session?.profile.user_avatar_url || undefined;
      const serverUrl = session?.serverUrl || '';

      const response = await joinRoom(api, payload.room_id, payload.password, displayName, avatarUrl);

      saveMeetingData({
        role: 'participant',
        roomId: payload.room_id,
        password: payload.password,
        roomName: payload.room_name,
        displayName,
        token: response.ws_token,
        iceServers: response.ice_servers,
        userInfo: response.user_info,
        serverUrl,
      });

      if (isMobile()) {
        useChatStore.getState().setPendingMeetingJoin(true);
      } else {
        await openMeetingWindow();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('不存在') || msg.includes('not found') || msg.includes('404') || msg.includes('expired')) {
        setExpired(true);
      } else {
        setError(msg);
      }
    } finally {
      setJoining(false);
    }
  }, [payload, joining, expired, api, session]);

  if (!payload) {
    return <div className="meeting-invite-card meeting-invite-invalid">[无法解析的会议邀请]</div>;
  }

  return (
    <div className={`meeting-invite-card ${expired ? 'meeting-invite-expired' : ''}`}>
      {/* ---- D2「左章横条卡」修改版（owner 2026-09-14 选定）----
          章（46px 圆角方章）= **创建会议人的头像**（有头像用头像，无头像回退到会议图标章）。
          骨架：左右两栏（章 | 标题+元信息）+ 底部全宽实心 CTA。 */}
      <div className="meeting-invite-body-row">
        <span className="meeting-invite-medal" aria-hidden="true">
          {payload.creator_avatar
            ? (
              <img
                className="meeting-invite-medal-avatar"
                src={resolveServerAvatarUrl(payload.creator_avatar) || ''}
                alt=""
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )
            : null}
          {/* 无头像（或头像加载失败被隐藏）时的回退图标：会议摄像头章 */}
          <svg className="meeting-invite-medal-glyph" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </span>

        <div className="meeting-invite-info">
          <div className="meeting-invite-room-name">{payload.room_name}</div>
          <div className="meeting-invite-meta">房间号 {payload.room_id} · {payload.creator_name}</div>
        </div>
      </div>

      {/* D2 原案：底部全宽实心 CTA（原先是透明底+上边框的文字链） */}
      <button
        className="meeting-invite-join-btn"
        onClick={handleJoin}
        disabled={joining || expired}
      >
        {(() => {
          if (expired) { return '会议已结束'; }
          if (joining) { return '加入中...'; }
          return '加入会议';
        })()}
      </button>

      {error && <div className="meeting-invite-error">{error}</div>}
    </div>
  );
}
