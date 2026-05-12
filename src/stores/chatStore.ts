/**
 * 聊天状态管理 Store (Zustand)
 *
 * 集中管理聊天应用的核心状态：
 * - friends: 好友列表
 * - groups: 群聊列表
 * - chatTarget: 当前聊天目标
 * - muteStatus: 当前用户在各群的禁言状态
 *
 * 优势：
 * - 细粒度订阅：组件只订阅需要的状态片段，避免不必要的重渲染
 * - React 外部访问：WebSocket 回调中可直接使用 getState() 和 set()
 * - 无 Provider：即插即用，无需包裹组件
 * - 类型安全：完整的 TypeScript 支持
 *
 * 使用方式：
 * ```typescript
 * // 订阅整个 friends 数组
 * const friends = useChatStore(state => state.friends)
 *
 * // 订阅特定群的角色（细粒度）
 * const role = useChatStore(state =>
 *   state.groups.find(g => g.group_id === groupId)?.role
 * )
 *
 * // 在 WebSocket 回调中使用（React 外部）
 * useChatStore.getState().updateGroupRole(groupId, 'admin')
 *
 * // 检查禁言状态
 * const muteInfo = useChatStore(selectCurrentMuteStatus)
 * ```
 */

import { create } from 'zustand';
import type { Friend, Group, ChatTarget, Message } from '../types/chat';
import type { GroupMessage } from '../api/groupMessages';

// ============================================
// 类型定义
// ============================================

/** 禁言信息 */
interface MuteInfo {
  /** 禁言结束时间（ISO 字符串） */
  mutedUntil: string;
  /** 禁言原因 */
  reason?: string;
}

interface ChatState {
  // ==================== 好友状态 ====================
  /** 好友列表 */
  friends: Friend[];
  /** 好友加载中 */
  friendsLoading: boolean;
  /** 好友加载错误 */
  friendsError: string | null;

  // ==================== 群聊状态 ====================
  /** 群聊列表 */
  groups: Group[];
  /** 群聊加载中 */
  groupsLoading: boolean;
  /** 群聊加载错误 */
  groupsError: string | null;

  // ==================== 聊天目标 ====================
  /** 当前聊天目标 */
  chatTarget: ChatTarget | null;

  // ==================== 禁言状态 ====================
  /**
   * 当前用户在各群的禁言状态
   * key: groupId, value: MuteInfo
   */
  muteStatus: Record<string, MuteInfo>;

  // ==================== 会议状态 ====================
  /** 是否有待加入的会议（移动端从会议邀请卡片触发） */
  pendingMeetingJoin: boolean;

  // ==================== 跳转状态 ====================
  /**
   * 待跳转的目标消息 UUID（来自全局搜索结果点击）
   * ChatMessages / GroupChatMessages 监听此字段：
   *   非 null → 加载历史至该消息 + scrollIntoView + 清空
   */
  pendingScrollToMessageId: string | null;

  // ==================== 切换会话恢复状态 ====================
  /**
   * 每会话当前已加载消息的全量内存缓存（含 loadMore 加载的历史）。
   *
   * key: `friend-${friendId}` / `group-${groupId}` —— 与 scrollAnchors 共用同一 key 格式。
   * value: 当前 messages 数组（按时间正序，全量保留）。
   *
   * 为什么不 slice(-50)：用户翻历史触发 loadMore 后，滚动锚点 uuid 可能指向
   * 50 条之外的消息。如果只缓存尾部 50 条，锚点对应的 DOM 元素切回时不存在，
   * 触发降级 scrollToBottom 把用户拉回到底，违背"恢复到上次阅读位置"的预期。
   *
   * 用途：用户切换聊天 A → B → A 时，A 的 ChatPanel mount 触发新的
   * useLocalFriendMessages，messages 初始值从此缓存读取 → 第一帧就有数据显示，
   * 不再等待 db.getMessages(50) 异步完成产生空白闪烁。
   *
   * 时机：
   *   - 写入：useLocal*Messages 的 useEffect cleanup（unmount 触发）保存当前 messages 全量
   *   - 读取：useLocal*Messages 的 useState 初始化函数
   *   - 校准：mount 后异步 db.getMessages(50) 与缓存合并（新消息追加）
   *   - 清理：用户退出登录 / 切换账号（resetAll 同步清空）
   *
   * 注意：不缓存"附件是否在本地"（isLocal/localPath）—— 那是文件系统 SSOT，
   * 永远由 useFileCache 通过 Rust get_cached_file_path 实时 stat 校验。
   */
  cachedFriendMessages: Record<string, Message[]>;

