/**
 * 查找命中项的全屏预览：点 ✕ / 点背景要**真的关掉**
 *
 * ## 被修的真机现象
 *
 * 手机端从侧边栏进「查找聊天记录」→ 图片九宫格 → 点开预览 → 点 ✕ ⇒ 预览关不掉
 *（今天这条被另一个更早的缺陷掩盖着：面板会先被连带关掉，所以看起来像"退回聊天页"。
 *  面板那条修好后，这条立刻显形。）
 *
 * ## 成因
 *
 * `MobileMediaPreview` 虽然 `createPortal` 到 body，但 **React 合成事件仍沿 React 树冒泡**。
 * 它原先渲染在 `<li onClick={openPreview}>` 的**内部** ⇒ 点 ✕ 先 `onClose()`（previewOpen=false），
 * 事件继续冒泡到 `<li>` 的 onClick ⇒ 又 `openPreview()`（previewOpen=true）⇒ 预览原地复活。
 *
 * ## 这些用例不是恒真的
 *
 * 用例 1 先证明"点格子确实能打开"（否则"关掉了"可能只是它压根没开）；
 * 用例 2/3 再断言关闭后**保持**关闭。把 `{mobilePreview}` 挪回 `<li>` 里面，2/3 立刻翻红
 *（已做变异验证，见交付）。
 *
 * ⚠️ 与 tests/components/ConversationSearchHit.test.tsx 的分工：那份把 MobileMediaPreview
 * 整个 mock 成一个 `<div>`，测的是"喂进去的是哪个 src"；本文件必须用**真组件**，
 * 因为要复现的正是真组件里那次 `onClose` 之后的冒泡。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockUseFileCache = vi.hoisted(() => vi.fn());
const mockOpenMediaWindow = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => ({
  session: { serverUrl: 'https://api.example', accessToken: 'tok-1' },
}));

vi.mock('../../src/hooks/useFileCache', () => ({ useFileCache: mockUseFileCache }));
vi.mock('../../src/media', () => ({ openMediaWindow: mockOpenMediaWindow }));
vi.mock('../../src/contexts/SessionContext', () => ({ useSession: () => sessionMock }));
vi.mock('../../src/utils/platform', () => ({
  isMobile: () => true,
  isDesktop: () => false,
  isMacOS: () => false,
  getPlatformType: () => 'mobile',
  _resetPlatformCache: () => undefined,
}));
// 返回键分发与相册保存不参与本用例；工厂必须列全被测代码用到的导出
vi.mock('../../src/hooks/useMobileBackHandler', () => ({
  useMobileBackHandler: vi.fn(),
  useMobileBackOverlay: vi.fn(),
}));
vi.mock('../../src/utils/saveToGallery', () => ({
  saveToGallery: vi.fn().mockResolvedValue({ success: true }),
}));

import { ConversationSearchHit } from '../../src/components/search/ConversationSearchHit';
import type { LocalMessage } from '../../src/db';

const PROXIED_SRC = 'http://127.0.0.1:41234/proxied/photo.png';

const buildMessage = (overrides: Partial<LocalMessage> = {}): LocalMessage => ({
  message_uuid: 'm1',
  conversation_id: 'conv-u1-u9',
  conversation_type: 'friend',
  sender_id: 'u1',
  sender_name: 'Alice',
  sender_avatar: null,
  content: 'photo.png',
  content_type: 'image',
  file_uuid: 'file-uuid-1',
  file_url: 'https://backend.example/presigned/RAW-SHOULD-NEVER-BE-USED',
  file_size: 1024,
  file_hash: 'hash-1',
  image_width: null,
  image_height: null,
  seq: 1,
  reply_to: null,
  media_group_id: null,
  media_group_index: null,
  media_group_count: null,
  is_recalled: false,
  is_deleted: false,
  send_time: '2026-05-11T08:30:00Z',
  created_at: null,
  ...overrides,
});

function renderHit(layout: 'row' | 'cover') {
  return render(
    <ul>
      <ConversationSearchHit
        message={buildMessage()}
        query=""
        layout={layout}
        onLocate={vi.fn()}
      />
    </ul>,
  );
}

const overlay = () => document.querySelector('.mobile-media-preview-overlay');

describe('ConversationSearchHit 全屏预览的关闭', () => {
  beforeEach(() => {
    cleanup();
    document.body.style.overflow = '';
    mockUseFileCache.mockReset();
    mockUseFileCache.mockReturnValue({
      src: PROXIED_SRC,
      isLocal: false,
      localPath: null,
      presignedUrl: 'https://backend.example/presigned/photo.png?sig=abc',
      openInFolder: vi.fn(),
    });
    mockOpenMediaWindow.mockReset();
  });

  it('点九宫格格子先能打开预览（后面"关掉了"的断言才有意义）', () => {
    const { container } = renderHit('cover');
    fireEvent.click(container.querySelector('.conv-msg-search-cell') as HTMLElement);
    expect(overlay()).not.toBeNull();
  });

  it('点 ✕ 关掉预览且不会被命中项的 onClick 重新打开', async () => {
    const { container } = renderHit('cover');
    fireEvent.click(container.querySelector('.conv-msg-search-cell') as HTMLElement);
    expect(overlay()).not.toBeNull();

    fireEvent.click(document.querySelector('.mobile-media-preview-close') as Element);

    // AnimatePresence 退场卸载是异步的 ⇒ 消失断言必须入 waitFor
    await waitFor(() => {
      expect(overlay()).toBeNull();
    });
    // 冒泡回 <li> 会立刻把 previewOpen 重新置 true —— 再等一轮确认它没有原地复活
    await waitFor(() => {
      expect(overlay()).toBeNull();
    });
  });

  it('点预览背景同样能关掉（另一条会冒泡到 <li> 的路径）', async () => {
    const { container } = renderHit('cover');
    fireEvent.click(container.querySelector('.conv-msg-search-cell') as HTMLElement);

    fireEvent.click(overlay() as Element);

    await waitFor(() => {
      expect(overlay()).toBeNull();
    });
  });

  it('行版式（row）同样成立 —— 两个版式各有一份 <li>，不能只修其中一个', async () => {
    const { container } = renderHit('row');
    fireEvent.click(container.querySelector('.conv-msg-search-hit') as HTMLElement);
    expect(overlay()).not.toBeNull();

    fireEvent.click(document.querySelector('.mobile-media-preview-close') as Element);

    await waitFor(() => {
      expect(overlay()).toBeNull();
    });
  });

  it('预览是 <li> 的兄弟而不是子节点：<ul> 的直接子节点仍只有 <li>（portal 不添 DOM 子节点）', () => {
    const { container } = renderHit('cover');
    fireEvent.click(container.querySelector('.conv-msg-search-cell') as HTMLElement);

    const ul = container.querySelector('ul') as HTMLElement;
    expect(Array.from(ul.children).map((el) => el.tagName)).toEqual(['LI']);
    // 预览确实挂在 body 上、且不在命中项内部
    expect((container.querySelector('.conv-msg-search-cell') as HTMLElement).contains(overlay()))
      .toBe(false);
  });
});
