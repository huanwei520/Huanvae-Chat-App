/**
 * 搜索弹出框状态管理 Hook
 * 
 * 用于管理可折叠搜索框的弹出状态
 */

import { useState, useRef, useEffect, useCallback } from 'react';

interface UseSearchPopupOptions {
  /** 面板宽度 */
  panelWidth: number;
  /** 折叠阈值 */
  collapseWidth?: number;
}

interface UseSearchPopupReturn {
  /** 是否显示弹出搜索框 */
  showSearchPopup: boolean;
  /** 设置弹出状态 */
  setShowSearchPopup: (show: boolean) => void;
  /** 搜索输入框 ref */
  searchInputRef: React.RefObject<HTMLInputElement>;
  /** 是否处于折叠状态 */
  isCollapsed: boolean;
  /** 打开弹出框 */
  openPopup: () => void;
  /** 关闭弹出框 */
  closePopup: () => void;
}

const DEFAULT_COLLAPSE_WIDTH = 120;

export function useSearchPopup({
  panelWidth,
  collapseWidth = DEFAULT_COLLAPSE_WIDTH,
}: UseSearchPopupOptions): UseSearchPopupReturn {
  const [showSearchPopup, setShowSearchPopup] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isCollapsed = panelWidth < collapseWidth;

  // 弹出搜索框时自动聚焦
  useEffect(() => {
    if (showSearchPopup && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearchPopup]);

  // 点击外部关闭弹出框
  useEffect(() => {
    if (!showSearchPopup) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.search-popup') && !target.closest('.search-icon-btn') && !target.closest('.search-box-wrapper')) {
        setShowSearchPopup(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSearchPopup]);

  const openPopup = useCallback(() => {
    setShowSearchPopup(true);
  }, []);

  const closePopup = useCallback(() => {
    setShowSearchPopup(false);
  }, []);

  return {
    showSearchPopup,
    setShowSearchPopup,
    searchInputRef,
    isCollapsed,
    openPopup,
    closePopup,
  };
}

