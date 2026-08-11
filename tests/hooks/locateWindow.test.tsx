/**
 * 定位窗口化（locateMessage / loadNewerMessages / jumpToLatest）行为测试
 *
 * 被测的是**行为差**，不是某个字段长什么样：
 *
 *  1. 定位走的是「一次窗口查询」而**不是**「逐页翻到命中」
 *     —— 断言 `db.getMessagesAround` 被调、且 `db.getMessages` 一次都没被调用。
 *        原实现（loadUntilMessage）恰恰相反：循环调 getMessages 直到命中。
 *  2. 锚点不在本地库 → 返回 false（DB 层给 null），**不与「窗口为空」混同**
 *     —— 空数组会被上层误读成「这段真没消息」而静默空白。
 *  3. 🔴 护栏一：窗口态下 unmount **不写缓存**
 *     —— 否则下次进会话会从一段历史开场（.claude/rules/common.md
 *        「缓存与数据库 SSOT 协同」的同族失效形态）。
 *  4. 🔴 护栏二：窗口态下 `loadMessages` **不并最新 50 条**
 *     —— 并进来会让窗口与最新之间的断档在 UI 上完全看不出来。
 *  5. 锚点已经贴近最新（更新侧没取满）→ **不进窗口态**
 *     —— 否则会卡在「窗口态但没有更新的可加载」，两条护栏白挂。
 *  6. `jumpToLatest` 退出窗口态并整段换成最新一页。
 *
 * mock 的 context hook 返回值一律用 vi.hoisted 稳定单例（引用稳定，见 frontend-test.md：
 * 每次 render 返回新对象会虚假触发依赖 session 引用的 effect）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { LocalMessage } from '../../src/db';

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

const wsMock = vi.hoisted(() => ({
  connected: false,
  onNewMessage: () => () => {},
  onMessageRecalled: () => () => {},
  markRead: vi.fn(),
}));
vi.mock('../../src/contexts/WebSocketContext', () => ({ useWebSocket: () => wsMock }));

const dbMock = vi.hoisted(() => ({
  getMessages: vi.fn().mockResolvedValue([]),
  getMessagesAround: vi.fn().mockResolvedValue(null),
  getMessagesAfter: vi.fn().mockResolvedValue([]),
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

const groupsApiMock = vi.hoisted(() => ({
  getGroupMessageBlocks: vi.fn().mockResolvedValue([]),
  getGroupSpecialCares: vi.fn().mockResolvedValue([]),
  getGroupMemberRemarks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/api/groups', () => groupsApiMock);

import { useLocalFriendMessages } from '../../src/chat/friend/useLocalFriendMessages';
import { useLocalGroupMessages } from '../../src/chat/group/useLocalGroupMessages';
import { useChatStore } from '../../src/stores/chatStore';

/** 造一条本地消息行 */
function row(seq: number, uuid = `m${seq}`): LocalMessage {
  return {
    message_uuid: uuid,
    conversation_id: 'conv',
    conversation_type: 'friend',
    sender_id: 'them',
    sender_name: 'Them',
    sender_avatar: null,
    content: `消息 ${seq}`,
    content_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    image_width: null,
    image_height: null,
    seq,
    reply_to: null,
    media_group_id: null,
    media_group_index: null,
    media_group_count: null,
    is_recalled: false,
    is_deleted: false,
    send_time: `2026-01-01T00:00:${String(seq % 60).padStart(2, '0')}Z`,
    created_at: null,
  };
}

/** 造一个「锚点两侧都取满」的窗口（=> 真正进入窗口态） */
function fullWindow(anchorSeq: number, before = 30, after = 30): LocalMessage[] {
  const newer = Array.from({ length: after }, (_, i) => row(anchorSeq + after - i));
  const anchor = row(anchorSeq, 'anchor');
  const older = Array.from({ length: before }, (_, i) => row(anchorSeq - 1 - i));
  return [...newer, anchor, ...older];
}

