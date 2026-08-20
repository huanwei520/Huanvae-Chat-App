/**
 * 在途发送项在**消息气泡里**的渲染（覆盖层接线的行为面）
 *
 * spec §三：进度从输入框上方搬进气泡内部，**每个媒体在自己的位置转圈**。
 * 这一层的接线点是 `FileMessageContent`：拿到 `clientId` 且该条目还在 sendingMediaStore 里，
 * 就渲染「本地预览 + `<SendingMediaOverlay>`」，而不是走正常取源路径。
 *
 * ## 这里能测什么、不能测什么
 *
 * 能测：**触发时机与调用契约** —— 有条目才走这一支、真实消息不受影响、
 * 重试/取消真的落到 store 上、文档分支也有覆盖层、相册态尺寸交给外层 grid。
 *
 * 不能测（jsdom 结构性盲区，见 .claude/rules/frontend-test.md）：
 * 覆盖层是不是**真的盖在**媒体上（`position: absolute` 需要布局引擎）、
 * 环形进度的视觉、待发区换行、乐观插入后是否真的滚到底。**这些必须真机看。**
 * 声明层的那一半（宿主必须 `position: relative`）由
 * tests/styles/SendingOverlayHost.test.ts 静态守着。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileMessageContent } from '../../src/chat/shared/FileMessageContent';
import {
  useSendingMediaStore,
  type SendingMediaSeed,
} from '../../src/stores/sendingMediaStore';

const KEY = 'friend:u1';

/**
 * jsdom 没有 `URL.createObjectURL`（sendingMediaStore 靠能力判断退成 null）。
 * 在途预览的 src 是本用例要断言的东西，所以这里补上一个可预期的实现。
 */
type UrlPatch = { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
let objectUrlSeq = 0;

beforeEach(() => {
  objectUrlSeq = 0;
  (URL as unknown as UrlPatch).createObjectURL = () => {
    objectUrlSeq += 1;
    return `blob:preview/${objectUrlSeq}`;
  };
  (URL as unknown as UrlPatch).revokeObjectURL = () => {};
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
});

afterEach(() => {
  delete (URL as unknown as UrlPatch).createObjectURL;
  delete (URL as unknown as UrlPatch).revokeObjectURL;
});

function seed(
  clientId: string,
  kind: 'image' | 'video' | 'file',
  dimensions: { width: number | null; height: number | null } = { width: null, height: null },
): SendingMediaSeed {
  return {
    clientId,
    file: new File(['x'], 'a.png', { type: 'image/png' }),
    conversationKey: KEY,
    conversationType: 'friend',
    targetId: 'u1',
    shape: { kind: 'single', groupId: null, index: null, count: null },
    preview: {
      name: 'a.png',
      kind,
      size: 2048,
      localPath: '',
      width: dimensions.width,
      height: dimensions.height,
    },
    sendTime: '2026-08-13T00:00:00.000Z',
  };
}

describe('在途发送项：本地预览 + 单项覆盖层', () => {
  it('🔴 图片在途 ⇒ 渲染本地预览与覆盖层，而不是「文件不可用」', () => {
    // 乐观消息此刻 file_uuid 恒为 null（服务端还没建消息）。没有这一支的话，
    // FileMessageContent 会在 !fileUuid 那里早返回错误块 —— 用户发的每张图上传期间都显示"不可用"。
    useSendingMediaStore.getState().enqueue([seed('client_img', 'image')]);

    const { container } = render(
      <FileMessageContent
        messageUuid="msg-uuid-1"
        messageType="image"
        messageContent="[图片] a.png"
        fileUuid={null}
        fileSize={2048}
        clientId="client_img"
      />,
    );

    const img = container.querySelector('img.message-image');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'blob:preview/1');
    expect(screen.getByTestId('sending-media-overlay')).toBeInTheDocument();
    expect(screen.queryByText('文件不可用')).toBeNull();
  });

  /**
   * 🔴 视频那一格必须是**首帧封面**，不是破图（huanwei 2026-08-13 08:16
   * 「上传进度条中就以图片/视频封面来进行显示」）。
   *
   * `previewUrl` 是 blob 地址：图片解得出、**视频解不出** —— 喂给 `<img>` 得到的是破图图标。
   * 完成态用的是 `<VideoThumbnail>`（内部追 `#t=0.1` 逼引擎 seek 出首帧），在途必须用同一个，
   * 否则「上传中」与「完成后」画面根本不是同一种东西，谈不上"样式完全一致"。
   *
   * jsdom 不解码也不 seek，这里能钉的是**接线**：出来的是 `<video>`、src 带片段、
   * 三个播放属性齐全、类名与完成态相同。首帧真画得出来是真机的事。
   */
  it('🔴 视频在途 ⇒ <VideoThumbnail> 首帧封面（带 #t=0.1 与三个播放属性），不是喂给 <img> 的破图', () => {
    useSendingMediaStore.getState().enqueue([seed('client_vid', 'video')]);

    const { container } = render(
      <FileMessageContent
        messageUuid="msg-uuid-1"
        messageType="video"
        messageContent="[视频] a.mp4"
        fileUuid={null}
        fileSize={2048}
        clientId="client_vid"
      />,
    );

    const video = container.querySelector('video.message-video-thumbnail');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('blob:preview/1#t=0.1');
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect((video as HTMLVideoElement).muted).toBe(true);
    expect(video?.hasAttribute('playsinline')).toBe(true);
    // 反向：这一格里不许再出现 <img>（那正是破图的来源）
    expect(container.querySelector('.video-message img')).toBeNull();
    expect(screen.getByTestId('sending-media-overlay')).toBeInTheDocument();
  });

  it('文档在途 ⇒ 卡片上也有覆盖层（待发区收文档，文件也要能转圈）', () => {
    useSendingMediaStore.getState().enqueue([seed('client_doc', 'file')]);

    const { container } = render(
      <FileMessageContent
        messageUuid="msg-uuid-1"
        messageType="file"
        messageContent="[文件] a.pdf"
        fileUuid={null}
        fileSize={2048}
        clientId="client_doc"
      />,
    );

    const card = container.querySelector('.document-message');
    expect(card).not.toBeNull();
    // 覆盖层必须落在这张卡片**内部** —— 它靠 absolute 铺满最近的定位祖先
    expect(card!.querySelector('[data-testid="sending-media-overlay"]')).not.toBeNull();
  });

  it('相册态：尺寸交给外层 grid（不写内联宽高会跟 grid 打架）', () => {
    useSendingMediaStore.getState().enqueue([seed('client_album', 'image')]);

    const { container } = render(
      <FileMessageContent
        messageUuid="msg-uuid-1"
        messageType="image"
        messageContent="[图片] a.png"
        fileUuid={null}
        fileSize={2048}
        clientId="client_album"
        displayVariant="album"
      />,
    );

    const box = container.querySelector('.image-message') as HTMLElement;
    expect(box.style.width).toBe('100%');
    expect(box.style.height).toBe('100%');
  });
});

