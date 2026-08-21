/**
 * 会话媒体序列（左右切图的数据面）纯逻辑测试
 *
 * 覆盖四件事，每一件都是「错了就是用户看得见的错」：
 * 1. **顺序**：整体升序（旧 → 新）+ 相册内部按 media_group_index 升序
 *    —— 组内顺序若跟着 send_time 走，同一批上传的相册会乱序，滑到的与网格里看到的对不上
 * 2. **过滤**：撤回 / 非媒体 / 没有 file_uuid（在途乐观消息）都不进序列
 * 3. **边界**：第一张往前、最后一张往后都返回 null（不循环、不跳转）
 * 4. **定位**：locateInGallery 在序列里找得到就用整条序列，找不到退化成单张序列
 */

import { describe, it, expect } from 'vitest';
import {
  buildMediaGallery,
  galleryPositionLabel,
  locateInGallery,
  mediaFilenameFromContent,
  stepGalleryIndex,
  type GalleryableMessage,
  type MediaGalleryItem,
} from '../../src/chat/shared/mediaGallery';
import { groupMessagesIntoAlbums, type AlbumableMessage } from '../../src/chat/shared/mediaGroup';

type Msg = GalleryableMessage & AlbumableMessage;

function msg(over: Partial<Msg> & { message_uuid: string }): Msg {
  return {
    message_content: '[图片] x.png',
    message_type: 'image',
    file_uuid: `file-${over.message_uuid}`,
    file_size: 1024,
    is_recalled: false,
    ...over,
  };
}

/** 列表层给的是 send_time **倒序**（新 → 旧），与 ChatMessages 的 sortedMessages 同口径 */
function nodesOf(messagesNewestFirst: Msg[]) {
  return groupMessagesIntoAlbums(messagesNewestFirst);
}

const SCOPE = { urlType: 'friend' as const };

describe('mediaFilenameFromContent', () => {
  it('剥掉后端派生正文的「[图片] / [视频] / [文件] 」前缀', () => {
    expect(mediaFilenameFromContent('[图片] a.png')).toBe('a.png');
    expect(mediaFilenameFromContent('[视频] b.mp4')).toBe('b.mp4');
    expect(mediaFilenameFromContent('[文件] c.pdf')).toBe('c.pdf');
  });

  it('没有前缀时原样返回（有配文的相册首项走的就是这条）', () => {
    expect(mediaFilenameFromContent('今天的照片')).toBe('今天的照片');
  });
});

describe('buildMediaGallery：顺序', () => {
  it('整体升序（旧 → 新）—— 输入是倒序，输出必须反过来', () => {
    const items = buildMediaGallery(
      nodesOf([msg({ message_uuid: 'c' }), msg({ message_uuid: 'b' }), msg({ message_uuid: 'a' })]),
      SCOPE,
    );
    expect(items.map((i) => i.messageUuid)).toEqual(['a', 'b', 'c']);
  });

  it('相册内部按 media_group_index 升序，且相册整体占它在列表里的位置', () => {
    // 倒序列表里相册成员的到达顺序被打乱（2, 0, 1），组内顺序必须只认 index
    const album = (idx: number) => msg({
      message_uuid: `g${idx}`,
      media_group_id: 'grp',
      media_group_index: idx,
      media_group_count: 3,
    });
    const items = buildMediaGallery(
      nodesOf([msg({ message_uuid: 'newest' }), album(2), album(0), album(1), msg({ message_uuid: 'oldest' })]),
      SCOPE,
    );
    // 反转后：oldest → 相册（0,1,2）→ newest
    expect(items.map((i) => i.messageUuid)).toEqual(['oldest', 'g0', 'g1', 'g2', 'newest']);
  });

  it('图片与视频在同一条序列里（网格里就是混排的，跳过视频会让位次对不上）', () => {
    const items = buildMediaGallery(
      nodesOf([
        msg({ message_uuid: 'v', message_type: 'video', message_content: '[视频] m.mp4' }),
        msg({ message_uuid: 'i' }),
      ]),
      SCOPE,
    );
    expect(items.map((i) => [i.messageUuid, i.type])).toEqual([['i', 'image'], ['v', 'video']]);
  });
});

