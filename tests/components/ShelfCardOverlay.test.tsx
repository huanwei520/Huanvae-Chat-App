/**
 * ShelfCardOverlay 浮层卡测试
 *
 * - 内容源来自本地会话窗口 db.getMessages（card 消息）→ 命中则渲染 CardRenderer，
 *   未命中显示"不在本地缓存"占位
 * - canManage=false：纯查看，无任何管理控件
 * - canManage=true：取消上架 / 上移下移 / 上架候选选取
 *   · 取消上架 → unpinFromShelf(scope, key, itemId)
 *   · 下移首项 → reorderShelf(scope, key, [交换后的有序 id])
 *   · 选取候选 → pinToShelf(scope, key, { message_uuid })
 * - open=false → 不渲染
 *
 * scope/scopeKey 用中性 fixture（bot / u1:bot_x）；CardRenderer 被 stub 隔离。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({}));
vi.mock('../../src/contexts/SessionContext', async (orig) => ({
  ...(await orig()),
  useApi: () => apiMock,
}));

const shelfApiMock = vi.hoisted(() => ({
  getShelf: vi.fn().mockResolvedValue({ items: [] }),
  unpinFromShelf: vi.fn().mockResolvedValue(undefined),
  reorderShelf: vi.fn().mockResolvedValue({ items: [] }),
  pinToShelf: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../src/api/shelf', async (orig) => ({
  ...(await orig()),
  ...shelfApiMock,
}));

const dbMock = vi.hoisted(() => ({ getMessages: vi.fn() }));
vi.mock('../../src/db', async (orig) => ({
  ...(await orig()),
  getMessages: dbMock.getMessages,
}));

// 隔离卡片渲染
vi.mock('../../src/chat/shared/CardRenderer', () => ({
  CardRenderer: (p: { messageUuid: string }) => <div data-testid={`card-${p.messageUuid}`} />,
}));

import { ShelfCardOverlay } from '../../src/chat/shared/ShelfCardOverlay';
import { useShelfStore } from '../../src/stores/shelfStore';
import type { ShelfItem } from '../../src/api/shelf';

const CARD = JSON.stringify({ version: 1, nodes: [{ type: 'text', text: '进度' }] });

function makeItem(overrides: Partial<ShelfItem> = {}): ShelfItem {
  return {
    item_id: 'i1',
    message_uuid: 'm1',
    pinned_by: 'bot_x',
    note: null,
    position: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const ANCHOR = { top: 0, left: 0, width: 320 };

/** m1/m2 两条 card 消息在本地窗口 */
function seedTwoCards() {
  dbMock.getMessages.mockResolvedValue([
    { message_uuid: 'm1', content: CARD, content_type: 'card', is_deleted: false, is_recalled: false },
    { message_uuid: 'm2', content: CARD, content_type: 'card', is_deleted: false, is_recalled: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any);
}

function renderOverlay(props: Partial<React.ComponentProps<typeof ShelfCardOverlay>> = {}) {
  return render(
    <ShelfCardOverlay
      open
      onClose={vi.fn()}
      items={[makeItem()]}
      scope="bot"
      scopeKey="u1:bot_x"
      conversationId="conv1"
      sourceType="friend"
      canManage={false}
      anchor={ANCHOR}
      {...props}
    />,
  );
}

beforeEach(() => {
  useShelfStore.getState().clear();
  shelfApiMock.getShelf.mockClear().mockResolvedValue({ items: [] });
  shelfApiMock.unpinFromShelf.mockClear().mockResolvedValue(undefined);
  shelfApiMock.reorderShelf.mockClear().mockResolvedValue({ items: [] });
  shelfApiMock.pinToShelf.mockClear().mockResolvedValue({});
  dbMock.getMessages.mockReset();
  seedTwoCards();
});

describe('ShelfCardOverlay', () => {
  it('canManage=false：渲染卡片但无任何管理控件', async () => {
    renderOverlay({ items: [makeItem({ item_id: 'i1', message_uuid: 'm1' })], canManage: false });

    await waitFor(() => expect(screen.getByTestId('card-m1')).toBeInTheDocument());
    expect(screen.queryByText('取消上架')).toBeNull();
    expect(screen.queryByRole('button', { name: '上架' })).toBeNull();
    expect(screen.queryByLabelText('上移')).toBeNull();
    expect(screen.queryByLabelText('下移')).toBeNull();
  });

  it('canManage=true：显示取消上架 / 上架入口 / 上移下移', async () => {
    renderOverlay({ items: [makeItem({ item_id: 'i1', message_uuid: 'm1' })], canManage: true });

    await waitFor(() => expect(screen.getByTestId('card-m1')).toBeInTheDocument());
    expect(screen.getByText('取消上架')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上架' })).toBeInTheDocument();
    expect(screen.getByLabelText('上移')).toBeInTheDocument();
    expect(screen.getByLabelText('下移')).toBeInTheDocument();
  });

  it('点击取消上架 → unpinFromShelf(scope, key, itemId)', async () => {
    renderOverlay({ items: [makeItem({ item_id: 'i1', message_uuid: 'm1' })], canManage: true });

    await waitFor(() => expect(screen.getByTestId('card-m1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('取消上架'));

    await waitFor(() =>
      expect(shelfApiMock.unpinFromShelf).toHaveBeenCalledWith(
        expect.anything(),
        'bot',
        'u1:bot_x',
        'i1',
      ),
    );
  });

  it('下移首项 → reorderShelf 传交换后的有序 id 列表', async () => {
    renderOverlay({
      items: [makeItem({ item_id: 'i1', message_uuid: 'm1' }), makeItem({ item_id: 'i2', message_uuid: 'm2', position: 1 })],
      canManage: true,
    });

    await waitFor(() => expect(screen.getByTestId('card-m1')).toBeInTheDocument());
    // 首项（index 0）的"下移"启用；第二项的"下移"禁用
    fireEvent.click(screen.getAllByLabelText('下移')[0]);

    await waitFor(() =>
      expect(shelfApiMock.reorderShelf).toHaveBeenCalledWith(
        expect.anything(),
        'bot',
        'u1:bot_x',
        ['i2', 'i1'],
      ),
    );
  });

  it('上架候选：选取一张候选卡 → pinToShelf(scope, key, { message_uuid })', async () => {
    renderOverlay({ items: [], canManage: true });

    // 打开上架选择器（toggle 文案为"上架"）
    fireEvent.click(screen.getByText('上架'));
    // 候选来自本地窗口 card 消息（m1/m2 均未上架）
    await waitFor(() => expect(screen.getByTestId('card-m1')).toBeInTheDocument());

    const candidateBtn = screen.getByTestId('card-m1').closest('button')!;
    fireEvent.click(candidateBtn);

    await waitFor(() =>
      expect(shelfApiMock.pinToShelf).toHaveBeenCalledWith(
        expect.anything(),
        'bot',
        'u1:bot_x',
        { message_uuid: 'm1' },
      ),
    );
  });

  it('引用的卡片不在本地窗口 → 显示"不在本地缓存"占位', async () => {
    dbMock.getMessages.mockResolvedValue([]);
    renderOverlay({ items: [makeItem({ message_uuid: 'notindb' })], canManage: false });

    await waitFor(() => expect(screen.getByText(/不在本地缓存/)).toBeInTheDocument());
    expect(screen.queryByTestId('card-notindb')).toBeNull();
  });

  it('open=false → 不渲染', () => {
    renderOverlay({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
