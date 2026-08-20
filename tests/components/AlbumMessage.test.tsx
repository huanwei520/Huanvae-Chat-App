/**
 * 相册气泡内容测试（src/chat/shared/AlbumMessage.tsx）
 *
 * 覆盖 huanwei 明确要的效果 + 两条会引发可见缺陷的排版约束：
 * 1. 配文在整组**下方**（不是挂在第一张图上）—— 要的是「视觉上一整个整体」
 * 2. 跨分页拆组时按 expectedCount 铺格子、缺口用占位补
 *    —— 按已加载条数排版会让 loadMore 之后相册当着用户面从 7 格重排成 10 格
 * 3. 每格复用 FileMessageContent（不新增直接渲染 <img> 的显示点，
 *    远程媒体必经安全反代那条不变量才不会被绕开）
 *
 * FileMessageContent 在这里 mock 掉：它自带 useFileCache / 预签名 URL / Tauri 依赖，
 * 本测试要验的是**相册的排版与装配**，不是媒体加载本身（那由它自己的测试覆盖）。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../src/chat/shared/FileMessageContent', () => ({
  FileMessageContent: ({
    fileUuid,
    displayVariant,
    messageType,
  }: { fileUuid: string | null; displayVariant?: string; messageType?: string }) => (
    <div data-testid="media" data-uuid={fileUuid} data-variant={displayVariant} data-type={messageType} />
  ),
}));

import {
  AlbumMessage,
  albumRowLengths,
  albumGridPlan,
  type AlbumMediaItem,
} from '../../src/chat/shared/AlbumMessage';
import type { AlbumNode } from '../../src/chat/shared/mediaGroup';

function item(index: number, uuid = `f${index}`): AlbumMediaItem {
  return {
    message_uuid: `m${index}`,
    message_content: '',
    message_type: 'image',
    file_uuid: uuid,
    file_size: 1024,
    media_group_index: index,
  };
}

function album(overrides: Partial<AlbumNode<AlbumMediaItem>> = {}): AlbumNode<AlbumMediaItem> {
  return {
    kind: 'album',
    groupId: 'g1',
    items: [item(0), item(1)],
    expectedCount: 2,
    caption: '',
    isComplete: true,
    ...overrides,
  };
}

describe('相册排布必须铺满：任何张数都不留空槽', () => {
  /**
   * 这条替换掉的是旧的「固定列数」用例（albumColumns：<=4 → 2 列，>=5 → 3 列）。
   * 固定列数下 3 张排成 2×2、右下空一整格，那一格露出气泡底色 ——
   * huanwei 2026-08-13 原话「三张图那种奇数图就让其自适应排列铺满」。
   *
   * 断言强度是**升高**的，不是放宽：旧用例只对 5 个点位断言了一个标量列数
   * （而且列数正确 ≠ 铺满，2×2 放 3 张时它照样是「对」的）；这里对 1..24 每一个 n
   * 断言两条结构性不变量 —— 行长度之和 === n（不多不少正好这么多格子），
   * 且每一行的 span 之和 === 列基数（每一行都被恰好铺满，一格不空）。
   * 1..10 的具体分法另行逐个定死，保住「同样张数在两端长得一样」那条原意。
   */
  it('行长度之和 === 张数，每行 span 之和 === 列基数，且 1..10 的分法逐个定死', () => {
    // 1..10 逐个定死：同样张数的相册在两端必须长得一样
    expect(albumRowLengths(1)).toEqual([1]);
    expect(albumRowLengths(2)).toEqual([2]);
    expect(albumRowLengths(3)).toEqual([3]);
    expect(albumRowLengths(4)).toEqual([2, 2]);
    expect(albumRowLengths(5)).toEqual([2, 3]);
    expect(albumRowLengths(6)).toEqual([3, 3]);
    expect(albumRowLengths(7)).toEqual([3, 4]);
    expect(albumRowLengths(8)).toEqual([4, 4]);
    expect(albumRowLengths(9)).toEqual([3, 3, 3]);
    expect(albumRowLengths(10)).toEqual([3, 3, 4]);

    // 越过发送端上限（ALBUM_MAX_ITEMS=10）继续核：expectedCount 来自后端下发的
    // media_group_count，是外部输入，一条脏数据就能给出 11+。
    for (let n = 1; n <= 24; n++) {
      const rows = albumRowLengths(n);
      expect(rows.reduce((a, b) => a + b, 0), `n=${n}: 行长度之和必须等于张数`).toBe(n);

      const { columnBase, spans } = albumGridPlan(n);
      expect(spans, `n=${n}: 每一格恰好一个 span`).toHaveLength(n);

      // 逐行核对：这一行所有格子的 span 加起来必须正好铺满一整行
      let cursor = 0;
      for (const [rowIndex, len] of rows.entries()) {
        const rowSpans = spans.slice(cursor, cursor + len);
        expect(
          rowSpans.reduce((a, b) => a + b, 0),
          `n=${n}: 第 ${rowIndex} 行铺不满（空槽就是从这里来的）`,
        ).toBe(columnBase);
        cursor += len;
      }
    }
  });

  it('渲染出的格子数 === 张数，且每一格都带自己的 span（DOM 上没有无主的空位）', () => {
    for (const n of [1, 2, 3, 5, 7, 10]) {
      const { container, unmount } = render(
        <AlbumMessage
          album={album({
            items: Array.from({ length: n }, (_, i) => item(i)),
            expectedCount: n,
          })}
        />,
      );

      const grid = container.querySelector<HTMLElement>('.album-grid');
      expect(grid, `n=${n}: 网格必须存在`).not.toBeNull();

      const cells = Array.from(container.querySelectorAll<HTMLElement>('.album-cell'));
      expect(cells, `n=${n}: 格子数必须等于张数`).toHaveLength(n);
      // 每一格都必须真的写上了 span：漏写会退化成默认的 span 1，行就铺不满了
      cells.forEach((cell, i) => {
        expect(cell.style.gridColumn, `n=${n}: 第 ${i} 格缺 grid-column`).toMatch(/^span \d+$/);
      });
      // 列基数确实被写进了 grid-template-columns（不是留给浏览器猜）
      expect(grid!.style.gridTemplateColumns).toBe(`repeat(${albumGridPlan(n).columnBase}, 1fr)`);

      unmount();
    }
  });

  it('张数为 0 时不产出格子，列基数也不会退化成非法的 repeat(0, 1fr)', () => {
    expect(albumRowLengths(0)).toEqual([]);
    expect(albumGridPlan(0)).toEqual({ columnBase: 1, spans: [] });
  });
});