  /**
   * 群聊会话的消息缓存（key = groupId，value = 全量 GroupMessage）。
   * 与 cachedFriendMessages 同设计，但类型不同（Message vs GroupMessage 字段集差异）。
   * 同样不 slice(-50)，原因见上方注释。
   */
  cachedGroupMessages: Record<string, GroupMessage[]>;

  /**
   * 每会话的滚动锚点 message_uuid。
   *
   * key: 与 cachedMessages 同格式。
   * value: 视口顶部第一条完全可见消息的 message_uuid。
   *
   * 用途：用户在 A 中向上翻阅历史 → 切换到 B → 切回 A 时恢复到上次阅读位置。
   *
   * 时机：
   *   - 写入：ChatMessages 滚动事件 200ms 防抖后扫描视口顶部消息 uuid
   *   - 读取：ChatMessages 首次渲染时 useLayoutEffect 同步 scrollIntoView
   *   - 失效：锚点消息被本地删除（querySelector 返回 null）→ 降级滚到底
   *   - 清理：用户退出登录 / 切换账号
   */
  scrollAnchors: Record<string, string>;
}

interface ChatActions {
  // ==================== 好友操作 ====================
  /** 设置好友列表 */
  setFriends: (friends: Friend[]) => void;
  /** 设置好友加载状态 */
  setFriendsLoading: (loading: boolean) => void;
  /** 设置好友加载错误 */
  setFriendsError: (error: string | null) => void;
  /** 添加好友（WebSocket 通知时使用） */
  addFriend: (friend: Friend) => void;
  /** 移除好友（WebSocket 通知时使用） */
  removeFriend: (friendId: string) => void;

  // ==================== 群聊操作 ====================
  /** 设置群聊列表 */
  setGroups: (groups: Group[]) => void;
  /** 设置群聊加载状态 */
  setGroupsLoading: (loading: boolean) => void;
  /** 设置群聊加载错误 */
  setGroupsError: (error: string | null) => void;
  /** 添加群聊（WebSocket 通知时使用） */
  addGroup: (group: Group) => void;
  /** 移除群聊（WebSocket 通知时使用） */
  removeGroup: (groupId: string) => void;
  /**
   * 更新群聊信息（WebSocket 通知时使用）
   * 细粒度更新，只修改指定群的属性，不影响其他群
   */
  updateGroup: (groupId: string, updates: Partial<Group>) => void;

  // ==================== 聊天目标操作 ====================
  /** 设置当前聊天目标 */
  setChatTarget: (target: ChatTarget | null) => void;
  /**
   * 更新当前聊天目标的群角色
   * 用于 WebSocket 通知时同步更新 chatTarget
   */
  updateChatTargetRole: (groupId: string, role: 'owner' | 'admin' | 'member') => void;

  // ==================== 禁言操作 ====================
  /**
   * 设置用户在某群的禁言状态
   * @param groupId 群ID
   * @param mutedUntil 禁言结束时间（ISO 字符串）
   * @param reason 禁言原因（可选）
   */
  setMuteStatus: (groupId: string, mutedUntil: string, reason?: string) => void;
  /**
   * 清除用户在某群的禁言状态
   * @param groupId 群ID
   */
  clearMuteStatus: (groupId: string) => void;
  /**
   * 检查用户在某群是否被禁言
   * @param groupId 群ID
   * @returns 如果被禁言返回剩余时间（毫秒），否则返回 0
   */
  getMuteRemaining: (groupId: string) => number;

