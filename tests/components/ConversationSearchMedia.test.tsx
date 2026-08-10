/**
 * ConversationSearchMedia —— 会话内查找结果里的图片 / 视频缩略图
 *
 * 覆盖它仅有的三条契约：
 * 1. 显示 src **来自 useFileCache**（其内部已经过唯一收口点 resolveDisplayUrl 反代改写），
 *    绝不用消息行里的裸 file_url —— 私有 CA 自签 leaf 过不了 webview 系统信任库，
 *    真机上会静默裂图（见 .claude/rules/frontend-test.md「所有 X 必经 Y」）
 * 2. 图片渲染 <img>、视频渲染 <video preload="metadata">（不是给视频也塞 img）
 * 3. 取源参数正确：群消息走 group 域、好友/bot 走 friend 域；**autoCache 关闭**
 *    （浏览态一页几十个媒体，逐个触发后台下载会把带宽打满）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const mockUseFileCache = vi.hoisted(() => vi.fn());

vi.mock('../../src/hooks/useFileCache', () => ({
  useFileCache: mockUseFileCache,
}));

import { ConversationSearchMedia } from '../../src/components/search/ConversationSearchMedia';
import type { LocalMessage } from '../../src/db';

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

describe('ConversationSearchMedia', () => {
  beforeEach(() => {
    mockUseFileCache.mockReset();
    mockUseFileCache.mockReturnValue({ src: 'http://127.0.0.1:41234/proxied/photo.png' });
  });

  it('图片：src 取自 useFileCache（经反代），不是消息行里的裸 file_url', () => {
    const { container } = render(<ConversationSearchMedia message={buildMessage()} />);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('http://127.0.0.1:41234/proxied/photo.png');
    // 回归守卫：一旦改回直接喂 file_url，这条即 FAIL
    expect(container.innerHTML).not.toContain('RAW-SHOULD-NEVER-BE-USED');
  });

  it('视频：渲染 <video preload="metadata">，不是 <img>', () => {
    const { container } = render(
      <ConversationSearchMedia message={buildMessage({ content_type: 'video', content: 'clip.mp4' })} />,
    );

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(container.querySelector('img')).toBeNull();
  });

  it('取源参数：群消息走 group 域，好友/bot 走 friend 域，且 autoCache 关闭', () => {
    render(<ConversationSearchMedia message={buildMessage()} />);
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

    render(
      <ConversationSearchMedia
        message={buildMessage({ conversation_type: 'group', content_type: 'video' })}
      />,
    );
    expect(mockUseFileCache).toHaveBeenLastCalledWith(
      expect.objectContaining({ urlType: 'group', fileType: 'video', autoCache: false }),
    );
  });

  it('src 未就绪 / 无 file_uuid：给同尺寸占位而不是渲染空 src 的破图', () => {
    mockUseFileCache.mockReturnValue({ src: null });
    const { container } = render(
      <ConversationSearchMedia message={buildMessage({ file_uuid: null })} />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('.conv-msg-search-thumb--empty')).not.toBeNull();
    // 没有 file_uuid 时不该去取源
    expect(mockUseFileCache).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });
});
