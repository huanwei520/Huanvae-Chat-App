/**
 * BotsModal 测试（桌面端机器人管理弹窗）
 *
 * 与 MiniAppsModal 不同，BotsModal 无 WebviewWindow 静态方法依赖，可整体渲染：
 * - mock SessionContext.useApi 返回固定 api 对象
 * - mock src/api/bots 的 5 个函数（createBot/listMyBots/deleteBot/resetBotToken/addBotByUsername），
 *   真实 useBots + 真实 BotsModal 走完整链路
 *
 * 覆盖：
 * 1. 列表渲染：listMyBots 返回的 bot 昵称 / @username / 描述 / 启停徽章
 * 2. 创建流程：填表 → createBot 精确入参 + SecretDisplay 展示明文 token（一次性）
 * 3. 加好友流程：addBotByUsername 精确入参 + 成功文案 + onBotAdded 回调
 * 4. 删除流程：确认弹窗 → deleteBot 精确入参（取消不调用）
 * 5. 重置 token 流程：确认弹窗 → resetBotToken 精确入参 + 新 token 展示
 * 6. 隐私设置：PrivacyDialog 只传变化字段调 updateBot / 无变化禁保存 /
 *    ops bot 全禁用 / 白名单 textarea 去重去空
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { BotInfo } from '../../src/api/bots';

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mockApi,
}));

const botsApiMock = vi.hoisted(() => ({
  createBot: vi.fn(),
  listMyBots: vi.fn(),
  updateBot: vi.fn(),
  deleteBot: vi.fn(),
  resetBotToken: vi.fn(),
  addBotByUsername: vi.fn(),
}));

vi.mock('../../src/api/bots', async () => {
  const actual = await vi.importActual<typeof import('../../src/api/bots')>(
    '../../src/api/bots',
  );
  return { ...actual, ...botsApiMock };
});

import { BotsModal } from '../../src/components/bots/BotsModal';

const BOT_ONE: BotInfo = {
  bot_user_id: 'bot_1111',
  username: 'test_bot',
  nickname: '测试机器人',
  description: '一个测试机器人',
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

const BOT_TWO: BotInfo = {
  ...BOT_ONE,
  bot_user_id: 'bot_2222',
  username: 'idle_bot',
  nickname: '停用机器人',
  description: '',
  is_active: false,
};

describe('BotsModal', () => {
  beforeEach(() => {
    cleanup();
    Object.values(botsApiMock).forEach((m) => m.mockReset());
    botsApiMock.listMyBots.mockResolvedValue([BOT_ONE, BOT_TWO]);
  });

  it('渲染 listMyBots 返回的 bot 列表（昵称 / @username / 描述 / 启停徽章）', async () => {
    render(<BotsModal isOpen onClose={vi.fn()} />);

    expect(await screen.findByText('测试机器人')).toBeInTheDocument();
    expect(screen.getByText('@test_bot')).toBeInTheDocument();
    expect(screen.getByText('一个测试机器人')).toBeInTheDocument();
    expect(screen.getByText('启用中')).toBeInTheDocument();

    expect(screen.getByText('停用机器人')).toBeInTheDocument();
    expect(screen.getByText('@idle_bot')).toBeInTheDocument();
    expect(screen.getByText('已停用')).toBeInTheDocument();

    expect(botsApiMock.listMyBots).toHaveBeenCalledWith(mockApi);
  });

  it('创建流程：填表提交 → createBot 精确入参 + SecretDisplay 一次性展示 token', async () => {
    botsApiMock.createBot.mockResolvedValue({
      bot_user_id: 'bot_9999',
      username: 'my_bot',
      nickname: '我的机器人',
      description: '测试描述',
      token: 'bot-token-plaintext-once-abc123',
    });
    render(<BotsModal isOpen onClose={vi.fn()} />);
    await screen.findByText('测试机器人');

    fireEvent.click(screen.getByRole('button', { name: '+ 创建' }));

    fireEvent.change(
      screen.getByPlaceholderText('3-32 位字母 / 数字 / 下划线，全局唯一'),
      { target: { value: 'my_bot' } },
    );
    fireEvent.change(screen.getByPlaceholderText('机器人显示昵称'), {
      target: { value: '我的机器人' },
    });
    fireEvent.change(screen.getByPlaceholderText('可选，简要描述机器人用途'), {
      target: { value: '测试描述' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(botsApiMock.createBot).toHaveBeenCalledWith(mockApi, {
        username: 'my_bot',
        nickname: '我的机器人',
        description: '测试描述',
      });
    });

    // SecretDisplay 一次性展示明文 token 与 bot 标识
    expect(await screen.findByText('机器人创建成功')).toBeInTheDocument();
    expect(screen.getByText('bot-token-plaintext-once-abc123')).toBeInTheDocument();
    expect(screen.getByText('bot_9999')).toBeInTheDocument();

    // 关闭 SecretDisplay 后 token 从 DOM 清除（展示态即清空）
    fireEvent.click(screen.getByRole('button', { name: '已保存，关闭' }));
    await waitFor(() => {
      expect(screen.queryByText('bot-token-plaintext-once-abc123')).not.toBeInTheDocument();
    });
  });

  it('token 弹窗 portal 到 body 的 fixed 高层容器（回归：防被 z-index:1000 主弹窗遮挡）', async () => {
    botsApiMock.createBot.mockResolvedValue({
      bot_user_id: 'bot_8888',
      username: 'portal_bot',
      nickname: 'Portal Bot',
      description: '',
      token: 'portal-token-xyz',
    });
    render(<BotsModal isOpen onClose={vi.fn()} />);
    await screen.findByText('测试机器人');

    fireEvent.click(screen.getByRole('button', { name: '+ 创建' }));
    fireEvent.change(
      screen.getByPlaceholderText('3-32 位字母 / 数字 / 下划线，全局唯一'),
      { target: { value: 'portal_bot' } },
    );
    fireEvent.change(screen.getByPlaceholderText('机器人显示昵称'), {
      target: { value: 'Portal Bot' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    const tokenEl = await screen.findByText('portal-token-xyz');
    const overlay = tokenEl.closest('.oauth-create-overlay');
    expect(overlay).not.toBeNull();
    // 遮罩层必须被一个 fixed + z-index>1000 的包裹层承载，且该包裹层直接挂在 body（portal 化）
    const wrapper = overlay?.parentElement as HTMLElement;
    expect(wrapper.style.position).toBe('fixed');
    expect(Number(wrapper.style.zIndex)).toBeGreaterThan(1000);
    expect(wrapper.parentElement).toBe(document.body);
  });

  it('创建流程：username 不满足 3-32 位字母/数字/下划线时提交按钮禁用', async () => {
    render(<BotsModal isOpen onClose={vi.fn()} />);
    await screen.findByText('测试机器人');

    fireEvent.click(screen.getByRole('button', { name: '+ 创建' }));
    fireEvent.change(
      screen.getByPlaceholderText('3-32 位字母 / 数字 / 下划线，全局唯一'),
      { target: { value: 'a!' } },
    );
    fireEvent.change(screen.getByPlaceholderText('机器人显示昵称'), {
      target: { value: '我的机器人' },
    });

    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
    expect(botsApiMock.createBot).not.toHaveBeenCalled();
  });

  it('加好友流程：addBotByUsername 精确入参 + 成功文案 + onBotAdded 回调', async () => {
    botsApiMock.addBotByUsername.mockResolvedValue({
      bot_user_id: 'bot_3333',
      username: 'helper_bot',
      nickname: '助手',
      request_id: 'req-1',
    });
    const onBotAdded = vi.fn();
    render(<BotsModal isOpen onClose={vi.fn()} onBotAdded={onBotAdded} />);
    await screen.findByText('测试机器人');

    fireEvent.click(screen.getByRole('button', { name: '添加机器人' }));
    fireEvent.change(screen.getByPlaceholderText('输入 bot 的 username（不含 @）'), {
      target: { value: 'helper_bot' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => {
      expect(botsApiMock.addBotByUsername).toHaveBeenCalledWith(mockApi, 'helper_bot');
    });
    expect(await screen.findByText('已添加 @helper_bot 为好友')).toBeInTheDocument();
    expect(onBotAdded).toHaveBeenCalledTimes(1);
  });

  it('删除流程：确认后 deleteBot 精确入参；取消不调用', async () => {
    botsApiMock.deleteBot.mockResolvedValue(undefined);
    render(<BotsModal isOpen onClose={vi.fn()} />);
    await screen.findByText('测试机器人');

    // 第一个 bot（test_bot）的删除按钮
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    expect(
      screen.getByText(/确定要删除 @test_bot 吗/),
    ).toBeInTheDocument();

    // 先取消：不调用 deleteBot
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(botsApiMock.deleteBot).not.toHaveBeenCalled();

    // 再删除并确认
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(botsApiMock.deleteBot).toHaveBeenCalledWith(mockApi, 'bot_1111');
    });
  });

  it('重置 token 流程：确认后 resetBotToken 精确入参 + 新 token 一次性展示', async () => {
    botsApiMock.resetBotToken.mockResolvedValue({ token: 'new-token-once-xyz789' });
    render(<BotsModal isOpen onClose={vi.fn()} />);
    await screen.findByText('测试机器人');

    fireEvent.click(screen.getAllByRole('button', { name: '重置 Token' })[0]);
    expect(screen.getByText(/确定要重置 @test_bot 的 Token 吗/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认重置' }));

    await waitFor(() => {
      expect(botsApiMock.resetBotToken).toHaveBeenCalledWith(mockApi, 'bot_1111');
    });
    expect(await screen.findByText('Token 已重置')).toBeInTheDocument();
    expect(screen.getByText('new-token-once-xyz789')).toBeInTheDocument();
  });

  it('关闭主弹窗清空一次性 token 展示态：重开后不复现旧 token', async () => {
    botsApiMock.createBot.mockResolvedValue({
      bot_user_id: 'bot_9999',
      username: 'my_bot',
      nickname: '我的机器人',
      description: '测试描述',
      token: 'bot-token-plaintext-once-abc123',
    });
    const { rerender } = render(<BotsModal isOpen onClose={vi.fn()} />);
    await screen.findByText('测试机器人');

    // 走完创建流程，让 SecretDisplay 展示 token
    fireEvent.click(screen.getByRole('button', { name: '+ 创建' }));
    fireEvent.change(
      screen.getByPlaceholderText('3-32 位字母 / 数字 / 下划线，全局唯一'),
      { target: { value: 'my_bot' } },
    );
    fireEvent.change(screen.getByPlaceholderText('机器人显示昵称'), {
      target: { value: '我的机器人' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByText('bot-token-plaintext-once-abc123')).toBeInTheDocument();

    // token 展示中直接关闭主弹窗，再重开
    rerender(<BotsModal isOpen={false} onClose={vi.fn()} />);
    rerender(<BotsModal isOpen onClose={vi.fn()} />);
    await screen.findByText('测试机器人');

    // 旧 token 不得复现，SecretDisplay 不再渲染
    expect(screen.queryByText('bot-token-plaintext-once-abc123')).not.toBeInTheDocument();
    expect(screen.queryByText('机器人创建成功')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '已保存，关闭' })).not.toBeInTheDocument();
  });

  it('isOpen=false 时不渲染任何内容', () => {
    const { container } = render(<BotsModal isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector('.miniapps-modal')).toBeNull();
  });

  describe('隐私设置', () => {
    it('改 radio 到「仅自己」+ 取消可搜索 → 只传变化字段调 updateBot（不含 message_whitelist）', async () => {
      // updateBot 成功返回更新后的 BotInfo（truthy → 弹窗关闭）
      botsApiMock.updateBot.mockResolvedValue({
        ...BOT_ONE,
        message_policy: 'owner_only',
        is_discoverable: false,
      });
      render(<BotsModal isOpen onClose={vi.fn()} />);
      await screen.findByText('测试机器人');

      // 第一个 bot（bot_1111 / everyone / discoverable）的「隐私」按钮
      fireEvent.click(screen.getAllByRole('button', { name: '隐私' })[0]);
      expect(screen.getByText('隐私设置')).toBeInTheDocument();
      // 初始态回填自 bot 字段
      expect(screen.getByRole('radio', { name: '所有人' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /允许被搜索添加/ })).toBeChecked();

      fireEvent.click(screen.getByRole('radio', { name: '仅自己' }));
      fireEvent.click(screen.getByRole('checkbox', { name: /允许被搜索添加/ }));
      fireEvent.click(screen.getByRole('button', { name: '保存' }));

      await waitFor(() => {
        // 只传变化字段：policy 非 whitelist → 不含 message_whitelist
        expect(botsApiMock.updateBot).toHaveBeenCalledWith(mockApi, 'bot_1111', {
          message_policy: 'owner_only',
          is_discoverable: false,
        });
      });
      expect(botsApiMock.updateBot).toHaveBeenCalledTimes(1);
      // 保存成功后弹窗关闭
      await waitFor(() => {
        expect(screen.queryByText('隐私设置')).not.toBeInTheDocument();
      });
    });

    it('未改任何字段时保存按钮 disabled，点击不触发 updateBot', async () => {
      render(<BotsModal isOpen onClose={vi.fn()} />);
      await screen.findByText('测试机器人');

      fireEvent.click(screen.getAllByRole('button', { name: '隐私' })[0]);
      const saveBtn = screen.getByRole('button', { name: '保存' });
      expect(saveBtn).toBeDisabled();
      fireEvent.click(saveBtn);
      expect(botsApiMock.updateBot).not.toHaveBeenCalled();
    });

    it('选「白名单」+ textarea 含重复/空行/前后空格 → 入参 message_whitelist 去重去空保序', async () => {
      botsApiMock.updateBot.mockResolvedValue({
        ...BOT_ONE,
        message_policy: 'whitelist',
        message_whitelist: ['u1', 'u2', 'u3'],
      });
      render(<BotsModal isOpen onClose={vi.fn()} />);
      await screen.findByText('测试机器人');

      fireEvent.click(screen.getAllByRole('button', { name: '隐私' })[0]);
      fireEvent.click(screen.getByRole('radio', { name: '白名单' }));
      fireEvent.change(screen.getByPlaceholderText('每行一个用户 ID'), {
        target: { value: 'u1\n\nu2\nu1\n u3 ' },
      });
      fireEvent.click(screen.getByRole('button', { name: '保存' }));

      await waitFor(() => {
        // is_discoverable 未变 → 不含该字段；白名单去重（u1）去空行、trim 后保序
        expect(botsApiMock.updateBot).toHaveBeenCalledWith(mockApi, 'bot_1111', {
          message_policy: 'whitelist',
          message_whitelist: ['u1', 'u2', 'u3'],
        });
      });
    });
  });
});
