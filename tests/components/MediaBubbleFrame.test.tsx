/**
 * 媒体 + 配文的**同一个大气泡**（Telegram 式 media + caption）
 *
 * huanwei 2026-08-13 02:28 原话：「相册和图片视频带文字的，将其用一个大气泡装起来
 * 而不是没有任何包含，就和 Telegram 一样」。
 *
 * 本文件钉三件事：
 * 1. **四种形态的 DOM 契约** —— 相册+文字 / 单图+文字 / 单视频+文字 三种里媒体与配文
 *    必须在**同一个**气泡节点内；纯媒体无文字时**不产生**多余的背景框节点。
 * 2. **配文判定的单一收口** `resolveMediaCaption` —— 后端契约是「给了 caption 就取代
 *    由文件名派生的正文」，所以「带 `[图片] ` 前缀 = 没配文」。判错的代价是每条媒体
 *    下面挂一行文件名。
 * 3. **两端真的接上了** —— 私聊 / 群聊气泡里 FileMessageContent 确实被这层包住。
 *    这条只能静态扫：完整 render MessageBubble 要拖 SessionContext / framer-motion /
 *    useFileCache 一整条 Tauri 依赖链，成本远高于它能覆盖的接线事实。
 *
 * ⚠️ 本文件**证明不了**「气泡长什么样」——jsdom 无布局无绘制，圆角 / 背景 / 媒体贴不贴
 * 上沿都不可观测（同 .claude/rules/frontend-test.md「滚动 / 布局相关行为」一族）。
 * 视觉由真机截图另行验收。
 *
 * FileMessageContent 在这里 mock 掉（同 AlbumMessage.test.tsx 的理由）：它自带
 * useFileCache / 预签名 URL / Tauri 依赖，本测试要验的是包裹结构，不是媒体加载本身。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../src/chat/shared/FileMessageContent', () => ({
  FileMessageContent: ({ messageType }: { messageType?: string }) => (
    <div data-testid="media" data-type={messageType} />
  ),
}));

import {
  MediaBubbleFrame,
  resolveMediaCaption,
  isCaptionableMediaType,
} from '../../src/chat/shared/MediaBubbleFrame';
import { FileMessageContent } from '../../src/chat/shared/FileMessageContent';
import { AlbumMessage, type AlbumMediaItem } from '../../src/chat/shared/AlbumMessage';
import type { AlbumNode } from '../../src/chat/shared/mediaGroup';

function albumItem(index: number): AlbumMediaItem {
  return {
    message_uuid: `m${index}`,
    message_content: '',
    message_type: 'image',
    file_uuid: `f${index}`,
    file_size: 1024,
    file_hash: `h${index}`,
    media_group_index: index,
  };
}

function album(caption: string): AlbumNode<AlbumMediaItem> {
  return {
    kind: 'album',
    groupId: 'g1',
    items: [albumItem(0), albumItem(1)],
    expectedCount: 2,
    caption,
    isComplete: true,
  };
}

describe('resolveMediaCaption — 配文判定的单一收口', () => {
  it('后端「文件名派生正文」形态一律不算配文（否则每条媒体下面都挂一行文件名）', () => {
    expect(resolveMediaCaption('[图片] IMG_0042.jpg')).toBeNull();
    expect(resolveMediaCaption('[视频] clip.mp4')).toBeNull();
    expect(resolveMediaCaption('[文件] report.pdf')).toBeNull();
    // 无扩展名的文件名：前缀这条规则同样挡得住（派生正文一定带前缀）
    expect(resolveMediaCaption('[图片] 假期照片')).toBeNull();
  });

  /**
   * 🔴 回归：曾经有一条「裸文件名不算配文」的兜底规则，现已删除。
   *
   * 它当初只是为了挡上游的一个缺陷（本地乐观副本写裸 `file.name`、少了 `[图片] ` 前缀）。
   * 上游已改成走 `uploadPersist.resolveUploadedContent`，写的就是带前缀的派生正文
   * （由 tests/unit/uploadPersistContent.test.ts 钉住），兜底失去理由；
   * 而它有真实代价 —— **一条恰好长得像文件名的真配文会被整条漏显**。
   *
   * 下面这组就是那个代价的反面：这些都是用户真的打出来的字，必须显示出来。
   */
  it('长得像文件名的**真配文**必须原样显示（兜底规则删除后的回归判据）', () => {
    expect(resolveMediaCaption('notes.txt')).toBe('notes.txt');
    expect(resolveMediaCaption('IMG_0042.jpg')).toBe('IMG_0042.jpg');
    expect(resolveMediaCaption('我的截图 2026-08-13.png')).toBe('我的截图 2026-08-13.png');
    // 首尾空白仍然裁掉（这条规则没被一起删）
    expect(resolveMediaCaption('  setup.exe  ')).toBe('setup.exe');
  });

  it('派生正文那条规则仍在（删了它，自己发的每张图下面都会挂一行文件名）', () => {
    // 与上一条成对：删掉裸文件名兜底 ≠ 放弃「派生正文不算配文」这条真正的契约规则
    expect(resolveMediaCaption('[图片] notes.txt')).toBeNull();
  });

  it('真正的配文原样返回（首尾空白裁掉）', () => {
    expect(resolveMediaCaption('wow')).toBe('wow');
    expect(resolveMediaCaption('  今天拍的  ')).toBe('今天拍的');
    // 带扩展名形状但明显是句子的（含换行）不会被误判成文件名
    expect(resolveMediaCaption('第一行\n第二行.jpg')).toBe('第一行\n第二行.jpg');
  });

  it('空 / 空白 / null / undefined 都没有配文', () => {
    expect(resolveMediaCaption('')).toBeNull();
    expect(resolveMediaCaption('   ')).toBeNull();
    expect(resolveMediaCaption(null)).toBeNull();
    expect(resolveMediaCaption(undefined)).toBeNull();
  });

  it('只有图片与视频能带配文进大气泡（文档自带白底卡片，套进来是两层背景）', () => {
    expect(isCaptionableMediaType('image')).toBe(true);
    expect(isCaptionableMediaType('video')).toBe(true);
    expect(isCaptionableMediaType('file')).toBe(false);
    expect(isCaptionableMediaType('text')).toBe(false);
  });
});

