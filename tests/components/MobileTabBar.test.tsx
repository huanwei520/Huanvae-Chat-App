/**
 * MobileTabBar 组件测试
 *
 * 验证：
 * - 渲染两个 tab（消息/通讯录），激活 tab 含 layoutId 指示器元素（且只有一个）
 * - activeTab 变化后指示器随激活 tab 移动
 * - 点击 tab 调 onTabChange 带正确参数（toHaveBeenCalledWith）
 * - 未读徽章渲染与 99+ 截断
 *
 * 注：MobileTabBar 是既有组件（本次补动效 + 补测试），按 frontend-test.md
 * 「注册新组件必须同时改两处文件」仅约束新增组件，此处不强制登记 tests/registry.ts。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileTabBar } from '../../src/pages/mobile/MobileTabBar';

describe('MobileTabBar', () => {
  it('渲染两个 tab，激活 tab 内含唯一指示器', () => {
    const { container } = render(
      <MobileTabBar activeTab="chat" onTabChange={() => {}} />,
    );

    const items = container.querySelectorAll('.mobile-tab-item');
    expect(items).toHaveLength(2);
    expect(screen.getByText('消息')).toBeInTheDocument();
    expect(screen.getByText('通讯录')).toBeInTheDocument();

    // 指示器只渲染在激活 tab 内
    const indicators = container.querySelectorAll('.mobile-tab-indicator');
    expect(indicators).toHaveLength(1);
    expect(items[0].contains(indicators[0])).toBe(true);
    expect(items[0].classList.contains('active')).toBe(true);
    expect(items[1].classList.contains('active')).toBe(false);
  });

  it('activeTab 切到 contacts 后指示器移动到通讯录 tab', () => {
    const { container, rerender } = render(
      <MobileTabBar activeTab="chat" onTabChange={() => {}} />,
    );
    rerender(<MobileTabBar activeTab="contacts" onTabChange={() => {}} />);

    const items = container.querySelectorAll('.mobile-tab-item');
    const indicators = container.querySelectorAll('.mobile-tab-indicator');
    expect(indicators).toHaveLength(1);
    expect(items[1].contains(indicators[0])).toBe(true);
    expect(items[0].classList.contains('active')).toBe(false);
    expect(items[1].classList.contains('active')).toBe(true);
  });

  it('点击 tab 调 onTabChange 带正确参数', () => {
    const onTabChange = vi.fn();
    render(<MobileTabBar activeTab="chat" onTabChange={onTabChange} />);

    fireEvent.click(screen.getByText('通讯录'));
    expect(onTabChange).toHaveBeenLastCalledWith('contacts');

    fireEvent.click(screen.getByText('消息'));
    expect(onTabChange).toHaveBeenLastCalledWith('chat');
    expect(onTabChange).toHaveBeenCalledTimes(2);
  });

  it('未读数徽章：>0 显示、>99 截断为 99+、0 不显示', () => {
    const { container, rerender } = render(
      <MobileTabBar activeTab="chat" onTabChange={() => {}} unreadCount={5} />,
    );
    expect(screen.getByText('5')).toBeInTheDocument();

    rerender(
      <MobileTabBar activeTab="chat" onTabChange={() => {}} unreadCount={120} />,
    );
    expect(screen.getByText('99+')).toBeInTheDocument();

    rerender(
      <MobileTabBar activeTab="chat" onTabChange={() => {}} unreadCount={0} />,
    );
    expect(container.querySelector('.mobile-tab-badge')).toBeNull();
  });
});