describe('buildMediaGallery：过滤', () => {
  it('撤回的不进序列（气泡本身已不渲染媒体，滑过去只会是取不到源的空屏）', () => {
    const items = buildMediaGallery(
      nodesOf([msg({ message_uuid: 'gone', is_recalled: true }), msg({ message_uuid: 'ok' })]),
      SCOPE,
    );
    expect(items.map((i) => i.messageUuid)).toEqual(['ok']);
  });

  it('没有 file_uuid 的（还在上传的乐观消息）不进序列', () => {
    const items = buildMediaGallery(
      nodesOf([msg({ message_uuid: 'pending', file_uuid: null }), msg({ message_uuid: 'ok' })]),
      SCOPE,
    );
    expect(items.map((i) => i.messageUuid)).toEqual(['ok']);
  });

  it('文本 / 文件 / 卡片不是媒体，不进序列', () => {
    const items = buildMediaGallery(
      nodesOf([
        msg({ message_uuid: 't', message_type: 'text', message_content: '你好' }),
        msg({ message_uuid: 'f', message_type: 'file', message_content: '[文件] a.pdf' }),
        msg({ message_uuid: 'card', message_type: 'card', message_content: '{}' }),
        msg({ message_uuid: 'ok' }),
      ]),
      SCOPE,
    );
    expect(items.map((i) => i.messageUuid)).toEqual(['ok']);
  });

  // 2026-08-21：`friendId` 已从 MediaGalleryScope / MediaGalleryItem 整条删除 ——
  // 它唯一的用途是给「好友文件 403 上报」拼诊断上下文，而那条上报打的
  // /api/diagnostic/report/friend-permission 在后端路由表里不存在（恒 404 且被静默吞掉）。
  // 断言改成 toEqual 的**全等**形态，正是为了让「有人把它悄悄加回来」也会红。
  it('归属信息（urlType）逐项注入，文件名已剥前缀，且不再夹带 friendId', () => {
    const [item] = buildMediaGallery(nodesOf([msg({ message_uuid: 'a' })]), SCOPE);
    expect(item).toEqual({
      messageUuid: 'a',
      fileUuid: 'file-a',
      filename: 'x.png',
      fileSize: 1024,
      type: 'image',
      urlType: 'friend',
    });
  });
});

describe('stepGalleryIndex：边界 = 到头就是到头（不循环、不跳转）', () => {
  it('中间位次两个方向都能走', () => {
    expect(stepGalleryIndex(1, 3, -1)).toBe(0);
    expect(stepGalleryIndex(1, 3, 1)).toBe(2);
  });

  it('第一张再往前 → null（上层表现为回弹）', () => {
    expect(stepGalleryIndex(0, 3, -1)).toBeNull();
  });

  it('最后一张再往后 → null（上层表现为回弹）', () => {
    expect(stepGalleryIndex(2, 3, 1)).toBeNull();
  });

  it('单张序列两个方向都是 null', () => {
    expect(stepGalleryIndex(0, 1, -1)).toBeNull();
    expect(stepGalleryIndex(0, 1, 1)).toBeNull();
  });

  it('🔴 绝不循环：最后一张往后不会回到 0', () => {
    expect(stepGalleryIndex(2, 3, 1)).not.toBe(0);
  });
});

describe('galleryPositionLabel', () => {
  it('多张时给「第几 / 共几」（1-based）', () => {
    expect(galleryPositionLabel(0, 3)).toBe('1 / 3');
    expect(galleryPositionLabel(2, 3)).toBe('3 / 3');
  });

  it('单张序列不显示（没有"上一张"可言）', () => {
    expect(galleryPositionLabel(0, 1)).toBeNull();
    expect(galleryPositionLabel(0, 0)).toBeNull();
  });
});

describe('locateInGallery', () => {
  const items: MediaGalleryItem[] = buildMediaGallery(
    nodesOf([msg({ message_uuid: 'c' }), msg({ message_uuid: 'b' }), msg({ message_uuid: 'a' })]),
    SCOPE,
  );

  it('在序列里找得到 → 用整条序列 + 正确位次', () => {
    const located = locateInGallery(items, items[1]);
    expect(located.index).toBe(1);
    expect(located.list.map((i) => i.messageUuid)).toEqual(['a', 'b', 'c']);
  });

  it('找不到（宿主没挂 Provider，序列为空）→ 退化成只有这一张的序列', () => {
    const located = locateInGallery([], items[1]);
    expect(located.index).toBe(0);
    expect(located.list).toEqual([items[1]]);
  });

  it('身份是 messageUuid 不是 fileUuid —— 同一个文件发两次要定位到点开的那一次', () => {
    const twice = buildMediaGallery(
      nodesOf([
        msg({ message_uuid: 'second', file_uuid: 'same-file' }),
        msg({ message_uuid: 'first', file_uuid: 'same-file' }),
      ]),
      SCOPE,
    );
    expect(twice.map((i) => i.fileUuid)).toEqual(['same-file', 'same-file']);
    expect(locateInGallery(twice, twice[1]).index).toBe(1);
  });
});
