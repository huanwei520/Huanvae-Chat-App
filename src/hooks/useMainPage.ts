/**
 * 主页面状态管理 Hook
 *
 * 基于 Zustand store 重构的主页面状态管理
 *
 * 负责：
 * - 聊天目标管理（通过 Zustand store）
 * - 消息发送
 * - 文件上传
 * - 系统通知处理（好友/群聊相关实时通知）
 *
 * 重构要点：
 * - chatTarget 状态迁移到 Zustand store
 * - WebSocket 回调中使用 store.getState() 获取最新状态，避免依赖数组问题
 * - 群角色更新使用 store 的 updateGroup 和 updateChatTargetRole 方法
 * - WS 新消息/撤回订阅已统一由各消息 hook 内部管理（避免双重订阅导致消息重复）
 *
 * 支持的系统通知类型：
 * - friend_request_approved: 好友请求通过，添加好友到列表
 * - friend_deleted: 被好友删除，从列表移除
 * - group_join_approved: 入群申请通过，添加群到列表
 * - group_removed/disbanded: 被移出群/群解散，从列表移除
 * - owner_transferred: 群主转让，更新角色
 * - admin_set/removed: 管理员变更，更新角色
 * - member_muted: 成员被禁言，存储禁言状态
 * - member_unmuted: 成员被解禁，清除禁言状态
 * - group_info_updated: 群名称更新
 * - group_avatar_updated: 群头像更新
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession, useApi } from '../contexts/SessionContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useChatStore } from '../stores';
import { useSettingsStore } from '../stores/settingsStore';
import { useFriends } from './useFriends';
import { useGroups } from './useGroups';
import { useLocalFriendMessages } from '../chat/friend/useLocalFriendMessages';
import { useLocalGroupMessages } from '../chat/group/useLocalGroupMessages';
import { useAIMessages } from '../chat/ai/useAIMessages';
import { useVoiceCall } from '../chat/ai/voice/useVoiceCall';
import { useVoiceProfiles } from '../chat/ai/voice/useVoiceProfiles';
import { scrollMessageIntoView } from '../chat/shared/scrollMessageIntoView';
import { markLocalSend } from '../chat/shared/useStickToBottom';
import { draftKeyOf } from '../chat/shared/conversationKey';
import { useResizablePanel } from './useResizablePanel';
import { useFileUpload } from './useFileUpload';
import type { MediaGroupMeta } from './useFileUpload';
import { useChatActions } from './useChatActions';
import { useMultiSelect } from './useMultiSelect';
import { getPendingRequests } from '../api/friends';
import { getGroupInvitations } from '../api/groups';
import { invoke } from '@tauri-apps/api/core';
import { saveFileUuidHash, saveMessage, clearCurrentUser } from '../db';
import { getFriendConversationId } from '../utils/conversationId';
import { isFriendLikeTarget } from '../utils/chatTarget';
import type { NavTab } from '../components/sidebar/Sidebar';
import type { AttachmentType } from '../chat';
import type { Friend, Group, ChatTarget } from '../types/chat';
import type {
  FriendApprovedData,
  GroupJoinApprovedData,
  GroupRemovedData,
  FriendDeletedData,
  OwnerTransferredData,
  AdminChangedData,
  GroupInfoUpdatedData,
  GroupAvatarUpdatedData,
  MemberMutedData,
  MemberUnmutedData,
} from '../types/websocket';
import { resolveServerAvatarUrl } from '../utils/avatar';
import {
  ALBUM_MIN_ITEMS,
  describePartialFailure,
  planAlbumUpload,
  runAlbumUpload,
} from '../chat/shared/albumSend';
import type { PickedFile } from '../chat/shared/FileAttachButton';

// 侧边栏宽度常量
const MIN_PANEL_WIDTH = 88;
const MAX_PANEL_WIDTH = 280;

/**
 * 消息定位失败之一：**本地库里没有这条消息**（窗口化查询 getMessagesAround 返回 null）。
 * 真的取不到数据，重试也没用 —— 文案据此如实说「不在本地记录中」。
 */
const MESSAGE_JUMP_NOT_FOUND_NOTICE = '原消息不在本地记录中，无法定位';
/**
 * 消息定位失败之二：**数据取到了、DOM 里却找不到那个节点**（渲染层缺陷）。
 *
 * 🔴 这两条必须是两句话。它们同源共用一句文案时，排查会被直接带偏到「数据库/同步」方向 ——
 * 而真因可能纯粹在渲染层（实例：相册折叠后组内非代表成员不产出任何带 data-message-uuid
 * 的节点，于是每一张 media_group_index >= 1 的图都必然走到这一支，却谎报「不在本地记录中」）。
 * 同仓 Rust 侧 `src-tauri/src/db/messages.rs` 早就把「锚点不存在」与「查询出错」拆成两条出口。
 */
const MESSAGE_JUMP_RENDER_MISS_NOTICE = '定位失败，请重试';
/** 定位命中后高亮脉冲的存活时长（ms） */
const HIGHLIGHT_DURATION_MS = 2000;
/** 定位失败提示条的自动消失时长（ms） */
const JUMP_NOTICE_DURATION_MS = 4000;

// ============================================
// 文件上传成功后的公共处理逻辑
// ============================================

/**
 * 上传成功后处理：缓存文件、保存消息、保存映射
 *
 * 提取此函数是为了消除好友/群聊文件上传的重复代码（约 80 行）
 */
