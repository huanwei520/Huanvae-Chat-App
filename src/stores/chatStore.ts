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
import type { GroupReaderInfo } from '../chat/group/useGroupReadReceipt';

/**
 * 群已读位置内存镜像值（仿 cachedGroupMessages）：进群首帧从此秒取，消除两阶段弹入。
 * positions: member_id → last_read_seq（计数用）；readerInfo: member_id → 展示信息
 * （avatarUrl 为已解析的显示 URL）；memberCount: 群活跃成员总数。
 */
export interface GroupReadMirror {
  positions: Record<string, number>;
  readerInfo: Record<string, GroupReaderInfo>;
  memberCount: number;
}

// ============================================
// 类型定义
// ============================================

/**
 * 群聊「正在回复」草稿
 *
 * senderName / preview 在选中回复的那一刻就快照下来，不在渲染时反查——
 * 反查依赖被引用消息仍在已加载窗口内，而用户完全可能在编辑期间翻走历史。
 */
export interface ReplyDraft {
  /** 所属群 ID（用于校验草稿与当前会话一致，防止串会话发错引用） */
  groupId: string;
  /** 被回复消息的 UUID，发送时作为 reply_to 提交给后端 */
  messageUuid: string;
  /** 被回复者显示名（已套用群内私有备注） */
  senderName: string;
  /** 被回复消息的单行摘要 */
  preview: string;
}

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

  /**
   * 定位成功后要高亮的消息 UUID（回复引用点击 / 全局搜索跳转共用）
   *
   * useMainPage 在滚动到位后写入，并起一次性定时器在 2s 后清空；
   * GroupChatMessages 据此给对应气泡加 `.message-bubble--highlight`（CSS keyframes 脉冲）。
   */
  highlightedMessageId: string | null;

  /**
   * 消息定位失败的降级提示文案（null = 无提示）
   *
   * 触发点：loadUntilMessage 把本地历史翻完仍未命中目标（原消息更早于本地保留范围 /
   * 已被本地删除）。此时**必须**给用户明确反馈，不能静默无反应。
   *
   * 渲染方：ChatInputArea（桌面 + 移动共用，位于输入区上方）——刻意不放进
   * .chat-messages-container，那是 overflow:auto 的滚动容器，绝对定位浮层会锚到内容顶
   * 而非视口顶，用户滚到下面时根本看不见（见 .claude/rules/common.md 同名条目）。
   */
  messageJumpNotice: string | null;

  /**
   * 群聊「正在回复」草稿（null = 当前没在回复任何人）
   *
   * 只保留一条：切换会话时清空（见 setChatTarget），不做按会话多槽保留——
   * 回复目标是强上下文的临时意图，跨会话保活反而会让人发错引用。
   */
  replyDraft: ReplyDraft | null;

  // ==================== 切换会话恢复状态 ====================
  /**
   * 每会话当前已加载消息的全量内存缓存（含 loadMore 加载的历史）。
   *
   * key: `friend-${friendId}` / `group-${groupId}`。
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
   *   - 清理：用户退出登录 / 切换账号（clearMessageCache 同步清空，经 SessionContext.clearSession 调用）
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
   * 群已读位置内存镜像（key = groupId）——仿 cachedGroupMessages，进群二开首帧零异步。
   *
   * 写入：useGroupReadReceipt 的 unmount cleanup（保存当前已读态全量）。
   * 读取：useGroupReadReceipt 的 useState 懒初始化（hook 挂在按会话 key 键控的组件内，切会话即重挂，
   *   首帧懒初始化读镜像即够，无需 groupId 变更渲染期兜底）。
   * 清理：退出登录 / 切换账号（clearMessageCache）。
   * 与 db（group_read_positions 表）互补：镜像=会话内秒开，db=跨应用重启持久化。
   */
  cachedGroupReadPositions: Record<string, GroupReadMirror>;

  /**
   * 单聊对方已读位置内存镜像（key = conversationId，value = peerLastReadSeq）。
   * 同上设计；与 db（conversations.peer_last_read_seq）互补。
   */
  cachedFriendReadPositions: Record<string, number>;

  /**
   * 每群「我屏蔽的成员 user_id」集合（D6）。
   *
   * 服务端已过滤新同步/历史消息，但本地 SQLite 缓存的旧消息仍含被屏蔽者内容。
   * GroupMessageBubble 据此把这些消息渲染成折叠占位（隐藏内容），并保留消息体以便
   * 右键「取消屏蔽」——这是取消屏蔽的唯一入口（被隐藏的消息无法右键，故不能整条剔除）。
   * 进群时由 getGroupMessageBlocks 加载；屏蔽/取消时乐观更新。
   */
  groupMessageBlocks: Record<string, string[]>;

  /**
   * 每群「我特别关心的成员 user_id」集合（M3）。
   *
   * 效果：被关心成员在本群发言时，本地通知标题带 ⭐ 强提醒（判定在客户端）。
   * 进群时由 getGroupSpecialCares 加载；右键特别关心/取消时乐观更新。
   * 与 [[groupMessageBlocks]] 同为「群+成员」单向私有视图，互相独立。
   */
  groupSpecialCares: Record<string, string[]>;

  /**
   * 每群「我给成员设的私有备注」映射（D7）：groupId → { 被备注成员 user_id → 备注名 }。
   *
   * 效果：该成员在本群的显示名（消息气泡/成员列表/已读名单）对我显示为备注，
   * 优先级 备注 → 群昵称 → 用户昵称。进群时由 getGroupMemberRemarks 加载；设置/清除时乐观更新。
   * 仅自己可见，单向；与好友备注独立。
   */
  groupMemberRemarks: Record<string, Record<string, string>>;

  /**
   * 我拉黑某好友的时间点（userId → ISO 时间）。
   *
   * 用途：群消息「只折叠拉黑之后发的消息」——发送时间晚于此时间才折叠，
   * 拉黑前的历史消息保留原文。值统一为服务器 created_at（经 getBlacklistTimes 填充）：
   * 后台同步与拉黑动作均拉取服务器时间，取消拉黑时清除。是群折叠的单一真值源。
   */
  friendBlacklistTimes: Record<string, string>;

  /**
   * 好友在线状态映射：userId → { online, last_seen_at? }。
   *
   * 首屏由 GET /api/friends/presence 快照 seed，之后靠 WS presence_update 顶层消息增量维护
   * （上线/下线由服务端隐式推送）。单独一张表（不并入 friends 数组），避免每次状态心跳
   * churn 整个 friends 列表触发大范围重渲染。好友列表绿点 / 资料页在线态 / 聊天顶栏副标题据此展示。
   */
  friendPresence: Record<string, { online: boolean; last_seen_at?: string }>;
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
  /** 设置某好友的拉黑状态（拉黑/取消拉黑后乐观更新，列表与资料页即时反映）。取消拉黑时一并清除拉黑时间。 */
  setFriendBlacklisted: (friendId: string, blacklisted: boolean) => void;
  /** 批量设置拉黑时间映射（由 getBlacklistTimes 的服务器 created_at 填充：后台同步 + 拉黑动作） */
  setFriendBlacklistTimes: (times: Record<string, string>) => void;
  /** 设置某好友的特别关心状态（标星/取消后乐观更新，列表置顶/标星与资料页即时反映） */
  setFriendSpecialCare: (friendId: string, specialCare: boolean) => void;
  /** 批量 seed 好友在线状态（GET /api/friends/presence 首屏快照） */
  setFriendPresences: (entries: Array<{ user_id: string; online: boolean; last_seen_at?: string }>) => void;
  /** 增量更新单个好友在线状态（WS presence_update） */
  setFriendPresence: (userId: string, presence: { online: boolean; last_seen_at?: string }) => void;

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
  /** 设置某群「我屏蔽的成员」集合（进群时由 getGroupMessageBlocks 加载，D6） */
  setGroupMessageBlocks: (groupId: string, userIds: string[]) => void;
  /** 群内屏蔽/取消屏蔽某成员（右键操作 await API 成功后写入，群消息列表随之过滤/恢复，D6） */
  setGroupMemberBlocked: (groupId: string, userId: string, blocked: boolean) => void;
  /** 设置某群「我特别关心的成员」集合（进群时由 getGroupSpecialCares 加载，M3） */
  setGroupSpecialCares: (groupId: string, userIds: string[]) => void;
  /** 群内特别关心/取消某成员（右键操作 await API 成功后写入，影响该成员发言的通知强提醒 ⭐，M3） */
  setGroupMemberSpecialCare: (groupId: string, userId: string, cared: boolean) => void;
  /** 设置某群「我给成员设的备注」映射（进群时由 getGroupMemberRemarks 加载，D7） */
  setGroupMemberRemarks: (groupId: string, remarks: { user_id: string; remark: string }[]) => void;
  /** 设置/清除群内对某成员的备注（右键操作 await API 成功后写入；remark 为空串/null 表示清除，D7） */
  setGroupMemberRemark: (groupId: string, userId: string, remark: string | null) => void;

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
  /** 设置定位成功后高亮的消息 UUID（useMainPage 定时清空） */
  setHighlightedMessageId: (messageId: string | null) => void;
  /** 设置消息定位失败的降级提示文案（null = 清除） */
  setMessageJumpNotice: (notice: string | null) => void;

  // ==================== 群聊回复操作 ====================
  /** 设置 / 清空「正在回复」草稿 */
  setReplyDraft: (draft: ReplyDraft | null) => void;

  // ==================== 切换会话恢复操作 ====================
  /**
   * 缓存私聊会话的全量当前 messages（unmount 时调用）。
   * 不截断 —— 完整保留 loadMore 加载的历史，切回会话首帧即有完整上下文。
   */
  cacheFriendMessages: (friendId: string, messages: Message[]) => void;

  /**
   * 缓存群聊会话的全量当前 messages（unmount 时调用）。
   * 同 cacheFriendMessages，不截断。
   */
  cacheGroupMessages: (groupId: string, messages: GroupMessage[]) => void;

  /** 缓存群已读位置镜像（useGroupReadReceipt unmount 时调用，供二开首帧秒取）。 */
  cacheGroupReadPositions: (groupId: string, mirror: GroupReadMirror) => void;

  /** 缓存单聊对方已读位置镜像（useFriendReadReceipt unmount 时调用）。 */
  cacheFriendReadPositions: (conversationId: string, peerLastReadSeq: number) => void;

  /**
   * 清空所有消息缓存与群私有视图（退出登录 / 切换账号时调用）。
   */
  clearMessageCache: () => void;
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

  highlightedMessageId: null,

  messageJumpNotice: null,

  replyDraft: null,

  cachedFriendMessages: {},

  cachedGroupMessages: {},

  cachedGroupReadPositions: {},

  cachedFriendReadPositions: {},

  groupMessageBlocks: {},

  groupSpecialCares: {},

  groupMemberRemarks: {},

  friendBlacklistTimes: {},

  friendPresence: {},

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

  setFriendBlacklisted: (friendId, blacklisted) => set((state) => {
    const friends = state.friends.map((f) =>
      f.friend_id === friendId ? { ...f, is_blacklisted: blacklisted } : f,
    );
    if (blacklisted) {
      return { friends };
    }
    // 取消拉黑：一并清除记录的拉黑时间（群折叠随之恢复）
    const times = { ...state.friendBlacklistTimes };
    delete times[friendId];
    return { friends, friendBlacklistTimes: times };
  }),

  setFriendBlacklistTimes: (times) => set({ friendBlacklistTimes: times }),

  setFriendSpecialCare: (friendId, specialCare) => set((state) => ({
    friends: state.friends.map((f) =>
      f.friend_id === friendId ? { ...f, is_special_care: specialCare } : f,
    ),
  })),

  setFriendPresences: (entries) => set(() => {
    const map: Record<string, { online: boolean; last_seen_at?: string }> = {};
    entries.forEach((e) => {
      map[e.user_id] = { online: e.online, last_seen_at: e.last_seen_at };
    });
    return { friendPresence: map };
  }),

  setFriendPresence: (userId, presence) => set((state) => ({
    friendPresence: { ...state.friendPresence, [userId]: presence },
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

  setGroupMessageBlocks: (groupId, userIds) => set((state) => ({
    groupMessageBlocks: { ...state.groupMessageBlocks, [groupId]: userIds },
  })),

  setGroupMemberBlocked: (groupId, userId, blocked) => set((state) => {
    const cur = state.groupMessageBlocks[groupId] ?? [];
    let next: string[];
    if (!blocked) {
      next = cur.filter((id) => id !== userId);
    } else if (cur.includes(userId)) {
      next = cur;
    } else {
      next = [...cur, userId];
    }
    return { groupMessageBlocks: { ...state.groupMessageBlocks, [groupId]: next } };
  }),

  setGroupSpecialCares: (groupId, userIds) => set((state) => ({
    groupSpecialCares: { ...state.groupSpecialCares, [groupId]: userIds },
  })),

  setGroupMemberSpecialCare: (groupId, userId, cared) => set((state) => {
    const cur = state.groupSpecialCares[groupId] ?? [];
    let next: string[];
    if (!cared) {
      next = cur.filter((id) => id !== userId);
    } else if (cur.includes(userId)) {
      next = cur;
    } else {
      next = [...cur, userId];
    }
    return { groupSpecialCares: { ...state.groupSpecialCares, [groupId]: next } };
  }),

  setGroupMemberRemarks: (groupId, remarks) => set((state) => {
    const map: Record<string, string> = {};
    for (const r of remarks) { map[r.user_id] = r.remark; }
    return { groupMemberRemarks: { ...state.groupMemberRemarks, [groupId]: map } };
  }),

  setGroupMemberRemark: (groupId, userId, remark) => set((state) => {
    const cur = state.groupMemberRemarks[groupId] ?? {};
    const next = { ...cur };
    const trimmed = remark?.trim();
    if (trimmed) {
      next[userId] = trimmed;
    } else {
      delete next[userId];
    }
    return { groupMemberRemarks: { ...state.groupMemberRemarks, [groupId]: next } };
  }),

  // ==================== 聊天目标操作 ====================
  // 切会话一并丢掉「回复草稿 / 高亮 / 定位失败提示」这三样强会话上下文的临时态：
  // 回复草稿跨会话保留会让人对着 B 发出引用 A 的消息；高亮和提示都是上一条会话的残留。
  // 注意**不清** pendingScrollToMessageId —— 全局搜索的调用顺序正是「先 setChatTarget
  // 再 setPendingScrollToMessageId」，清了会把刚设的跳转目标顺手抹掉（见 Main.tsx:353-362）。
  setChatTarget: (target) => set({
    chatTarget: target,
    replyDraft: null,
    highlightedMessageId: null,
    messageJumpNotice: null,
  }),

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

  setHighlightedMessageId: (messageId) => set({ highlightedMessageId: messageId }),

  setMessageJumpNotice: (notice) => set({ messageJumpNotice: notice }),

  // ==================== 群聊回复操作 ====================
  setReplyDraft: (draft) => set({ replyDraft: draft }),

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

  cacheGroupReadPositions: (groupId, mirror) =>
    set((state) => ({
      cachedGroupReadPositions: {
        ...state.cachedGroupReadPositions,
        [groupId]: mirror,
      },
    })),

  cacheFriendReadPositions: (conversationId, peerLastReadSeq) =>
    set((state) => ({
      cachedFriendReadPositions: {
        ...state.cachedFriendReadPositions,
        [conversationId]: peerLastReadSeq,
      },
    })),

  clearMessageCache: () =>
    set({ cachedFriendMessages: {}, cachedGroupMessages: {}, cachedGroupReadPositions: {}, cachedFriendReadPositions: {}, groupMessageBlocks: {}, groupSpecialCares: {}, groupMemberRemarks: {}, friendBlacklistTimes: {}, friendPresence: {}, replyDraft: null, highlightedMessageId: null, messageJumpNotice: null }),

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
