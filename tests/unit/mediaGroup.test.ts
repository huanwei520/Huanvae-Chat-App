/**
 * 媒体组（相册）聚合纯逻辑测试（src/chat/shared/mediaGroup.ts）
 *
 * 覆盖的是「真的会写错、且写错了用户一眼看得见」的几件事：
 * 1. 折叠后位置不跳：相册占据它首次出现的位置，非相册消息相对顺序原样保留
 * 2. 组内顺序按 media_group_index 升序，**不跟随到达顺序**
 *    —— 列表是 send_time 倒序拿到的，同批上传 send_time 还可能相同，
 *       跟着到达顺序走会让相册里的图倒过来
 * 3. 跨分页拆组（R1）：只加载到一部分时仍保留 expectedCount，
 *    否则 loadMore 后相册会当着用户面从 7 格重排成 10 格
 * 4. caption 只认 index=0；index=0 未加载时给空串而不是拿别的项顶替
 * 5. 三件套不全 ⇒ 按普通单条处理（宁可退化成 N 张独立图，也不要渲染错位格子）
 */

import { describe, it, expect } from 'vitest';
import {
  MEDIA_GROUP_MAX,
  groupMessagesIntoAlbums,
  isAlbumItem,
  type AlbumNode,
  type RenderNode,
} from '../../src/chat/shared/mediaGroup';

interface Msg {
  message_uuid: string;
  message_content: string;
  media_group_id?: string | null;
  media_group_index?: number | null;
  media_group_count?: number | null;
}

function m(uuid: string, overrides: Partial<Msg> = {}): Msg {
  return { message_uuid: uuid, message_content: '', ...overrides };
}

/** 组内第 i 项（count 默认 3） */
function item(groupId: string, index: number, count = 3, content = ''): Msg {
  return m(`${groupId}-${index}`, {
    message_content: content,
    media_group_id: groupId,
    media_group_index: index,
    media_group_count: count,
  });
}

function albums(nodes: RenderNode<Msg>[]): AlbumNode<Msg>[] {
  return nodes.filter((n): n is AlbumNode<Msg> => n.kind === 'album');
}

describe('isAlbumItem', () => {
  it('三件套齐全且 count>=2 才算成组', () => {
    expect(isAlbumItem(item('g', 0))).toBe(true);
  });

  it('缺 index 或 count ⇒ 不算成组（退化为普通单条）', () => {
    expect(isAlbumItem(m('a', { media_group_id: 'g' }))).toBe(false);
    expect(isAlbumItem(m('a', { media_group_id: 'g', media_group_index: 0 }))).toBe(false);
    expect(isAlbumItem(m('a', { media_group_id: 'g', media_group_count: 3 }))).toBe(false);
  });

  it('count < 2 不算组（单条媒体带 caption 是另一条路，不走相册渲染）', () => {
    expect(isAlbumItem(item('g', 0, 1))).toBe(false);
  });

  it('空 media_group_id 不算组', () => {
    expect(isAlbumItem(m('a', { media_group_id: '', media_group_index: 0, media_group_count: 3 }))).toBe(false);
  });
});

describe('groupMessagesIntoAlbums — 折叠与定位', () => {
  it('同组多条折叠成一个节点，占据首次出现的位置', () => {
    const nodes = groupMessagesIntoAlbums([
      m('before'),
      item('g1', 0),
      item('g1', 1),
      item('g1', 2),
      m('after'),
    ]);

    expect(nodes.map((n) => n.kind)).toEqual(['single', 'album', 'single']);
    expect((nodes[0] as { message: Msg }).message.message_uuid).toBe('before');
    expect((nodes[2] as { message: Msg }).message.message_uuid).toBe('after');
    expect(albums(nodes)[0].items).toHaveLength(3);
  });

  it('组内成员不相邻时也只折叠出一个节点，且不改变其它消息的相对顺序', () => {
    const nodes = groupMessagesIntoAlbums([
      item('g1', 0),
      m('x'),
      item('g1', 1),
      m('y'),
    ]);

    expect(nodes.map((n) => n.kind)).toEqual(['album', 'single', 'single']);
    expect((nodes[1] as { message: Msg }).message.message_uuid).toBe('x');
    expect((nodes[2] as { message: Msg }).message.message_uuid).toBe('y');
    expect(albums(nodes)).toHaveLength(1);
    expect(albums(nodes)[0].items).toHaveLength(2);
  });

  it('多个相册各自折叠，互不串组', () => {
    const nodes = groupMessagesIntoAlbums([
      item('g1', 0, 2),
      item('g2', 0, 2),
      item('g1', 1, 2),
      item('g2', 1, 2),
    ]);

    const got = albums(nodes);
    expect(got).toHaveLength(2);
    expect(got[0].groupId).toBe('g1');
    expect(got[1].groupId).toBe('g2');
    expect(got[0].items.every((i) => i.media_group_id === 'g1')).toBe(true);
    expect(got[1].items.every((i) => i.media_group_id === 'g2')).toBe(true);
  });

  it('无相册时逐条原样输出，顺序不变', () => {
    const nodes = groupMessagesIntoAlbums([m('a'), m('b'), m('c')]);
    expect(nodes.map((n) => (n as { message: Msg }).message.message_uuid)).toEqual(['a', 'b', 'c']);
  });
});

