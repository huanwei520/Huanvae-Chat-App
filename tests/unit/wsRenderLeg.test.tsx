/**
 * WS 渲染腿中集成测试：手工 JSON 帧 → 真 handleWebSocketMessage（wsHandlers.ts）
 * → 真 useLocalFriendMessages / useLocalGroupMessages → 真 MessageBubble /
 * GroupMessageBubble 渲染，断言"一条 new_message 帧到达后气泡列表出现该文本"。
 *
 * 接线方式镜像真实 WebSocketContext：ctx.newMessageListeners / recalledListeners
 * 与 mocked useWebSocket 注册进的是**同一个 Set**（wsListeners），因此帧经
 * handleWebSocketMessage 分发后由 hook 订阅回调消费，走完整渲染腿。
 *
 * ⚠️ 变异自证对象：注掉 wsHandlers.ts new_message 分支的
 * `ctx.newMessageListeners.current.forEach(cb => cb(msg))`，本文件用例 1/3/4 必翻
 * （变异验证由主对话执行，本文件只需保证用例走真实链路）。
 *
 * handleWebSocketMessage 内 saveMessageToLocal 是 fire-and-forget async，
 * 投递统一用 `await act(async () => {...})` 让微任务 flush。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import type { WsNewMessage, UnreadSummary } from '../../src/types/websocket';
import type { Friend } from '../../src/types/chat';
import type { SessionInfo } from '../../src/components/common/Avatar';
import type { MessageHandlerContext } from '../../src/contexts/wsHandlers';

// ============== 共同 mock 骨架（vi.hoisted 稳定单例） ==============

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
}));
const sessionMock = vi.hoisted(() => ({
  session: {
    userId: 'me',
    serverUrl: 'http://t',
    accessToken: 't',
    refreshToken: 'r',
    profile: {
      user_id: 'me',
      user_nickname: 'Me',
      user_email: null,
      user_signature: null,
      user_avatar_url: null,
      admin: 'false',
      created_at: '',
      updated_at: '',
    },
  },
}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => sessionMock,
  useApi: () => apiMock,
}));

const wsListeners = vi.hoisted(() => ({
  onNew: new Set<(m: import('../../src/types/websocket').WsNewMessage) => void>(),
  onRecalled: new Set<(m: import('../../src/types/websocket').WsMessageRecalled) => void>(),
}));
const wsMock = vi.hoisted(() => ({
  connected: false,
  onNewMessage: (cb: (m: import('../../src/types/websocket').WsNewMessage) => void) => {
    wsListeners.onNew.add(cb);
    return () => {
      wsListeners.onNew.delete(cb);
    };
  },
  onMessageRecalled: (cb: (m: import('../../src/types/websocket').WsMessageRecalled) => void) => {
    wsListeners.onRecalled.add(cb);
    return () => {
      wsListeners.onRecalled.delete(cb);
    };
  },
  markRead: vi.fn(),
}));
vi.mock('../../src/contexts/WebSocketContext', () => ({ useWebSocket: () => wsMock }));

const dbMock = vi.hoisted(() => ({
  getMessages: vi.fn().mockResolvedValue([]),
  getConversation: vi.fn().mockResolvedValue(null),
  saveMessage: vi.fn().mockResolvedValue(undefined),
  saveConversation: vi.fn().mockResolvedValue(undefined),
  markMessageRecalled: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  refreshConversationPreview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => dbMock);
vi.mock('../../src/services/syncService', () => ({ getSyncService: () => null }));
vi.mock('../../src/services/fileService', () => ({
  recordUploadedFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (s: string | null | undefined) => s ?? null,
}));

// 群 hook 三接口 + GroupMessageBubble 的右键操作接口（同模块，named import 必须齐全）
vi.mock('../../src/api/groups', () => ({
  getGroupMessageBlocks: vi.fn().mockResolvedValue([]),
  getGroupSpecialCares: vi.fn().mockResolvedValue([]),
  getGroupMemberRemarks: vi.fn().mockResolvedValue([]),
  addGroupMessageBlock: vi.fn().mockResolvedValue(undefined),
  removeGroupMessageBlock: vi.fn().mockResolvedValue(undefined),
  addGroupSpecialCare: vi.fn().mockResolvedValue(undefined),
  removeGroupSpecialCare: vi.fn().mockResolvedValue(undefined),
  setGroupMemberRemark: vi.fn().mockResolvedValue(undefined),
  removeGroupMemberRemark: vi.fn().mockResolvedValue(undefined),
}));

// new_message 分发分支会调 notifyNewMessage（非自己发的消息）
const notifMock = vi.hoisted(() => ({
  notifyNewMessage: vi.fn().mockResolvedValue(undefined),
  notifySystemEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/services/notificationService', () => notifMock);

// ============== 气泡重型依赖 mock（对齐 MessageBubbleRecalled / GroupMessageBubbleRecalled） ==============

vi.mock('../../src/chat/shared/MessageContextMenu', () => ({
  MessageContextMenu: () => null,
}));
vi.mock('../../src/chat/shared/FileMessageContent', () => ({
  FileMessageContent: ({ messageType }: { messageType: string }) => (
    <div data-testid="file-content" data-type={messageType}>FileContent</div>
  ),
}));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({
  MeetingInviteCard: () => <div data-testid="meeting-card">MeetingCard</div>,
}));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));
vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({
  MobileMessageFullPreview: () => null,
}));
vi.mock('../../src/services/fileCache', () => ({
  getCachedFilePath: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/utils/platform', () => ({
  isMobile: () => false,
}));
vi.mock('../../src/utils/saveToGallery', () => ({
  saveToGallery: vi.fn(),
}));
vi.mock('../../src/components/common/Avatar', () => ({
  UserAvatar: () => <div data-testid="user-avatar" />,
  FriendAvatar: () => <div data-testid="friend-avatar" />,
}));
vi.mock('../../src/hooks/useFileCache', () => ({
  useFileCache: () => ({
    localPath: null,
    isLocal: false,
  }),
}));

// selector-aware barrel mock（GroupMessageBubble/MessageBubble 从 '../../src/stores' 取
// useChatStore 选择器与 useProfileViewStore）。注意：hook 与 wsHandlers 用的是
// '../../src/stores/chatStore' 直接路径（真实 store），不受此 barrel mock 影响——
// 这正是本测试要的：渲染腿的组件视图用受控空值，消息链路数据走真实 store。
const mockChatState = vi.hoisted(() => ({
  friends: [] as unknown[],
  setChatTarget: () => {},
  groupMessageBlocks: {} as Record<string, string[]>,
  setGroupMemberBlocked: () => {},
  groupSpecialCares: {} as Record<string, string[]>,
  setGroupMemberSpecialCare: () => {},
  groupMemberRemarks: {} as Record<string, Record<string, string>>,
  setGroupMemberRemark: () => {},
  friendBlacklistTimes: {} as Record<string, string>,
}));
vi.mock('../../src/stores', () => ({
  useChatStore: (selector: (s: typeof mockChatState) => unknown) => selector(mockChatState),
  useProfileViewStore: () => vi.fn(),
}));

// ============== 真实 SUT ==============

import { handleWebSocketMessage } from '../../src/contexts/wsHandlers';
import { useLocalFriendMessages } from '../../src/chat/friend/useLocalFriendMessages';
import { MessageBubble } from '../../src/chat/friend/MessageBubble';
import { useLocalGroupMessages } from '../../src/chat/group/useLocalGroupMessages';
import { GroupMessageBubble } from '../../src/chat/group/GroupMessageBubble';
import { useChatStore } from '../../src/stores/chatStore';

// ============== fixture（抄 MessageBubbleRecalled.test.tsx） ==============

const session: SessionInfo & { userId: string } = {
  serverUrl: 'http://test',
  userId: 'me',
  accessToken: 't',
  refreshToken: 'r',
  profile: {
    user_id: 'me',
    user_nickname: 'Me',
    user_email: null,
    user_signature: null,
    user_avatar_url: null,
    admin: 'false',
    created_at: '',
    updated_at: '',
  },
  avatarPath: null,
} as never;

const friend: Friend = {
  friend_id: 'them',
  friend_nickname: 'Them',
  friend_email: null,
  friend_signature: null,
  friend_avatar_url: null,
  add_time: '2026-01-01T00:00:00Z',
} as never;

// ============== 组织：ctx（关键接线：listeners 指向 hook 订阅进的同一个 Set） ==============

function makeCtx() {
  return {
    activeChatRef: { current: null },
    currentUserId: 'me',
    setUnreadSummary: vi.fn(),
    setPendingNotifications: vi.fn(),
    newMessageListeners: { current: wsListeners.onNew },
    recalledListeners: { current: wsListeners.onRecalled },
    notificationListeners: { current: new Set() },
    readSyncListeners: { current: new Set() },
    sendResyncReadPositions: vi.fn(),
    flushPendingMarkReads: vi.fn(),
    markActiveChatRead: vi.fn(),
  };
}
const toCtx = (ctx: ReturnType<typeof makeCtx>) => ctx as unknown as MessageHandlerContext;

function friendFrame(overrides: Partial<WsNewMessage> = {}): string {
  return JSON.stringify({
    type: 'new_message',
    source_type: 'friend',
    source_id: 'them',
    message_uuid: 'm-ws-1',
    sender_id: 'them',
    sender_nickname: 'Them',
    content: '来自WS的问候',
    message_type: 'text',
    seq: 3,
    timestamp: '2026-01-02T00:00:00Z',
    ...overrides,
  });
}

// ============== Harness：真 hook + 真气泡 ==============

function FriendHarness() {
  const { messages } = useLocalFriendMessages('them');
  return (
    <div>
      {messages.map((m) => (
        <MessageBubble
          key={m.clientId ?? m.message_uuid}
          message={m}
          isOwn={m.sender_id === 'me'}
          session={session}
          friend={friend}
        />
      ))}
    </div>
  );
}

function GroupHarness() {
  const { messages } = useLocalGroupMessages('g-1');
  return (
    <div>
      {messages.map((m) => (
        <GroupMessageBubble
          key={m.clientId ?? m.message_uuid}
          message={m}
          isOwn={m.sender_id === 'me'}
          groupId="g-1"
        />
      ))}
    </div>
  );
}

describe('WS 渲染腿：帧 → 真分发 → 真 hook → 真气泡', () => {
  beforeEach(() => {
    cleanup();
    wsListeners.onNew.clear();
    wsListeners.onRecalled.clear();
    useChatStore.setState({
      cachedFriendMessages: {},
      cachedGroupMessages: {},
      groupMessageBlocks: {},
      friendBlacklistTimes: {},
      groupSpecialCares: {},
      friends: [],
    });
  });

  it('好友渲染腿：new_message 帧到达 → 气泡列表出现该文本 + 落库 + 未读摘要更新', async () => {
    render(<FriendHarness />);
    const ctx = makeCtx();

    await act(async () => {
      handleWebSocketMessage(friendFrame(), toCtx(ctx));
    });

    expect(await screen.findByText('来自WS的问候')).toBeInTheDocument();

    // 分发分支落库副作用（saveMessageToLocal）
    expect(dbMock.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      message_uuid: 'm-ws-1',
      conversation_id: 'conv-me-them',
      conversation_type: 'friend',
      content: '来自WS的问候',
      seq: 3,
    }));

    // 未读摘要 functional updater：activeChat=null → shouldIncrement=true
    expect(ctx.setUnreadSummary).toHaveBeenCalledTimes(1);
    const updater = ctx.setUnreadSummary.mock.calls[0][0] as
      (prev: UnreadSummary | null) => UnreadSummary;
    const next = updater(null);
    expect(next.friend_unreads[0]).toMatchObject({
      friend_id: 'them',
      unread_count: 1,
      last_message_preview: '来自WS的问候',
    });
  });

  it('负控（过滤契约）：别的会话的帧不出现在本会话气泡列表', async () => {
    render(<FriendHarness />);
    const ctx = makeCtx();

    await act(async () => {
      handleWebSocketMessage(
        friendFrame({ source_id: 'other-friend', message_uuid: 'm-other', content: '别的会话消息' }),
        toCtx(ctx),
      );
    });

    expect(screen.queryByText('别的会话消息')).toBeNull();
    expect(document.querySelector('.message-bubble')).toBeNull();
  });

  it('群渲染腿：group new_message 帧到达 → 群气泡出现该文本', async () => {
    render(<GroupHarness />);
    const ctx = makeCtx();

    await act(async () => {
      handleWebSocketMessage(
        friendFrame({
          source_type: 'group',
          source_id: 'g-1',
          message_uuid: 'm-ws-g1',
          content: '群WS消息',
        }),
        toCtx(ctx),
      );
    });

    expect(await screen.findByText('群WS消息')).toBeInTheDocument();
    expect(dbMock.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      message_uuid: 'm-ws-g1',
      conversation_id: 'g-1',
      conversation_type: 'group',
    }));
  });

  it('撤回渲染腿：new_message 后同 uuid 的 message_recalled 帧 → 撤回占位出现、原文本消失', async () => {
    render(<FriendHarness />);
    const ctx = makeCtx();

    await act(async () => {
      handleWebSocketMessage(
        friendFrame({ message_uuid: 'm-rc-1', content: '将被撤回' }),
        toCtx(ctx),
      );
    });
    expect(screen.getByText('将被撤回')).toBeInTheDocument();

    await act(async () => {
      handleWebSocketMessage(JSON.stringify({
        type: 'message_recalled',
        source_type: 'friend',
        source_id: 'them',
        message_uuid: 'm-rc-1',
        recalled_by: 'them',
      }), toCtx(ctx));
    });

    expect(document.querySelector('.recall-system-row')).toBeInTheDocument();
    expect(screen.queryByText('将被撤回')).toBeNull();
    // 全局 handler 侧的落库副作用（与 hook 侧幂等冗余）
    expect(dbMock.markMessageRecalled).toHaveBeenCalledWith('m-rc-1');
  });
});
