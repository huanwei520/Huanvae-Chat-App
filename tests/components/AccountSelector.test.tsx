/**
 * AccountSelector 键盘导航测试
 *
 * 覆盖为 .stack-selector 新增的键盘支持：
 * - ↑/← → 上一个账号；↓/→ → 下一个账号（与滚轮/拖拽语义一致）
 * - Enter → 登录当前账号
 * - Delete → 触发删除确认（不直接删）
 * - 方向键 preventDefault（防止页面滚动）+ 无关键不响应
 *
 * 卡片切换依赖 goToPrev/goToNext 内部的 setTimeout(ANIMATION_DURATION=400ms)
 * 动画完成后才更新 mainIndex，故索引变化类断言需用 fake timer 推进 400ms。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, createEvent, act } from '@testing-library/react';
import { AccountSelector } from '../../src/pages/AccountSelector';
import type { SavedAccount } from '../../src/types/account';

const ANIMATION_DURATION = 400;

function makeAccounts(): SavedAccount[] {
  return [
    { user_id: 'u1', nickname: '账号一', server_url: 'https://a.example.com', avatar_path: null, created_at: '2026-01-01T00:00:00Z' },
    { user_id: 'u2', nickname: '账号二', server_url: 'https://b.example.com', avatar_path: null, created_at: '2026-01-02T00:00:00Z' },
    { user_id: 'u3', nickname: '账号三', server_url: 'https://c.example.com', avatar_path: null, created_at: '2026-01-03T00:00:00Z' },
  ];
}

interface Harness {
  container: HTMLElement;
  selector: HTMLElement;
  counterText: () => string;
  onSelectAccount: ReturnType<typeof vi.fn>;
  onAddAccount: ReturnType<typeof vi.fn>;
  onDeleteAccount: ReturnType<typeof vi.fn>;
  accounts: SavedAccount[];
}

function setup(): Harness {
  const accounts = makeAccounts();
  const onSelectAccount = vi.fn();
  const onAddAccount = vi.fn();
  const onDeleteAccount = vi.fn();
  const { container } = render(
    <AccountSelector
      accounts={accounts}
      onSelectAccount={onSelectAccount}
      onAddAccount={onAddAccount}
      onDeleteAccount={onDeleteAccount}
    />,
  );
  const selector = container.querySelector('.stack-selector') as HTMLElement;
  return {
    container,
    selector,
    counterText: () => container.querySelector('.stack-counter')?.textContent ?? '',
    onSelectAccount,
    onAddAccount,
    onDeleteAccount,
    accounts,
  };
}

// 推进一次卡片切换动画并 flush React 更新
function advanceAnimation(): void {
  act(() => {
    vi.advanceTimersByTime(ANIMATION_DURATION);
  });
}

describe('AccountSelector 键盘导航', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stack-selector 可被键盘聚焦（tabIndex=0）并具备无障碍角色', () => {
    const { selector } = setup();
    expect(selector).toHaveAttribute('tabindex', '0');
    expect(selector).toHaveAttribute('role', 'group');
    expect(selector).toHaveAttribute('aria-label');
  });

  it('Enter 登录当前（初始）账号', () => {
    const { selector, onSelectAccount, accounts } = setup();
    fireEvent.keyDown(selector, { key: 'Enter' });
    expect(onSelectAccount).toHaveBeenCalledTimes(1);
    expect(onSelectAccount).toHaveBeenCalledWith(accounts[0]);
  });

  it('ArrowDown 切到下一个账号', () => {
    const { selector, counterText, onSelectAccount, accounts } = setup();
    expect(counterText()).toContain('1 / 3');
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    advanceAnimation();
    expect(counterText()).toContain('2 / 3');
    fireEvent.keyDown(selector, { key: 'Enter' });
    expect(onSelectAccount).toHaveBeenCalledWith(accounts[1]);
  });

  it('ArrowRight 同样切到下一个账号', () => {
    const { selector, counterText, onSelectAccount, accounts } = setup();
    fireEvent.keyDown(selector, { key: 'ArrowRight' });
    advanceAnimation();
    expect(counterText()).toContain('2 / 3');
    fireEvent.keyDown(selector, { key: 'Enter' });
    expect(onSelectAccount).toHaveBeenCalledWith(accounts[1]);
  });

  it('ArrowUp 切到上一个账号（从首个循环到末个）', () => {
    const { selector, counterText, onSelectAccount, accounts } = setup();
    fireEvent.keyDown(selector, { key: 'ArrowUp' });
    advanceAnimation();
    expect(counterText()).toContain('3 / 3');
    fireEvent.keyDown(selector, { key: 'Enter' });
    expect(onSelectAccount).toHaveBeenCalledWith(accounts[2]);
  });

  it('ArrowLeft 同样切到上一个账号', () => {
    const { selector, counterText, onSelectAccount, accounts } = setup();
    fireEvent.keyDown(selector, { key: 'ArrowLeft' });
    advanceAnimation();
    expect(counterText()).toContain('3 / 3');
    fireEvent.keyDown(selector, { key: 'Enter' });
    expect(onSelectAccount).toHaveBeenCalledWith(accounts[2]);
  });

  it('动画进行中再次按键被 animationLock 拦截（不连跳）', () => {
    const { selector, counterText } = setup();
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    // 动画未完成时再按一次，应被锁拦截
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    advanceAnimation();
    expect(counterText()).toContain('2 / 3'); // 只前进一格，而非 3
  });

  it('Delete 触发删除确认弹层（不直接删除）', () => {
    const { selector, container, onDeleteAccount } = setup();
    expect(container.querySelector('.delete-confirm-row')).toBeNull();
    fireEvent.keyDown(selector, { key: 'Delete' });
    expect(container.querySelector('.delete-confirm-row')).not.toBeNull();
    expect(container.textContent).toContain('确认删除');
    // 仅展示确认，不应直接调用删除回调
    expect(onDeleteAccount).not.toHaveBeenCalled();
  });

  it('方向键调用 preventDefault（防止页面滚动）', () => {
    const { selector } = setup();
    const ev = createEvent.keyDown(selector, { key: 'ArrowDown' });
    fireEvent(selector, ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('无关按键不响应（不 preventDefault、不登录）', () => {
    const { selector, onSelectAccount } = setup();
    const ev = createEvent.keyDown(selector, { key: 'a' });
    fireEvent(selector, ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(onSelectAccount).not.toHaveBeenCalled();
  });
});
