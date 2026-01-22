/**
 * 移动端顶部栏组件
 *
 * 左侧头像按钮 + 搜索框
 */

import type { Session } from '../../types/session';

// 搜索图标
const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
    />
  </svg>
);

interface MobileHeaderProps {
  /** 用户会话信息 */
  session: Session;
  /** 搜索关键词 */
  searchQuery: string;
  /** 搜索关键词变化回调 */
  onSearchChange: (query: string) => void;
  /** 头像点击回调（打开抽屉） */
  onAvatarClick: () => void;
}

export function MobileHeader({
  session,
  searchQuery,
  onSearchChange,
  onAvatarClick,
}: MobileHeaderProps) {
  return (
    <header className="mobile-header">
      {/* 头像按钮 */}
      <div className="mobile-header-avatar" onClick={onAvatarClick}>
        {session.profile?.user_avatar_url ? (
          <img
            src={session.profile.user_avatar_url}
            alt={session.profile.user_nickname || session.userId}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: 'linear-gradient(135deg, var(--primary), var(--accent))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '18px',
              fontWeight: 600,
            }}
          >
            {(session.profile?.user_nickname || session.userId).charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* 搜索框 */}
      <div className="mobile-header-search">
        <SearchIcon />
        <input
          type="text"
          placeholder="搜索会话..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </header>
  );
}
