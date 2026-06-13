/**
 * GroupMessageBubble 群内右键三项操作（屏蔽 / 特别关心 / 备注）写序测试
 *
 * 锁定契约（U3）：三项操作均「先 await API 成功再写 store，失败不写入」，与好友关系操作
 * （useChatMenu）一致。
 *
 * 关键区分 await-first vs 旧「乐观写 + 失败回滚」：仅断言「失败后 store 不变」不够——旧实现
 * 失败时先写后回滚，终态同样不变，两种实现都会通过。真正的差异在【API 未决期间】：
 * await-first 此时 store 尚未写入，旧乐观实现此时已写入。因此用「可控延迟 promise」断言
 * 未决期间 store 不写、resolve 后才写，才能真正锁定写序（旧乐观实现会在未决断言处翻红）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import type { GroupMessage } from '../../src/api/groupMessages';
import { useChatStore } from '../../src/stores/chatStore';

const groupsApi = vi.hoisted(() => ({
  addGroupMessageBlock: vi.fn(),
  removeGroupMessageBlock: vi.fn(),
  addGroupSpecialCare: vi.fn(),
  removeGroupSpecialCare: vi.fn(),
  setGroupMemberRemark: vi.fn(),
  removeGroupMemberRemark: vi.fn(),
}));
vi.mock('../../src/api/groups', () => groupsApi);

vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }),
  useSession: () => ({ session: { userId: 'me' } }),
}));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));
vi.mock('../../src/chat/shared/FileMessageContent', () => ({ FileMessageContent: () => null }));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({ MeetingInviteCard: () => null }));
vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({ MobileMessageFullPreview: () => null }));
vi.mock('../../src/services/fileCache', () => ({ getCachedFilePath: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));
vi.mock('../../src/utils/saveToGallery', () => ({ saveToGallery: vi.fn() }));
vi.mock('../../src/hooks/useFileCache', () => ({ useFileCache: () => ({ localPath: null, isLocal: false }) }));

// 暴露右键三项操作为按钮，便于直接触发 handler
vi.mock('../../src/chat/shared/MessageContextMenu', () => ({
  MessageContextMenu: ({ onToggleBlockSender, onToggleSpecialCareSender }: {
    onToggleBlockSender?: () => void; onToggleSpecialCareSender?: () => void;
  }) => (
    <div>
      <button data-testid="act-block" onClick={() => onToggleBlockSender?.()}>block</button>
      <button data-testid="act-care" onClick={() => onToggleSpecialCareSender?.()}>care</button>
    </div>
  ),
}));
// 备注弹窗：暴露一个保存按钮，直接以固定值触发 onSave
vi.mock('../../src/chat/group/GroupRemarkInputModal', () => ({
  GroupRemarkInputModal: ({ onSave }: { onSave?: (v: string) => void }) => (
    <button data-testid="act-remark-save" onClick={() => onSave?.('新备注')}>save</button>
  ),
}));

import { GroupMessageBubble } from '../../src/chat/group/GroupMessageBubble';

function makeMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    message_uuid: 'uuid-1', group_id: 'g-1', sender_id: 'user-2', sender_nickname: 'Alice',
    sender_avatar_url: '', message_content: 'hello', message_type: 'text',
    file_uuid: null, file_url: null, file_size: null, file_hash: null,
    image_width: null, image_height: null, reply_to: null,
    send_time: '2026-01-01T00:00:00Z', is_recalled: false, seq: 1, ...overrides,
  };
}

function renderBubble() {
  return render(<GroupMessageBubble message={makeMessage()} isOwn={false} groupId="g-1" />);
}

const blocks = () => useChatStore.getState().groupMessageBlocks['g-1'] ?? [];
const cares = () => useChatStore.getState().groupSpecialCares['g-1'] ?? [];
const remark = () => useChatStore.getState().groupMemberRemarks['g-1']?.['user-2'];

describe('GroupMessageBubble 群内右键操作 — 先 await 再写 store（失败不写入）', () => {
  beforeEach(() => {
    cleanup();
    Object.values(groupsApi).forEach((m) => { m.mockReset(); m.mockResolvedValue(undefined); });
    useChatStore.setState({
      groupMessageBlocks: {}, groupSpecialCares: {}, groupMemberRemarks: {},
      friends: [], friendBlacklistTimes: {},
    });
  });

  // 构造一个可手动 resolve 的 pending promise，用于断言「API 未决期间不写 store」
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => { resolve = () => res(); });
    return { promise, resolve };
  }

  it('屏蔽：API 未决期间 store 不写入，resolve 后才写入（锁定 await-first 写序）', async () => {
    const d = deferred();
    groupsApi.addGroupMessageBlock.mockReturnValueOnce(d.promise);
    const { getByTestId } = renderBubble();
    fireEvent.click(getByTestId('act-block'));
    await waitFor(() => expect(groupsApi.addGroupMessageBlock).toHaveBeenCalledTimes(1));
    // 未决期间：await-first 尚未写 store（旧乐观实现此处已写 → 翻红）
    expect(blocks()).not.toContain('user-2');
    await act(async () => { d.resolve(); });
    // resolve 成功后才写入
    await waitFor(() => expect(blocks()).toContain('user-2'));
  });

  it('屏蔽失败 → store 不写入（catch 路径不写）', async () => {
    groupsApi.addGroupMessageBlock.mockRejectedValueOnce(new Error('net'));
    const { getByTestId } = renderBubble();
    fireEvent.click(getByTestId('act-block'));
    await waitFor(() => expect(groupsApi.addGroupMessageBlock).toHaveBeenCalledTimes(1));
    expect(blocks()).not.toContain('user-2');
  });

  it('特别关心：API 未决期间 store 不写入，resolve 后才写入', async () => {
    const d = deferred();
    groupsApi.addGroupSpecialCare.mockReturnValueOnce(d.promise);
    const { getByTestId } = renderBubble();
    fireEvent.click(getByTestId('act-care'));
    await waitFor(() => expect(groupsApi.addGroupSpecialCare).toHaveBeenCalledTimes(1));
    expect(cares()).not.toContain('user-2');
    await act(async () => { d.resolve(); });
    await waitFor(() => expect(cares()).toContain('user-2'));
  });

  it('备注：API 未决期间 store 不写入，resolve 后才写入', async () => {
    const d = deferred();
    groupsApi.setGroupMemberRemark.mockReturnValueOnce(d.promise);
    const { getByTestId } = renderBubble();
    fireEvent.click(getByTestId('act-remark-save'));
    await waitFor(() => expect(groupsApi.setGroupMemberRemark).toHaveBeenCalledWith(expect.anything(), 'g-1', 'user-2', '新备注'));
    expect(remark()).toBeUndefined();
    await act(async () => { d.resolve(); });
    await waitFor(() => expect(remark()).toBe('新备注'));
  });

  it('备注失败 → store 不写入（catch 路径不写）', async () => {
    groupsApi.setGroupMemberRemark.mockRejectedValueOnce(new Error('net'));
    const { getByTestId } = renderBubble();
    fireEvent.click(getByTestId('act-remark-save'));
    await waitFor(() => expect(groupsApi.setGroupMemberRemark).toHaveBeenCalledTimes(1));
    expect(remark()).toBeUndefined();
  });
});
