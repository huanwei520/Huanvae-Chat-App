/**
 * 移动端顶部栏组件
 *
 * 左侧头像按钮 + 搜索框 + WebSocket 连接状态指示器
 *
 * ## 连接状态指示器
 * 头像右下角显示一个圆点，颜色根据 WebSocket 连接状态变化：
 * - 🟢 绿色：已连接
 * - 🟡 黄色：连接中（带脉冲动画）
 * - 🔴 红色：断开连接
 */

import type { Session } from '../../types/session';
import { useWebSocket } from '../../contexts/WebSocketContext';

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

const PlusIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
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
  /** 添加好友/群聊点击回调 */
  onAddClick?: () => void;
  /** 待处理申请/邀请总数 */
  pendingCount?: number;
}

export function MobileHeader({
  session,
  searchQuery,
  onSearchChange,
  onAvatarClick,
  onAddClick,
  pendingCount = 0,
}: MobileHeaderProps) {
  // 获取 WebSocket 连接状态
  const { connected, connecting } = useWebSocket();

  // 计算状态类名
  const getStatusClass = () => {
    if (connected) {
      return 'connected';
    }
    if (connecting) {
      return 'connecting';
    }
    return 'disconnected';
  };
  const statusClass = getStatusClass();

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
              background: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              fontWeight: 700,
            }}
          >
            <span
              style={{
                background: 'linear-gradient(135deg, #60a5fa, #e0e7ff)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {(session.profile?.user_nickname || session.userId).charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        {/* 连接状态指示器 */}
        <span className={`connection-indicator ${statusClass}`} />
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

      {/* 添加好友/群聊按钮 */}
      {onAddClick && (
        <button className="mobile-contacts-add-btn" onClick={onAddClick}>
          <PlusIcon />
          {pendingCount > 0 && (
            <span className="mobile-contacts-add-badge">
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          )}
        </button>
      )}
    </header>
  );
}
