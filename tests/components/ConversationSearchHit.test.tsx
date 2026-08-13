/**
 * ConversationSearchHit —— 会话内查找的单条命中项
 *
 * 覆盖两组契约：
 *
 * A. **取源红线**（原 ConversationSearchMedia.test.tsx 的四条，随组件合并搬来）
 *    1. 显示 src 来自 useFileCache（内部已过唯一收口点 resolveDisplayUrl 反代改写），
 *       绝不用消息行里的裸 file_url —— 私有 CA 自签 leaf 过不了 webview 系统信任库，
 *       真机上会静默裂图（见 .claude/rules/frontend-test.md「所有 X 必经 Y」）
 *    2. 图片渲染 <img>、视频渲染 <video preload="metadata">
 *    3. 取源参数：群消息走 group 域、好友/bot 走 friend 域，**autoCache 关闭**
 *    4. src 未就绪 / 无 file_uuid → 同尺寸占位，不渲染空 src 破图
 *
 * B. **本次改造的交互契约**
 *    - 版式：layout="cover" 出正方形格子（无文字块）、layout="row" 出列表行（有文字块）
 *    - **左键 = 打开**：桌面走独立预览窗 openMediaWindow（且递的是**原始** presignedUrl
 *      而不是反代 src）、移动端出全屏 MobileMediaPreview；文字/文件命中左键**什么都不做**
 *    - **右键 / 长按 / 键盘 Enter = 定位菜单**：三条入口弹同一个「定位到聊天消息」，
 *      选中才调 onLocate。左键与右键触发的是**不同**回调 —— 这是「点击即定位」被移除的判据
 *    - 长按弹菜单后浏览器补发的那次合成 click 被吞掉（否则长按会既弹菜单又打开预览）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

const mockUseFileCache = vi.hoisted(() => vi.fn());
const mockOpenMediaWindow = vi.hoisted(() => vi.fn());
const mockIsMobile = vi.hoisted(() => vi.fn(() => false));
// ⚠️ 引用稳定的单例：每次 render 返回新对象会虚假触发下游依赖 session 的 effect
// （见 .claude/rules/frontend-test.md「mock context hook 的返回值必须引用稳定」）
const sessionMock = vi.hoisted(() => ({
  session: { serverUrl: 'https://api.example', accessToken: 'tok-1' },
}));

vi.mock('../../src/hooks/useFileCache', () => ({ useFileCache: mockUseFileCache }));
vi.mock('../../src/media', () => ({ openMediaWindow: mockOpenMediaWindow }));
vi.mock('../../src/contexts/SessionContext', () => ({ useSession: () => sessionMock }));
vi.mock('../../src/utils/platform', () => ({
  isMobile: mockIsMobile,
  isDesktop: () => !mockIsMobile(),
  isMacOS: () => false,
  getPlatformType: () => (mockIsMobile() ? 'mobile' : 'desktop'),
  _resetPlatformCache: () => undefined,
}));
// 真组件是 portal + framer-motion 全屏层，这里只需要断言「开了、喂进去的是哪个 src」
vi.mock('../../src/chat/shared/MobileMediaPreview', () => ({
  MobileMediaPreview: ({ isOpen, type, src }: { isOpen: boolean; type: string; src: string }) =>
    (isOpen ? <div data-testid="mobile-preview" data-type={type} data-src={src} /> : null),
}));

import { ConversationSearchHit } from '../../src/components/search/ConversationSearchHit';
import type { LocalMessage } from '../../src/db';

const PROXIED_SRC = 'http://127.0.0.1:41234/proxied/photo.png';
const RAW_PRESIGNED = 'https://backend.example/presigned/photo.png?sig=abc';

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

function renderHit(
  message: LocalMessage,
  opts: { layout?: 'row' | 'cover'; query?: string } = {},
) {
  const onLocate = vi.fn();
  const view = render(
    <ul>
      <ConversationSearchHit
        message={message}
        query={opts.query ?? ''}
        layout={opts.layout ?? 'row'}
        onLocate={onLocate}
      />
    </ul>,
  );
  return { ...view, onLocate };
}

/** 触发一次长按（fake timers 下推过 500ms 判定窗） */
function longPress(el: HTMLElement) {
  fireEvent.touchStart(el, { touches: [{ clientX: 30, clientY: 40 }] });
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

describe('ConversationSearchHit', () => {
  beforeEach(() => {
    mockUseFileCache.mockReset();
    mockUseFileCache.mockReturnValue({
      src: PROXIED_SRC,
      isLocal: false,
      localPath: null,
      presignedUrl: RAW_PRESIGNED,
      openInFolder: vi.fn(),
    });
    mockOpenMediaWindow.mockReset();
    mockIsMobile.mockReturnValue(false);
  });

  describe('取源红线（媒体）', () => {
    it('图片：src 取自 useFileCache（经反代），不是消息行里的裸 file_url', () => {
      const { container } = renderHit(buildMessage());

      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBe(PROXIED_SRC);
      // 回归守卫：一旦改回直接喂 file_url，这条即 FAIL
      expect(container.innerHTML).not.toContain('RAW-SHOULD-NEVER-BE-USED');
    });

    it('视频（本地还没存过封面）：渲染 <video preload="metadata">，不是 <img>', async () => {
      // ⚠️ 断言必须 await：自「视频封面本地持久化」落地起，<VideoThumbnail> 拿到 fileHash 后
      // 会先异步问一次 Rust「这个视频有没有存过封面」（invoke get_video_poster_path），
      // 那几毫秒里它**什么都不渲染**（渲染 <video> 会让一屏几十个格子各拉一次元数据，
      // 正是该功能要消灭的成本，见 src/chat/shared/useVideoPoster.ts）。
      // 本用例里全局 invoke mock 返回 undefined = 没存过 ⇒ 落到 <video> 分支，
      // 与本功能落地前一致；存过的路径由 tests/components/VideoThumbnailPoster.test.tsx 覆盖。
      const { container } = renderHit(
        buildMessage({ content_type: 'video', content: 'clip.mp4' }),
      );

      await waitFor(() => {
        const video = container.querySelector('video');
        expect(video?.getAttribute('preload')).toBe('metadata');
        expect(container.querySelector('img')).toBeNull();
      });
    });

    it('取源参数：群消息走 group 域、好友/bot 走 friend 域，且 autoCache 关闭', () => {
      renderHit(buildMessage());
      expect(mockUseFileCache).toHaveBeenLastCalledWith(
        expect.objectContaining({
          fileUuid: 'file-uuid-1',
          fileHash: 'hash-1',
          fileName: 'photo.png',
          fileType: 'image',
          urlType: 'friend',
          autoCache: false,
          enabled: true,
        }),
      );

      renderHit(buildMessage({ conversation_type: 'group', content_type: 'video' }));
      expect(mockUseFileCache).toHaveBeenLastCalledWith(
        expect.objectContaining({ urlType: 'group', fileType: 'video', autoCache: false }),
      );
    });

    it('src 未就绪 / 无 file_uuid：给同尺寸占位而不是空 src 破图，且不去取源', () => {
      mockUseFileCache.mockReturnValue({
        src: null,
        isLocal: false,
        localPath: null,
        presignedUrl: null,
        openInFolder: vi.fn(),
      });
      const { container } = renderHit(buildMessage({ file_uuid: null }));

      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('video')).toBeNull();
      expect(container.querySelector('.conv-msg-search-thumb--empty')).not.toBeNull();
      expect(mockUseFileCache).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: false }),
      );
    });
  });

  describe('版式：图片/视频分类走正方形九宫格封面，其余分类保持列表行', () => {
    it('layout="cover"：出格子 + 封面，没有文字块（这两个分类没有正文可显示）', () => {
      const { container } = renderHit(buildMessage(), { layout: 'cover' });

      expect(container.querySelector('.conv-msg-search-cell')).not.toBeNull();
      expect(container.querySelector('img')?.className).toBe('conv-msg-search-cover');
      expect(container.querySelector('.conv-msg-search-hit')).toBeNull();
      expect(container.querySelector('.conv-msg-search-hit-body')).toBeNull();
    });

    it('layout="row"：出列表行 + 40px 缩略图 + 文字块（发件人 / 时间 / 徽标 / 正文）', () => {
      const { container } = renderHit(buildMessage(), { layout: 'row' });

      expect(container.querySelector('.conv-msg-search-hit')).not.toBeNull();
      expect(container.querySelector('img')?.className).toBe('conv-msg-search-thumb');
      expect(container.querySelector('.conv-msg-search-cell')).toBeNull();
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('图片')).toBeInTheDocument();
    });

    it('视频封面带播放标记（九宫格里图片与视频只能靠它区分），图片没有', () => {
      const { container: videoCell } = renderHit(
        buildMessage({ content_type: 'video', content: 'clip.mp4' }),
        { layout: 'cover' },
      );
      expect(videoCell.querySelector('.conv-msg-search-cover-play')).not.toBeNull();

      const { container: imageCell } = renderHit(buildMessage(), { layout: 'cover' });
      expect(imageCell.querySelector('.conv-msg-search-cover-play')).toBeNull();
    });
  });

  describe('左键 = 打开 / 播放', () => {
    it('桌面点图片：开独立预览窗，递的是**原始** presignedUrl 而不是反代 src，且不定位', () => {
      const { container, onLocate } = renderHit(buildMessage(), { layout: 'cover' });

      fireEvent.click(container.querySelector('.conv-msg-search-cell') as HTMLElement);

      expect(mockOpenMediaWindow).toHaveBeenCalledTimes(1);
      expect(mockOpenMediaWindow).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'image',
          fileUuid: 'file-uuid-1',
          filename: 'photo.png',
          urlType: 'friend',
          presignedUrl: RAW_PRESIGNED,
        }),
        { serverUrl: 'https://api.example', accessToken: 'tok-1' },
      );
      // 左键不再是「定位」——这是旧交互被彻底移除的判据
      expect(onLocate).not.toHaveBeenCalled();
    });

    it('桌面点视频：同一条通路，type=video', () => {
      const { container } = renderHit(buildMessage({ content_type: 'video', content: 'clip.mp4' }), {
        layout: 'cover',
      });

      fireEvent.click(container.querySelector('.conv-msg-search-cell') as HTMLElement);

      expect(mockOpenMediaWindow).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'video', filename: 'clip.mp4' }),
        expect.anything(),
      );
    });

    it('本地已缓存时不递 presignedUrl（预览窗直接用本地文件）', () => {
      mockUseFileCache.mockReturnValue({
        src: 'http://127.0.0.1:41234/local/photo.png',
        isLocal: true,
        localPath: '/data/photo.png',
        presignedUrl: RAW_PRESIGNED,
        openInFolder: vi.fn(),
      });
      const { container } = renderHit(buildMessage(), { layout: 'cover' });

      fireEvent.click(container.querySelector('.conv-msg-search-cell') as HTMLElement);

      expect(mockOpenMediaWindow).toHaveBeenLastCalledWith(
        expect.objectContaining({ presignedUrl: undefined, localPath: '/data/photo.png' }),
        expect.anything(),
      );
    });

    it('移动端点图片：不开独立窗（移动端没有多窗口），出全屏预览且喂的是反代 src', () => {
      mockIsMobile.mockReturnValue(true);
      const { container } = renderHit(buildMessage(), { layout: 'cover' });

      fireEvent.click(container.querySelector('.conv-msg-search-cell') as HTMLElement);

      expect(mockOpenMediaWindow).not.toHaveBeenCalled();
      const preview = screen.getByTestId('mobile-preview');
      expect(preview).toHaveAttribute('data-type', 'image');
      expect(preview).toHaveAttribute('data-src', PROXIED_SRC);
    });

    it('src 还没就绪：点了不开任何预览（避免空 src 的预览窗）', () => {
      mockUseFileCache.mockReturnValue({
        src: null,
        isLocal: false,
        localPath: null,
        presignedUrl: null,
        openInFolder: vi.fn(),
      });
      const { container } = renderHit(buildMessage(), { layout: 'cover' });

      fireEvent.click(container.querySelector('.conv-msg-search-cell') as HTMLElement);

      expect(mockOpenMediaWindow).not.toHaveBeenCalled();
      expect(screen.queryByTestId('mobile-preview')).not.toBeInTheDocument();
    });

    it('文字命中：左键什么都不做（既不打开也不定位）', () => {
      const { container, onLocate } = renderHit(
        buildMessage({ content_type: 'text', content: '普通一句话', file_uuid: null }),
      );

      fireEvent.click(container.querySelector('.conv-msg-search-hit') as HTMLElement);

      expect(mockOpenMediaWindow).not.toHaveBeenCalled();
      expect(onLocate).not.toHaveBeenCalled();
      expect(screen.queryByText('定位到聊天消息')).not.toBeInTheDocument();
    });

    it('文件命中：给文档图标，不去取媒体源', () => {
      const { container } = renderHit(
        buildMessage({ content_type: 'file', content: 'a.zip', file_uuid: 'f-zip' }),
      );

      expect(container.querySelector('.conv-msg-search-thumb--doc')).not.toBeNull();
      expect(mockUseFileCache).not.toHaveBeenCalled();
    });
  });

  describe('右键 / 长按 / 键盘 = 「定位到聊天消息」菜单', () => {
    it('右键弹菜单，选中菜单项才调 onLocate —— 与左键是两个不同回调', () => {
      const message = buildMessage();
      const { container, onLocate } = renderHit(message, { layout: 'cover' });
      const cell = container.querySelector('.conv-msg-search-cell') as HTMLElement;

      fireEvent.contextMenu(cell);

      // 弹出菜单本身不等于定位
      expect(onLocate).not.toHaveBeenCalled();
      expect(mockOpenMediaWindow).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('menuitem', { name: '定位到聊天消息' }));

      expect(onLocate).toHaveBeenCalledTimes(1);
      expect(onLocate).toHaveBeenLastCalledWith(message);
      // 定位不该顺带打开预览
      expect(mockOpenMediaWindow).not.toHaveBeenCalled();
      // 选完即收
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('文字命中同样能右键定位（它唯一的动作）', () => {
      const message = buildMessage({ content_type: 'text', content: '普通一句话', file_uuid: null });
      const { container, onLocate } = renderHit(message);

      fireEvent.contextMenu(container.querySelector('.conv-msg-search-hit') as HTMLElement);
      fireEvent.click(screen.getByRole('menuitem', { name: '定位到聊天消息' }));

      expect(onLocate).toHaveBeenLastCalledWith(message);
    });

    it('键盘 Enter 弹同一个菜单（键盘没有右键；焦点进入菜单项）', () => {
      const { container, onLocate } = renderHit(buildMessage());

      fireEvent.keyDown(container.querySelector('.conv-msg-search-hit') as HTMLElement, {
        key: 'Enter',
      });

      const item = screen.getByRole('menuitem', { name: '定位到聊天消息' });
      expect(item).toHaveFocus();
      expect(onLocate).not.toHaveBeenCalled();

      fireEvent.click(item);
      expect(onLocate).toHaveBeenCalledTimes(1);
    });

    describe('移动端长按（无右键 ⇒ 长按等价）', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        mockIsMobile.mockReturnValue(true);
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('长按 500ms 弹菜单；不足 500ms 抬手不弹', () => {
        const { container } = renderHit(buildMessage(), { layout: 'cover' });
        const cell = container.querySelector('.conv-msg-search-cell') as HTMLElement;

        fireEvent.touchStart(cell, { touches: [{ clientX: 30, clientY: 40 }] });
        act(() => {
          vi.advanceTimersByTime(300);
        });
        fireEvent.touchEnd(cell);
        act(() => {
          vi.advanceTimersByTime(400);
        });
        expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

        longPress(cell);
        expect(screen.getByRole('menuitem', { name: '定位到聊天消息' })).toBeInTheDocument();
      });

      it('长按中手指移动超过阈值（在滚列表）⇒ 不弹菜单', () => {
        const { container } = renderHit(buildMessage(), { layout: 'cover' });
        const cell = container.querySelector('.conv-msg-search-cell') as HTMLElement;

        fireEvent.touchStart(cell, { touches: [{ clientX: 30, clientY: 40 }] });
        fireEvent.touchMove(cell, { touches: [{ clientX: 30, clientY: 90 }] });
        act(() => {
          vi.advanceTimersByTime(500);
        });

        expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
      });

      it('长按弹菜单后，浏览器补发的那次 click 被吞掉（不会又打开预览）', () => {
        const { container } = renderHit(buildMessage(), { layout: 'cover' });
        const cell = container.querySelector('.conv-msg-search-cell') as HTMLElement;

        longPress(cell);
        fireEvent.click(cell);

        expect(screen.queryByTestId('mobile-preview')).not.toBeInTheDocument();

        // 吞的只是长按后那一次；下一次真点击照常打开
        fireEvent.click(cell);
        expect(screen.getByTestId('mobile-preview')).toBeInTheDocument();
      });
    });
  });
});
