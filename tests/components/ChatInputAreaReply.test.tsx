/**
 * 输入区侧的群聊回复接线测试（ChatInputArea + 真实 chatStore）
 *
 * ChatInputArea 是桌面 ChatPanel 与移动 MobileChatView **共用**的同一个组件，
 * 所以这里验的既是桌面行为也是移动行为 —— 两端不存在第二份接线。
 *
 * 覆盖：
 * - 「正在回复」条：显示被回复者 + 摘要；点 × 清空 store 草稿并收起
 * - 跨会话闸：草稿属于别的群时不显示（防止把 A 群的引用发到 B 群）
 * - setChatTarget 切会话即清草稿（store 层不变量）
 * - 定位失败降级提示：文案可见 + 可手动关闭
 *
 * 用真 store 而非 mock：这几条要验的正是「组件与 store 的接线」，mock 掉就只剩自说自话。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Friend, Group } from '../../src/types/chat';

const apiMock = vi.hoisted(() => ({}));
vi.mock('../../src/contexts/SessionContext', async (orig) => ({
  ...(await orig()),
  useApi: () => apiMock,
}));

import { ChatInputArea } from '../../src/chat/shared/ChatInputArea';
import { useChatStore } from '../../src/stores/chatStore';

const GROUP: Group = {
  group_id: 'g-1',
  group_name: '测试群',
  group_avatar_url: '',
  role: 'member',
  unread_count: null,
  last_message_content: null,
  last_message_time: null,
};

const FRIEND: Friend = {
  friend_id: 'f-1',
  friend_nickname: 'F',
  friend_avatar_url: null,
  add_time: '',
  approve_reason: null,
  friend_remark: null,
  is_blacklisted: false,
  is_special_care: false,
};

function renderInput() {
  return render(
    <ChatInputArea
      messageInput=""
      onMessageChange={() => {}}
      onSendMessage={() => {}}
      onFileSelect={() => {}}
      uploading={false}
      uploadingFile={null}
      uploadProgress={null}
      onCancelUpload={() => {}}
    />,
  );
}

beforeEach(() => {
  useChatStore.setState({ chatTarget: null, replyDraft: null, messageJumpNotice: null, muteStatus: {} });
});

describe('ChatInputArea — 「正在回复」条', () => {
  it('草稿属于当前群：显示被回复者与摘要', () => {
    useChatStore.setState({
      chatTarget: { type: 'group', data: GROUP },
      replyDraft: { conversationKey: 'group:g-1', messageUuid: 'm-1', senderName: 'Alice', preview: '被引用的原文' },
    });

    renderInput();

    expect(screen.getByText('回复 Alice')).toBeInTheDocument();
    expect(screen.getByText('被引用的原文')).toBeInTheDocument();
  });

  it('点「取消回复」清空 store 草稿并收起该条', async () => {
    useChatStore.setState({
      chatTarget: { type: 'group', data: GROUP },
      replyDraft: { conversationKey: 'group:g-1', messageUuid: 'm-1', senderName: 'Alice', preview: '被引用的原文' },
    });

    renderInput();
    fireEvent.click(screen.getByRole('button', { name: '取消回复' }));

    expect(useChatStore.getState().replyDraft).toBeNull();
    // AnimatePresence 退场是异步卸载，消失断言必须进 waitFor（见 frontend-test.md）
    await waitFor(() => {
      expect(screen.queryByText('回复 Alice')).not.toBeInTheDocument();
    });
  });

  it('草稿属于别的群：当前会话不显示（跨会话闸）', () => {
    useChatStore.setState({
      chatTarget: { type: 'group', data: GROUP },
      replyDraft: { conversationKey: 'group:g-OTHER', messageUuid: 'm-1', senderName: 'Alice', preview: '别群的原文' },
    });

    renderInput();

    expect(screen.queryByText('回复 Alice')).not.toBeInTheDocument();
    expect(screen.queryByText('别群的原文')).not.toBeInTheDocument();
  });

  it('草稿属于群、当前是私聊：不显示（跨会话闸对不同会话类型同样生效）', () => {
    useChatStore.setState({
      chatTarget: { type: 'friend', data: FRIEND },
      replyDraft: { conversationKey: 'group:g-1', messageUuid: 'm-1', senderName: 'Alice', preview: '原文' },
    });

    renderInput();

    expect(screen.queryByText('回复 Alice')).not.toBeInTheDocument();
  });

  // 私聊自 migration 036 起后端支持 reply_to，回复条与群聊走同一条通路。
  // 这条是上面那条跨会话闸的**正对照**：没有它，把归属校验写成恒 false 也能让上面全绿。
  it('草稿属于当前私聊会话：正常显示回复条', () => {
    useChatStore.setState({
      chatTarget: { type: 'friend', data: FRIEND },
      replyDraft: { conversationKey: 'friend:f-1', messageUuid: 'm-1', senderName: 'Bob', preview: '私聊被引用的原文' },
    });

    renderInput();

    expect(screen.getByText('回复 Bob')).toBeInTheDocument();
    expect(screen.getByText('私聊被引用的原文')).toBeInTheDocument();
  });

  // bot 会话的 key 前缀是 `bot:` 而不是 `friend:` —— 接线时按 friend 硬编码会让 bot 会话的
  // 回复条永远不显示且无任何报错。这条把该前缀钉死。
  it('草稿属于当前 bot 会话：正常显示回复条（key 前缀 bot: 而非 friend:）', () => {
    useChatStore.setState({
      chatTarget: { type: 'bot', data: FRIEND },
      replyDraft: { conversationKey: 'bot:f-1', messageUuid: 'm-1', senderName: 'Bot', preview: 'bot 的原文' },
    });

    renderInput();

    expect(screen.getByText('回复 Bot')).toBeInTheDocument();
  });
});

describe('chatStore — 切会话清回复草稿', () => {
  it('setChatTarget 清空 replyDraft / highlightedMessageId / messageJumpNotice', () => {
    useChatStore.setState({
      chatTarget: { type: 'group', data: GROUP },
      replyDraft: { conversationKey: 'group:g-1', messageUuid: 'm-1', senderName: 'Alice', preview: '原文' },
      highlightedMessageId: 'm-9',
      messageJumpNotice: '原消息不在本地记录中，无法定位',
    });

    useChatStore.getState().setChatTarget({ type: 'friend', data: FRIEND });

    expect(useChatStore.getState().replyDraft).toBeNull();
    expect(useChatStore.getState().highlightedMessageId).toBeNull();
    expect(useChatStore.getState().messageJumpNotice).toBeNull();
  });

  it('setChatTarget 不动 pendingScrollToMessageId（全局搜索先切会话再设跳转目标）', () => {
    useChatStore.setState({ pendingScrollToMessageId: null });
    useChatStore.getState().setChatTarget({ type: 'group', data: GROUP });
    useChatStore.getState().setPendingScrollToMessageId('target-uuid');

    expect(useChatStore.getState().pendingScrollToMessageId).toBe('target-uuid');
  });
});

describe('ChatInputArea — 消息定位失败降级提示', () => {
  it('messageJumpNotice 非空时显示提示文案', () => {
    useChatStore.setState({
      chatTarget: { type: 'group', data: GROUP },
      messageJumpNotice: '原消息不在本地记录中，无法定位',
    });

    renderInput();

    expect(screen.getByText('原消息不在本地记录中，无法定位')).toBeInTheDocument();
  });

  it('点关闭按钮清空提示并收起', async () => {
    useChatStore.setState({
      chatTarget: { type: 'group', data: GROUP },
      messageJumpNotice: '原消息不在本地记录中，无法定位',
    });

    renderInput();
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));

    expect(useChatStore.getState().messageJumpNotice).toBeNull();
    await waitFor(() => {
      expect(screen.queryByText('原消息不在本地记录中，无法定位')).not.toBeInTheDocument();
    });
  });

  it('被禁言时也能看到定位失败提示（禁言不影响点引用块去定位）', () => {
    useChatStore.setState({
      chatTarget: { type: 'group', data: GROUP },
      messageJumpNotice: '原消息不在本地记录中，无法定位',
      muteStatus: { 'g-1': { mutedUntil: new Date(Date.now() + 60_000).toISOString() } },
    });

    renderInput();

    // 确认确实进了禁言分支（防空断言）
    expect(screen.getByText(/您已被禁言/)).toBeInTheDocument();
    expect(screen.getByText('原消息不在本地记录中，无法定位')).toBeInTheDocument();
  });
});