describe('AlbumMessage — 装配', () => {
  it('每格复用 FileMessageContent 并传 displayVariant="album"（不新增显示点）', () => {
    render(<AlbumMessage album={album()} />);

    const media = screen.getAllByTestId('media');
    expect(media).toHaveLength(2);
    expect(media.every((n) => n.getAttribute('data-variant') === 'album')).toBe(true);
  });

  it('按位次铺格子：组内顺序与 media_group_index 对应', () => {
    render(<AlbumMessage album={album({ items: [item(1, 'fB'), item(0, 'fA')] })} />);

    const uuids = screen.getAllByTestId('media').map((n) => n.getAttribute('data-uuid'));
    expect(uuids).toEqual(['fA', 'fB']);
  });
});

describe('AlbumMessage — 定位锚点（每格一个 data-message-uuid）', () => {
  // 背景：相册把 N 条独立消息折叠成一个气泡、只用组内首位当代表，于是 index >= 1 的每一张
  // 在消息列表里**一个节点都不产出**。scrollMessageIntoView 靠 [data-message-uuid] 寻址，
  // 查不到就返回 false —— 用户搜到一张图点进去只会得到「定位失败」。锚点必须落在格子上。
  it('每个已到货的格子都带自己那条消息的 uuid（不是代表消息的）', () => {
    const { container } = render(
      <AlbumMessage album={album({ items: [item(0), item(1), item(2)], expectedCount: 3 })} />,
    );

    const anchors = Array.from(container.querySelectorAll('.album-cell'))
      .map((cell) => cell.getAttribute('data-message-uuid'));
    expect(anchors).toEqual(['m0', 'm1', 'm2']);
  });

  it('锚点挂在格子本体上（滚动落点算的是这一格的矩形，不是整块网格的）', () => {
    const { container } = render(<AlbumMessage album={album()} />);

    const anchored = container.querySelectorAll('[data-message-uuid]');
    expect(anchored).toHaveLength(2);
    anchored.forEach((el) => expect(el.classList.contains('album-cell')).toBe(true));
  });

  it('占位格不带锚点：那一位次还没加载到，本来就定位不了（不能挂个假的骗上层）', () => {
    const { container } = render(
      <AlbumMessage album={album({ items: [item(0)], expectedCount: 3, isComplete: false })} />,
    );

    const cells = Array.from(container.querySelectorAll('.album-cell'));
    expect(cells).toHaveLength(3);
    expect(cells[0].getAttribute('data-message-uuid')).toBe('m0');
    expect(cells[1].hasAttribute('data-message-uuid')).toBe(false);
    expect(cells[2].hasAttribute('data-message-uuid')).toBe(false);
  });
});

