/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * MobileNfcTrustedCardsPage 组件测试
 *
 * 验证：
 * - listTrusted 返回 2 条 → 渲染 2 个条目（含 summary）
 * - 空列表 → 渲染"暂无"占位
 * - 点移除按钮 → 触发 removeTrusted 含正确 args + 重新调 listTrusted 刷新
 *
 * 用 vi.hoisted 包外层引用变量（vitest mock 提升规则，参见
 * .claude/rules/frontend-test.md "vi.mock 工厂引用 outer 变量必须用 vi.hoisted()"）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockTrustStore = vi.hoisted(() => ({
  listTrusted: vi.fn(),
  removeTrusted: vi.fn(),
  isTrusted: vi.fn(),
  addTrusted: vi.fn(),
}));

vi.mock('../../src/nfc/trustStore', () => ({
  trustStore: mockTrustStore,
}));

import { MobileNfcTrustedCardsPage } from '../../src/pages/mobile/MobileNfcTrustedCardsPage';
import type { TrustedNfcCard } from '../../src/nfc/types';

const SAMPLE_CARDS: TrustedNfcCard[] = [
  {
    uid: '04123456deadbeef',
    payload_hash: 'abcdef0123456789fedcba9876543210abcdef0123456789fedcba9876543210',
    action_summary: '打开小程序: app-1',
    created_at: new Date('2024-05-14T10:30:00').getTime(),
  },
  {
    uid: '05abcdefdeadbabe',
    payload_hash: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
    action_summary: 'POST 请求: api.test',
    created_at: new Date('2024-05-13T08:15:00').getTime(),
  },
];

describe('MobileNfcTrustedCardsPage', () => {
  beforeEach(() => {
    mockTrustStore.listTrusted.mockReset();
    mockTrustStore.removeTrusted.mockReset();
  });

  it('listTrusted 返回 2 条 → 渲染 2 个 summary', async () => {
    mockTrustStore.listTrusted.mockResolvedValueOnce(SAMPLE_CARDS);

    render(<MobileNfcTrustedCardsPage onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('打开小程序: app-1')).toBeInTheDocument();
      expect(screen.getByText('POST 请求: api.test')).toBeInTheDocument();
    });
  });

  it('空列表 → 渲染"暂无"占位', async () => {
    mockTrustStore.listTrusted.mockResolvedValueOnce([]);

    render(<MobileNfcTrustedCardsPage onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/暂无已信任的 NFC 卡/)).toBeInTheDocument();
    });
  });

  it('点移除按钮 → 调 removeTrusted 含正确 (uid, payload_hash) + 重新 list 刷新', async () => {
    mockTrustStore.listTrusted
      .mockResolvedValueOnce(SAMPLE_CARDS)
      .mockResolvedValueOnce([SAMPLE_CARDS[1]!]); // 移除第一条后剩第二条
    mockTrustStore.removeTrusted.mockResolvedValueOnce(undefined);

    render(<MobileNfcTrustedCardsPage onBack={() => {}} />);

    // 等首次加载完成
    await waitFor(() => {
      expect(screen.getByText('打开小程序: app-1')).toBeInTheDocument();
    });

    // 找第一条对应的"移除"按钮（两个移除按钮均存在，按出现顺序取第一个）
    const removeButtons = screen.getAllByRole('button', { name: '移除' });
    expect(removeButtons.length).toBe(2);
    fireEvent.click(removeButtons[0]!);

    await waitFor(() => {
      expect(mockTrustStore.removeTrusted).toHaveBeenCalledWith(
        SAMPLE_CARDS[0]!.uid,
        SAMPLE_CARDS[0]!.payload_hash,
      );
    });
    // listTrusted 被再次调用刷新
    await waitFor(() => {
      expect(mockTrustStore.listTrusted).toHaveBeenCalledTimes(2);
    });
    // UI 已更新只显示第二条
    await waitFor(() => {
      expect(screen.queryByText('打开小程序: app-1')).not.toBeInTheDocument();
      expect(screen.getByText('POST 请求: api.test')).toBeInTheDocument();
    });
  });
});
