/**
 * MainMenu 语义分组结构测试（侧边滑出面板的 main 视图）
 *
 * 覆盖「优化显示结构」这次改造的可验证契约：
 * - 好友 / 群聊各自的分组集合与顺序，破坏性操作单独成组且**排在最后**
 * - 危险项确实落在危险组内（不是散在别处只是标了红）
 * - 角色相关项（群管理 / 解散 / 退出）用「常驻 DOM + disabled」表达隐藏：
 *   隐藏态必须既不在无障碍树里、也不可激活 —— 防「能聚焦却按了没反应」
 *
 * 断言全部针对真实 MainMenu 渲染出的 DOM，不 render 自造的 className。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MainMenu } from '../../src/chat/shared/menu/MainMenu';

type MainMenuProps = React.ComponentProps<typeof MainMenu>;

function renderMenu(overrides: Partial<MainMenuProps> = {}) {
  const props: MainMenuProps = {
    targetType: 'friend',
    isOwnerOrAdmin: false,
    isOwner: false,
    isMultiSelectMode: false,
    onSetView: vi.fn(),
    onUploadAvatar: vi.fn(),
    onToggleMultiSelect: vi.fn(),
    onLoadAllHistory: vi.fn(),
    onToggleSpecialCare: vi.fn(),
    onUnblacklist: vi.fn(),
    ...overrides,
  };
  const { container } = render(<MainMenu {...props} />);
  return { container, props };
}

/** 组标题按 DOM 顺序取出 */
function groupTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.menu-group-title')).map(
    (el) => el.textContent ?? '',
  );
}

function dangerGroup(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('.menu-group--danger');
  if (!el) {
    throw new Error('未找到危险操作分组');
  }
  return el;
}