interface UploadSuccessOptions {
  result: {
    fileHash?: string;
    fileUuid?: string;
    fileUrl?: string;
    messageUuid?: string;
    messageSendTime?: string;
    imageWidth?: number | null;
    imageHeight?: number | null;
  };
  file: File;
  localPath?: string;
  messageType: 'image' | 'video' | 'file';
  timestamp: string;
  session: { userId: string; profile: { user_nickname: string; user_avatar_url: string | null } };
  conversationType: 'friend' | 'group';
  conversationId: string;
  /**
   * 相册三件套；单发不传。
   *
   * 必须在这里落库：本条是**自己发的**消息，服务端不会再经 WS 把它推回来，
   * 上传后紧跟的 loadXxxMessages() 直接读本地库 —— 这里写 null 的话，
   * 自己刚发出的相册在自己屏幕上会散成 N 张独立图（对端却是正常一组）。
   * 这正是 common.md「数据要穿过几段就得验几段」里的第 ② 段。
   */
  mediaGroup?: MediaGroupMeta;
  /**
   * 本条生效的配文；只有组首项（index 0）会带。
   *
   * 后端 `resolve_content`（storage/handlers/upload.rs）在 caption 非空白时**用它取代**
   * 文件名派生正文，而契约里「`index=0` 那条的 `message_content` 即整组配文」
   * （backend-docs/messages/好友消息.md）—— 本地这份乐观副本不跟着写，
   * 自己刚发的相册在自己屏幕上就会把**文件名**当配文显示。
   */
  caption?: string;
}

async function processUploadSuccess(options: UploadSuccessOptions): Promise<void> {
  const { result, file, localPath, messageType, timestamp, session, conversationType, conversationId, mediaGroup, caption } = options;

  if (!result.fileUuid || !result.fileHash) {
    return;
  }

  // 1. 保存 file_uuid 到 file_hash 的映射
  await saveFileUuidHash(result.fileUuid, result.fileHash);
  // eslint-disable-next-line no-console
  console.log('%c[FileUpload] 保存 UUID-Hash 映射', 'color: #FF9800; font-weight: bold', {
    fileUuid: result.fileUuid,
    fileHash: result.fileHash,
  });

  // 2. 如果有本地路径，复制到统一缓存目录（大文件≥阈值不复制，记录原始路径）
  if (localPath) {
    try {
      const { fileCache } = useSettingsStore.getState();
      const thresholdBytes = fileCache.largeFileThresholdMB * 1024 * 1024;
      const cachedPath = await invoke<string>('copy_file_to_cache', {
        sourcePath: localPath,
        fileHash: result.fileHash,
        fileName: file.name,
        fileType: messageType,
        fileSize: file.size,
        largeFileThreshold: thresholdBytes,
      });
      // eslint-disable-next-line no-console
      console.log('%c[FileUpload] 文件已缓存到统一目录', 'color: #2196F3; font-weight: bold', {
        fileHash: result.fileHash,
        originalPath: localPath,
        cachedPath,
        isLargeFile: file.size >= thresholdBytes,
      });
    } catch (cacheErr) {
      console.error('[FileUpload] 缓存文件失败:', cacheErr);
    }
  }

  // 3. 保存消息到本地数据库（后端上传时会自动发送消息）
  if (result.messageUuid) {
    await saveMessage({
      message_uuid: result.messageUuid,
      conversation_id: conversationId,
      conversation_type: conversationType,
      sender_id: session.userId,
      sender_name: session.profile.user_nickname,
      sender_avatar: session.profile.user_avatar_url,
      // 配文生效时取代文件名（与后端 resolve_content 同口径）；单发不传 caption ⇒ 仍是 file.name
      content: caption?.trim() || file.name,
      content_type: messageType,
      file_uuid: result.fileUuid,
      file_url: result.fileUrl || null,
      file_size: file.size,
      file_hash: result.fileHash,
      image_width: result.imageWidth ?? null,
      image_height: result.imageHeight ?? null,
      seq: 0,
      reply_to: null,
      // 相册三件套：单发时 mediaGroup 为 undefined ⇒ 三列均 null（与从前逐字一致）
      media_group_id: mediaGroup?.id ?? null,
      media_group_index: mediaGroup?.index ?? null,
      media_group_count: mediaGroup?.count ?? null,
      is_recalled: false,
      is_deleted: false,
      send_time: result.messageSendTime || timestamp,
    });
    // eslint-disable-next-line no-console
    console.log('%c[FileUpload] 保存消息到本地数据库', 'color: #9C27B0; font-weight: bold', {
      messageUuid: result.messageUuid,
      fileName: file.name,
      conversationId,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
    });
  }
}

