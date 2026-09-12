/**
 * MeetingShareSheet（会议分享动作面板）单测
 *
 * 2026-09-10 会议分享改版（块 1788982832352-3）③：
 * 点分享只弹两类选项 —— 「转发给好友」（沿用既有 ShareMeetingModal 链路，
 * 本面板只上抛意图）+「复制会议链接」（会议信息写剪贴板）。
 *
 * 覆盖：两选项渲染、预览行、意图回调、取消/遮罩关闭、文案构建器同构性。
 * 布局/动画不在这里断（jsdom 无布局引擎），由真机截图承担。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  MeetingShareSheet,
  buildMeetingInviteText,
} from '../../src/meeting/components/MeetingShareSheet';

const MEETING = {
  roomName: '周会',
  roomId: 'AB12CD',
  password: '123456',
};

describe('MeetingShareSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('open=false 时不渲染任何内容', () => {
    render(
      <MeetingShareSheet
        open={false}
        roomName={MEETING.roomName}
        roomId={MEETING.roomId}
        onClose={vi.fn()}
        onForward={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog', { name: '分享会议' })).toBeNull();
    expect(screen.queryByText('转发给好友')).toBeNull();
    expect(screen.queryByText('复制会议链接')).toBeNull();
  });

  it('open=true 渲染两类选项 + 预览行（会议名 + #房间号，无密码）', () => {
    render(
      <MeetingShareSheet
        open
        roomName={MEETING.roomName}
        roomId={MEETING.roomId}
        onClose={vi.fn()}
        onForward={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: '分享会议' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /转发给好友/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /复制会议链接/ })).toBeInTheDocument();
    // 预览行 = 名称 + 房间号（密码不上屏，与 ShareMeetingModal 预览同一口径）
    const preview = document.querySelector('.meeting-share-sheet-preview');
    expect(preview?.textContent).toBe('周会 · #AB12CD');
    expect(preview?.textContent).not.toContain('123456');
  });

  it('点「转发给好友」只上抛 onForward，不触发 onCopy/onClose', () => {
    const onForward = vi.fn();
    const onCopy = vi.fn();
    const onClose = vi.fn();
    render(
      <MeetingShareSheet
        open
        roomName={MEETING.roomName}
        roomId={MEETING.roomId}
        onClose={onClose}
        onForward={onForward}
        onCopy={onCopy}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /转发给好友/ }));
    expect(onForward).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('点「复制会议链接」只上抛 onCopy（写剪贴板的副作用留在调用方）', () => {
    const onForward = vi.fn();
    const onCopy = vi.fn();
    const onClose = vi.fn();
    render(
      <MeetingShareSheet
        open
        roomName={MEETING.roomName}
        roomId={MEETING.roomId}
        onClose={onClose}
        onForward={onForward}
        onCopy={onCopy}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /复制会议链接/ }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onForward).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('点取消或遮罩走 onClose', () => {
    const onClose = vi.fn();
    render(
      <MeetingShareSheet
        open
        roomName={MEETING.roomName}
        roomId={MEETING.roomId}
        onClose={onClose}
        onForward={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    const overlay = document.querySelector('.meeting-share-sheet-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('点面板主体（非选项）不关闭', () => {
    const onClose = vi.fn();
    render(
      <MeetingShareSheet
        open
        roomName={MEETING.roomName}
        roomId={MEETING.roomId}
        onClose={onClose}
        onForward={vi.fn()}
        onCopy={vi.fn()}
      />,
    );

    const panel = document.querySelector('.meeting-share-sheet');
    expect(panel).not.toBeNull();
    fireEvent.click(panel as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('buildMeetingInviteText', () => {
  it('文案与加入页「粘贴房间信息」解析器同构（房间号/密码两行可解析回填）', () => {
    const text = buildMeetingInviteText(MEETING);
    expect(text).toBe('会议名称: 周会\n房间号: AB12CD\n密码: 123456');

    // 用加入页 parseRoomInfo 同款正则验证可解析
    const roomIdMatch = text.match(/房间号[：:]\s*([A-Za-z0-9]+)/);
    const passwordMatch = text.match(/密码[：:]\s*([0-9]+)/);
    expect(roomIdMatch?.[1]).toBe('AB12CD');
    expect(passwordMatch?.[1]).toBe('123456');
  });

  it('waitFor 可用性烟雾（clipboard 侧副作用由真机场景 c 覆盖）', async () => {
    await waitFor(() => expect(buildMeetingInviteText(MEETING)).toContain('房间号'));
  });
});