describe('MainMenu — 语义分组结构', () => {
  beforeEach(() => cleanup());

  describe('好友 / bot', () => {
    it('分组为「会话 → 好友 → 危险操作」，危险组排在最后', () => {
      const { container } = renderMenu({ targetType: 'friend' });
      expect(groupTitles(container)).toEqual(['会话', '好友', '危险操作']);

      const groups = container.querySelectorAll('.menu-group');
      expect(groups[groups.length - 1]).toHaveClass('menu-group--danger');
    });

    it('bot 与 friend 分组一致（bot 也是好友关系）', () => {
      const { container } = renderMenu({ targetType: 'bot' });
      expect(groupTitles(container)).toEqual(['会话', '好友', '危险操作']);
    });

    it('「拉黑」「删除好友」落在危险组内，「设置备注」「特别关心」不在', () => {
      const { container } = renderMenu({ targetType: 'friend' });
      const danger = dangerGroup(container);

      expect(danger).toContainElement(screen.getByRole('button', { name: /^拉黑$/ }));
      expect(danger).toContainElement(screen.getByRole('button', { name: /删除好友/ }));
      expect(danger).not.toContainElement(screen.getByRole('button', { name: /设置备注/ }));
      expect(danger).not.toContainElement(screen.getByRole('button', { name: /^特别关心$/ }));
    });

    it('已拉黑时「取消拉黑」是恢复性操作，归「好友」组而不是危险组', () => {
      const { container } = renderMenu({ targetType: 'friend', isFriendBlacklisted: true });
      const danger = dangerGroup(container);
      const unblock = screen.getByRole('button', { name: /取消拉黑/ });

      expect(danger).not.toContainElement(unblock);
      expect(screen.queryByRole('button', { name: /^拉黑$/ })).toBeNull();
      // 危险组只剩删除好友
      expect(danger).toContainElement(screen.getByRole('button', { name: /删除好友/ }));
    });

    it('「多选消息」「加载全部记录」归会话组', () => {
      const { container } = renderMenu({ targetType: 'friend' });
      const conversation = container.querySelectorAll<HTMLElement>('.menu-group')[0];

      expect(conversation).toContainElement(screen.getByRole('button', { name: /多选消息/ }));
      expect(conversation).toContainElement(screen.getByRole('button', { name: /加载全部记录/ }));
    });
  });

  describe('群聊', () => {
    it('分组为「会话 → 群聊 → 群管理 → 危险操作」，危险组排在最后', () => {
      const { container } = renderMenu({ targetType: 'group', isOwnerOrAdmin: true });
      expect(groupTitles(container)).toEqual(['会话', '群聊', '群管理', '危险操作']);

      const groups = container.querySelectorAll('.menu-group');
      expect(groups[groups.length - 1]).toHaveClass('menu-group--danger');
    });

    it('普通成员：群管理组隐藏（脱离无障碍树）且组内项被禁用，不可误触发', () => {
      const { container } = renderMenu({ targetType: 'group', isOwnerOrAdmin: false });

      const manageGroup = Array.from(container.querySelectorAll<HTMLElement>('.menu-group')).find(
        (g) => g.querySelector('.menu-group-title')?.textContent === '群管理',
      );
      expect(manageGroup).toHaveAttribute('aria-hidden', 'true');

      // 脱离无障碍树 → 按角色查不到
      expect(screen.queryByRole('button', { name: /修改群名称/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /邀请成员/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /邀请码管理/ })).toBeNull();

      // 且真的被禁用（不进 Tab 序、Enter 也不会触发）
      expect(screen.getByText('修改群名称').closest('button')).toBeDisabled();
      expect(screen.getByText('邀请码管理').closest('button')).toBeDisabled();
    });

    it('管理员（非群主）：群管理可用，但「转让群主」禁用', () => {
      renderMenu({ targetType: 'group', isOwnerOrAdmin: true, isOwner: false });

      expect(screen.getByRole('button', { name: /修改群名称/ })).toBeEnabled();
      expect(screen.getByRole('button', { name: /邀请成员/ })).toBeEnabled();
      expect(screen.getByText('转让群主').closest('button')).toBeDisabled();
    });

    it('群主：转让群主 / 解散群聊 可用，退出群聊禁用', () => {
      const { container } = renderMenu({
        targetType: 'group',
        isOwnerOrAdmin: true,
        isOwner: true,
      });

      expect(screen.getByRole('button', { name: /转让群主/ })).toBeEnabled();

      const disband = screen.getByRole('button', { name: /解散群聊/ });
      expect(disband).toBeEnabled();
      expect(dangerGroup(container)).toContainElement(disband);

      expect(screen.getByText('退出群聊').closest('button')).toBeDisabled();
    });

    it('非群主：退出群聊可用，解散群聊禁用', () => {
      const { container } = renderMenu({
        targetType: 'group',
        isOwnerOrAdmin: false,
        isOwner: false,
      });

      const leave = screen.getByRole('button', { name: /退出群聊/ });
      expect(leave).toBeEnabled();
      expect(dangerGroup(container)).toContainElement(leave);

      expect(screen.getByText('解散群聊').closest('button')).toBeDisabled();
    });

    it('「群公告 / 查看成员 / 修改群内昵称」归群聊组，人人可用', () => {
      const { container } = renderMenu({ targetType: 'group' });
      const chatGroup = Array.from(container.querySelectorAll<HTMLElement>('.menu-group')).find(
        (g) => g.querySelector('.menu-group-title')?.textContent === '群聊',
      );

      expect(chatGroup).toContainElement(screen.getByRole('button', { name: /群公告/ }));
      expect(chatGroup).toContainElement(screen.getByRole('button', { name: /查看成员/ }));
      expect(chatGroup).toContainElement(screen.getByRole('button', { name: /修改群内昵称/ }));
    });

    it('群头像上传区仅群主/管理员可见', () => {
      const group = {
        group_id: 'g1',
        group_name: '前端小分队',
        role: 'owner',
      } as MainMenuProps['group'];

      const { container, ...rest } = renderMenu({
        targetType: 'group',
        isOwnerOrAdmin: true,
        group,
      });
      expect(container.querySelector('.menu-avatar-section')).not.toBeNull();
      expect(rest).toBeTruthy();

      cleanup();
      const plain = renderMenu({ targetType: 'group', isOwnerOrAdmin: false, group });
      expect(plain.container.querySelector('.menu-avatar-section')).toBeNull();
    });
  });
});
