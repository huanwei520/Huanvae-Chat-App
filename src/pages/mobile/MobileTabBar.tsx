/**
 * 移动端底部Tab栏组件
 *
 * 包含两个Tab：消息和通讯录
 */

import type { MobileTab } from '../../hooks/useMobileNavigation';

// 消息图标
const ChatIcon = () => (
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
      d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
    />
  </svg>
);

// 通讯录图标
const ContactsIcon = () => (
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
      d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
    />
  </svg>
);

interface MobileTabBarProps {
  /** 当前激活的Tab */
  activeTab: MobileTab;
  /** Tab切换回调 */
  onTabChange: (tab: MobileTab) => void;
  /** 未读消息总数 */
  unreadCount?: number;
}

export function MobileTabBar({
  activeTab,
  onTabChange,
  unreadCount = 0,
}: MobileTabBarProps) {
  return (
    <nav className="mobile-tab-bar">
      {/* 消息Tab */}
      <div
        className={`mobile-tab-item ${activeTab === 'chat' ? 'active' : ''}`}
        onClick={() => onTabChange('chat')}
      >
        <div className="mobile-tab-icon">
          <ChatIcon />
          {unreadCount > 0 && (
            <span className="mobile-tab-badge">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        <span className="mobile-tab-label">消息</span>
      </div>

      {/* 通讯录Tab */}
      <div
        className={`mobile-tab-item ${activeTab === 'contacts' ? 'active' : ''}`}
        onClick={() => onTabChange('contacts')}
      >
        <div className="mobile-tab-icon">
          <ContactsIcon />
        </div>
        <span className="mobile-tab-label">通讯录</span>
      </div>
    </nav>
  );
}