  // ==================== 会议操作 ====================
  /** 设置待加入会议状态 */
  setPendingMeetingJoin: (pending: boolean) => void;

  // ==================== 跳转操作 ====================
  /** 设置待跳转的目标消息 UUID（搜索结果点击时设置，ChatMessages 滚动到该消息后清空） */
  setPendingScrollToMessageId: (messageId: string | null) => void;

  // ==================== 切换会话恢复操作 ====================
  /**
   * 缓存私聊会话的全量当前 messages（unmount 时调用）。
   * 不截断 —— 完整保留 loadMore 加载的历史，确保滚动锚点可定位。
   */
  cacheFriendMessages: (friendId: string, messages: Message[]) => void;

  /**
   * 缓存群聊会话的全量当前 messages（unmount 时调用）。
   * 同 cacheFriendMessages，不截断。
   */
  cacheGroupMessages: (groupId: string, messages: GroupMessage[]) => void;

  /**
   * 保存某会话的滚动锚点 message_uuid（滚动事件防抖后调用）。
   * key 格式：`friend-${friendId}` / `group-${groupId}`
   */
  saveScrollAnchor: (key: string, messageUuid: string) => void;

  /**
   * 清空所有缓存和锚点（退出登录 / 切换账号时调用）。
   */
  clearCacheAndAnchors: () => void;
}

export type ChatStore = ChatState & ChatActions;

// ============================================
// Store 实现
// ============================================