describe('groupMessagesIntoAlbums — 组内顺序', () => {
  it('按 media_group_index 升序，不跟随到达顺序（列表是倒序拿到的）', () => {
    const nodes = groupMessagesIntoAlbums([
      item('g1', 2),
      item('g1', 0),
      item('g1', 1),
    ]);

    expect(albums(nodes)[0].items.map((i) => i.media_group_index)).toEqual([0, 1, 2]);
  });
});

describe('groupMessagesIntoAlbums — 跨分页拆组（R1）', () => {
  it('只加载到一部分时保留 expectedCount 且 isComplete=false（供 UI 预留占位）', () => {
    const nodes = groupMessagesIntoAlbums([item('g1', 0, 10), item('g1', 1, 10)]);
    const album = albums(nodes)[0];

    expect(album.items).toHaveLength(2);
    expect(album.expectedCount).toBe(10);
    expect(album.isComplete).toBe(false);
  });

  it('集齐时 isComplete=true', () => {
    const nodes = groupMessagesIntoAlbums([item('g1', 0, 2), item('g1', 1, 2)]);
    expect(albums(nodes)[0].isComplete).toBe(true);
  });

  it('个别项 count 缺失时取组内最大值，不把期望总数算小（少预留占位比多预留更糟）', () => {
    const partial = m('g1-1', {
      message_content: '',
      media_group_id: 'g1',
      media_group_index: 1,
      media_group_count: 3,
    });
    const nodes = groupMessagesIntoAlbums([item('g1', 0, 3), partial]);
    expect(albums(nodes)[0].expectedCount).toBe(3);
  });
});

describe('groupMessagesIntoAlbums — caption', () => {
  it('caption 取 index=0 那条的正文', () => {
    const nodes = groupMessagesIntoAlbums([
      item('g1', 1, 2, '这条不该被当配文'),
      item('g1', 0, 2, '整组配文'),
    ]);
    expect(albums(nodes)[0].caption).toBe('整组配文');
  });

  it('index=0 未加载（被分页切掉）时给空串，不拿其它项顶替', () => {
    const nodes = groupMessagesIntoAlbums([
      item('g1', 1, 3, '第二张的正文'),
      item('g1', 2, 3, '第三张的正文'),
    ]);
    expect(albums(nodes)[0].caption).toBe('');
  });
});

describe('MEDIA_GROUP_MAX', () => {
  it('与后端约定的组大小上限一致（2..10）', () => {
    expect(MEDIA_GROUP_MAX).toBe(10);
  });

  // 🔴 回归（外部审计 idx=94）：media_group_count 是**对端可控的外部输入**，
  // 而 expectedCount 直接喂给 AlbumMessage 的 `Array.from({ length: expectedCount })`。
  // 改前 isAlbumItem 只判 `>= 2`，一条 media_group_count = 1e8 的消息就能让渲染线程
  // 当场分配一亿个元素 —— webview 冻死，而它只是「别人发来的一条消息」。
  // 超界按本文件既定原则处理：不成组，退化成 N 条独立消息（数据仍在，只是不折叠）。
  it('count 超过上限 ⇒ 不成组（isAlbumItem 为假）', () => {
    expect(isAlbumItem(item('g1', 0, MEDIA_GROUP_MAX))).toBe(true);
    expect(isAlbumItem(item('g1', 0, MEDIA_GROUP_MAX + 1))).toBe(false);
    expect(isAlbumItem(item('g1', 0, 100_000_000))).toBe(false);
  });

  it('脏 count 的消息退化成独立单条，expectedCount 不可能超过上限', () => {
    const nodes = groupMessagesIntoAlbums([
      item('poison', 0, 100_000_000),
      item('poison', 1, 100_000_000),
    ]);

    expect(albums(nodes)).toHaveLength(0);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.kind === 'single')).toBe(true);
  });

  it('同组里混进一条脏 count 时，其余项仍按各自合法的 count 成组', () => {
    const nodes = groupMessagesIntoAlbums([
      item('g1', 0, 3),
      item('g1', 1, 3),
      item('g1', 2, 100_000_000),
    ]);

    const [album] = albums(nodes);
    expect(album.expectedCount).toBe(3);
    expect(album.expectedCount).toBeLessThanOrEqual(MEDIA_GROUP_MAX);
    expect(album.items).toHaveLength(2);
  });
});
