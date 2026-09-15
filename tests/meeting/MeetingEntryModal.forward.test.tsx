/**
 * 桌面会议入口弹窗「复制信息 → 转发给好友」改版回归（2026-09-13，块 1d0t34vy-2 #2）
 *
 * 验收口径：桌面创建会议后，弹窗里是「转发给好友」按钮（不再是「复制信息」），
 * 点击打开既有 ShareMeetingModal，且 meetingData 带上创建房间三元组
 * （roomId/password/roomName）+ 创建者信息 —— 发送逻辑全部复用既有链路，本组件不碰。
 *
 * ShareMeetingModal 用 stub 替换（它自己的选人/发送行为归它自己的测试）；
 * 这里只断言「接线与参数」。
 */

/* eslint-disable require-await */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MeetingEntryModal } from '../../src/meeting/components/MeetingEntryModal';
import type { CreateRoomResponse } from '../../src/meeting/api';

const mocks = vi.hoisted(() => ({
  session: {
    userId: 'user-self',
    serverUrl: 'https://api.example',
    profile: { user_nickname: '桌面测试者', user_avatar_url: 'https://a.example/me.png' },
  },
  createRoom: vi.fn(),
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => ({ session: mocks.session }),
  useApi: () => ({ post: vi.fn(), get: vi.fn() }),
}));

vi.mock('../../src/meeting/api', () => ({
  createRoom: mocks.createRoom,
  joinRoom: vi.fn(),
  saveMeetingData: vi.fn(),
}));

vi.mock('../../src/meeting/identity', () => ({
  getMeetingIdentity: vi.fn().mockResolvedValue({ deviceId: 'dev-1' }),
}));

vi.mock('../../src/meeting/creatorIce', () => ({
  fetchCreatorIceServers: vi.fn().mockResolvedValue([]),
}));

const shareMeetingModal = vi.hoisted(() => vi.fn());
vi.mock('../../src/meeting/components/ShareMeetingModal', () => ({
  ShareMeetingModal: shareMeetingModal,
}));

const created: CreateRoomResponse = {
  room_id: 'R123',
  password: '123456',
  name: '周会',
  ws_token: 'token-x',
  user_info: { user_id: 'user-self', nickname: '桌面测试者', avatar_url: null },
} as unknown as CreateRoomResponse;

/** 「创建会议」文案同时命中 tab 与表单提交按钮：表单里那个是 className=meeting-btn 的最后一个 */
function clickCreateSubmit() {
  const buttons = screen.getAllByText('创建会议');
  fireEvent.click(buttons[buttons.length - 1]);
}

describe('MeetingEntryModal 创建成功后的转发入口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRoom.mockResolvedValue(created);
    shareMeetingModal.mockImplementation(() => <div data-testid="share-modal-stub" />);
  });

  it('创建成功后显示「转发给好友」，不再有「复制信息」', async () => {
    render(<MeetingEntryModal isOpen onClose={() => {}} />);

    
    clickCreateSubmit();
    await waitFor(() => screen.getByText('转发给好友'));

    expect(screen.queryByText('复制信息')).not.toBeInTheDocument();
    expect(screen.queryByText('已复制')).not.toBeInTheDocument();
  });

  it('点击「转发给好友」打开 ShareMeetingModal，meetingData 为创建的房间 + 登录态创建者', async () => {
    render(<MeetingEntryModal isOpen onClose={() => {}} />);

    // 创建 tab 是默认 activeTab；「创建会议」文案同时命中 tab 与提交按钮，仅点提交
    clickCreateSubmit();
    await waitFor(() => screen.getByText('转发给好友'));
    fireEvent.click(screen.getByText('转发给好友'));

    await waitFor(() => expect(shareMeetingModal).toHaveBeenCalled());
    const props = shareMeetingModal.mock.calls[0][0];
    expect(props.isOpen).toBe(true);
    expect(props.meetingData).toEqual({
      roomId: 'R123',
      password: '123456',
      roomName: '周会',
      creatorName: '桌面测试者',
      creatorAvatar: 'https://a.example/me.png',
    });
  });

  it('ShareMeetingModal 关闭后可再次打开（onClose 只收面板，不毁房间信息）', async () => {
    render(<MeetingEntryModal isOpen onClose={() => {}} />);

    // 创建 tab 是默认 activeTab；「创建会议」文案同时命中 tab 与提交按钮，仅点提交
    clickCreateSubmit();
    await waitFor(() => screen.getByText('转发给好友'));
    fireEvent.click(screen.getByText('转发给好友'));
    await waitFor(() => expect(shareMeetingModal).toHaveBeenCalledTimes(1));

    // 面板关闭（既有链路：发送完成后回调 onClose）——act 包裹让卸载先提交
    await act(async () => {
      shareMeetingModal.mock.calls[0][0].onClose();
    });
    expect(screen.queryByTestId('share-modal-stub')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('转发给好友'));
    await waitFor(() => expect(shareMeetingModal).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('share-modal-stub')).toBeInTheDocument();
  });
});
