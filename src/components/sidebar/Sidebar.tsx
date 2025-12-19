/**
 * 侧边栏组件
 */

import { motion } from 'framer-motion';
import { UserAvatar, type SessionInfo } from '../common/Avatar';
import {
  ChatIcon,
  SettingsIcon,
  LogoutIcon,
  GroupIcon,
} from '../common/Icons';

// 好友图标（单人 + 小人 = 通讯录风格）
const FriendsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

// 添加按钮图标（+号）
const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

export type NavTab = 'chat' | 'group' | 'friends' | 'settings';

interface SidebarProps {
    session: SessionInfo;
    activeTab: NavTab;
    onTabChange: (tab: NavTab) => void;
    onAvatarClick: () => void;
    onAddClick: () => void; // 统一的添加按钮
    onLogout: () => void;
}

export function Sidebar({
  session,
  activeTab,
  onTabChange,
  onAvatarClick,
  onAddClick,
  onLogout,
}: SidebarProps) {
  return (
    <motion.aside
      className="chat-sidebar"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="sidebar-avatar">
        <motion.div
          className="avatar-wrapper"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onAvatarClick}
          style={{ cursor: 'pointer' }}
          title="个人资料"
        >
          <UserAvatar session={session} />
        </motion.div>
        <div className="online-indicator" />
      </div>

      <nav className="sidebar-nav">
        <motion.button
          className={`nav-btn ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => onTabChange('chat')}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          title="消息"
        >
          <ChatIcon />
        </motion.button>
        <motion.button
          className={`nav-btn ${activeTab === 'friends' ? 'active' : ''}`}
          onClick={() => onTabChange('friends')}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          title="好友"
        >
          <FriendsIcon />
        </motion.button>
        <motion.button
          className={`nav-btn ${activeTab === 'group' ? 'active' : ''}`}
          onClick={() => onTabChange('group')}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          title="群聊"
        >
          <GroupIcon />
        </motion.button>
        <motion.button
          className="nav-btn add-btn"
          onClick={onAddClick}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          title="添加好友/群聊"
        >
          <PlusIcon />
        </motion.button>
      </nav>

      <div className="sidebar-bottom">
        <motion.button
          className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onTabChange('settings')}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          title="设置"
        >
          <SettingsIcon />
        </motion.button>
        <motion.button
          className="nav-btn logout"
          onClick={onLogout}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          title="退出登录"
        >
          <LogoutIcon />
        </motion.button>
      </div>
    </motion.aside>
  );
}
