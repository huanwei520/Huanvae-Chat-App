/**
 * ConversationMessageSearch —— 会话内消息查找视图（侧边面板的一个 view）
 *
 * 本次改造把它从「输入关键词才有结果」改成 Telegram 式「点分类就按时间倒序列出，关键词再收窄」，
 * 并加了滚动/按钮分页。覆盖：
 * 1. **不输入关键词，点分类即出结果**（本次核心；同时断言下发给 DB 的过滤条件不带 query）
 * 2. 输入关键词 → 在同一分类内过滤，命中文本按关键词高亮（<mark class="msg-search-mark">）
 * 3. 结果按 DB 给的顺序（send_time 倒序）渲染 —— 组件不得自作主张重排
 * 4. 图片/视频给缩略图组件、文件给图标 + 文件名 + 大小、文字不带徽标
 * 5. **分页**：首屏只请求一页；点「加载更多」以 offset=已加载条数 追加；滚到底自动追加；
 *    到底后显示「没有更多了」且不再请求
 * 6. 点命中 → 写 chatStore.pendingScrollToMessageId（全仓唯一那条定位通路的入口）+ onJump，
 *    并且**显式断言没走 scrollIntoView**（jsdom 里它是 undefined，误回退会静默 noop，
 *    不显式断言就防不住回退 —— 见 .claude/rules/frontend-test.md 防回退断言）
 * 7. 两种空态文案分开（有关键词 vs 纯浏览）、DB 报错、返回主菜单
 *
 * 缩略图子组件 ConversationSearchMedia 被 mock 掉：它内部 useFileCache → useApi 需要整套
 * SessionProvider，与本文件要验的列表逻辑无关；它自身的契约由 ConversationSearchMedia.test.tsx 覆盖。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';

const mockListConversationMessages = vi.hoisted(() => vi.fn());

vi.mock('../../src/db', () => ({
  listConversationMessages: mockListConversationMessages,
}));

vi.mock('../../src/components/search/ConversationSearchMedia', () => ({
  ConversationSearchMedia: ({ message }: { message: { message_uuid: string } }) => (
    <div data-testid={`thumb-${message.message_uuid}`} />
  ),
}));

import { ConversationMessageSearch } from '../../src/components/search/ConversationMessageSearch';
import { CONVERSATION_PAGE_SIZE } from '../../src/components/search/useConversationMessageSearch';
import { useChatStore } from '../../src/stores';
import type { LocalMessage } from '../../src/db';

const CONV_ID = 'conv-u1-u9';

const buildMessage = (
  uuid: string,
  contentType: string,
  content: string,
  overrides: Partial<LocalMessage> = {},
): LocalMessage => ({
  message_uuid: uuid,
  conversation_id: CONV_ID,
  conversation_type: 'friend',
  sender_id: 'u1',
  sender_name: 'Alice',
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
  media_group_id: null,
  media_group_index: null,
  media_group_count: null,
  is_recalled: false,
  is_deleted: false,
  send_time: '2026-05-11T08:30:00Z',
  created_at: null,
  ...overrides,
});

const fullPage = (prefix: string): LocalMessage[] =>
  Array.from({ length: CONVERSATION_PAGE_SIZE }, (_, i) =>
    buildMessage(`${prefix}-${i}`, 'text', `第 ${i} 条`));

const MEMBERS = [
  { user_id: 'u1', user_nickname: '张三' },
  { user_id: 'u2', user_nickname: '李四' },
] as never;

function renderPanel(
  overrides: { onBack?: () => void; onJump?: () => void; members?: unknown } = {},
) {
  const onBack = overrides.onBack ?? vi.fn();
  const onJump = overrides.onJump ?? vi.fn();
  const view = render(
    <ConversationMessageSearch
      conversationId={CONV_ID}
      onBack={onBack}
      onJump={onJump}
      members={overrides.members as never}
    />,
  );
  return { ...view, onBack, onJump };
}

/** 推过一次异步查询（含 500ms 防抖窗） */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

