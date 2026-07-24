/**
 * CreateBotDialog 测试（共享创建机器人表单，req-23 侧边栏 "+" 复用）
 *
 * 组件只依赖 api/bots 的纯校验器（BOT_USERNAME_RE / isValidBotUsername），无 Context / 无网络，
 * 因此无需任何 mock，直接渲染真组件断言其真实体验层校验行为。
 * createPortal 挂到 document.body，用 screen 全局查询。
 *
 * 覆盖 bot 用户名后缀体验（本次核心特性）：
 * - 合规 bot 结尾用户名 + 昵称 → 「创建」可用 + onCreate 精确入参
 * - 非 bot 结尾 → 「创建」禁用 + 内联提示 + 推荐 chip；点 chip 补全后解禁
 * - 非法字符 → isValidBotUsername=false → 「创建」禁用（且无推荐 chip）
 * - 用户名合规但昵称空 → 「创建」禁用
 * - 描述为空 → onCreate 的 description 为 undefined（去空 || undefined 分支）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { CreateBotDialog } from '../../src/components/bots/CreateBotDialog';

const USERNAME_PLACEHOLDER = '3-32 位字母 / 数字 / 下划线，且以 bot 结尾';
const NICKNAME_PLACEHOLDER = '机器人显示昵称';
const DESC_PLACEHOLDER = '可选，简要描述机器人用途';

describe('CreateBotDialog', () => {
  beforeEach(() => {
    cleanup();
  });

  it('合规 bot 结尾用户名 + 昵称 → 「创建」可用，点击回传 onCreate 精确入参', () => {
    const onCreate = vi.fn();
    render(<CreateBotDialog onClose={vi.fn()} onCreate={onCreate} creating={false} error={null} />);

    fireEvent.change(screen.getByPlaceholderText(USERNAME_PLACEHOLDER), {
      target: { value: 'weatherbot' },
    });
    fireEvent.change(screen.getByPlaceholderText(NICKNAME_PLACEHOLDER), {
      target: { value: '天气机器人' },
    });
    fireEvent.change(screen.getByPlaceholderText(DESC_PLACEHOLDER), {
      target: { value: '播报天气' },
    });

    const createBtn = screen.getByRole('button', { name: '创建' });
    expect(createBtn).toBeEnabled();
    // 合规态不应出现推荐 chip / 内联提示
    expect(screen.queryByText(/需以 bot 结尾/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /推荐：/ })).not.toBeInTheDocument();

    fireEvent.click(createBtn);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({
      username: 'weatherbot',
      nickname: '天气机器人',
      description: '播报天气',
    });
  });

  it('非 bot 结尾用户名 → 「创建」禁用 + 内联提示 + 推荐 chip；点 chip 补全并解禁', () => {
    const onCreate = vi.fn();
    render(<CreateBotDialog onClose={vi.fn()} onCreate={onCreate} creating={false} error={null} />);

    const usernameInput = screen.getByPlaceholderText(USERNAME_PLACEHOLDER) as HTMLInputElement;
    fireEvent.change(usernameInput, { target: { value: 'weather' } });
    fireEvent.change(screen.getByPlaceholderText(NICKNAME_PLACEHOLDER), {
      target: { value: '天气机器人' },
    });

    // 缺 bot 后缀 → 禁用 + 提示 + 推荐 chip
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
    expect(screen.getByText(/需以 bot 结尾/)).toBeInTheDocument();
    const chip = screen.getByRole('button', { name: '推荐：weatherbot' });
    expect(chip).toHaveClass('bots-username-suggest-chip');

    // 点推荐 chip：把补全值写进输入框（点了才填）
    fireEvent.click(chip);
    expect(usernameInput.value).toBe('weatherbot');
    // 补全后合规 → 提示与 chip 消失，按钮解禁（昵称已填）
    expect(screen.queryByText(/需以 bot 结尾/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /推荐：/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled();

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('用户名含非法字符 → 「创建」禁用（isValidBotUsername=false），且无推荐 chip', () => {
    const onCreate = vi.fn();
    render(<CreateBotDialog onClose={vi.fn()} onCreate={onCreate} creating={false} error={null} />);

    fireEvent.change(screen.getByPlaceholderText(USERNAME_PLACEHOLDER), {
      target: { value: '我的bot' },
    });
    fireEvent.change(screen.getByPlaceholderText(NICKNAME_PLACEHOLDER), {
      target: { value: '合法昵称' },
    });

    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
    // 基础字符集校验就不过 → 不给推荐 chip
    expect(screen.queryByRole('button', { name: /推荐：/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('用户名合规但昵称为空 → 「创建」禁用', () => {
    render(<CreateBotDialog onClose={vi.fn()} onCreate={vi.fn()} creating={false} error={null} />);

    fireEvent.change(screen.getByPlaceholderText(USERNAME_PLACEHOLDER), {
      target: { value: 'weatherbot' },
    });
    // 昵称留空

    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('描述为空时 onCreate 的 description 为 undefined（去空 || undefined 分支）', () => {
    const onCreate = vi.fn();
    render(<CreateBotDialog onClose={vi.fn()} onCreate={onCreate} creating={false} error={null} />);

    fireEvent.change(screen.getByPlaceholderText(USERNAME_PLACEHOLDER), {
      target: { value: 'echobot' },
    });
    fireEvent.change(screen.getByPlaceholderText(NICKNAME_PLACEHOLDER), {
      target: { value: '回声' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(onCreate).toHaveBeenCalledWith({
      username: 'echobot',
      nickname: '回声',
      description: undefined,
    });
  });

  it('creating=true 时按钮文案为「创建中...」', () => {
    render(<CreateBotDialog onClose={vi.fn()} onCreate={vi.fn()} creating error={null} />);
    fireEvent.change(screen.getByPlaceholderText(USERNAME_PLACEHOLDER), {
      target: { value: 'weatherbot' },
    });
    fireEvent.change(screen.getByPlaceholderText(NICKNAME_PLACEHOLDER), {
      target: { value: '天气机器人' },
    });
    // creating=true → canSubmit=false → 按钮禁用且文案切换
    const btn = screen.getByRole('button', { name: '创建中...' });
    expect(btn).toBeDisabled();
  });
});
