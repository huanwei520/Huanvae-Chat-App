/**
 * MobileBotsPage 测试（移动端机器人管理整屏页）
 *
 * mock 策略（与 MobileMiniAppsPage.test.tsx 一致）：
 * - useBots：vi.hoisted 提供 bots/loading/error/操作函数，隔离 SessionContext / api 层
 *
 * 覆盖：
 * 1. 渲染：顶栏标题 + bot 卡片内容（昵称 / @username / 启停徽章）
 * 2. 交互：点击「+ 创建机器人」打开创建表单（字段出现）
 * 3. 顶栏返回按钮调用 onClose
 * 4. 删除确认链路：卡片删除 → 确认 → remove(bot_user_id) 精确入参
 * 5. token 弹窗 portal 到 body fixed 高层容器（防遮挡回归）
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { BotInfo } from '../../src/api/bots';

const TEST_BOT: BotInfo = {
  bot_user_id: 'bot_m1',
  username: 'mobile_bot',
  nickname: '移动机器人',
  description: '移动端测试 bot',
  commands: [],
  webhook_url: null,
  can_join_groups: false,
  is_active: true,
  message_policy: 'everyone',
  message_whitelist: [],
  is_discoverable: true,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

const mockUseBotsReturn = vi.hoisted(() => ({
  bots: [] as BotInfo[],
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  resetToken: vi.fn(),
  addByUsername: vi.fn(),
  operatingId: null as string | null,
}));

vi.mock('../../src/hooks/useBots', () => ({
  useBots: () => mockUseBotsReturn,
}));

import { MobileBotsPage } from '../../src/pages/mobile/MobileBotsPage';

describe('MobileBotsPage', () => {
  beforeEach(() => {
    cleanup();
    mockUseBotsReturn.bots = [TEST_BOT];
    mockUseBotsReturn.loading = false;
    mockUseBotsReturn.error = null;
    mockUseBotsReturn.operatingId = null;
    mockUseBotsReturn.remove.mockReset();
    mockUseBotsReturn.create.mockReset();
    mockUseBotsReturn.resetToken.mockReset();
  });

  it('渲染顶栏标题与 bot 卡片（昵称 / @username / 启停徽章）', () => {
    render(<MobileBotsPage onClose={vi.fn()} />);

    expect(screen.getByText('机器人')).toBeInTheDocument();
    expect(screen.getByText('移动机器人')).toBeInTheDocument();
    expect(screen.getByText('@mobile_bot')).toBeInTheDocument();
    expect(screen.getByText('移动端测试 bot')).toBeInTheDocument();
    expect(screen.getByText('启用中')).toBeInTheDocument();
  });

  it('点击「+ 创建机器人」打开创建表单', () => {
    render(<MobileBotsPage onClose={vi.fn()} />);

    // 打开前表单字段不存在
    expect(screen.queryByPlaceholderText('3-32 位字母 / 数字 / 下划线')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '+ 创建机器人' }));

    expect(screen.getByText('创建机器人')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('3-32 位字母 / 数字 / 下划线')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('机器人显示昵称')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('可选，简要描述机器人用途')).toBeInTheDocument();
  });

  it('顶栏返回按钮调用 onClose', () => {
    const onClose = vi.fn();
    render(<MobileBotsPage onClose={onClose} />);

    const backBtn = document.querySelector('.mobile-bots-back') as HTMLElement | null;
    expect(backBtn).not.toBeNull();
    fireEvent.click(backBtn!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('删除链路：卡片删除 → 确认弹窗 → remove 精确入参', async () => {
    mockUseBotsReturn.remove.mockResolvedValue(true);
    render(<MobileBotsPage onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.getByText(/确定要删除 @mobile_bot 吗/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(mockUseBotsReturn.remove).toHaveBeenCalledWith('bot_m1');
    });
  });

  it('token 弹窗 portal 到 body 的 fixed 高层容器（回归：防被页面/弹层遮挡）', async () => {
    mockUseBotsReturn.resetToken.mockResolvedValue('mobile-portal-token-xyz');
    render(<MobileBotsPage onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '重置 Token' }));
    expect(screen.getByText(/确定要重置 @mobile_bot 的 Token 吗/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }));

    const tokenEl = await screen.findByText('mobile-portal-token-xyz');
    const overlay = tokenEl.closest('.oauth-create-overlay');
    expect(overlay).not.toBeNull();
    // 遮罩层必须被一个 fixed + z-index>1000 的包裹层承载，且该包裹层直接挂在 body（portal 化）
    const wrapper = overlay?.parentElement as HTMLElement;
    expect(wrapper.style.position).toBe('fixed');
    expect(Number(wrapper.style.zIndex)).toBeGreaterThan(1000);
    expect(wrapper.parentElement).toBe(document.body);
  });
});
