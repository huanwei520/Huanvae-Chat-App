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
      <div className="meeting-invite-header">
        <svg className="meeting-invite-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
        <span className="meeting-invite-title">会议邀请</span>
      </div>

      <div className="meeting-invite-body">
        <div className="meeting-invite-room-name">{payload.room_name}</div>
        <div className="meeting-invite-info-row">
          <span className="meeting-invite-label">房间号</span>
          <span className="meeting-invite-value">{payload.room_id}</span>
        </div>
        <div className="meeting-invite-creator">
          {payload.creator_avatar && (
            <img
              className="meeting-invite-avatar"
              src={resolveServerAvatarUrl(payload.creator_avatar) || ''}
              alt=""
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <span className="meeting-invite-creator-name">{payload.creator_name}</span>
        </div>
      </div>

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