export const useChatStore = create<ChatStore>((set, get) => ({
  // ==================== 初始状态 ====================
  friends: [],
  friendsLoading: true,
  friendsError: null,

  groups: [],
  groupsLoading: true,
  groupsError: null,

  chatTarget: null,

  muteStatus: {},

  pendingMeetingJoin: false,

  pendingScrollToMessageId: null,

  cachedFriendMessages: {},

  cachedGroupMessages: {},

  scrollAnchors: {},

  // ==================== 好友操作 ====================
  setFriends: (friends) => set({ friends }),

  setFriendsLoading: (loading) => set({ friendsLoading: loading }),

  setFriendsError: (error) => set({ friendsError: error }),

  addFriend: (friend) => set((state) => {
    // 避免重复添加
    if (state.friends.some((f) => f.friend_id === friend.friend_id)) {
      return state;
    }
    return { friends: [friend, ...state.friends] };
  }),

  removeFriend: (friendId) => set((state) => ({
    friends: state.friends.filter((f) => f.friend_id !== friendId),
  })),

  // ==================== 群聊操作 ====================
  setGroups: (groups) => set({ groups }),

  setGroupsLoading: (loading) => set({ groupsLoading: loading }),

  setGroupsError: (error) => set({ groupsError: error }),

  addGroup: (group) => set((state) => {
    // 避免重复添加
    if (state.groups.some((g) => g.group_id === group.group_id)) {
      return state;
    }
    return { groups: [group, ...state.groups] };
  }),

  removeGroup: (groupId) => set((state) => ({
    groups: state.groups.filter((g) => g.group_id !== groupId),
  })),

  updateGroup: (groupId, updates) => set((state) => ({
    groups: state.groups.map((g) =>
      g.group_id === groupId ? { ...g, ...updates } : g,
    ),
  })),

  // ==================== 聊天目标操作 ====================
  setChatTarget: (target) => set({ chatTarget: target }),

  updateChatTargetRole: (groupId, role) => {
    const { chatTarget } = get();
    if (
      chatTarget?.type === 'group' &&
      chatTarget.data.group_id === groupId
    ) {
      set({
        chatTarget: {
          type: 'group',
          data: { ...chatTarget.data, role },
        },
      });
    }
  },

  // ==================== 禁言操作 ====================
  setMuteStatus: (groupId, mutedUntil, reason) => set((state) => ({
    muteStatus: {
      ...state.muteStatus,
      [groupId]: { mutedUntil, reason },
    },
  })),

  clearMuteStatus: (groupId) => set((state) => {
    const newStatus = { ...state.muteStatus };
    delete newStatus[groupId];
    return { muteStatus: newStatus };
  }),

  // ==================== 会议操作 ====================
  setPendingMeetingJoin: (pending) => set({ pendingMeetingJoin: pending }),

  // ==================== 跳转操作 ====================
  setPendingScrollToMessageId: (messageId) => set({ pendingScrollToMessageId: messageId }),

  // ==================== 切换会话恢复操作 ====================
  // 缓存当前 messages 全量（不再 slice(-50)）：
  // 用户翻历史触发 loadMore 后，锚点 uuid 可能在第 50 条之外。若 slice(-50)
  // 缓存只保留尾部 → 切回时 DOM 无锚点元素 → 降级 scrollToBottom，导致回到底部
  // 而不是用户上次翻到的位置。完整缓存让锚点定位永远可用。
  // 内存代价：N 条消息 × ~1KB ≈ 几百 KB / 会话，桌面端可接受。
  cacheFriendMessages: (friendId, messages) =>
    set((state) => ({
      cachedFriendMessages: {
        ...state.cachedFriendMessages,
        [friendId]: messages,
      },
    })),

  cacheGroupMessages: (groupId, messages) =>
    set((state) => ({
      cachedGroupMessages: {
        ...state.cachedGroupMessages,
        [groupId]: messages,
      },
    })),

  saveScrollAnchor: (key, messageUuid) =>
    set((state) => ({
      scrollAnchors: { ...state.scrollAnchors, [key]: messageUuid },
    })),

  clearCacheAndAnchors: () =>
    set({ cachedFriendMessages: {}, cachedGroupMessages: {}, scrollAnchors: {} }),

  getMuteRemaining: (groupId) => {
    const { muteStatus } = get();
    const info = muteStatus[groupId];
    if (!info) { return 0; }

    const remaining = new Date(info.mutedUntil).getTime() - Date.now();
    return remaining > 0 ? remaining : 0;
  },
}));

// ============================================
// 选择器（Selectors）- 用于细粒度订阅
// ============================================

/**
 * 获取指定群的角色
 * 用于细粒度订阅，只在该群角色变化时触发重渲染
 */
export const selectGroupRole = (groupId: string) => (state: ChatStore) =>
  state.groups.find((g) => g.group_id === groupId)?.role;

/**
 * 获取指定好友
 */
export const selectFriend = (friendId: string) => (state: ChatStore) =>
  state.friends.find((f) => f.friend_id === friendId);

/**
 * 获取指定群聊
 */
export const selectGroup = (groupId: string) => (state: ChatStore) =>
  state.groups.find((g) => g.group_id === groupId);

/**
 * 判断当前聊天目标是否为指定群主/管理员
 */
export const selectIsGroupOwnerOrAdmin = (state: ChatStore) =>
  state.chatTarget?.type === 'group' &&
  (state.chatTarget.data.role === 'owner' || state.chatTarget.data.role === 'admin');

/**
 * 判断当前聊天目标是否为群主
 */
export const selectIsGroupOwner = (state: ChatStore) =>
  state.chatTarget?.type === 'group' && state.chatTarget.data.role === 'owner';

/**
 * 获取当前群的禁言状态
 * @returns MuteInfo 或 undefined
 */
export const selectCurrentMuteStatus = (state: ChatStore) => {
  if (state.chatTarget?.type !== 'group') { return undefined; }
  return state.muteStatus[state.chatTarget.data.group_id];
};
