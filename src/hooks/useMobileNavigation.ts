/**
 * 移动端导航状态管理 Hook
 *
 * 管理移动端特有的导航状态：
 * - 底部Tab切换
 * - 抽屉开关
 * - 页面视图切换
 *
 * @module hooks/useMobileNavigation
 */

import { useState, useCallback } from 'react';

export type MobileTab = 'chat' | 'contacts';
export type MobileView = 'list' | 'chat';

export interface MobileNavState {
  /** 当前底部Tab */
  activeTab: MobileTab;
  /** 抽屉是否打开 */
  isDrawerOpen: boolean;
  /** 当前视图 */
  currentView: MobileView;
}

export interface UseMobileNavigationReturn extends MobileNavState {
  /** 切换底部Tab */
  setActiveTab: (tab: MobileTab) => void;
  /** 打开抽屉 */
  openDrawer: () => void;
  /** 关闭抽屉 */
  closeDrawer: () => void;
  /** 切换抽屉状态 */
  toggleDrawer: () => void;
  /** 进入聊天页面 */
  enterChat: () => void;
  /** 退出聊天页面 */
  exitChat: () => void;
}

/**
 * 移动端导航状态管理
 */
export function useMobileNavigation(): UseMobileNavigationReturn {
  const [activeTab, setActiveTab] = useState<MobileTab>('chat');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [currentView, setCurrentView] = useState<MobileView>('list');

  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
  }, []);

  const toggleDrawer = useCallback(() => {
    setIsDrawerOpen((prev) => !prev);
  }, []);

  const enterChat = useCallback(() => {
    setCurrentView('chat');
  }, []);

  const exitChat = useCallback(() => {
    setCurrentView('list');
  }, []);

  const handleTabChange = useCallback((tab: MobileTab) => {
    setActiveTab(tab);
    // 切换Tab时如果在聊天页面，先退出
    setCurrentView('list');
  }, []);

  return {
    activeTab,
    isDrawerOpen,
    currentView,
    setActiveTab: handleTabChange,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    enterChat,
    exitChat,
  };
}
