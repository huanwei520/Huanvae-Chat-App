/**
 * 头像组件
 */

import { useState, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { AvatarPlaceholder } from './AvatarPlaceholder';
import type { Friend, Group } from '../../types/chat';

/** 用户会话信息类型 */
export interface SessionInfo {
    profile: {
        user_nickname: string;
        user_avatar_url: string | null;
    };
    avatarPath: string | null;
}

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

  return <AvatarPlaceholder name={session.profile.user_nickname} />;
}

/** 好友头像 - 尺寸由外层容器控制；无头像/加载失败回退统一首字母渐变占位 */
export function FriendAvatar({ friend }: { friend: Friend }) {
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (friend.friend_avatar_url) {
      setLoadFailed(false);
    }
  }, [friend.friend_avatar_url]);

  if (friend.friend_avatar_url && !loadFailed) {
    return (
      <img
        key={friend.friend_avatar_url}
        src={friend.friend_avatar_url}
        alt={friend.friend_nickname}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => setLoadFailed(true)}
      />
    );
  }
  return <AvatarPlaceholder name={friend.friend_nickname || friend.friend_id} />;
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

  return <AvatarPlaceholder name={group.group_name} />;
}
