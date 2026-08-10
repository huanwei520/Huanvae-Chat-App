/**
 * 相册在气泡里的**优先级**行为（私聊 + 群聊两个气泡）
 *
 * 静态契约（tests/album-wiring.test.ts）只能证明「JSX 里写了这一段」，
 * 证明不了运行时真的走了这条分支。这里补的正是行为：
 *
 * 1. album 非空 ⇒ 渲染相册网格，**且本条自己的单媒体不再单独出现**
 *    （漏掉后半句的话，「代表消息」那张图会在相册之外重复出现一次）
 * 2. album 为空 ⇒ 退回原来的按 message_type 渲染，一点没变
 * 3. 撤回优先于相册：整组撤回后显示撤回占位，而不是继续把图渲染出来
 *    —— 后端保证整组同时撤回，代表消息的 is_recalled 即整组状态
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Friend, Message } from '../../src/types/chat';
import type { GroupMessage } from '../../src/api/groupMessages';

vi.mock('../../src/chat/shared/FileMessageContent', () => ({
  FileMessageContent: ({ fileUuid }: { fileUuid: string | null }) => (
    <div data-testid="single-media" data-uuid={fileUuid} />
  ),
}));
vi.mock('../../src/chat/shared/AlbumMessage', () => ({
  AlbumMessage: ({ album }: { album: { groupId: string; items: unknown[] } }) => (
    <div data-testid="album" data-group={album.groupId} data-count={album.items.length} />
  ),
}));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({ MeetingInviteCard: () => null }));
vi.mock('../../src/chat/shared/CardRenderer', () => ({ CardRenderer: () => null }));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({ MarkdownRenderer: () => null }));
vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({ MobileMessageFullPreview: () => null }));
vi.mock('../../src/chat/group/GroupRemarkInputModal', () => ({ GroupRemarkInputModal: () => null }));
vi.mock('../../src/services/fileCache', () => ({ getCachedFilePath: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }),
}));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));
vi.mock('../../src/utils/saveToGallery', () => ({ saveToGallery: vi.fn() }));
vi.mock('../../src/hooks/useFileCache', () => ({ useFileCache: () => ({ localPath: null, isLocal: false }) }));

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
  useProfileViewStore: (selector: (s: { open: () => void }) => unknown) => selector({ open: () => {} }),
}));

import { MessageBubble } from '../../src/chat/friend/MessageBubble';
import { GroupMessageBubble } from '../../src/chat/group/GroupMessageBubble';

const SESSION = {
  userId: 'me',
  profile: { user_nickname: '我', user_avatar_url: '' },
} as unknown as Parameters<typeof MessageBubble>[0]['session'];

const FRIEND = { friend_id: 'peer', friend_nickname: 'Alice', friend_avatar_url: '' } as unknown as Friend;

function privateMsg(overrides: Partial<Message> = {}): Message {
  return {
    message_uuid: 'm-0',
    sender_id: 'peer',
    receiver_id: 'me',
    message_content: '',
    message_type: 'image',
    file_uuid: 'solo-file',
    file_url: null,
    file_size: 100,
    file_hash: 'h',
    reply_to: null,
    send_time: '2026-01-01T00:00:00Z',
    is_recalled: false,
    ...overrides,
  };
}

function groupMsg(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    message_uuid: 'gm-0',
    group_id: 'g-1',
    sender_id: 'other',
    sender_nickname: 'Alice',
    sender_avatar_url: '',
    message_content: '',
    message_type: 'image',
    file_uuid: 'solo-file',
    file_url: null,
    file_size: 100,
    file_hash: 'h',
    image_width: null,
    image_height: null,
    reply_to: null,
    send_time: '2026-01-01T00:00:00Z',
    is_recalled: false,
    seq: 1,
    ...overrides,
  };
}

const ALBUM = {
  kind: 'album' as const,
  groupId: 'grp-1',
  items: [{ message_uuid: 'a0' }, { message_uuid: 'a1' }],
  expectedCount: 2,
  caption: '',
  isComplete: true,
};

describe('私聊气泡 — 相册优先级', () => {
  it('album 非空：渲染相册，且代表消息自己的单媒体不再单独出现', () => {
    render(
      <MessageBubble
        message={privateMsg()}
        isOwn={false}
        session={SESSION}
        friend={FRIEND}
        album={ALBUM as never}
      />,
    );

    expect(screen.getByTestId('album')).toHaveAttribute('data-group', 'grp-1');
    expect(screen.queryByTestId('single-media')).not.toBeInTheDocument();
  });

  it('album 为空：退回按 message_type 渲染单媒体（原行为不变）', () => {
    render(
      <MessageBubble message={privateMsg()} isOwn={false} session={SESSION} friend={FRIEND} />,
    );

    expect(screen.queryByTestId('album')).not.toBeInTheDocument();
    expect(screen.getByTestId('single-media')).toHaveAttribute('data-uuid', 'solo-file');
  });

  it('整组撤回：显示撤回占位，不再渲染相册', () => {
    render(
      <MessageBubble
        message={privateMsg({ is_recalled: true })}
        isOwn={false}
        session={SESSION}
        friend={FRIEND}
        album={ALBUM as never}
      />,
    );

    expect(screen.queryByTestId('album')).not.toBeInTheDocument();
  });
});

describe('群聊气泡 — 相册优先级', () => {
  it('album 非空：渲染相册，且代表消息自己的单媒体不再单独出现', () => {
    render(<GroupMessageBubble message={groupMsg()} isOwn={false} groupId="g-1" album={ALBUM as never} />);

    expect(screen.getByTestId('album')).toHaveAttribute('data-group', 'grp-1');
    expect(screen.queryByTestId('single-media')).not.toBeInTheDocument();
  });

  it('album 为空：退回按 message_type 渲染单媒体（原行为不变）', () => {
    render(<GroupMessageBubble message={groupMsg()} isOwn={false} groupId="g-1" />);

    expect(screen.queryByTestId('album')).not.toBeInTheDocument();
    expect(screen.getByTestId('single-media')).toHaveAttribute('data-uuid', 'solo-file');
  });

  it('整组撤回：显示撤回占位，不再渲染相册', () => {
    render(
      <GroupMessageBubble
        message={groupMsg({ is_recalled: true })}
        isOwn={false}
        groupId="g-1"
        album={ALBUM as never}
      />,
    );

    expect(screen.queryByTestId('album')).not.toBeInTheDocument();
  });
});