describe('定位窗口化', () => {
  beforeEach(() => {
    Object.values(dbMock).forEach((fn) => {
      if (typeof fn === 'function' && 'mockClear' in fn) {
        (fn as ReturnType<typeof vi.fn>).mockClear();
      }
    });
    dbMock.getMessages.mockResolvedValue([]);
    dbMock.getMessagesAround.mockResolvedValue(null);
    dbMock.getMessagesAfter.mockResolvedValue([]);
    useChatStore.setState({ cachedFriendMessages: {} });
  });

  it('定位走单次窗口查询，而不是逐页翻到命中', async () => {
    dbMock.getMessagesAround.mockResolvedValue(fullWindow(1000));
    const { result } = renderHook(() => useLocalFriendMessages('them'));

    // 挂载期的初始加载会调 getMessages；先把它清掉，只观察定位这一步
    await waitFor(() => expect(result.current).toBeTruthy());
    dbMock.getMessages.mockClear();

    let ok = false;
    await act(async () => {
      ok = await result.current.locateMessage('anchor');
    });

    expect(ok).toBe(true);
    expect(dbMock.getMessagesAround).toHaveBeenCalledTimes(1);
    const [convId, anchorUuid, before, after] = dbMock.getMessagesAround.mock.calls[0]!;
    expect(anchorUuid).toBe('anchor');
    expect(before).toBe(30);
    expect(after).toBe(30);
    expect(typeof convId).toBe('string');

    // 关键反向断言：**一次都没有**走翻页。原实现正是循环调它直到命中。
    expect(dbMock.getMessages).not.toHaveBeenCalled();

    expect(result.current.messages).toHaveLength(61);
    expect(result.current.isWindowed).toBe(true);
  });

  it('锚点不在本地库 → 返回 false（不是「窗口为空」）', async () => {
    dbMock.getMessagesAround.mockResolvedValue(null);
    const { result } = renderHook(() => useLocalFriendMessages('them'));
    await waitFor(() => expect(result.current).toBeTruthy());

    let ok = true;
    await act(async () => {
      ok = await result.current.locateMessage('不存在');
    });

    expect(ok).toBe(false);
    expect(result.current.isWindowed).toBe(false);
  });

  it('护栏一：窗口态下 unmount 不写缓存', async () => {
    dbMock.getMessagesAround.mockResolvedValue(fullWindow(1000));
    const { result, unmount } = renderHook(() => useLocalFriendMessages('them'));
    await waitFor(() => expect(result.current).toBeTruthy());

    await act(async () => {
      await result.current.locateMessage('anchor');
    });
    expect(result.current.isWindowed).toBe(true);

    unmount();

    // 缓存里不许出现这段历史窗口 —— 否则下次进会话从历史开场
    expect(useChatStore.getState().cachedFriendMessages.them).toBeUndefined();
  });

  it('护栏二：窗口态下 loadMessages 不并最新 50 条', async () => {
    dbMock.getMessagesAround.mockResolvedValue(fullWindow(1000));
    const { result } = renderHook(() => useLocalFriendMessages('them'));
    await waitFor(() => expect(result.current).toBeTruthy());

    await act(async () => {
      await result.current.locateMessage('anchor');
    });
    const windowLen = result.current.messages.length;
    dbMock.getMessages.mockClear();
    dbMock.getMessages.mockResolvedValue([row(9999, 'newest')]);

    await act(async () => {
      await result.current.loadMessages();
    });

    // 既没去查，也没把最新那条并进来（并进来会造成看不出的断档）
    expect(dbMock.getMessages).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(windowLen);
    expect(result.current.messages.some((m) => m.message_uuid === 'newest')).toBe(false);
  });

  it('锚点贴近最新（更新侧没取满）→ 不进窗口态', async () => {
    // 更新侧只有 2 条 < 30 ⇒ 窗口已顶到最新，列表与最新连续
    dbMock.getMessagesAround.mockResolvedValue([
      row(1002),
      row(1001),
      row(1000, 'anchor'),
      ...Array.from({ length: 30 }, (_, i) => row(999 - i)),
    ]);
    const { result } = renderHook(() => useLocalFriendMessages('them'));
    await waitFor(() => expect(result.current).toBeTruthy());

    await act(async () => {
      await result.current.locateMessage('anchor');
    });

    expect(result.current.isWindowed).toBe(false);
    expect(result.current.hasNewer).toBe(false);
  });

  it('jumpToLatest 退出窗口态并换成最新一页', async () => {
    dbMock.getMessagesAround.mockResolvedValue(fullWindow(1000));
    const { result } = renderHook(() => useLocalFriendMessages('them'));
    await waitFor(() => expect(result.current).toBeTruthy());

    await act(async () => {
      await result.current.locateMessage('anchor');
    });
    expect(result.current.isWindowed).toBe(true);

    dbMock.getMessages.mockResolvedValue([row(9999, 'newest'), row(9998)]);
    await act(async () => {
      await result.current.jumpToLatest();
    });

    expect(result.current.isWindowed).toBe(false);
    expect(result.current.hasNewer).toBe(false);
    expect(result.current.messages[0]?.message_uuid).toBe('newest');
    expect(result.current.messages).toHaveLength(2);
  });

  it('窗口态向更新方向续加载：接到最新端即自动退出窗口态', async () => {
    dbMock.getMessagesAround.mockResolvedValue(fullWindow(1000));
    const { result } = renderHook(() => useLocalFriendMessages('them'));
    await waitFor(() => expect(result.current).toBeTruthy());

    await act(async () => {
      await result.current.locateMessage('anchor');
    });
    expect(result.current.hasNewer).toBe(true);

    // 返回不足一页 ⇒ 已经接上最新
    dbMock.getMessagesAfter.mockResolvedValue([row(1031, 'n1')]);
    await act(async () => {
      await result.current.loadNewerMessages();
    });

    expect(dbMock.getMessagesAfter).toHaveBeenCalledTimes(1);
    expect(result.current.messages[0]?.message_uuid).toBe('n1');
    expect(result.current.hasNewer).toBe(false);
    expect(result.current.isWindowed).toBe(false);
  });
});