describe('不该走这一支的情况（真实消息的行为逐字节不变）', () => {
  it('没有 clientId（真实历史消息）⇒ 走原路径，缺 fileUuid 仍是「文件不可用」', () => {
    render(
      <FileMessageContent
        messageUuid="msg-uuid-1"
        messageType="image"
        messageContent="[图片] a.png"
        fileUuid={null}
        fileSize={2048}
      />,
    );
    expect(screen.getByText('文件不可用')).toBeInTheDocument();
    expect(screen.queryByTestId('sending-media-overlay')).toBeNull();
  });

  it('有 clientId 但条目已被收掉（真实消息已到位）⇒ 同样走原路径', () => {
    render(
      <FileMessageContent
        messageUuid="msg-uuid-1"
        messageType="image"
        messageContent="[图片] a.png"
        fileUuid={null}
        fileSize={2048}
        clientId="client_gone"
      />,
    );
    expect(screen.getByText('文件不可用')).toBeInTheDocument();
    expect(screen.queryByTestId('sending-media-overlay')).toBeNull();
  });
});

describe('覆盖层上的两个动作真的落到 store 上', () => {
  it('失败态点「重试」⇒ 该项回到 pending，且位置与形态都不变', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 'image'), seed('client_b', 'image')]);
    st.markFailed('client_a', '网络错误');

    render(
      <FileMessageContent
        messageUuid="msg-uuid-1"
        messageType="image"
        messageContent="[图片] a.png"
        fileUuid={null}
        fileSize={2048}
        clientId="client_a"
      />,
    );
    fireEvent.click(screen.getByText('重试'));

    const after = useSendingMediaStore.getState();
    expect(after.entries.client_a.status).toBe('pending');
    // 顺序与形态不许被 retry 改写（spec §五 第 3、5 问）
    expect(after.orderByConversation[KEY]).toEqual(['client_a', 'client_b']);
    expect(after.entries.client_a.shape).toEqual({
      kind: 'single', groupId: null, index: null, count: null,
    });
  });

  it('点「取消」⇒ 该项从队列移除，其余项不受影响', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 'image'), seed('client_b', 'image')]);
    st.markUploading('client_a', 30);

    render(
      <FileMessageContent
        messageUuid="msg-uuid-1"
        messageType="image"
        messageContent="[图片] a.png"
        fileUuid={null}
        fileSize={2048}
        clientId="client_a"
      />,
    );
    fireEvent.click(screen.getByLabelText('取消上传'));

    const after = useSendingMediaStore.getState();
    expect(after.entries.client_a).toBeUndefined();
    expect(after.entries.client_b).toBeDefined();
    expect(after.orderByConversation[KEY]).toEqual(['client_b']);
  });
});