export function useMainPage() {
  const { session, clearSession } = useSession();
  const api = useApi();
  const {
    markRead,
    unreadSummary,
    pendingNotifications,
    initPendingNotifications,
    setActiveChat,
    updateLastMessage,
    onSystemNotification,
  } = useWebSocket();

  // ============================================
  // Zustand Store - 聊天目标状态
  // ============================================
  const chatTarget = useChatStore((state) => state.chatTarget);
  const setChatTarget = useChatStore((state) => state.setChatTarget);
  // 注意：updateChatTargetRole 在 WebSocket 回调中通过 store.getState() 使用

  // 消息定位（全局搜索点击 / 群聊回复引用点击共用）：监听 store.pendingScrollToMessageId
  const pendingScrollToMessageId = useChatStore((s) => s.pendingScrollToMessageId);
  const setPendingScrollToMessageId = useChatStore((s) => s.setPendingScrollToMessageId);
  // 定位成功后的高亮 / 定位失败的降级提示（两者都由本 hook 定时清空）
  const highlightedMessageId = useChatStore((s) => s.highlightedMessageId);
  const setHighlightedMessageId = useChatStore((s) => s.setHighlightedMessageId);
  const messageJumpNotice = useChatStore((s) => s.messageJumpNotice);
  const setMessageJumpNotice = useChatStore((s) => s.setMessageJumpNotice);
  // 群聊「正在回复」草稿：发送时取出作为 reply_to，发完即清
  const replyDraft = useChatStore((s) => s.replyDraft);
  const setReplyDraft = useChatStore((s) => s.setReplyDraft);

  // ============================================
  // 好友/群聊 Hooks（内部使用 Zustand store）
  // ============================================
  const {
    friends,
    loading: friendsLoading,
    error: friendsError,
    refresh: refreshFriends,
    // addFriend 在 WebSocket 回调中通过 store.getState() 使用
    removeFriend,
  } = useFriends();

  const {
    groups,
    loading: groupsLoading,
    error: groupsError,
    refresh: refreshGroups,
    addGroup,
    removeGroup,
    // updateGroup 在 WebSocket 回调中通过 store.getState() 使用
  } = useGroups();

  // 基础状态
  const [activeTab, setActiveTab] = useState<NavTab>('chat');
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // ============================================
  // 输入框草稿：按会话独立保存
  // ============================================
  // 此前 messageInput 是**全局一份**，所有会话共用 —— 切到别的聊天再切回来，
  // 之前敲了一半的内容会串台/丢失。改为按会话 key 存草稿：切走存、切回取。
  //
  // 只存在内存（useRef，不落 localStorage）：草稿是「这次会话期间的临时输入」，
  // 落盘会带来「重启后冒出旧草稿」的困惑，且未发送内容持久化到磁盘属多余的数据留存。
  // 需求只要求「切换会话之间保持」，内存足够。
  //
  // 桌面与移动端共用本 hook（Main.tsx / MobileMain.tsx 都读 page.messageInput），
  // 所以这一处改动**两端同时生效**。
  const draftsRef = useRef<Record<string, string>>({});
  const messageInputRef = useRef(messageInput);
  messageInputRef.current = messageInput;

  const draftKey = draftKeyOf(chatTarget);
  const prevDraftKeyRef = useRef<string | null>(draftKey);

  useEffect(() => {
    const prev = prevDraftKeyRef.current;
    if (prev === draftKey) { return; }
    // 切走：存下当前这条会话的半成品（空串也要存，代表"清空过"）
    if (prev !== null) {
      draftsRef.current[prev] = messageInputRef.current;
    }
    // 切回：恢复目标会话的草稿；没存过就是空
    // （messageInput 通过 messageInputRef 读最新值，故不进依赖 —— 否则每敲一个字都会重跑）
    setMessageInput(draftKey !== null ? (draftsRef.current[draftKey] ?? '') : '');
    prevDraftKeyRef.current = draftKey;
  }, [draftKey]);

  // 弹窗状态
  const [showProfileModal, setShowProfileModal] = useState(false);

  // 文件上传
  const { uploading, progress, uploadFriendFile, uploadGroupFile, resetUpload } = useFileUpload();
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  /** 相册合成面板：用户多选后待确认的文件；null = 面板关闭 */
  const [albumPicked, setAlbumPicked] = useState<PickedFile[] | null>(null);
  /** 相册整组发送中（禁用面板交互，避免重复提交） */
  const [albumSending, setAlbumSending] = useState(false);

  // 侧边栏宽度调整
  const { panelWidth, isResizing, handleResizeStart } = useResizablePanel({
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH,
  });

  // 私聊消息（本地优先）；bot 目标与好友共用同一条私聊消息链路
  const friendId = isFriendLikeTarget(chatTarget) ? chatTarget.data.friend_id : null;
  const {
    messages: friendMessages,
    loading: friendMessagesLoading,
    hasMore: friendHasMore,
    loadingMore: friendLoadingMore,
    // syncing: friendSyncing, // 后台同步状态（用于 UI 指示）
    sendTextMessage: sendFriendMessage,
    // sendMediaMessage: sendFriendMediaMessage, // 媒体消息发送（保留用于将来）
    loadMessages: loadFriendMessages,
    loadMoreMessages: loadMoreFriendMessages,
    locateMessage: locateFriendMessage,
    isWindowed: friendIsWindowed,
    hasNewer: friendHasNewer,
    loadNewerMessages: loadNewerFriendMessages,
    jumpToLatest: jumpToLatestFriend,
    removeMessage: removeFriendMessage,
    recall: recallFriendMessage,
  } = useLocalFriendMessages(friendId);

  // 群聊消息（本地优先）
  const groupId = chatTarget?.type === 'group' ? chatTarget.data.group_id : null;
  const {
    messages: groupMessages,
    loading: groupMessagesLoading,
    hasMore: groupHasMore,
    loadingMore: groupLoadingMore,
    // syncing: groupSyncing, // 后台同步状态（用于 UI 指示）
    sendTextMessage: sendGroupMessage,
    // sendMediaMessage: sendGroupMediaMessage, // 媒体消息发送（保留用于将来）
    loadMessages: loadGroupMessages,
    loadMoreMessages: loadMoreGroupMessages,
    locateMessage: locateGroupMessage,
    isWindowed: groupIsWindowed,
    hasNewer: groupHasNewer,
    loadNewerMessages: loadNewerGroupMessages,
    jumpToLatest: jumpToLatestGroup,
    removeMessage: removeGroupMessage,
    recall: recallGroupMessage,
  } = useLocalGroupMessages(groupId);

  // AI 消息
  const ai = useAIMessages(api);

  // AI 语音通话
  const voiceCall = useVoiceCall(api);
  const voiceProfiles = useVoiceProfiles(api);

  // 消息操作 Hook
  const { handleRecallMessage, handleDeleteMessage } = useChatActions({
    chatTarget,
    removeFriendMessage,
    removeGroupMessage,
    recallFriendMessage,
    recallGroupMessage,
  });

  // 多选模式 Hook
  const {
    isMultiSelectMode,
    selectedMessages,
    handleToggleSelect,
    handleEnterMultiSelect,
    handleExitMultiSelect,
    handleSelectAll,
    handleDeselectAll,
    handleBatchDelete,
    handleBatchRecall,
  } = useMultiSelect({
    chatTarget,
    friendMessages,
    groupMessages,
    handleRecallMessage,
    handleDeleteMessage,
  });

  // ============================================
  // 初始化待处理通知
  // ============================================
  const initDone = useRef(false);
  useEffect(() => {
    if (initDone.current) { return; }
    initDone.current = true;

    const loadPendingNotifications = async () => {
      try {
        const [friendRequestsRes, groupInvitesRes] = await Promise.all([
          getPendingRequests(api),
          getGroupInvitations(api),
        ]);

        const friendRequestsCount = Array.isArray(friendRequestsRes) ? friendRequestsRes.length : 0;
        const groupInvitesCount = groupInvitesRes.invitations?.length || 0;

        initPendingNotifications({
          friendRequests: friendRequestsCount,
          groupInvites: groupInvitesCount,
        });
      } catch {
        // 初始化失败不影响使用
      }
    };

    loadPendingNotifications();
  }, [api, initPendingNotifications]);

  // ============================================
  // 加载消息并标记已读
  // ============================================
  useEffect(() => {
    if (isFriendLikeTarget(chatTarget)) {
      loadFriendMessages();
      // bot 未读同样挂在 friend_unreads 上，通道 id 固定 'friend'
      markRead('friend', chatTarget.data.friend_id);
    } else if (chatTarget?.type === 'group') {
      loadGroupMessages();
      markRead('group', chatTarget.data.group_id);
    }
  }, [chatTarget, loadFriendMessages, loadGroupMessages, markRead]);

  // WS 新消息 / 撤回事件的订阅已统一由各消息 hook 内部处理
  // （useLocalFriendMessages / useLocalGroupMessages 内含 ws.onNewMessage + ws.onMessageRecalled）
  // markRead 也在 hook 内的 WS 监听回调中调用，避免双重订阅导致消息重复

  // ============================================
  // 订阅系统通知（关键重构：移除 groups 依赖）
  // ============================================
  useEffect(() => {
    const unsubscribe = onSystemNotification((msg) => {
      // 使用 store.getState() 获取最新状态，避免依赖数组问题
      const store = useChatStore.getState();
      const currentTarget = store.chatTarget;

      switch (msg.notification_type) {
        // ==================== 好友相关通知 ====================
        case 'friend_request':
          break;

        case 'friend_request_approved': {
          const friendData = msg.data as unknown as FriendApprovedData;
          if (friendData.friend_id) {
            const newFriend: Friend = {
              friend_id: friendData.friend_id,
              friend_nickname: friendData.friend_nickname,
              friend_avatar_url: resolveServerAvatarUrl(friendData.friend_avatar_url) || null,
              add_time: friendData.add_time,
              approve_reason: null,
              // 新通过的好友尚无备注
              friend_remark: null,
              // 新通过的好友默认未拉黑
              is_blacklisted: false,
              // 新通过的好友默认未特别关心
              is_special_care: false,
            };
            store.addFriend(newFriend);
          }
          break;
        }

        case 'friend_request_rejected':
          break;

        case 'friend_deleted': {
          const deletedData = msg.data as unknown as FriendDeletedData;
          if (deletedData.friend_id) {
            store.removeFriend(deletedData.friend_id);
            if (isFriendLikeTarget(currentTarget) && currentTarget.data.friend_id === deletedData.friend_id) {
              store.setChatTarget(null);
              setActiveChat(null, null);
            }
          }
          break;
        }

        // ==================== 群聊邀请和加入通知 ====================
        case 'group_invite':
          break;

        case 'group_join_request':
          break;

        case 'group_join_approved': {
          const groupData = msg.data as unknown as GroupJoinApprovedData;
          if (groupData.group_id) {
            const newGroup: Group = {
              group_id: groupData.group_id,
              group_name: groupData.group_name,
              group_avatar_url: resolveServerAvatarUrl(groupData.group_avatar_url) ?? '',
              role: groupData.role || 'member',
              unread_count: 0,
              last_message_content: null,
              last_message_time: null,
            };
            store.addGroup(newGroup);
          }
          break;
        }

        // ==================== 群聊移除/解散通知 ====================
        case 'group_removed':
        case 'group_disbanded': {
          const removedData = msg.data as unknown as GroupRemovedData;
          if (removedData.group_id) {
            store.removeGroup(removedData.group_id);
            if (currentTarget?.type === 'group' && currentTarget.data.group_id === removedData.group_id) {
              store.setChatTarget(null);
              setActiveChat(null, null);
            }
          }
          break;
        }

        // ==================== 群主转让通知（关键修复） ====================
        case 'owner_transferred': {
          const transferData = msg.data as unknown as OwnerTransferredData;
          if (transferData.group_id && session) {
            // 判断当前用户的新角色
            let newRole: 'owner' | 'admin' | 'member' | null = null;
            if (transferData.new_owner_id === session.userId) {
              newRole = 'owner';
            } else if (transferData.old_owner_id === session.userId) {
              newRole = 'member';
            }

            if (newRole) {
              // 使用 store 方法更新群角色（不触发整个列表重渲染）
              store.updateGroup(transferData.group_id, { role: newRole });
              // 同时更新 chatTarget（如果当前正在查看该群）
              store.updateChatTargetRole(transferData.group_id, newRole);
            }
          }
          break;
        }

        // ==================== 管理员变更通知 ====================
        case 'admin_set': {
          const adminData = msg.data as unknown as AdminChangedData;
          if (adminData.group_id && session && adminData.target_user_id === session.userId) {
            store.updateGroup(adminData.group_id, { role: 'admin' });
            store.updateChatTargetRole(adminData.group_id, 'admin');
          }
          break;
        }

        case 'admin_removed': {
          const adminData = msg.data as unknown as AdminChangedData;
          if (adminData.group_id && session && adminData.target_user_id === session.userId) {
            store.updateGroup(adminData.group_id, { role: 'member' });
            store.updateChatTargetRole(adminData.group_id, 'member');
          }
          break;
        }

        // ==================== 禁言通知 ====================
        case 'member_muted': {
          const muteData = msg.data as unknown as MemberMutedData;
          // 只处理当前用户被禁言的情况
          if (muteData.group_id && session && muteData.target_user_id === session.userId) {
            store.setMuteStatus(muteData.group_id, muteData.mute_until, muteData.reason);
          }
          break;
        }

        case 'member_unmuted': {
          const unmuteData = msg.data as unknown as MemberUnmutedData;
          // 只处理当前用户被解除禁言的情况
          if (unmuteData.group_id && session && unmuteData.target_user_id === session.userId) {
            store.clearMuteStatus(unmuteData.group_id);
          }
          break;
        }

        // ==================== 群信息更新通知 ====================
        case 'group_info_updated': {
          const infoData = msg.data as unknown as GroupInfoUpdatedData;
          if (infoData.group_id && infoData.new_name) {
            store.updateGroup(infoData.group_id, { group_name: infoData.new_name });
            // 更新 chatTarget
            if (currentTarget?.type === 'group' && currentTarget.data.group_id === infoData.group_id) {
              store.setChatTarget({
                type: 'group',
                data: { ...currentTarget.data, group_name: infoData.new_name },
              });
            }
          }
          break;
        }

        case 'group_avatar_updated': {
          const avatarData = msg.data as unknown as GroupAvatarUpdatedData;
          if (avatarData.group_id) {
            const resolvedUrl = resolveServerAvatarUrl(avatarData.new_avatar_url) || '';
            store.updateGroup(avatarData.group_id, { group_avatar_url: resolvedUrl });
            if (currentTarget?.type === 'group' && currentTarget.data.group_id === avatarData.group_id) {
              store.setChatTarget({
                type: 'group',
                data: { ...currentTarget.data, group_avatar_url: resolvedUrl },
              });
            }
          }
          break;
        }

        // ==================== 新成员加入通知 ====================
        case 'group_member_joined':
          // 成员列表的实时更新可以在 ChatMenu 组件中实现
          break;

        // ==================== 群公告更新通知 ====================
        case 'group_notice_updated':
          break;
      }
    });
    return unsubscribe;
  }, [session, onSystemNotification, setActiveChat]);
  // 注意：依赖数组中移除了 groups、chatTarget、addFriend 等
  // 因为我们在回调中使用 store.getState() 获取最新值

  // ============================================
  // 消息发送
  // ============================================
  const handleSendMessage = useCallback(async () => {
    if (!messageInput.trim() || !chatTarget) { return; }

    const content = messageInput.trim();
    setMessageInput('');
    // 发出去了就不再是草稿 —— 不清的话切走再切回，已发送的内容会作为草稿复活
    if (draftKey !== null) {
      delete draftsRef.current[draftKey];
    }

    if (chatTarget.type === 'ai') {
      await ai.sendMessage(content);
      return;
    }

    const timestamp = new Date().toISOString();

    // 回复草稿必须属于当前会话才作数（切会话时 setChatTarget 已清，这里是第二道闸，
    // 防止任何未来的清理时序漏洞把 A 会话的引用发到 B 会话）。
    // 群聊与私聊同一口径 —— 私聊 reply_to 自 migration 036 起后端已支持。
    const replyTo = draftKey && replyDraft?.conversationKey === draftKey
      ? replyDraft.messageUuid
      : undefined;
    // 先清草稿再 await：发送是异步的，不先清会让「正在回复」条在整个网络往返期间挂着，
    // 用户以为没发出去而重复点发送。
    if (replyDraft) { setReplyDraft(null); }

    if (isFriendLikeTarget(chatTarget)) {
      await sendFriendMessage(content, replyTo);
      updateLastMessage('friend', chatTarget.data.friend_id, content, 'text', timestamp);
    } else {
      await sendGroupMessage(content, replyTo);
      updateLastMessage('group', chatTarget.data.group_id, content, 'text', timestamp);
    }
  }, [messageInput, chatTarget, sendFriendMessage, sendGroupMessage, updateLastMessage, ai, draftKey, replyDraft, setReplyDraft]);

  // ============================================
  // 文件上传
  // ============================================
  const handleFileSelect = useCallback(async (file: File, type: AttachmentType, localPath?: string) => {
    if (!chatTarget || chatTarget.type === 'ai') { return; }

    setUploadingFile(file);

    const messageTypeMap: Record<AttachmentType, 'image' | 'video' | 'file'> = {
      image: 'image',
      video: 'video',
      file: 'file',
    };
    const messageType = messageTypeMap[type];
    const timestamp = new Date().toISOString();

    // eslint-disable-next-line no-console
    console.log('%c[FileUpload] 开始上传文件', 'color: #FF9800; font-weight: bold', {
      fileName: file.name,
      fileSize: file.size,
      fileType: messageType,
      localPath: localPath || '(无)',
    });

    try {
      if (isFriendLikeTarget(chatTarget)) {
        const result = await uploadFriendFile(file, chatTarget.data.friend_id);
        if (result.success) {
          // eslint-disable-next-line no-console
          console.log('%c[FileUpload] 好友文件上传成功', 'color: #4CAF50; font-weight: bold', {
            fileName: file.name,
            fileHash: result.fileHash,
            fileUuid: result.fileUuid,
            messageUuid: result.messageUuid,
            instant: result.instant,
          });

          // 使用公共函数处理上传成功后的逻辑（缓存、保存消息、映射）
          if (session) {
            const conversationId = getFriendConversationId(session.userId, chatTarget.data.friend_id);
            await processUploadSuccess({
              result,
              file,
              localPath,
              messageType,
              timestamp,
              session,
              conversationType: 'friend',
              conversationId,
            });
          }

          // 文件/图片/视频这条发送路径**没有乐观插入**：消息是落库后由 loadFriendMessages()
          // 重新读 DB 灌回来的，不带 clientId ⇒ 消息列表会把它当成"非实时加载"而不贴底。
          // 在重灌**之前**打一次标记，让「我刚发出去的东西」同样无条件滚到底。
          // 紧贴重灌调用（而不是上传开始时）打，窗口才够短，不会被同期到达的别人消息误消费。
          markLocalSend();
          loadFriendMessages();
          updateLastMessage('friend', chatTarget.data.friend_id, file.name, messageType, timestamp);
        } else {
          console.error('[FileUpload] 文件上传失败:', result.error);
        }
      } else {
        const result = await uploadGroupFile(file, chatTarget.data.group_id);
        if (result.success) {
          // eslint-disable-next-line no-console
          console.log('%c[FileUpload] 群文件上传成功', 'color: #4CAF50; font-weight: bold', {
            fileName: file.name,
            fileHash: result.fileHash,
            fileUuid: result.fileUuid,
            messageUuid: result.messageUuid,
            instant: result.instant,
          });

          // 使用公共函数处理上传成功后的逻辑（缓存、保存消息、映射）
          if (session) {
            await processUploadSuccess({
              result,
              file,
              localPath,
              messageType,
              timestamp,
              session,
              conversationType: 'group',
              conversationId: chatTarget.data.group_id,
            });
          }

          // 同私聊分支：无乐观插入，靠标记认领这次「本机发送动作」（理由见上）
          markLocalSend();
          loadGroupMessages();
          updateLastMessage('group', chatTarget.data.group_id, file.name, messageType, timestamp);
        } else {
          console.error('[FileUpload] 文件上传失败:', result.error);
        }
      }
    } catch (err) {
      console.error('[FileUpload] 文件上传异常:', err);
    } finally {
      setTimeout(() => {
        setUploadingFile(null);
        resetUpload();
      }, 1500);
    }
  }, [chatTarget, session, uploadFriendFile, uploadGroupFile, loadFriendMessages, loadGroupMessages, resetUpload, updateLastMessage]);

  /** 多选图片/视频 ⇒ 打开相册合成面板（选中 1 个时 FileAttachButton 仍走单发，不进这里） */
  const handleFilesSelect = useCallback((picked: PickedFile[]) => {
    setAlbumPicked(picked);
  }, []);

  const handleAlbumCancel = useCallback(() => {
    setAlbumPicked(null);
  }, []);

  /**
   * 相册发送：串行上传每一项，三件套与配文由 albumSend 编排
   *
   * 「传一半失败」的口径在 runAlbumUpload 里（失败即停、不回滚、如实上报），
   * 这里只负责把结果翻译成用户看得懂的提示 —— 已成功的那几张对方**已经收到了**，
   * 说成「发送失败」会让用户重发整组造成重复。
   */
  const handleAlbumSend = useCallback(async (files: PickedFile[], caption: string) => {
    if (!chatTarget || chatTarget.type === 'ai' || !session) { return; }
    // 少于 2 张不成组：交给既有单发路径，行为与从前一致
    if (files.length < ALBUM_MIN_ITEMS) {
      setAlbumPicked(null);
      if (files.length === 1) {
        // 类型按文件本身判，不能写死 'image' —— 面板里把 3 个视频删到只剩 1 个就会走到这，
        // 写死会让这条视频在本地被记成图片（缩略图渲染器都不同）
        const single = files[0];
        await handleFileSelect(
          single.file,
          single.file.type.startsWith('video/') ? 'video' : 'image',
          single.localPath,
        );
      }
      return;
    }

    setAlbumSending(true);
    const groupId = crypto.randomUUID();
    const plans = planAlbumUpload(files, groupId, caption);
    const isFriend = isFriendLikeTarget(chatTarget);
    const relatedId = isFriend ? chatTarget.data.friend_id : chatTarget.data.group_id;
    const timestamp = new Date().toISOString();

    const result = await runAlbumUpload(plans, async (plan) => {
      setUploadingFile(plan.file.file);
      // 一个 meta 同时喂给「上传请求」与「本地落库」—— 两处各写一份必然漂移，
      // 而漂移的症状是静默的（对端正常成组、自己这边散架）
      const meta: MediaGroupMeta = { id: plan.groupId, index: plan.index, count: plan.count };
      const uploaded = isFriend
        ? await uploadFriendFile(plan.file.file, relatedId, meta, plan.caption)
        : await uploadGroupFile(plan.file.file, relatedId, meta, plan.caption);
      if (!uploaded.success) {
        throw new Error(uploaded.error || '上传失败');
      }
      await processUploadSuccess({
        result: uploaded,
        file: plan.file.file,
        localPath: plan.file.localPath,
        messageType: plan.file.file.type.startsWith('video/') ? 'video' : 'image',
        timestamp,
        session,
        conversationType: isFriend ? 'friend' : 'group',
        conversationId: isFriend ? getFriendConversationId(session.userId, relatedId) : relatedId,
        mediaGroup: meta,
        // planAlbumUpload 已保证只有 index 0 带 caption（后端对其余位次带 caption 直接 400）
        caption: plan.caption,
      });
    });

    setAlbumSending(false);
    setAlbumPicked(null);
    setUploadingFile(null);
    resetUpload();

    if (isFriend) { loadFriendMessages(); } else { loadGroupMessages(); }
    const preview = caption.trim() || `[相册] ${result.succeeded} 张`;
    updateLastMessage(isFriend ? 'friend' : 'group', relatedId, preview, 'image', timestamp);

    // 传一半：明说已发出几张、对方已能看到，不笼统报「失败」
    if (!result.complete) {
      setMessageJumpNotice(describePartialFailure(result));
    }
  }, [chatTarget, session, uploadFriendFile, uploadGroupFile, loadFriendMessages, loadGroupMessages,
    resetUpload, updateLastMessage, setMessageJumpNotice, handleFileSelect]);

  // ============================================
  // 选择处理
  // ============================================
  const handleSelectTarget = useCallback((target: ChatTarget) => {
    // 通话中切换到非 AI 目标时自动最小化
    if (voiceCall.state.isActive && target.type !== 'ai') {
      voiceCall.minimize();
    }
    if (voiceCall.state.isActive && target.type === 'ai') {
      voiceCall.restore();
    }

    setChatTarget(target);
    if (target.type === 'ai') {
      setActiveChat(null, null);
    } else if (isFriendLikeTarget(target)) {
      // bot 与好友同走 'friend' 数据面通道（activeChat / markRead）
      setActiveChat('friend', target.data.friend_id);
      markRead('friend', target.data.friend_id);
    } else {
      setActiveChat('group', target.data.group_id);
      markRead('group', target.data.group_id);
    }
  }, [markRead, setActiveChat, setChatTarget, voiceCall]);

  const handleTabChange = useCallback((tab: NavTab) => {
    setActiveTab(tab);
    setSearchQuery('');
  }, []);

  // ============================================
  // 聊天菜单回调
  // ============================================
  const handleFriendRemoved = useCallback(() => {
    if (isFriendLikeTarget(chatTarget)) {
      removeFriend(chatTarget.data.friend_id);
    }
    setChatTarget(null);
    setActiveChat(null, null);
  }, [chatTarget, removeFriend, setActiveChat, setChatTarget]);

  const handleGroupUpdated = useCallback(async () => {
    const updatedGroups = await refreshGroups();
    const currentTarget = useChatStore.getState().chatTarget;
    if (currentTarget?.type === 'group') {
      const updatedGroup = updatedGroups.find(
        (g) => g.group_id === currentTarget.data.group_id,
      );
      if (updatedGroup) {
        setChatTarget({ type: 'group', data: updatedGroup });
      }
    }
  }, [refreshGroups, setChatTarget]);

  const handleGroupLeft = useCallback(() => {
    if (chatTarget?.type === 'group') {
      removeGroup(chatTarget.data.group_id);
    }
    setChatTarget(null);
    setActiveChat(null, null);
  }, [chatTarget, removeGroup, setActiveChat, setChatTarget]);

  const handleLogout = useCallback(async () => {
    // 清除当前用户数据目录上下文
    await clearCurrentUser();
    // 清除会话（clearSession 内部已统一清空消息缓存/群内屏蔽·特别关心·备注私有视图，避免下个登录用户串数据）
    clearSession();
  }, [clearSession]);

  const handleCancelUpload = useCallback(() => {
    setUploadingFile(null);
    resetUpload();
  }, [resetUpload]);

  // 历史记录加载完成后刷新消息列表（卡片预览由 DB 层自动通知）
  const handleHistoryLoaded = useCallback(() => {
    if (isFriendLikeTarget(chatTarget)) {
      loadFriendMessages();
    } else if (chatTarget?.type === 'group') {
      loadGroupMessages();
    }
  }, [chatTarget, loadFriendMessages, loadGroupMessages]);

  // 消息定位（全局搜索结果点击 / 群聊回复引用点击共用同一条通路）：
  // chatTarget 与 pendingScrollToMessageId 同时存在时，走窗口化定位（locate*Message，
  // 一次性取锚点前后各 30 条，DB 侧 getMessagesAround）→ 在 DOM 中查找元素
  // → 滚消息列表容器自己（scrollMessageIntoView，不冒泡到祖先）→ 高亮 → 清空 pending。
  // 窗口化查询在本地库里找不到该锚点（原消息早于本地保留范围 / 已被本地删除）→ 写降级提示，
  // 绝不静默无反应（用户点了引用块必须得到反馈）。
  useEffect(() => {
    if (!pendingScrollToMessageId || !chatTarget) {
      return;
    }
    // AI 会话不支持跳转
    if (chatTarget.type === 'ai') {
      setPendingScrollToMessageId(null);
      return;
    }

    let cancelled = false;
    const targetId = pendingScrollToMessageId;

    const run = async () => {
      const ok =
        isFriendLikeTarget(chatTarget)
          ? await locateFriendMessage(targetId)
          : await locateGroupMessage(targetId);
      if (cancelled) {
        return;
      }
      if (!ok) {
        setMessageJumpNotice(MESSAGE_JUMP_NOT_FOUND_NOTICE);
        setPendingScrollToMessageId(null);
        return;
      }
      // 🔴 等**两帧**再滚，不是一帧。`await locate*Message` 只等到 `setMessages` 被**调用**，
      // React 尚未提交渲染 —— 单帧里滚的可能是**旧 DOM**（定位窗口还没长出来），
      // 落点自然不对。双 rAF 保证「提交 + 绘制」都已完成，与 JumpToLatestButton 的
      // 「有重载」分支同款（那条是真机实测踩出来的，见其 handleClick 注释）。
      requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        requestAnimationFrame(() => {
          if (cancelled) {
            return;
          }
          if (scrollMessageIntoView(targetId)) {
            // 只有真滚到了才高亮：DOM 里找不到元素时高亮会落到看不见的地方，
            // 用户只会看到「点了没反应」，那种情况按定位失败给提示更诚实。
            setHighlightedMessageId(targetId);
          } else {
            // 数据层已确认这条消息在本地库里（locate*Message 返回了 true 且窗口已装载），
            // 走到这里 = 它没能渲染出带 data-message-uuid 的节点 ⇒ 渲染层缺陷，
            // 与「本地库里没有」是两码事，文案与诊断都必须分开。
            console.error('[定位] 窗口已装载但 DOM 中无该消息节点', { messageUuid: targetId });
            setMessageJumpNotice(MESSAGE_JUMP_RENDER_MISS_NOTICE);
          }
          setPendingScrollToMessageId(null);
        });
      });
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    pendingScrollToMessageId,
    chatTarget,
    locateFriendMessage,
    locateGroupMessage,
    setPendingScrollToMessageId,
    setHighlightedMessageId,
    setMessageJumpNotice,
  ]);

  // 高亮自动熄灭：脉冲动画约 1.6s，2s 后清掉状态（留一点余量让动画收尾）
  useEffect(() => {
    if (!highlightedMessageId) {
      return;
    }
    const timer = setTimeout(() => setHighlightedMessageId(null), HIGHLIGHT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [highlightedMessageId, setHighlightedMessageId]);

  // 降级提示自动消失（用户也可以点提示条上的 × 立即关掉）
  useEffect(() => {
    if (!messageJumpNotice) {
      return;
    }
    const timer = setTimeout(() => setMessageJumpNotice(null), JUMP_NOTICE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [messageJumpNotice, setMessageJumpNotice]);

  // ============================================
  // 计算属性
  // ============================================
  const isLoading = isFriendLikeTarget(chatTarget) ? friendMessagesLoading : groupMessagesLoading;
  const currentMessages = isFriendLikeTarget(chatTarget) ? friendMessages : groupMessages;
  const totalMessageCount = currentMessages.length;

  // 加载更多历史消息
  const hasMore = isFriendLikeTarget(chatTarget) ? friendHasMore : groupHasMore;
  const loadingMore = isFriendLikeTarget(chatTarget) ? friendLoadingMore : groupLoadingMore;
  const handleLoadMore = useCallback(() => {
    if (isFriendLikeTarget(chatTarget)) {
      loadMoreFriendMessages();
    } else if (chatTarget?.type === 'group') {
      loadMoreGroupMessages();
    }
  }, [chatTarget, loadMoreFriendMessages, loadMoreGroupMessages]);

  // 定位窗口态：把私聊 / 群聊两套收敛成一组出口，UI 无需分辨会话类型
  //
  // `isWindowed` 为真 = 当前列表是「围绕某条历史消息的一段窗口」，**里面没有最新消息**。
  // 这正是「一键回到最底部」不能只滚容器的原因：滚到底只会到达**已加载区域**的底，
  // 而不是最新 —— 必须走 handleJumpToLatest 重新取最新段并退出窗口态。
  const isWindowed = isFriendLikeTarget(chatTarget) ? friendIsWindowed : groupIsWindowed;
  const hasNewer = isFriendLikeTarget(chatTarget) ? friendHasNewer : groupHasNewer;
  const handleLoadNewer = useCallback(() => {
    if (isFriendLikeTarget(chatTarget)) {
      loadNewerFriendMessages();
    } else if (chatTarget?.type === 'group') {
      loadNewerGroupMessages();
    }
  }, [chatTarget, loadNewerFriendMessages, loadNewerGroupMessages]);
  const handleJumpToLatest = useCallback(async () => {
    if (isFriendLikeTarget(chatTarget)) {
      await jumpToLatestFriend();
    } else if (chatTarget?.type === 'group') {
      await jumpToLatestGroup();
    }
  }, [chatTarget, jumpToLatestFriend, jumpToLatestGroup]);

  const canBatchRecall = chatTarget?.type === 'group' &&
    (chatTarget.data.role === 'owner' || chatTarget.data.role === 'admin');

  const pendingNotificationCount =
    pendingNotifications.friendRequests +
    pendingNotifications.groupInvites +
    pendingNotifications.groupJoinRequests;

  return {
    // Session
    session,

    // 基础状态
    activeTab,
    chatTarget,
    messageInput,
    setMessageInput,
    searchQuery,
    setSearchQuery,

    // 弹窗状态
    showProfileModal,
    setShowProfileModal,

    // 好友/群聊数据
    friends,
    friendsLoading,
    friendsError,
    groups,
    groupsLoading,
    groupsError,
    refreshFriends,
    addGroup,
    refreshGroups,

    // 消息数据
    friendMessages,
    groupMessages,
    isLoading,
    currentMessages,
    totalMessageCount,

    // 加载更多
    hasMore,
    // 定位窗口态（供「一键回到最底部」与向下续加载消费）
    isWindowed,
    hasNewer,
    handleLoadNewer,
    handleJumpToLatest,
    loadingMore,
    handleLoadMore,

    // 文件上传
    uploading,
    progress,
    uploadingFile,

    // 多选模式
    isMultiSelectMode,
    selectedMessages,
    canBatchRecall,

    // 面板
    panelWidth,
    isResizing,

    // WebSocket
    unreadSummary,
    pendingNotificationCount,

    // 操作方法
    handleTabChange,
    handleSelectTarget,
    handleSendMessage,
    handleFileSelect,
    // 相册（多选 → 合成面板 → 串行上传）
    albumPicked,
    albumSending,
    handleFilesSelect,
    handleAlbumSend,
    handleAlbumCancel,
    handleCancelUpload,
    handleResizeStart,

    // 消息操作
    handleToggleSelect,
    handleEnterMultiSelect,
    handleExitMultiSelect,
    handleSelectAll,
    handleDeselectAll,
    handleBatchDelete,
    handleBatchRecall,
    handleRecallMessage,
    handleDeleteMessage,

    // 聊天菜单回调
    handleFriendRemoved,
    handleGroupUpdated,
    handleGroupLeft,
    handleHistoryLoaded,
    handleLogout,

    // AI 消息
    aiMessages: ai.messages,
    aiStreamingContent: ai.streamingContent,
    aiStreamingReasoning: ai.streamingReasoning,
    aiIsLoading: ai.isLoading,
    aiToolStatus: ai.toolStatus,
    aiPendingToolCall: ai.pendingToolCall,
    aiRetryLastMessage: ai.retryLastMessage,
    aiConfirmToolCall: ai.handleConfirmToolCall,
    aiRejectToolCall: ai.handleRejectToolCall,
    aiConversationTitle: ai.conversationTitle,
    aiConversations: ai.conversations,
    aiConversationsLoading: ai.conversationsLoading,
    aiConversationId: ai.conversationId,
    aiLoadConversations: ai.loadConversations,
    aiSwitchConversation: ai.switchConversation,
    aiDeleteConversation: ai.deleteConversation,
    aiNewConversation: ai.newConversation,

    // AI 语音通话
    voiceCallState: voiceCall.state,
    voiceCallTurns: voiceCall.turns,
    voiceStartCall: voiceCall.startCall,
    voiceDisconnect: voiceCall.disconnect,
    voiceToggleMute: voiceCall.toggleMute,
    voiceMinimize: voiceCall.minimize,
    voiceRestore: voiceCall.restore,

    // 声音配置
    voiceProfiles: voiceProfiles.profiles,
    voiceProfilesLoading: voiceProfiles.loading,
    voiceProfilesUploading: voiceProfiles.uploading,
    voiceProfilesError: voiceProfiles.error,
    selectedVoiceProfileId: voiceProfiles.selectedId,
    voiceProfileRefresh: voiceProfiles.refresh,
    voiceProfileUpload: voiceProfiles.upload,
    voiceProfileSetDefault: voiceProfiles.setDefault,
    voiceProfileDelete: voiceProfiles.remove,
    voiceProfileSelect: voiceProfiles.select,
    voiceProfileUpdatePrompt: voiceProfiles.updatePrompt,
  };
}
