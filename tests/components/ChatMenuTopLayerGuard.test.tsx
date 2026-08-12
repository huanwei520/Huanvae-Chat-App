/**
 * 侧边设置面板的「点击外部关闭」必须让位于顶层浮层
 *
 * ## 被修的真机现象
 *
 * 手机端：侧边栏 → 查找聊天记录 → 图片九宫格 → 点开预览 → 点 ✕
 * ⇒ **整个侧边面板一起消失，落回聊天消息页**。
 *
 * ## 成因
 *
 * ChatMenuPanel 与 MobileMediaPreview 各自 `createPortal(…, document.body)`，
 * 在 DOM 里是**兄弟**、互不包含。useChatMenu 的 `handleClickOutside` 判据是
 * `menuRef.current.contains(e.target)` ⇒ 预览里的**任何**一次 mousedown
 * （✕ / 背景 / 图片 / 播放键）对面板而言都是"点在外部" ⇒ 面板被连带关掉。
 *
 * ## 这些用例不是恒真的
 *
 * 用例 1（控制组）证明"点真正的外部确实会关" —— 没有它，用例 2 的"仍开着"可能只是
 * 因为整条关闭通路根本没跑起来（假绿）。用例 4 证明顶层卸载后关闭能力**恢复**，
 * 挡住"干脆把点击外部关闭整个禁掉"这种过度修法。
 * 去掉 useChatMenu 里那句 `if (isTopLayerActive()) return;`，用例 2 立刻翻红。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
// ⚠️ 引用稳定单例（见 .claude/rules/frontend-test.md「mock context hook 的返回值必须引用稳定」）
const sessionMock = vi.hoisted(() => ({ session: { userId: 'me' } }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mockApi,
  useSession: () => sessionMock,
}));

vi.mock('../../src/components/common/AvatarCropModal', () => ({
  useAvatarCrop: () => ({ requestCrop: vi.fn(), cropModal: null }),
}));

// 本用例只关心「层级判定」，返回键分发与相册保存都不参与
vi.mock('../../src/hooks/useMobileBackHandler', () => ({
  useMobileBackHandler: vi.fn(),
  useMobileBackOverlay: vi.fn(),
}));
vi.mock('../../src/utils/saveToGallery', () => ({
  saveToGallery: vi.fn().mockResolvedValue({ success: true }),
}));

import { useChatMenu } from '../../src/chat/group/useChatMenu';
import { MobileMediaPreview } from '../../src/chat/shared/MobileMediaPreview';
import type { Friend } from '../../src/types/chat';

const friend: Friend = {
  friend_id: 'f1',
  friend_nickname: 'Friend One',
  friend_avatar_url: null,
  add_time: '',
  approve_reason: null,
  friend_remark: null,
  is_blacklisted: false,
  is_special_care: false,
};

/**
 * 复刻真机结构：面板（menuRef 所在的那棵子树）与全屏预览是**互不包含**的两棵树。
 * MobileMediaPreview 自己 portal 到 body，所以它天然落在 menuRef 之外。
 */
function Harness({ previewOpen }: { previewOpen: boolean }) {
  const menu = useChatMenu({ target: { type: 'friend', data: friend } });
  return (
    <div>
      <div ref={menu.menuRef} data-testid="panel">
        <button type="button" data-testid="panel-inner">面板内的按钮</button>
      </div>
      <button type="button" data-testid="toggle" onClick={menu.handleToggle}>开合</button>
      <span data-testid="menu-open">{String(menu.isOpen)}</span>
      <MobileMediaPreview
        isOpen={previewOpen}
        type="image"
        src="http://127.0.0.1:41234/proxied/photo.png"
        filename="photo.png"
        onClose={vi.fn()}
      />
    </div>
  );
}

const menuIsOpen = () => screen.getByTestId('menu-open').textContent;
const openMenu = () => {
  act(() => {
    fireEvent.click(screen.getByTestId('toggle'));
  });
};

describe('ChatMenu 点击外部关闭 × 顶层浮层', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  it('控制组：没有顶层浮层时，点面板外部照常关闭（证明这条通路真的在跑）', () => {
    render(<Harness previewOpen={false} />);
    openMenu();
    expect(menuIsOpen()).toBe('true');

    act(() => {
      fireEvent.mouseDown(document.body);
    });

    expect(menuIsOpen()).toBe('false');
  });

  it('顶层预览开着时，点预览里的 ✕ 不会连带关掉面板（本次修的就是这条）', () => {
    const { rerender } = render(<Harness previewOpen={false} />);
    openMenu();
    expect(menuIsOpen()).toBe('true');

    rerender(<Harness previewOpen />);
    const closeBtn = document.querySelector('.mobile-media-preview-close');
    expect(closeBtn).not.toBeNull();
    // 预览确实在 menuRef 之外（否则这个用例会因为"点在内部"而假通过）
    expect(screen.getByTestId('panel').contains(closeBtn)).toBe(false);

    act(() => {
      fireEvent.mouseDown(closeBtn as Element);
    });

    expect(menuIsOpen()).toBe('true');
  });

  it('顶层预览开着时，点预览背景同样不关面板', () => {
    const { rerender } = render(<Harness previewOpen={false} />);
    openMenu();
    rerender(<Harness previewOpen />);

    const overlay = document.querySelector('.mobile-media-preview-overlay');
    expect(overlay).not.toBeNull();
    act(() => {
      fireEvent.mouseDown(overlay as Element);
    });

    expect(menuIsOpen()).toBe('true');
  });

  it('预览关闭 / 卸载后，关闭能力恢复（不是把点击外部关闭整个禁掉）', async () => {
    const { rerender } = render(<Harness previewOpen={false} />);
    openMenu();
    rerender(<Harness previewOpen />);

    act(() => {
      fireEvent.mouseDown(document.querySelector('.mobile-media-preview-overlay') as Element);
    });
    expect(menuIsOpen()).toBe('true');

    // 预览收起（AnimatePresence 退场卸载是异步的，等它真的从注册表里出册）
    rerender(<Harness previewOpen={false} />);
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(menuIsOpen()).toBe('false');
  });
});