/** 输入关键词并推过防抖窗 */
async function typeQuery(text: string) {
  fireEvent.change(screen.getByLabelText('在当前会话中查找消息'), { target: { value: text } });
  await settle();
}

describe('ConversationMessageSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockListConversationMessages.mockReset();
    mockListConversationMessages.mockResolvedValue([]);
    useChatStore.setState({ pendingScrollToMessageId: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('渲染五个分类页签，默认选中「全部」', async () => {
    renderPanel();
    await settle();

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['全部', '文字', '图片', '视频', '文件']);
    expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '图片' })).toHaveAttribute('aria-selected', 'false');
  });

  it('不输入关键词：挂载即列出「全部」分类的内容（本次改造的核心）', async () => {
    mockListConversationMessages.mockResolvedValue([
      buildMessage('m1', 'text', '最新一条'),
      buildMessage('m2', 'text', '早一点那条'),
    ]);
    renderPanel();
    await settle();

    expect(mockListConversationMessages).toHaveBeenCalledTimes(1);
    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId: CONV_ID, query: undefined, offset: 0 }),
    );
    expect(screen.getByRole('button', { name: /最新一条/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /早一点那条/ })).toBeInTheDocument();
  });

  it('不输入关键词点「图片」页签：直接列出该分类全部，DB 只收到分类过滤、不带 query', async () => {
    mockListConversationMessages.mockResolvedValue([
      buildMessage('i1', 'image', 'a.png', { file_uuid: 'fu-1', file_size: 2048 }),
    ]);
    renderPanel();
    await settle();

    fireEvent.click(screen.getByRole('tab', { name: '图片' }));
    await settle();

    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversationId: CONV_ID,
        query: undefined,
        filter: { include_content_types: ['image'] },
      }),
    );
    expect(screen.getByRole('tab', { name: '图片' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('thumb-i1')).toBeInTheDocument();
  });

  it('输入关键词：在当前分类内过滤，命中文本按关键词高亮', async () => {
    renderPanel();
    await settle();

    fireEvent.click(screen.getByRole('tab', { name: '文字' }));
    mockListConversationMessages.mockResolvedValue([
      buildMessage('m1', 'text', 'hello wonderful world'),
    ]);
    await typeQuery('wonder');

    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: 'wonder',
        filter: { exclude_content_types: ['image', 'video', 'file', 'audio'] },
      }),
    );

    const marks = document.querySelectorAll('mark.msg-search-mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe('wonder');
  });

  it('按 DB 给的顺序（send_time 倒序）渲染，组件不重排', async () => {
    mockListConversationMessages.mockResolvedValue([
      buildMessage('m-new', 'text', '新的', { send_time: '2026-05-11T09:00:00Z' }),
      buildMessage('m-mid', 'text', '中间', { send_time: '2026-05-11T08:00:00Z' }),
      buildMessage('m-old', 'text', '旧的', { send_time: '2026-05-11T07:00:00Z' }),
    ]);
    renderPanel();
    await settle();

    const rows = Array.from(document.querySelectorAll('.conv-msg-search-hit'));
    expect(rows.map((r) => r.textContent?.includes('新的'))).toEqual([true, false, false]);
    expect(rows[2]?.textContent).toContain('旧的');
  });

  it('图片/视频给缩略图，文件给图标 + 文件名 + 大小，文字不带徽标', async () => {
    mockListConversationMessages.mockResolvedValue([
      buildMessage('m1', 'image', 'target.png', { file_uuid: 'f1', file_size: 1024 }),
      buildMessage('m2', 'video', 'target.mp4', { file_uuid: 'f2', file_size: 2048 }),
      buildMessage('m3', 'file', 'target.zip', { file_uuid: 'f3', file_size: 3072 }),
      buildMessage('m4', 'text', 'target text'),
    ]);
    renderPanel();
    await settle();

    const items = screen.getAllByRole('button', { name: /target/ });
    expect(items).toHaveLength(4);

    expect(within(items[0] as HTMLElement).getByText('图片')).toBeInTheDocument();
    expect(screen.getByTestId('thumb-m1')).toBeInTheDocument();

    expect(within(items[1] as HTMLElement).getByText('视频')).toBeInTheDocument();
    expect(screen.getByTestId('thumb-m2')).toBeInTheDocument();

    // 文件：图标 + 文件名 + 大小
    expect(within(items[2] as HTMLElement).getByText('文件')).toBeInTheDocument();
    expect(within(items[2] as HTMLElement).getByText('target.zip')).toBeInTheDocument();
    expect(within(items[2] as HTMLElement).getByText('3.0 KB')).toBeInTheDocument();
    expect((items[2] as HTMLElement).querySelector('.conv-msg-search-thumb--doc')).not.toBeNull();

    // 文字命中不加任何类型徽标，也没有缩略图
    expect(within(items[3] as HTMLElement).queryByText('图片')).not.toBeInTheDocument();
    expect(within(items[3] as HTMLElement).queryByText('视频')).not.toBeInTheDocument();
    expect(within(items[3] as HTMLElement).queryByText('文件')).not.toBeInTheDocument();
    expect(screen.queryByTestId('thumb-m4')).not.toBeInTheDocument();
  });

  it('分页：首屏只渲染一页，点「加载更多」以 offset 追加下一页', async () => {
    mockListConversationMessages.mockResolvedValueOnce(fullPage('p1'));
    renderPanel();
    await settle();

    expect(document.querySelectorAll('.conv-msg-search-hit')).toHaveLength(CONVERSATION_PAGE_SIZE);
    expect(mockListConversationMessages).toHaveBeenCalledTimes(1);

    mockListConversationMessages.mockResolvedValueOnce([buildMessage('p2-0', 'text', '第二页那条')]);
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await settle();

    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: CONVERSATION_PAGE_SIZE, offset: CONVERSATION_PAGE_SIZE }),
    );
    expect(document.querySelectorAll('.conv-msg-search-hit')).toHaveLength(
      CONVERSATION_PAGE_SIZE + 1,
    );
    expect(screen.getByRole('button', { name: /第二页那条/ })).toBeInTheDocument();
    // 末页没拿满 → 到底
    expect(screen.getByText('没有更多了')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });

  it('滚到列表底部自动追加下一页', async () => {
    mockListConversationMessages.mockResolvedValueOnce(fullPage('p1'));
    renderPanel();
    await settle();

    const list = document.querySelector('.conv-msg-search-list') as HTMLElement;
    // jsdom 不做布局，几何全 0 → 手工造出「还没到底」与「到底」两种形态
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true });

    Object.defineProperty(list, 'scrollTop', { value: 0, configurable: true });
    fireEvent.scroll(list);
    await settle();
    expect(mockListConversationMessages).toHaveBeenCalledTimes(1);

    mockListConversationMessages.mockResolvedValueOnce([buildMessage('p2-0', 'text', '滚出来的')]);
    Object.defineProperty(list, 'scrollTop', { value: 690, configurable: true });
    fireEvent.scroll(list);
    await settle();

    expect(mockListConversationMessages).toHaveBeenCalledTimes(2);
    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: CONVERSATION_PAGE_SIZE }),
    );
    expect(screen.getByRole('button', { name: /滚出来的/ })).toBeInTheDocument();
  });

  it('点命中：写 pendingScrollToMessageId 走既有定位通路 + 通知调用方收面板，且不调 scrollIntoView', async () => {
    mockListConversationMessages.mockResolvedValue([
      buildMessage('m-target', 'text', 'jump here please'),
    ]);
    const { onJump } = renderPanel();
    await settle();

    const hit = screen.getByRole('button', { name: /jump here please/ });
    // jsdom 未实现 scrollIntoView（默认 undefined）→ 挂 spy 即可捕获误回退
    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;

    fireEvent.click(hit);

    expect(useChatStore.getState().pendingScrollToMessageId).toBe('m-target');
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('键盘 Enter 选中命中项（与点击等价）', async () => {
    mockListConversationMessages.mockResolvedValue([
      buildMessage('m-kbd', 'text', 'keyboard reachable'),
    ]);
    renderPanel();
    await settle();

    fireEvent.keyDown(screen.getByRole('button', { name: /keyboard reachable/ }), { key: 'Enter' });

    expect(useChatStore.getState().pendingScrollToMessageId).toBe('m-kbd');
  });

  it('空态：纯浏览与带关键词两种文案分开，不是同一句', async () => {
    mockListConversationMessages.mockResolvedValue([]);
    renderPanel();
    await settle();

    expect(screen.getByText('该分类暂无内容')).toBeInTheDocument();

    await typeQuery('nothingmatches');
    expect(screen.getByText(/未找到包含「nothingmatches」的消息/)).toBeInTheDocument();
    expect(screen.queryByText('该分类暂无内容')).not.toBeInTheDocument();
  });

  it('DB 报错：展示错误而不是空态', async () => {
    mockListConversationMessages.mockRejectedValue(new Error('db down'));
    renderPanel();
    await settle();

    expect(screen.getByText('db down')).toBeInTheDocument();
    expect(screen.queryByText('该分类暂无内容')).not.toBeInTheDocument();
  });

  it('返回键 / Esc 都回主菜单（面板本身不在这里关）', async () => {
    const { onBack } = renderPanel();
    await settle();

    fireEvent.click(screen.getByRole('button', { name: '←' }));
    expect(onBack).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByLabelText('在当前会话中查找消息'), { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  describe('群成员分类（huanwei 新需求：单独看某个群员在本群说过什么）', () => {
    it('不传 members（好友会话）⇒ 不出现「群成员」页签', async () => {
      renderPanel();
      await settle();
      expect(screen.queryByRole('tab', { name: '群成员' })).not.toBeInTheDocument();
    });

    it('群聊：点「群成员」先列成员，**不**直接查记录（此时不该发查询）', async () => {
      renderPanel({ members: MEMBERS });
      await settle();
      mockListConversationMessages.mockClear();

      fireEvent.click(screen.getByRole('tab', { name: '群成员' }));
      await settle();

      expect(screen.getByRole('button', { name: '张三' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '李四' })).toBeInTheDocument();
    });

    it('选中成员 ⇒ 以 sender_id 查询该成员在本会话的记录', async () => {
      renderPanel({ members: MEMBERS });
      await settle();
      fireEvent.click(screen.getByRole('tab', { name: '群成员' }));
      await settle();

      fireEvent.click(screen.getByRole('button', { name: '张三' }));
      await settle();

      expect(mockListConversationMessages).toHaveBeenLastCalledWith(
        expect.objectContaining({ filter: expect.objectContaining({ sender_id: 'u1' }) }),
      );
    });

    // 没有这条，用户看着一屏记录不知道是谁的
    it('选中后显示「正在看谁」，点「换人」回到成员列表', async () => {
      renderPanel({ members: MEMBERS });
      await settle();
      fireEvent.click(screen.getByRole('tab', { name: '群成员' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: '张三' }));
      await settle();

      expect(screen.getByText('张三')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '换人' }));
      await settle();

      expect(screen.getByRole('button', { name: '李四' })).toBeInTheDocument();
    });

    // 换页签不该保留上次选中的人，否则「点进群成员却直接是某人的记录」
    it('切到别的页签再切回来：回到成员选择，不残留上次的人', async () => {
      renderPanel({ members: MEMBERS });
      await settle();
      fireEvent.click(screen.getByRole('tab', { name: '群成员' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: '张三' }));
      await settle();

      fireEvent.click(screen.getByRole('tab', { name: '图片' }));
      await settle();
      fireEvent.click(screen.getByRole('tab', { name: '群成员' }));
      await settle();

      expect(screen.getByRole('button', { name: '张三' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '换人' })).not.toBeInTheDocument();
    });
  });
});

