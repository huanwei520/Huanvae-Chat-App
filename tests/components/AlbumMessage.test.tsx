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
  }: { fileUuid: string | null; displayVariant?: string }) => (
    <div data-testid="media" data-uuid={fileUuid} data-variant={displayVariant} />
  ),
}));

import { AlbumMessage, albumColumns, type AlbumMediaItem } from '../../src/chat/shared/AlbumMessage';
import type { AlbumNode } from '../../src/chat/shared/mediaGroup';

function item(index: number, uuid = `f${index}`): AlbumMediaItem {
  return {
    message_uuid: `m${index}`,
    message_content: '',
    message_type: 'image',
    file_uuid: uuid,
    file_size: 1024,
    file_hash: `h${index}`,
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

describe('albumColumns', () => {
  it('4 张及以内 2 列，5 张及以上 3 列（两端同一口径，保证同样张数长得一样）', () => {
    expect(albumColumns(2)).toBe(2);
    expect(albumColumns(3)).toBe(2);
    expect(albumColumns(4)).toBe(2);
    expect(albumColumns(5)).toBe(3);
    expect(albumColumns(10)).toBe(3);
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

  it('无配文时不渲染配文行（不留空行）', () => {
    const { container } = render(<AlbumMessage album={album({ caption: '' })} />);
    expect(container.querySelector('.album-caption')).toBeNull();
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