describe('AlbumMessage — 配文位置（huanwei 要的效果）', () => {
  it('配文渲染在网格下方，而不是挂在第一张图上', () => {
    const { container } = render(<AlbumMessage album={album({ caption: '整组配文' })} />);

    const caption = screen.getByText('整组配文');
    const grid = container.querySelector('.album-grid');
    expect(grid).not.toBeNull();

    // 配文不在网格内部
    expect(grid!.contains(caption)).toBe(false);
    // 且在 DOM 顺序上排在网格之后（视觉上位于下方）
    expect(grid!.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('无配文时不渲染配文行、也不多出一层气泡框（Telegram 惯例：纯媒体不加背景框）', () => {
    const { container } = render(<AlbumMessage album={album({ caption: '' })} />);
    expect(container.querySelector('.media-bubble-caption')).toBeNull();
    expect(container.querySelector('[data-testid="media-bubble"]')).toBeNull();
    // 网格直接就是顶层节点（没被任何包裹层套住）
    expect(container.firstElementChild?.classList.contains('album-grid')).toBe(true);
  });

  it('无配文的相册不会把「[图片] 文件名」派生正文当配文显示出来', () => {
    // 后端契约：不给 caption 时组首项正文就是 `[图片] xxx.jpg`（backend-docs/storage/文件存储管理.md）
    const { container } = render(<AlbumMessage album={album({ caption: '[图片] IMG_0042.jpg' })} />);
    expect(container.querySelector('.media-bubble-caption')).toBeNull();
    expect(screen.queryByText(/IMG_0042/)).not.toBeInTheDocument();
  });

  it('有配文时配文与网格在同一个大气泡节点内（Telegram 式 media + caption）', () => {
    const { container } = render(<AlbumMessage album={album({ caption: '整组配文' })} />);

    const bubble = container.querySelector('[data-testid="media-bubble"]');
    expect(bubble).not.toBeNull();
    expect(bubble!.querySelector('.album-grid')).not.toBeNull();
    expect(bubble!.contains(screen.getByText('整组配文'))).toBe(true);
  });
});

describe('AlbumMessage — 跨分页拆组（R1）', () => {
  it('只加载到一部分时仍按 expectedCount 铺格子，缺口用占位补', () => {
    const { container } = render(
      <AlbumMessage album={album({ items: [item(0)], expectedCount: 4, isComplete: false })} />,
    );

    // 真内容 1 个 + 占位 3 个 = 4 格，布局与「已加载几张」无关
    expect(screen.getAllByTestId('media')).toHaveLength(1);
    expect(container.querySelectorAll('.album-cell-placeholder')).toHaveLength(3);
    expect(container.querySelectorAll('.album-cell')).toHaveLength(4);
  });

  it('占位格不显示任何错误文案（它只是还没翻到那一页，不是加载失败）', () => {
    render(<AlbumMessage album={album({ items: [item(0)], expectedCount: 3, isComplete: false })} />);

    expect(screen.queryByText(/失败/)).not.toBeInTheDocument();
    expect(screen.queryByText(/错误/)).not.toBeInTheDocument();
  });

  it('中间位次缺失时，已到货的项仍落在自己的位次上（不前移填空）', () => {
    const { container } = render(
      <AlbumMessage album={album({ items: [item(0, 'fA'), item(2, 'fC')], expectedCount: 3, isComplete: false })} />,
    );

    const cells = Array.from(container.querySelectorAll('.album-cell'));
    expect(cells).toHaveLength(3);
    expect(cells[0].querySelector('[data-uuid="fA"]')).not.toBeNull();
    expect(cells[1].querySelector('.album-cell-placeholder')).not.toBeNull();
    expect(cells[2].querySelector('[data-uuid="fC"]')).not.toBeNull();
  });
});

describe('AlbumMessage — message_type 收窄', () => {
  it('video 项渲染为 video，其余一律按 image 渲染（相册项只可能是媒体）', () => {
    render(
      <AlbumMessage
        album={album({
          items: [
            { ...item(0), message_type: 'video' },
            { ...item(1), message_type: 'image' },
          ],
        })}
      />,
    );

    const types = screen.getAllByTestId('media').map((n) => n.getAttribute('data-type'));
    expect(types).toEqual(['video', 'image']);
  });

  // 收窄必须是全域的：混进非媒体类型时退化为 image，而不是把脏值原样透传下去
  it('非媒体类型退化为 image，不原样透传', () => {
    render(
      <AlbumMessage album={album({ items: [{ ...item(0), message_type: 'system' }], expectedCount: 1 })} />,
    );

    expect(screen.getByTestId('media')).toHaveAttribute('data-type', 'image');
  });
});
