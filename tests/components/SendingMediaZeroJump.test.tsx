/**
 * 「上传中」与「上传完成」逐像素同形（零跳变）
 *
 * huanwei 2026-08-13 08:16 的验收口径原话：
 * 「发出去上传进度条中就以图片/视频封面来进行显示，**保证上传进度条和上传完成的样式完全一致**」。
 * 判据是：同一条消息的两态，**布局 / 尺寸 / 圆角 / 裁切方式全都看不出变化**，
 * 唯一允许的差别是进度圈在不在。
 *
 * ## 这里钉的是那条口径里**可被机器判定**的部分
 *
 * 容器尺寸与类名。两者一旦相同，圆角与裁切（`border-radius` / `object-fit: contain`）
 * 就由同一条 CSS 规则接管 —— 那些规则本身由 tests/styles 与 album.css/media-bubble.css 守着，
 * 这里不重复断言样式表内容，只断言"两态落在同一个选择器上"。
 *
 * 做法是**把两态各渲染一次、逐字段比对**，而不是把期望值写死：
 * 写死 `{138, 300}` 只能证明在途那一支算对了它自己，证明不了它与完成态**相等**——
 * 而"相等"才是验收口径。哪一天有人改了 `calculateDisplaySize` 的上限或默认值，
 * 只改一边就会让这里翻红。
 *
 * ## 测不到什么（jsdom 结构性盲区，见 .claude/rules/frontend-test.md）
 *
 * 真实的绘制结果：图有没有被裁、黑底铺没铺满、进度圈盖没盖在图上（`position: absolute`
 * 需要布局引擎）。**那些必须真机并排截图看。** 这里只保证两态的声明层完全一致。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('../../src/hooks/useFileCache', () => ({
  useImageCache: () => ({
    src: 'https://proxy.local/img',
    isLocal: false,
    loading: false,
    error: null,
    onLoad: vi.fn(),
    localPath: null,
    presignedUrl: null,
    retryWithNewUrl: vi.fn(),
    openInFolder: vi.fn(),
  }),
  useVideoCache: () => ({
    src: 'https://proxy.local/vid',
    isLocal: false,
    loading: false,
    error: null,
    onPlay: vi.fn(),
    localPath: null,
    presignedUrl: null,
    openInFolder: vi.fn(),
  }),
  useFileCache: () => ({
    src: null,
    presignedUrl: null,
    isLocal: false,
    localPath: null,
    openInFolder: vi.fn(),
  }),
}));
vi.mock('../../src/services/fileCache', () => ({ triggerBackgroundDownload: vi.fn() }));
vi.mock('../../src/media', () => ({ openMediaWindow: vi.fn() }));
vi.mock('../../src/chat/shared/MobileMediaPreview', () => ({ MobileMediaPreview: () => null }));
vi.mock('../../src/chat/shared/FilePreviewModal', () => ({ FilePreviewModal: () => null }));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));

const sessionMock = vi.hoisted(() => ({
  session: {
    userId: 'me',
    serverUrl: 'https://example.invalid',
    accessToken: 't',
    profile: { user_nickname: '我', user_avatar_url: null },
  },
}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => sessionMock,
  useApi: () => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }),
}));

import { FileMessageContent } from '../../src/chat/shared/FileMessageContent';
import { useSendingMediaStore, type SendingMediaSeed } from '../../src/stores/sendingMediaStore';

const KEY = 'friend:u1';

type UrlPatch = { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };

beforeEach(() => {
  (URL as unknown as UrlPatch).createObjectURL = () => 'blob:zero-jump';
  (URL as unknown as UrlPatch).revokeObjectURL = () => {};
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
});

afterEach(() => {
  delete (URL as unknown as UrlPatch).createObjectURL;
  delete (URL as unknown as UrlPatch).revokeObjectURL;
});

function seed(
  clientId: string,
  kind: 'image' | 'video',
  width: number | null,
  height: number | null,
): SendingMediaSeed {
  return {
    clientId,
    file: new File(['x'], kind === 'video' ? 'a.mp4' : 'a.png', {
      type: kind === 'video' ? 'video/mp4' : 'image/png',
    }),
    conversationKey: KEY,
    conversationType: 'friend',
    targetId: 'u1',
    shape: { kind: 'single', groupId: null, index: null, count: null },
    preview: { name: 'a.png', kind, size: 2048, localPath: '', width, height },
    sendTime: '2026-08-13T00:00:00.000Z',
  };
}

/** 在途那一态的媒体容器（`.image-message` / `.video-message`） */
function renderSending(
  kind: 'image' | 'video',
  width: number | null,
  height: number | null,
  displayVariant?: 'bubble' | 'album',
): HTMLElement {
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
  useSendingMediaStore.getState().enqueue([seed('client_x', kind, width, height)]);
  const { container } = render(
    <FileMessageContent
      messageType={kind}
      messageContent={kind === 'video' ? '[视频] a.mp4' : '[图片] a.png'}
      fileUuid={null}
      fileSize={2048}
      clientId="client_x"
      displayVariant={displayVariant}
    />,
  );
  return container.querySelector(kind === 'video' ? '.video-message' : '.image-message') as HTMLElement;
}