describe('四种形态的 DOM 契约', () => {
  it('形态一 · 相册 + 文字：网格与配文在同一个气泡节点内', () => {
    const { container } = render(<AlbumMessage album={album('wow')} />);

    const bubble = container.querySelector('[data-testid="media-bubble"]');
    expect(bubble).not.toBeNull();
    expect(bubble!.querySelector('.album-grid')).not.toBeNull();
    expect(bubble!.contains(screen.getByText('wow'))).toBe(true);
    // 相册不走单媒体那层媒体带：网格自己排布，宽度归它，DOM 与加这条之前逐字节相同。
    // 套上去会多一层 flex 居中容器 + 黑底，把网格挤成居中的一小块。
    expect(bubble!.querySelector('[data-testid="media-bubble-media"]')).toBeNull();
    expect(bubble!.classList.contains('media-bubble--single')).toBe(false);
  });

  it('形态二 · 单图 + 文字：图片与配文在同一个气泡节点内', () => {
    const { container } = render(
      <MediaBubbleFrame content="wow" media="single">
        <FileMessageContent
          messageType="image"
          messageContent="wow"
          fileUuid="f1"
          fileSize={1024}
        />
      </MediaBubbleFrame>,
    );

    const bubble = container.querySelector('[data-testid="media-bubble"]');
    expect(bubble).not.toBeNull();
    const media = screen.getByTestId('media');
    expect(media.getAttribute('data-type')).toBe('image');
    expect(bubble!.contains(media)).toBe(true);
    expect(bubble!.contains(screen.getByText('wow'))).toBe(true);
    // 媒体在前、配文在后（配文位于媒体下方）
    expect(media.compareDocumentPosition(screen.getByText('wow')) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();

    // huanwei 2026-08-13 04:32/04:49：单媒体的「格」= 这层媒体带 —— 它撑满气泡宽
    // （气泡带 --single 修饰类钉到上限）、图在带内居中、带子是黑底。
    // 三条判据里这里只能验结构（jsdom 无布局无绘制），取值由
    // tests/styles/MediaBubbleSingleMediaBand.test.ts 静态扫 CSS 钉住。
    const band = bubble!.querySelector('[data-testid="media-bubble-media"]');
    expect(band).not.toBeNull();
    expect(band!.contains(media)).toBe(true);
    expect(bubble!.classList.contains('media-bubble--single')).toBe(true);
    // 配文必须在带**外**：套进黑底带里，对方那侧的半透明白底会被压成深灰
    expect(band!.contains(screen.getByText('wow'))).toBe(false);
  });

  it('形态三 · 单视频 + 文字：视频与配文在同一个气泡节点内', () => {
    const { container } = render(
      <MediaBubbleFrame content="录了一段" media="single">
        <FileMessageContent
          messageType="video"
          messageContent="录了一段"
          fileUuid="f1"
          fileSize={2048}
        />
      </MediaBubbleFrame>,
    );

    const bubble = container.querySelector('[data-testid="media-bubble"]');
    expect(bubble).not.toBeNull();
    const media = screen.getByTestId('media');
    expect(media.getAttribute('data-type')).toBe('video');
    expect(bubble!.contains(media)).toBe(true);
    expect(bubble!.contains(screen.getByText('录了一段'))).toBe(true);
  });

  it('形态四 · 纯媒体无文字：不产生任何多余的背景框节点（媒体自身圆角即可）', () => {
    const { container } = render(
      <MediaBubbleFrame content="[图片] IMG_0042.jpg" media="single">
        <FileMessageContent
          messageType="image"
          messageContent="[图片] IMG_0042.jpg"
          fileUuid="f1"
          fileSize={1024}
        />
      </MediaBubbleFrame>,
    );

    expect(container.querySelector('[data-testid="media-bubble"]')).toBeNull();
    expect(container.querySelector('.media-bubble-caption')).toBeNull();
    // 媒体带同样不产生：无配文时「一个多余节点都不产生」这条约束不因 media="single" 松动
    expect(container.querySelector('[data-testid="media-bubble-media"]')).toBeNull();
    // 媒体就是顶层节点，外面没套任何东西
    expect(container.firstElementChild).toBe(screen.getByTestId('media'));
    expect(screen.queryByText(/IMG_0042/)).not.toBeInTheDocument();
  });
});

describe('两端接线（静态扫描：完整 render 要拖整条 Tauri 依赖链）', () => {
  const SOURCES = {
    私聊: readFileSync(resolve(__dirname, '../../src/chat/friend/MessageBubble.tsx'), 'utf-8'),
    群聊: readFileSync(resolve(__dirname, '../../src/chat/group/GroupMessageBubble.tsx'), 'utf-8'),
  };

  for (const [side, src] of Object.entries(SOURCES)) {
    it(`${side}气泡把 FileMessageContent 包在 MediaBubbleFrame 里，且配文只递给图片/视频`, () => {
      // 块内有界：从 <MediaBubbleFrame 到下一个标签为止，中间不许插别的元素，
      // 拆掉包裹层或换成别的容器都会翻红。
      expect(src).toMatch(
        /<MediaBubbleFrame[^<]*content=\{isCaptionableMediaType\(message\.message_type\)[^<]*<FileMessageContent/,
      );
      // 单条**不**被塞进 media_group：本层只是套样式，绝不改消息结构
      expect(src).toMatch(/import \{ MediaBubbleFrame, isCaptionableMediaType \}/);
      // 形态声明必须是 single —— 传 "album" 一样能过类型检查，却会静默砍掉媒体带
      // （媒体区退回媒体自身宽度，"图只有文字一半"当场回归），所以钉死取值。
      expect(src).toMatch(/<MediaBubbleFrame[^<]*media="single"[^<]*<FileMessageContent/);
    });
  }

  it('单条渲染路径没有新增 media_group 写入（大气泡只是样式，不改消息结构）', () => {
    // 相册折叠会抹掉组内非代表成员的 DOM 锚点（AlbumMessage.tsx 的 .album-cell 注释），
    // 把单条折进相册就会踩同一个坑。两端气泡里都不许出现给单条造 media_group 的代码。
    for (const src of Object.values(SOURCES)) {
      expect(src).not.toMatch(/media_group_id\s*:/);
      expect(src).not.toMatch(/media_group_count\s*:/);
    }
  });
});
