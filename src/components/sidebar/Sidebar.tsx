/**
 * 侧边栏组件
 *
 * 采用"核心固定 + 更多收纳"布局：
 * - 固定区：消息、好友、群聊（高频核心操作）
 * - 更多浮层：文件、局域网互传、会议、小程序、低代码（低频工具，点击"更多"展开）
 * - 底部区：设置、退出
 *
 * WebSocket 连接状态指示器：
 * - 绿色：已连接
 * - 黄色闪烁：连接中
 * - 红色：断开连接
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { platform } from '@tauri-apps/plugin-os';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { UserAvatar, type SessionInfo } from '../common/Avatar';
import {
  ChatIcon,
  SettingsIcon,
  LogoutIcon,
  GroupIcon,
  VideoMeetingIcon,
} from '../common/Icons';

// 好友图标（单人 + 小人 = 通讯录风格）
const FriendsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

// 文件夹图标
const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);

// 局域网传输图标（双向箭头 + 设备）
const LanTransferIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
  </svg>
);

// VPN 盾牌图标
const GuardIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
);

// 远程开发图标（终端 / 服务器风格）
const RemoteDevIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 17.25V6.75A2.25 2.25 0 0 0 18.75 4.5H5.25A2.25 2.25 0 0 0 3 6.75v10.5A2.25 2.25 0 0 0 5.25 20.25Z" />
  </svg>
);

// 低代码编辑器图标（流程图/节点连线风格）
const LowcodeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h3M10.5 18h3M6 10.5v3M18 10.5v3" />
  </svg>
);

// 小程序图标（火箭 / 应用商店风格，与低代码的四格+连线图标区分）
const MiniAppsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
  </svg>
);

// "更多"按钮图标（三个圆点 · · ·）
const MoreIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
  </svg>
);

export type NavTab = 'chat' | 'group' | 'friends';

interface SidebarProps {
    session: SessionInfo;
    activeTab: NavTab;
    isSettingsOpen?: boolean;
    onTabChange: (tab: NavTab) => void;
    onAvatarClick: () => void;
    onFilesClick: () => void;
    onLanTransferClick: () => void;
    onMeetingClick: () => void;
    onMiniAppsClick: () => void;
    onLowcodeClick: () => void;
    onRemoteDevClick: () => void;
    onHuanvaeGuardClick: () => void;
    onSettingsClick: () => void;
    onLogout: () => void;
}

/** "更多"浮层中的功能项定义 */
interface MoreMenuItem {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

export function Sidebar({
  session,
  activeTab,
  isSettingsOpen = false,
  onTabChange,
  onAvatarClick,
  onFilesClick,
  onLanTransferClick,
  onMeetingClick,
  onMiniAppsClick,
  onLowcodeClick,
  onRemoteDevClick,
  onHuanvaeGuardClick,
  onSettingsClick,
  onLogout,
}: SidebarProps) {
  const { connected, connecting } = useWebSocket();
  const [showMorePanel, setShowMorePanel] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const morePanelRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  const getStatusClass = () => {
    if (connected) {
      return 'connected';
    }
    if (connecting) {
      return 'connecting';
    }
    return 'disconnected';
  };

  // 打开浮层时根据按钮位置计算 fixed 坐标
  const toggleMorePanel = useCallback(() => {
    setShowMorePanel((prev) => {
      if (!prev && moreBtnRef.current) {
        const rect = moreBtnRef.current.getBoundingClientRect();
        setPanelPos({
          top: rect.top,
          left: rect.right + 10,
        });
      }
      return !prev;
    });
  }, []);

  // 点击浮层外部时关闭
  useEffect(() => {
    if (!showMorePanel) {
      return;
    }
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        morePanelRef.current && !morePanelRef.current.contains(target) &&
        moreBtnRef.current && !moreBtnRef.current.contains(target)
      ) {
        setShowMorePanel(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMorePanel]);

  // 浮层内按钮点击：执行回调 + 关闭浮层
  const handleMoreItemClick = useCallback((action: () => void) => {
    action();
    setShowMorePanel(false);
  }, []);

  const [isWindowsPlatform] = useState(() => {
    try {
      return platform() === 'windows';
    } catch {
      return false;
    }
  });

  // "更多"浮层中收纳的功能列表
  const moreItems: MoreMenuItem[] = useMemo(() => {
    const items: MoreMenuItem[] = [
      { icon: <FolderIcon />, label: '我的文件', onClick: onFilesClick },
      { icon: <LanTransferIcon />, label: '局域网互传', onClick: onLanTransferClick },
      { icon: <VideoMeetingIcon />, label: '视频会议', onClick: onMeetingClick },
      { icon: <MiniAppsIcon />, label: '小程序', onClick: onMiniAppsClick },
      { icon: <LowcodeIcon />, label: '低代码编辑器', onClick: onLowcodeClick },
      { icon: <RemoteDevIcon />, label: '远程开发', onClick: onRemoteDevClick },
    ];
    if (isWindowsPlatform) {
      items.push({ icon: <GuardIcon />, label: 'VPN 组网', onClick: onHuanvaeGuardClick });
    }
    return items;
  }, [isWindowsPlatform, onFilesClick, onLanTransferClick, onMeetingClick, onMiniAppsClick, onLowcodeClick, onRemoteDevClick, onHuanvaeGuardClick]);

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
        <div className={`online-indicator ${getStatusClass()}`} />
      </div>

      <nav className="sidebar-nav">
        {/* 核心固定区：消息、好友、群聊 */}
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

        {/* "更多"按钮（浮层通过 Portal 渲染到 body，避免被父容器 overflow 裁切） */}
        <motion.button
          ref={moreBtnRef}
          className={`nav-btn ${showMorePanel ? 'active' : ''}`}
          onClick={toggleMorePanel}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          title="更多功能"
        >
          <MoreIcon />
        </motion.button>

        {createPortal(
          <AnimatePresence>
            {showMorePanel && (
              <motion.div
                ref={morePanelRef}
                className="sidebar-more-panel"
                style={{ top: panelPos.top, left: panelPos.left }}
                initial={{ opacity: 0, x: -8, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
              >
                {moreItems.map((item) => (
                  <button
                    key={item.label}
                    className="more-panel-item"
                    onClick={() => handleMoreItemClick(item.onClick)}
                  >
                    <span className="more-panel-icon">{item.icon}</span>
                    <span className="more-panel-label">{item.label}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
      </nav>

      <div className="sidebar-bottom">
        <motion.button
          className={`nav-btn ${isSettingsOpen ? 'active' : ''}`}
          onClick={onSettingsClick}
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