/** 完成态那一态的媒体容器（走正常取源路径，服务端下发的宽高） */
function renderSettled(
  kind: 'image' | 'video',
  width: number | null,
  height: number | null,
  displayVariant?: 'bubble' | 'album',
): HTMLElement {
  const { container } = render(
    <FileMessageContent
      messageType={kind}
      messageContent={kind === 'video' ? '[视频] a.mp4' : '[图片] a.png'}
      fileUuid="file-uuid-1"
      fileHash="hash-1"
      fileSize={2048}
      imageWidth={width}
      imageHeight={height}
      displayVariant={displayVariant}
    />,
  );
  return container.querySelector(kind === 'video' ? '.video-message' : '.image-message') as HTMLElement;
}

function boxOf(el: HTMLElement) {
  return { width: el.style.width, height: el.style.height };
}

describe('🔴 单图：上传中与完成后的容器尺寸完全相同', () => {
  // 1179x2556 = 真实手机竖屏截图（v1.1.32 实测那张）。它是最容易暴露差异的形状：
  // 先卡宽 280 再卡高 300，卡高那步会把宽度按比例缩回去 ⇒ 与任何"默认占位尺寸"都不同。
  it.each([
    ['手机竖屏截图 1179x2556', 1179, 2556],
    ['横图 1920x1080', 1920, 1080],
    ['方图 800x800', 800, 800],
    ['小图（不触发任何上限）160x120', 160, 120],
  ])('%s', (_label, w, h) => {
    const sending = boxOf(renderSending('image', w, h));
    const settled = boxOf(renderSettled('image', w, h));
    expect(sending).toEqual(settled);
    // 反向：真的算出了非空尺寸（两边都空也会 toEqual 通过）
    expect(sending.width).not.toBe('');
    expect(sending.height).not.toBe('');
  });

  it('读不出尺寸时两态一起退到同一套默认值（缺尺寸的那条路上也不跳版）', () => {
    expect(boxOf(renderSending('image', null, null))).toEqual(boxOf(renderSettled('image', null, null)));
  });
});

describe('🔴 视频：上传中与完成后的容器尺寸完全相同', () => {
  it.each([
    ['竖版 1080x1920', 1080, 1920],
    ['横版 1920x1080', 1920, 1080],
  ])('%s', (_label, w, h) => {
    const sending = boxOf(renderSending('video', w, h));
    const settled = boxOf(renderSettled('video', w, h));
    expect(sending).toEqual(settled);
    expect(sending.width).not.toBe('');
  });

  it('读不出尺寸时两态一起退到同一套默认值', () => {
    expect(boxOf(renderSending('video', null, null))).toEqual(boxOf(renderSettled('video', null, null)));
  });
});

describe('🔴 相册每一格：两态都把尺寸交给外层 grid', () => {
  it('图片格', () => {
    const sending = boxOf(renderSending('image', 1179, 2556, 'album'));
    expect(sending).toEqual(boxOf(renderSettled('image', 1179, 2556, 'album')));
    // 相册态的正确形态是 100%/100%（写死内联像素会跟 grid 打架）
    expect(sending).toEqual({ width: '100%', height: '100%' });
  });

  it('视频格', () => {
    const sending = boxOf(renderSending('video', 1080, 1920, 'album'));
    expect(sending).toEqual(boxOf(renderSettled('video', 1080, 1920, 'album')));
    expect(sending).toEqual({ width: '100%', height: '100%' });
  });
});

