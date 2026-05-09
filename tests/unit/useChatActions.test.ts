/**
 * useChatActions 撤回路径回归测试
 *
 * 防回归契约（与 src/hooks/useChatActions.ts 文件头注释对齐）：
 *
 * 1. handleRecallMessage 必须委托 useLocalFriendMessages.recall / useLocalGroupMessages.recall
 *    —— 二者内部已实现 [server → setMessages.map(is_recalled=true) → markMessageRecalled]，
 *    确保撤回后当前聊天界面立即翻转为「消息已撤回」占位。
 *
 * 2. handleRecallMessage 禁止调用 removeFriendMessage / removeGroupMessage
 *    —— 老路径会把消息直接 filter 移除，用户看不到撤回胶囊。
 *
 * 3. handleRecallMessage 禁止调用 db.markMessageDeleted
 *    —— 老路径写 is_deleted=1 会让会话预览 JOIN 把这条排除，卡片排序退回。
 *
 * 4. recall 成功后调 refreshLastMessagePreview 同步会话卡片预览。
 *
 * 5. handleDeleteMessage 仍走 removeXxxMessage + markMessageDeleted（删除语义未变）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Hoisted mocks，避开 vi.mock 提升导致引用前未初始化的问题
const mocks = vi.hoisted(() => ({
  useApi: vi.fn(),
  useWebSocket: vi.fn(),
  deleteMessage: vi.fn(),
  deleteGroupMessage: vi.fn(),
  markMessageDeleted: vi.fn(),
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: mocks.useApi,
}));

vi.mock('../../src/contexts/WebSocketContext', () => ({
  useWebSocket: mocks.useWebSocket,
}));

vi.mock('../../src/api/messages', () => ({
  deleteMessage: mocks.deleteMessage,
}));

vi.mock('../../src/api/groupMessages', () => ({
  deleteGroupMessage: mocks.deleteGroupMessage,
}));

vi.mock('../../src/db', () => ({
  markMessageDeleted: mocks.markMessageDeleted,
}));

import { useChatActions } from '../../src/hooks/useChatActions';
import type { ChatTarget } from '../../src/types/chat';

const friendTarget: ChatTarget = {
  type: 'friend',
  data: {
    friend_id: 'friend-1',
    friend_nickname: 'F',
    friend_email: null,
    friend_signature: null,
    friend_avatar_url: null,
    add_time: '2026-01-01T00:00:00Z',
  } as never,
};

const groupTarget: ChatTarget = {
  type: 'group',
  data: {
    group_id: 'group-1',
    group_name: 'G',
  } as never,
};

describe('useChatActions.handleRecallMessage 走 hook recall（防回归）', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recallFriendMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recallGroupMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let removeFriendMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let removeGroupMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let refreshLastMessagePreview: any;

  beforeEach(() => {
    recallFriendMessage = vi.fn().mockResolvedValue(true);
    recallGroupMessage = vi.fn().mockResolvedValue(true);
    removeFriendMessage = vi.fn();
    removeGroupMessage = vi.fn();
    refreshLastMessagePreview = vi.fn().mockResolvedValue(undefined);

    mocks.useApi.mockReturnValue({});
    mocks.useWebSocket.mockReturnValue({ refreshLastMessagePreview });
  });

  function renderActions(chatTarget: ChatTarget | null) {
    return renderHook(() =>
      useChatActions({
        chatTarget,
        removeFriendMessage,
        removeGroupMessage,
        recallFriendMessage,
        recallGroupMessage,
      }),
    );
  }

  it('好友撤回 → 调 recallFriendMessage（不调 removeFriendMessage / markMessageDeleted）+ 刷新预览', async () => {
    const { result } = renderActions(friendTarget);

    await act(async () => {
      await result.current.handleRecallMessage('msg-uuid-1');
    });

    expect(recallFriendMessage).toHaveBeenCalledTimes(1);
    expect(recallFriendMessage).toHaveBeenLastCalledWith('msg-uuid-1');

    // 关键反向断言：不能走老路径
    expect(removeFriendMessage).not.toHaveBeenCalled();
    expect(removeGroupMessage).not.toHaveBeenCalled();
    expect(mocks.markMessageDeleted).not.toHaveBeenCalled();
    expect(recallGroupMessage).not.toHaveBeenCalled();

    // 撤回成功后刷新会话预览
    expect(refreshLastMessagePreview).toHaveBeenCalledTimes(1);
    expect(refreshLastMessagePreview).toHaveBeenLastCalledWith('friend', 'friend-1');
  });

  it('群聊撤回 → 调 recallGroupMessage（不调 removeGroupMessage / markMessageDeleted）+ 刷新预览', async () => {
    const { result } = renderActions(groupTarget);

    await act(async () => {
      await result.current.handleRecallMessage('msg-uuid-2');
    });

    expect(recallGroupMessage).toHaveBeenCalledTimes(1);
    expect(recallGroupMessage).toHaveBeenLastCalledWith('msg-uuid-2');

    // 关键反向断言
    expect(removeGroupMessage).not.toHaveBeenCalled();
    expect(removeFriendMessage).not.toHaveBeenCalled();
    expect(mocks.markMessageDeleted).not.toHaveBeenCalled();
    expect(recallFriendMessage).not.toHaveBeenCalled();

    expect(refreshLastMessagePreview).toHaveBeenCalledTimes(1);
    expect(refreshLastMessagePreview).toHaveBeenLastCalledWith('group', 'group-1');
  });

  it('hook recall 返回 false（撤回失败）→ 不刷新预览', async () => {
    recallFriendMessage = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useChatActions({
        chatTarget: friendTarget,
        removeFriendMessage,
        removeGroupMessage,
        recallFriendMessage,
        recallGroupMessage,
      }),
    );

    await act(async () => {
      await result.current.handleRecallMessage('msg-uuid-fail');
    });

    expect(recallFriendMessage).toHaveBeenCalledTimes(1);
    expect(refreshLastMessagePreview).not.toHaveBeenCalled();
    expect(removeFriendMessage).not.toHaveBeenCalled();
  });

  it('chatTarget=null → 不调任何 recall', async () => {
    const { result } = renderActions(null);

    await act(async () => {
      await result.current.handleRecallMessage('msg-uuid-x');
    });

    expect(recallFriendMessage).not.toHaveBeenCalled();
    expect(recallGroupMessage).not.toHaveBeenCalled();
    expect(refreshLastMessagePreview).not.toHaveBeenCalled();
  });

  it('chatTarget.type=ai → 不调任何 recall', async () => {
    const { result } = renderActions({ type: 'ai', data: null } as unknown as ChatTarget);

    await act(async () => {
      await result.current.handleRecallMessage('msg-uuid-ai');
    });

    expect(recallFriendMessage).not.toHaveBeenCalled();
    expect(recallGroupMessage).not.toHaveBeenCalled();
  });
});

describe('useChatActions.handleDeleteMessage 仍走 removeXxx + markMessageDeleted（删除语义不变）', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recallFriendMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recallGroupMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let removeFriendMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let removeGroupMessage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let refreshLastMessagePreview: any;

  beforeEach(() => {
    recallFriendMessage = vi.fn();
    recallGroupMessage = vi.fn();
    removeFriendMessage = vi.fn();
    removeGroupMessage = vi.fn();
    refreshLastMessagePreview = vi.fn().mockResolvedValue(undefined);

    mocks.useApi.mockReturnValue({});
    mocks.useWebSocket.mockReturnValue({ refreshLastMessagePreview });
    mocks.deleteMessage.mockResolvedValue(undefined);
    mocks.deleteGroupMessage.mockResolvedValue(undefined);
    mocks.markMessageDeleted.mockResolvedValue(undefined);
  });

  it('好友删除 → deleteMessage + removeFriendMessage + markMessageDeleted + 刷新预览', async () => {
    const { result } = renderHook(() =>
      useChatActions({
        chatTarget: friendTarget,
        removeFriendMessage,
        removeGroupMessage,
        recallFriendMessage,
        recallGroupMessage,
      }),
    );

    await act(async () => {
      await result.current.handleDeleteMessage('msg-del-1');
    });

    expect(mocks.deleteMessage).toHaveBeenCalledTimes(1);
    expect(removeFriendMessage).toHaveBeenLastCalledWith('msg-del-1');
    expect(mocks.markMessageDeleted).toHaveBeenLastCalledWith('msg-del-1');
    expect(refreshLastMessagePreview).toHaveBeenLastCalledWith('friend', 'friend-1');
    // 删除不应触发 recall 路径
    expect(recallFriendMessage).not.toHaveBeenCalled();
  });
});
