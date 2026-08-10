/**
 * ConversationMessageSearch —— 会话内消息查找面板
 *
 * 覆盖：
 * 1. 五个分类页签渲染 + 默认「全部」选中
 * 2. 输入关键词 → 防抖后出结果，命中文本按关键词高亮（<mark class="msg-search-mark">）
 * 3. 非文字命中带类型徽标（图片/视频/文件），文字命中不带
 * 4. 切页签 → 以对应 content_type 过滤条件重查，且页签选中态跟着变
 * 5. 点命中 → 写 chatStore.pendingScrollToMessageId（全仓唯一那条定位通路的入口），
 *    并且**显式断言没走 scrollIntoView**（jsdom 里它是 undefined，误回退会静默 noop，
 *    不显式断言就防不住回退 —— 见 .claude/rules/frontend-test.md 防回退断言）
 * 6. 空结果态 / 关闭按钮
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';

const mockSearchMessages = vi.hoisted(() => vi.fn());

vi.mock('../../src/db', () => ({
  searchMessages: mockSearchMessages,
}));

import { ConversationMessageSearch } from '../../src/components/search/ConversationMessageSearch';
import { useChatStore } from '../../src/stores';
import type { SearchMessageResult } from '../../src/db';

const CONV_ID = 'conv-u1-u9';

const buildHit = (
  uuid: string,
  contentType: string,
  content: string,
  senderName = 'Alice',
): SearchMessageResult => ({
  message: {
    message_uuid: uuid,
    conversation_id: CONV_ID,
    conversation_type: 'friend',
    sender_id: 'u1',
    sender_name: senderName,
    sender_avatar: null,
    content,
    content_type: contentType,
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    image_width: null,
    image_height: null,
    seq: 1,
    reply_to: null,
    is_recalled: false,
    is_deleted: false,
    send_time: '2026-05-11T08:30:00Z',
    created_at: null,
  },
  conversation_name: 'User9',
  conversation_avatar: null,
  context_before: null,
  context_after: null,
});

/** 输入关键词并推过 500ms 防抖窗 */
async function typeQuery(text: string) {
  const input = screen.getByLabelText('在当前会话中查找消息');
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

describe('ConversationMessageSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchMessages.mockReset();
    mockSearchMessages.mockResolvedValue([]);
    useChatStore.setState({ pendingScrollToMessageId: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('渲染五个分类页签，默认选中「全部」', () => {
    render(<ConversationMessageSearch conversationId={CONV_ID} onClose={vi.fn()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['全部', '文字', '图片', '视频', '文件']);
    expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '图片' })).toHaveAttribute('aria-selected', 'false');
  });

  it('输入关键词后出结果，命中文本按关键词高亮', async () => {
    mockSearchMessages.mockResolvedValue([buildHit('m1', 'text', 'hello wonderful world')]);
    render(<ConversationMessageSearch conversationId={CONV_ID} onClose={vi.fn()} />);

    await typeQuery('wonder');

    expect(screen.getByText('1 条结果')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();

    const marks = document.querySelectorAll('mark.msg-search-mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe('wonder');
  });

  it('非文字命中带类型徽标，文字命中不带', async () => {
    mockSearchMessages.mockResolvedValue([
      buildHit('m1', 'image', 'target.png'),
      buildHit('m2', 'video', 'target.mp4'),
      buildHit('m3', 'file', 'target.zip'),
      buildHit('m4', 'text', 'target text'),
    ]);
    render(<ConversationMessageSearch conversationId={CONV_ID} onClose={vi.fn()} />);

    await typeQuery('target');

    const items = screen.getAllByRole('button', { name: /target/ });
    expect(items).toHaveLength(4);
    expect(within(items[0] as HTMLElement).getByText('图片')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('视频')).toBeInTheDocument();
    expect(within(items[2] as HTMLElement).getByText('文件')).toBeInTheDocument();
    // 文字命中不加徽标：这一条内不应出现任何类型徽标
    expect(within(items[3] as HTMLElement).queryByText('图片')).not.toBeInTheDocument();
    expect(within(items[3] as HTMLElement).queryByText('视频')).not.toBeInTheDocument();
    expect(within(items[3] as HTMLElement).queryByText('文件')).not.toBeInTheDocument();
  });

  it('切「图片」页签：以 include_content_types 重查，且选中态跟着走', async () => {
    render(<ConversationMessageSearch conversationId={CONV_ID} onClose={vi.fn()} />);
    await typeQuery('target');
    expect(mockSearchMessages).toHaveBeenLastCalledWith('target', 100, {
      conversation_id: CONV_ID,
    });

    fireEvent.click(screen.getByRole('tab', { name: '图片' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mockSearchMessages).toHaveBeenLastCalledWith('target', 100, {
      conversation_id: CONV_ID,
      include_content_types: ['image'],
    });
    expect(screen.getByRole('tab', { name: '图片' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'false');
  });

  it('切「文字」页签：以 exclude_content_types 重查（非文件类，含未知类型）', async () => {
    render(<ConversationMessageSearch conversationId={CONV_ID} onClose={vi.fn()} />);
    await typeQuery('target');

    fireEvent.click(screen.getByRole('tab', { name: '文字' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mockSearchMessages).toHaveBeenLastCalledWith('target', 100, {
      conversation_id: CONV_ID,
      exclude_content_types: ['image', 'video', 'file', 'audio'],
    });
  });

  it('点命中：写 pendingScrollToMessageId 走既有定位通路，且不调 scrollIntoView', async () => {
    mockSearchMessages.mockResolvedValue([buildHit('m-target', 'text', 'jump here please')]);
    render(<ConversationMessageSearch conversationId={CONV_ID} onClose={vi.fn()} />);
    await typeQuery('jump');

    const hit = screen.getByRole('button', { name: /jump here please/ });
    // jsdom 未实现 scrollIntoView（默认 undefined）→ 挂 spy 即可捕获误回退
    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;

    fireEvent.click(hit);

    expect(useChatStore.getState().pendingScrollToMessageId).toBe('m-target');
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(hit).toHaveClass('conv-msg-search-hit--active');

    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('键盘 Enter 选中命中项（与点击等价）', async () => {
    mockSearchMessages.mockResolvedValue([buildHit('m-kbd', 'text', 'keyboard reachable')]);
    render(<ConversationMessageSearch conversationId={CONV_ID} onClose={vi.fn()} />);
    await typeQuery('keyboard');

    fireEvent.keyDown(screen.getByRole('button', { name: /keyboard reachable/ }), { key: 'Enter' });

    expect(useChatStore.getState().pendingScrollToMessageId).toBe('m-kbd');
  });

  it('无命中：给出空态提示而不是静默空白', async () => {
    mockSearchMessages.mockResolvedValue([]);
    render(<ConversationMessageSearch conversationId={CONV_ID} onClose={vi.fn()} />);

    await typeQuery('nothingmatches');

    expect(screen.getByText(/未找到包含「nothingmatches」的消息/)).toBeInTheDocument();
    expect(screen.queryByText(/条结果/)).not.toBeInTheDocument();
  });

  it('DB 报错：展示错误而不是空态', async () => {
    mockSearchMessages.mockRejectedValue(new Error('db down'));
    render(<ConversationMessageSearch conversationId={CONV_ID} onClose={vi.fn()} />);

    await typeQuery('boom');

    expect(screen.getByText('db down')).toBeInTheDocument();
    expect(screen.queryByText(/未找到包含/)).not.toBeInTheDocument();
  });

  it('关闭按钮 / Esc 都触发 onClose', () => {
    const onClose = vi.fn();
    render(<ConversationMessageSearch conversationId={CONV_ID} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText('关闭会话内查找'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByLabelText('在当前会话中查找消息'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