describe('🔴 两态落在同一个选择器上（圆角 / 裁切由同一条 CSS 接管）', () => {
  it('图片：两态都是 .file-message.image-message > .message-image', () => {
    useSendingMediaStore.getState().enqueue([seed('client_i', 'image', 1179, 2556)]);
    const sending = render(
      <FileMessageContent
        messageType="image" messageContent="[图片] a.png" fileUuid={null} fileSize={2048} clientId="client_i"
      />,
    ).container;
    const settled = render(
      <FileMessageContent
        messageType="image" messageContent="[图片] a.png" fileUuid="u" fileHash="h" fileSize={2048}
        imageWidth={1179} imageHeight={2556}
      />,
    ).container;

    expect(sending.querySelector('.file-message.image-message > img.message-image')).not.toBeNull();
    expect(settled.querySelector('.file-message.image-message > img.message-image')).not.toBeNull();
  });

  it('视频：两态的画面元素都带 .message-video-thumbnail，且都在 .video-message 里', async () => {
    useSendingMediaStore.getState().enqueue([seed('client_v', 'video', 1080, 1920)]);
    const sending = render(
      <FileMessageContent
        messageType="video" messageContent="[视频] a.mp4" fileUuid={null} fileSize={2048} clientId="client_v"
      />,
    ).container;
    const settled = render(
      <FileMessageContent
        messageType="video" messageContent="[视频] a.mp4" fileUuid="u" fileHash="h" fileSize={2048}
        imageWidth={1080} imageHeight={1920}
      />,
    ).container;

    // 两态都走 <VideoThumbnail>。它在完成态那一路会先问一次「本地存过封面没有」
    // （fileHash 是那张表的键），那几毫秒内什么都不渲染 —— 所以这里要 waitFor。
    // 在途那一路不传 fileHash ⇒ 同步就是 <video>，不读也不写封面库（本单不碰 video_posters）。
    expect(sending.querySelector('.video-message video.message-video-thumbnail')).not.toBeNull();
    await waitFor(() => {
      expect(settled.querySelector('.video-message .message-video-thumbnail')).not.toBeNull();
    });
  });

  /**
   * 🔴 播放角标必须两态都有。
   *
   * 验收口径是「唯一差别是进度圈在不在」。完成态的 VideoMessage 画 `.video-play-overlay`，
   * 在途若不画，就是**第二处**差别 —— 上传完成那一刻凭空多出一个角标。
   * 反向断言（图片两态都不该有）防的是"为了让这条过就无差别乱加"。
   */
  it('视频：播放角标两态都有；图片两态都没有', async () => {
    useSendingMediaStore.getState().enqueue([seed('client_pv', 'video', 1080, 1920)]);
    const vidSending = render(
      <FileMessageContent
        messageType="video" messageContent="[视频] a.mp4" fileUuid={null} fileSize={2048} clientId="client_pv"
      />,
    ).container;
    const vidSettled = render(
      <FileMessageContent
        messageType="video" messageContent="[视频] a.mp4" fileUuid="u" fileHash="h" fileSize={2048}
        imageWidth={1080} imageHeight={1920}
      />,
    ).container;

    expect(vidSending.querySelector('.video-play-overlay')).not.toBeNull();
    await waitFor(() => {
      expect(vidSettled.querySelector('.video-play-overlay')).not.toBeNull();
    });

    // 反向：图片那一路两态都不该有角标
    useSendingMediaStore.getState().enqueue([seed('client_pi', 'image', 1179, 2556)]);
    const imgSending = render(
      <FileMessageContent
        messageType="image" messageContent="[图片] a.png" fileUuid={null} fileSize={2048} clientId="client_pi"
      />,
    ).container;
    const imgSettled = render(
      <FileMessageContent
        messageType="image" messageContent="[图片] a.png" fileUuid="u" fileHash="h" fileSize={2048}
        imageWidth={1179} imageHeight={2556}
      />,
    ).container;
    expect(imgSending.querySelector('.video-play-overlay')).toBeNull();
    expect(imgSettled.querySelector('.video-play-overlay')).toBeNull();
  });
});
