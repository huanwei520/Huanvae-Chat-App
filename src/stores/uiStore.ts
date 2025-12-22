/**
 * UI 状态管理 Store (Zustand)
 *
 * 管理全局 UI 状态：
 * - 侧边栏折叠状态
 * - 模态框状态
 * - 加载状态
 * - 通知/提示
 */

import { create } from 'zustand';

// ============================================
// 类型定义
// ============================================

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

interface UIState {
  /** 侧边栏是否折叠 */
  sidebarCollapsed: boolean;
  /** 好友面板是否展开 */
  friendsPanelExpanded: boolean;
  /** 群聊面板是否展开 */
  groupsPanelExpanded: boolean;
  /** 全局加载状态 */
  globalLoading: boolean;
  /** 全局加载文本 */
  globalLoadingText: string | null;
  /** 主题模式 */
  theme: 'light' | 'dark' | 'system';
  /** Toast 通知列表 */
  toasts: Toast[];
  /** 当前打开的模态框 */
  activeModal: string | null;
  /** 模态框数据 */
  modalData: Record<string, unknown> | null;
  /** 是否处于全屏模式 */
  isFullscreen: boolean;
  /** 消息输入框草稿 key: conversationId */
  drafts: Record<string, string>;
}

interface UIActions {
  /** 切换侧边栏 */
  toggleSidebar: () => void;
  /** 设置侧边栏状态 */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** 切换好友面板 */
  toggleFriendsPanel: () => void;
  /** 切换群聊面板 */
  toggleGroupsPanel: () => void;
  /** 设置全局加载 */
  setGlobalLoading: (loading: boolean, text?: string) => void;
  /** 设置主题 */
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  /** 显示 Toast */
  showToast: (toast: Omit<Toast, 'id'>) => void;
  /** 移除 Toast */
  removeToast: (id: string) => void;
  /** 清除所有 Toast */
  clearToasts: () => void;
  /** 打开模态框 */
  openModal: (modalId: string, data?: Record<string, unknown>) => void;
  /** 关闭模态框 */
  closeModal: () => void;
  /** 设置全屏模式 */
  setFullscreen: (isFullscreen: boolean) => void;
  /** 设置草稿 */
  setDraft: (conversationId: string, text: string) => void;
  /** 获取草稿 */
  getDraft: (conversationId: string) => string;
  /** 清除草稿 */
  clearDraft: (conversationId: string) => void;
}

export type UIStore = UIState & UIActions;

// ============================================
// Store 实现
// ============================================

let toastIdCounter = 0;

export const useUIStore = create<UIStore>((set, get) => ({
  // 初始状态
  sidebarCollapsed: false,
  friendsPanelExpanded: true,
  groupsPanelExpanded: true,
  globalLoading: false,
  globalLoadingText: null,
  theme: 'system',
  toasts: [],
  activeModal: null,
  modalData: null,
  isFullscreen: false,
  drafts: {},

  // 侧边栏
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  // 面板
  toggleFriendsPanel: () => set((state) => ({ friendsPanelExpanded: !state.friendsPanelExpanded })),
  toggleGroupsPanel: () => set((state) => ({ groupsPanelExpanded: !state.groupsPanelExpanded })),

  // 全局加载
  setGlobalLoading: (loading, text) => set({ 
    globalLoading: loading, 
    globalLoadingText: text || null,
  }),

  // 主题
  setTheme: (theme) => set({ theme }),

  // Toast
  showToast: (toast) => {
    const id = `toast-${++toastIdCounter}`;
    const newToast: Toast = { ...toast, id };
    
    set((state) => ({
      toasts: [...state.toasts, newToast],
    }));

    // 自动移除
    const duration = toast.duration ?? 3000;
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }
  },

  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id),
  })),

  clearToasts: () => set({ toasts: [] }),

  // 模态框
  openModal: (modalId, data) => set({ 
    activeModal: modalId, 
    modalData: data || null,
  }),

  closeModal: () => set({ 
    activeModal: null, 
    modalData: null,
  }),

  // 全屏
  setFullscreen: (isFullscreen) => set({ isFullscreen }),

  // 草稿
  setDraft: (conversationId, text) => set((state) => ({
    drafts: { ...state.drafts, [conversationId]: text },
  })),

  getDraft: (conversationId) => get().drafts[conversationId] || '',

  clearDraft: (conversationId) => set((state) => {
    const newDrafts = { ...state.drafts };
    delete newDrafts[conversationId];
    return { drafts: newDrafts };
  }),
}));

// ============================================
// 选择器
// ============================================

/** 获取当前主题 */
export const selectTheme = (state: UIStore) => state.theme;

/** 获取侧边栏状态 */
export const selectSidebarCollapsed = (state: UIStore) => state.sidebarCollapsed;

/** 获取全局加载状态 */
export const selectGlobalLoading = (state: UIStore) => ({
  loading: state.globalLoading,
  text: state.globalLoadingText,
});

/** 获取 Toast 列表 */
export const selectToasts = (state: UIStore) => state.toasts;

/** 获取当前模态框 */
export const selectActiveModal = (state: UIStore) => ({
  id: state.activeModal,
  data: state.modalData,
});

