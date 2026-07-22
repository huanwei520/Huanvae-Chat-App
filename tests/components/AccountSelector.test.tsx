/**
 * AccountSelector 键盘导航测试
 *
 * 覆盖为 .stack-selector 新增的键盘支持：
 * - ↑/← → 上一个账号；↓/→ → 下一个账号（与滚轮/拖拽语义一致）
 * - Enter → 登录当前账号
 * - Delete → 触发删除确认（不直接删）
 * - 方向键 preventDefault（防止页面滚动）+ 无关键不响应
 *
 * 另覆盖滚轮手势（见文末 describe）：一次连续手势只切一张（惯性不连跳）、
 * 手势内净位移 |deltaY| 累计 ≥30px 才算一次切换意图、动画进行中滚轮输入被忽略
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

describe('AccountSelector 滚轮手势', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('向下滚动（deltaY>0）切到下一个账号', () => {
    const { selector, counterText, onSelectAccount, accounts } = setup();
    expect(counterText()).toContain('1 / 3');
    fireEvent.wheel(selector, { deltaY: 100 });
    advanceAnimation();
    expect(counterText()).toContain('2 / 3');
    fireEvent.keyDown(selector, { key: 'Enter' });
    expect(onSelectAccount).toHaveBeenCalledWith(accounts[1]);
  });

  it('向上滚动（deltaY<0）切到上一个账号（从首个循环到末个）', () => {
    const { selector, counterText } = setup();
    fireEvent.wheel(selector, { deltaY: -100 });
    advanceAnimation();
    expect(counterText()).toContain('3 / 3');
  });

  it('一次惯性滑动手势（16ms 间隔连发数十个事件）只切一张卡片', () => {
    const { selector, counterText } = setup();
    fireEvent.wheel(selector, { deltaY: 100 });
    // 触控板惯性:16ms 间隔连发 ~40 个 wheel 事件,总时长 ~650ms 超过 400ms 动画锁
    for (let i = 0; i < 40; i += 1) {
      act(() => {
        vi.advanceTimersByTime(16);
      });
      fireEvent.wheel(selector, { deltaY: 100 });
    }
    advanceAnimation();
    expect(counterText()).toContain('2 / 3'); // 仍只前进一格;旧代码此处会连跳到 3 / 3
  });

  it('手势内累计净位移达 30px 才算一次切换意图', () => {
    const { selector, counterText } = setup();
    // 同一手势（16ms 间隔）连发 2 个 deltaY=10:累计 20px 未达阈,不切换
    fireEvent.wheel(selector, { deltaY: 10 });
    act(() => {
      vi.advanceTimersByTime(16);
    });
    fireEvent.wheel(selector, { deltaY: 10 });
    expect(counterText()).toContain('1 / 3');
    // 同一手势内再发 1 个 deltaY=10:累计 30px 达阈,触发一次切换
    // 注意:两次滚动之间不能 advanceTimersByTime ≥200ms,否则超手势间隔会重置累计值
    act(() => {
      vi.advanceTimersByTime(16);
    });
    fireEvent.wheel(selector, { deltaY: 10 });
    advanceAnimation();
    expect(counterText()).toContain('2 / 3');
  });

  it('手势结束（间隔 > 200ms）后再滚可切下一张', () => {
    const { selector, counterText } = setup();
    fireEvent.wheel(selector, { deltaY: 100 });
    advanceAnimation(); // 400ms,Date.now 随 fake timers 同步推进
    act(() => {
      vi.advanceTimersByTime(250);
    });
    fireEvent.wheel(selector, { deltaY: 100 });
    advanceAnimation();
    expect(counterText()).toContain('3 / 3');
  });

  it('动画进行中的滚轮输入被完全忽略（不累计、不消耗手势）', () => {
    const { selector, counterText } = setup();
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    for (let i = 0; i < 5; i += 1) {
      fireEvent.wheel(selector, { deltaY: 100 });
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
    advanceAnimation();
    expect(counterText()).toContain('2 / 3'); // 只被键盘前进一格,滚轮未生效
  });
});
