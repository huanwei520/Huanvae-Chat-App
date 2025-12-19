/**
 * 头像组件
 */

import { useState, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Friend, Group } from '../../types/chat';

/** 用户会话信息类型 */
export interface SessionInfo {
    profile: {
        user_nickname: string;
        user_avatar_url: string | null;
    };
    avatarPath: string | null;
}

/** 默认头像 SVG - 尺寸由外层容器控制 */
export const DefaultAvatar = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    style={{
      width: '60%',
      height: '60%',
      color: '#94a3b8',
    }}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
    />
  </svg>
);

/** 当前用户头像 - 尺寸由外层容器控制 */
export function UserAvatar({ session }: { session: SessionInfo }) {
  const [localSrc, setLocalSrc] = useState<string | null>(null);
  const [useLocal, setUseLocal] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // 当服务器 URL 变化时，重置状态
  useEffect(() => {
    if (session.profile.user_avatar_url) {
      setLoadFailed(false);
      setUseLocal(false);
    }
  }, [session.profile.user_avatar_url]);

  // 加载本地头像（仅在没有服务器 URL 时使用）
  useEffect(() => {
    if (!session.profile.user_avatar_url && session.avatarPath) {
      try {
        setLocalSrc(convertFileSrc(session.avatarPath));
        setUseLocal(true);
      } catch {
        setUseLocal(false);
      }
    }
  }, [session.avatarPath, session.profile.user_avatar_url]);

  // 优先使用服务器头像（服务器已返回带时间戳的 URL）
  if (session.profile.user_avatar_url && !loadFailed) {
    return (
      <img
        key={session.profile.user_avatar_url}
        src={session.profile.user_avatar_url}
        alt={session.profile.user_nickname}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => setLoadFailed(true)}
      />
    );
  }

  // 回退到本地头像
  if (useLocal && localSrc) {
    return (
      <img
        src={localSrc}
        alt={session.profile.user_nickname}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => setUseLocal(false)}
      />
    );
  }

  return <DefaultAvatar />;
}

/** 好友头像 - 尺寸由外层容器控制 */
export function FriendAvatar({ friend }: { friend: Friend }) {
  if (friend.friend_avatar_url) {
    return (
      <img
        src={friend.friend_avatar_url}
        alt={friend.friend_nickname}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return <DefaultAvatar />;
}

/** 群聊图标 SVG */
const GroupIconSvg = ({ size = 20 }: { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width={size}
    height={size}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
    />
  </svg>
);

/** 群聊默认头像 - 尺寸由外层容器控制 */
export function GroupDefaultAvatar() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #93c5fd, #60a5fa)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
      }}
    >
      <GroupIconSvg size={20} />
    </div>
  );
}

/** 群聊头像 - 尺寸由外层容器控制 */
export function GroupAvatar({ group }: { group: Group }) {
  const [loadFailed, setLoadFailed] = useState(false);

  // 当群头像 URL 变化时，重置状态
  useEffect(() => {
    if (group.group_avatar_url) {
      setLoadFailed(false);
    }
  }, [group.group_avatar_url]);

  // 服务器已返回带时间戳的 URL，无需额外处理
  if (group.group_avatar_url && !loadFailed) {
    return (
      <img
        key={group.group_avatar_url}
        src={group.group_avatar_url}
        alt={group.group_name}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
        onError={() => setLoadFailed(true)}
      />
    );
  }

  return <GroupDefaultAvatar />;
}