/**
 * 群侧是私聊侧的**复制实现**（两个 hook 各一份），复制关系天然会漂移。
 * 这一组只钉最要命的三条：走窗口查询而非翻页、两条护栏。
 * 其余分支由私聊侧那组覆盖 —— 那些是同一段逻辑，复制漂移会先在这三条上暴露。
 */
describe('定位窗口化（群侧）', () => {
  beforeEach(() => {
    Object.values(dbMock).forEach((fn) => {
      if (typeof fn === 'function' && 'mockClear' in fn) {
        (fn as ReturnType<typeof vi.fn>).mockClear();
      }
    });
    dbMock.getMessages.mockResolvedValue([]);
    dbMock.getMessagesAround.mockResolvedValue(null);
    dbMock.getMessagesAfter.mockResolvedValue([]);
    useChatStore.setState({ cachedGroupMessages: {} });
  });

  it('走单次窗口查询，而不是逐页翻到命中', async () => {
    dbMock.getMessagesAround.mockResolvedValue(fullWindow(1000));
    const { result } = renderHook(() => useLocalGroupMessages('g1'));
    await waitFor(() => expect(result.current).toBeTruthy());
    dbMock.getMessages.mockClear();

    let ok = false;
    await act(async () => {
      ok = await result.current.locateMessage('anchor');
    });

    expect(ok).toBe(true);
    expect(dbMock.getMessagesAround).toHaveBeenCalledWith('g1', 'anchor', 30, 30);
    expect(dbMock.getMessages).not.toHaveBeenCalled();
    expect(result.current.isWindowed).toBe(true);
    expect(result.current.messages).toHaveLength(61);
  });

  it('护栏一：窗口态下 unmount 不写缓存', async () => {
    dbMock.getMessagesAround.mockResolvedValue(fullWindow(1000));
    const { result, unmount } = renderHook(() => useLocalGroupMessages('g1'));
    await waitFor(() => expect(result.current).toBeTruthy());
    await act(async () => {
      await result.current.locateMessage('anchor');
    });
    expect(result.current.isWindowed).toBe(true);

    unmount();
    expect(useChatStore.getState().cachedGroupMessages.g1).toBeUndefined();
  });

  it('护栏二：窗口态下 loadMessages 不并最新 50 条', async () => {
    dbMock.getMessagesAround.mockResolvedValue(fullWindow(1000));
    const { result } = renderHook(() => useLocalGroupMessages('g1'));
    await waitFor(() => expect(result.current).toBeTruthy());
    await act(async () => {
      await result.current.locateMessage('anchor');
    });
    const windowLen = result.current.messages.length;
    dbMock.getMessages.mockClear();
    dbMock.getMessages.mockResolvedValue([row(9999, 'newest')]);

    await act(async () => {
      await result.current.loadMessages();
    });

    expect(dbMock.getMessages).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(windowLen);
    expect(result.current.messages.some((m) => m.message_uuid === 'newest')).toBe(false);
  });
});
