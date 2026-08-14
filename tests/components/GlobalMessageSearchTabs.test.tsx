/**
 * GlobalMessageSearchResults —— 六分类页签（消息 · 视频 · 图片 · 用户 · 群聊 · 机器人）
 *
 * 本文件覆盖**页签本身**与**三个消息类页签**（用户/群聊/机器人的发现区在
 * GlobalMessageSearchDiscovery.test.tsx）。每个页签至少一条：
 *
 * | 页签 | 本文件断言 |
 * |---|---|
 * | 消息 | 默认选中；filter 下推成 exclude image/video；文档命中带 📁 前缀；命中触顶给提示 |
 * | 视频 | 切过去 → filter 变 include video；命中走九宫格封面版式（layout="cover"）|
 * | 图片 | 切过去 → filter 变 include image；点封面 → onSelectMessage 带对的 group/hit |
 * | 用户 | 切过去 → **不再查消息表**（query 传空串）；本地非 bot 好友在这里 |
 * | 群聊 | 切过去 → 本地群名命中在这里 |
 * | 机器人 | 切过去 → 本地 bot 好友在这里，**且不出现在用户页签**（正反两条）|
 *
 * mock 说明：
 * - useGlobalMessageSearch / useDiscoverySearch → vi.fn，逐用例注入（引用稳定）。
 *   🔴 mock 该 hook 模块时必须一并导出 GLOBAL_SEARCH_LIMIT —— 被测组件从同一模块 import 它，
 *   工厂里漏掉会报 "No export is defined on the mock"（见 .claude/rules/frontend-test.md）。
 * - ConversationSearchHit → 轻量替身。真组件自带 useFileCache / 独立预览窗 / portal，
 *   它的行为由 ConversationSearchHit.test.tsx 覆盖；这里要验的是**父组件的接线**
 *   （版式是不是 cover、onLocate 有没有接到 onSelectMessage）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { Friend, Group } from '../../src/types/chat';
import type { SearchMessageResult } from '../../src/db';

const mockUseGlobalMessageSearch = vi.hoisted(() => vi.fn());
vi.mock('../../src/hooks/useGlobalMessageSearch', () => ({
  useGlobalMessageSearch: (q: string, f?: unknown) => mockUseGlobalMessageSearch(q, f),
  GLOBAL_SEARCH_LIMIT: 50,
}));

const mockUseDiscoverySearch = vi.hoisted(() => vi.fn());
vi.mock('../../src/hooks/useDiscoverySearch', () => ({
  useDiscoverySearch: (q: string) => mockUseDiscoverySearch(q),
}));

vi.mock('../../src/components/search/ConversationSearchHit', () => ({
  ConversationSearchHit: ({
    message,
    layout,
    onLocate,
  }: {
    message: { message_uuid: string; content: string };
    layout: string;
    onLocate: (m: unknown) => void;
  }) => (
    <li
      data-testid="search-hit"
      data-layout={layout}
      data-uuid={message.message_uuid}
      onClick={() => onLocate(message)}
    >
      {message.content}
    </li>
  ),
}));

import { GlobalMessageSearchResults } from '../../src/components/search/GlobalMessageSearchResults';

const buildFriend = (id: string, nickname: string): Friend => ({
  friend_id: id,
  friend_nickname: nickname,
  friend_avatar_url: null,
  add_time: '2026-01-01T00:00:00Z',
  approve_reason: null,
  friend_remark: null,
  is_blacklisted: false,
  is_special_care: false,
});

const buildGroup = (id: string, name: string): Group => ({
  group_id: id,
  group_name: name,
  group_avatar_url: '',
  role: 'member',
  unread_count: null,
  last_message_content: null,
  last_message_time: null,
});

const buildHit = (uuid: string, contentType: string, content: string): SearchMessageResult => ({
  message: {
    message_uuid: uuid,
    conversation_id: 'conv-a-b',
    conversation_type: 'friend',
    sender_id: 'u1',
    sender_name: 'User1',
    sender_avatar: null,
    content,
    content_type: contentType,
    file_uuid: 'f-1',
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
    send_time: '2026-05-11T00:00:00Z',
    created_at: null,
  },
  conversation_name: 'Alice',
  conversation_avatar: null,
  context_before: null,
  context_after: null,
});

const buildGroupResult = (hits: SearchMessageResult[]) => ({
  conversationId: 'conv-a-b',
  conversationType: 'friend' as const,
  conversationName: 'Alice',
  conversationAvatar: null,
  hits,
});

function setLocalHits(hits: SearchMessageResult[]) {
  mockUseGlobalMessageSearch.mockReturnValue({
    groups: hits.length > 0 ? [buildGroupResult(hits)] : [],
    loading: false,
    error: null,
  });
}

interface RenderOverrides {
  query?: string;
  friends?: Friend[];
  groups?: Group[];
}

/** 回调单独返回：混进 props 展开后类型会被拓宽成联合类型，`.mock` 就取不到了 */
function renderResults(overrides: RenderOverrides = {}) {
  const spies = {
    onSelectConversation: vi.fn(),
    onSelectMessage: vi.fn(),
    onSelectDiscoveryPerson: vi.fn(),
    onSelectDiscoveryBot: vi.fn(),
    onSelectDiscoveryGroup: vi.fn(),
  };
  render(
    <GlobalMessageSearchResults
      query={overrides.query ?? 'x'}
      friends={overrides.friends ?? []}
      groups={overrides.groups ?? []}
      {...spies}
    />,
  );
  return spies;
}

/** 最近一次本地搜索调用的 (query, filter) */
function lastLocalCall(): [string, unknown] {
  const calls = mockUseGlobalMessageSearch.mock.calls;
  return calls[calls.length - 1] as [string, unknown];
}

function clickTab(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

/**
 * 取当前渲染出的所有会话 / 发现行的**显示名**
 *
 * 🔴 不能用 `getByText('AliceBot')`：highlightMatch 会把命中的关键词切成
 * `<mark>Alice</mark>` + 文本节点 `Bot`，整名字在 DOM 里根本不是一个文本节点 ⇒
 * `getByText` 恒找不到。更糟的是 `queryByText(...).toBeNull()` 这种**反向**断言会
 * 因此恒真 —— 那条断言本来是用来证明"bot 没跑到用户页签里"的，会变成假通过。
 * 故一律按行元素的 textContent 比对；BOT 徽章挂在名字 span 内，先摘掉再取文本。
 */
function rowLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.global-msg-search-conv-name')).map(
    (el) => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.bot-badge').forEach((b) => b.remove());
      return clone.textContent ?? '';
    },
  );
}

/** 按显示名点某一行（行与名字 span 一一对应，取同一个下标） */
function clickRow(label: string) {
  const index = rowLabels().indexOf(label);
  expect(index).toBeGreaterThanOrEqual(0);
  fireEvent.click(document.querySelectorAll('.global-msg-search-conv-item')[index]);
}

describe('GlobalMessageSearchResults · 页签栏', () => {
  beforeEach(() => {
    cleanup();
    mockUseGlobalMessageSearch.mockReset();
    mockUseDiscoverySearch.mockReset();
    setLocalHits([]);
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: false,
      error: null,
    });
  });

  it('渲染六个页签，顺序为 消息 → 视频 → 图片 → 用户 → 群聊 → 机器人', () => {
    renderResults();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      '消息',
      '视频',
      '图片',
      '用户',
      '群聊',
      '机器人',
    ]);
  });

  it('默认选中「消息」，切换后 aria-selected 跟着走（同一时刻只有一个选中）', () => {
    renderResults();
    expect(screen.getByRole('tab', { name: '消息' })).toHaveAttribute('aria-selected', 'true');

    clickTab('图片');
    expect(screen.getByRole('tab', { name: '图片' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '消息' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true'))
      .toHaveLength(1);
  });
});

describe('GlobalMessageSearchResults · 消息 / 视频 / 图片页签的 SQL 过滤下推', () => {
  beforeEach(() => {
    cleanup();
    mockUseGlobalMessageSearch.mockReset();
    mockUseDiscoverySearch.mockReset();
    setLocalHits([]);
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: false,
      error: null,
    });
  });

  it('「消息」页签：带 exclude image/video 查本地（文档 / 语音仍留在消息里）', () => {
    renderResults();
    expect(lastLocalCall()).toEqual(['x', { exclude_content_types: ['image', 'video'] }]);
  });

  it('「视频」页签：切过去后 filter 变成 include video', () => {
    renderResults();
    clickTab('视频');
    expect(lastLocalCall()).toEqual(['x', { include_content_types: ['video'] }]);
  });

  it('「图片」页签：切过去后 filter 变成 include image', () => {
    renderResults();
    clickTab('图片');
    expect(lastLocalCall()).toEqual(['x', { include_content_types: ['image'] }]);
  });

  it('实体页签（用户 / 群聊 / 机器人）不查消息表：query 传空串、filter 为 undefined', () => {
    renderResults();
    for (const label of ['用户', '群聊', '机器人']) {
      clickTab(label);
      expect(lastLocalCall()).toEqual(['', undefined]);
    }
  });
});

describe('GlobalMessageSearchResults · 消息页签的结果渲染', () => {
  beforeEach(() => {
    cleanup();
    mockUseGlobalMessageSearch.mockReset();
    mockUseDiscoverySearch.mockReset();
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: false,
      error: null,
    });
  });

  it('文字命中原样显示；文档 / 语音命中加类型前缀（消息页签里混着三种，要能一眼分辨）', () => {
    setLocalHits([
      buildHit('m1', 'text', 'hello world'),
      buildHit('m2', 'file', 'report.pdf'),
      buildHit('m3', 'audio', 'voice.m4a'),
    ]);
    renderResults();

    expect(screen.getByText('hello world')).toBeInTheDocument();
    expect(screen.getByText(/📁\s*report\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/🎵\s*voice\.m4a/)).toBeInTheDocument();
  });

  it('点消息命中 → onSelectMessage 收到对应的 group 与 hit', () => {
    const hit = buildHit('m1', 'text', 'hello world');
    setLocalHits([hit]);
    const props = renderResults();

    fireEvent.click(screen.getByText('hello world'));
    expect(props.onSelectMessage).toHaveBeenCalledTimes(1);
    const [grpArg, hitArg] = props.onSelectMessage.mock.calls[0];
    expect(grpArg.conversationId).toBe('conv-a-b');
    expect(hitArg.message.message_uuid).toBe('m1');
  });

  it('命中数触顶 → 如实提示"只显示了前 N 条"（本链路无翻页，不能假装后面没有了）', () => {
    setLocalHits(Array.from({ length: 50 }, (_, i) => buildHit(`m${i}`, 'text', `hit ${i}`)));
    renderResults();
    expect(screen.getByText(/仅显示最近 50 条/)).toBeInTheDocument();
  });

  it('命中数未触顶 → 不出现该提示（避免恒显示 = 没有信息量）', () => {
    setLocalHits([buildHit('m1', 'text', 'only one')]);
    renderResults();
    expect(screen.queryByText(/仅显示最近/)).toBeNull();
  });

  it('本地搜索加载中 / 出错各自有态，不落到空态', () => {
    mockUseGlobalMessageSearch.mockReturnValue({ groups: [], loading: true, error: null });
    renderResults();
    expect(screen.getByText(/搜索消息中/)).toBeInTheDocument();
    expect(screen.queryByText(/未找到包含/)).toBeNull();

    cleanup();
    mockUseGlobalMessageSearch.mockReturnValue({ groups: [], loading: false, error: 'db crash' });
    renderResults();
    expect(screen.getByText('db crash')).toBeInTheDocument();
    expect(screen.queryByText(/未找到包含/)).toBeNull();
  });
});

describe('GlobalMessageSearchResults · 图片 / 视频页签走九宫格封面', () => {
  beforeEach(() => {
    cleanup();
    mockUseGlobalMessageSearch.mockReset();
    mockUseDiscoverySearch.mockReset();
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: false,
      error: null,
    });
  });

  it('图片页签：命中渲染成 layout="cover" 的格子，挂在网格容器里', () => {
    setLocalHits([buildHit('m1', 'image', 'a.png'), buildHit('m2', 'image', 'b.png')]);
    renderResults();
    clickTab('图片');

    const cells = screen.getAllByTestId('search-hit');
    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.getAttribute('data-layout'))).toEqual(['cover', 'cover']);
    expect(cells[0].parentElement).toHaveClass('global-msg-search-grid');
  });

  it('视频页签：同样走 cover 版式（与图片同一条通路）', () => {
    setLocalHits([buildHit('v1', 'video', 'clip.mp4')]);
    renderResults();
    clickTab('视频');

    const cell = screen.getByTestId('search-hit');
    expect(cell).toHaveAttribute('data-layout', 'cover');
    expect(cell).toHaveAttribute('data-uuid', 'v1');
  });

  it('点格子 → onSelectMessage（全局搜索跨会话，定位前必须先切会话，不能只写定位请求）', () => {
    setLocalHits([buildHit('m1', 'image', 'a.png')]);
    const props = renderResults();
    clickTab('图片');

    fireEvent.click(screen.getByTestId('search-hit'));
    expect(props.onSelectMessage).toHaveBeenCalledTimes(1);
    expect(props.onSelectMessage.mock.calls[0][1].message.message_uuid).toBe('m1');
  });

  it('消息页签不用 cover 版式（用列表行）—— 防止三个页签被写成同一支', () => {
    setLocalHits([buildHit('m1', 'text', 'hello')]);
    renderResults();
    expect(screen.queryByTestId('search-hit')).toBeNull();
  });
});

describe('GlobalMessageSearchResults · 本地会话名命中按 bot 分流', () => {
  // 三个名字都含关键词 alice ⇒ 三个页签的本地命中来自**同一批**输入，
  // 分流写反时会立刻串台（而不是各自恰好搜不到对方）
  const friends = [buildFriend('u-1', 'Alice'), buildFriend('bot_9', 'Alice 助手')];
  const groups = [buildGroup('g-1', 'Alice 的群')];

  beforeEach(() => {
    cleanup();
    mockUseGlobalMessageSearch.mockReset();
    mockUseDiscoverySearch.mockReset();
    setLocalHits([]);
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: false,
      error: null,
    });
  });

  it('「用户」页签只出非 bot 好友；bot 好友与群都不在这里（正反两条，防 isBotUserId 写反）', () => {
    renderResults({ query: 'alice', friends, groups });
    clickTab('用户');

    expect(rowLabels()).toEqual(['Alice']);
  });

  it('「机器人」页签只出 bot 好友，且带 BOT 徽章', () => {
    renderResults({ query: 'alice', friends, groups });
    clickTab('机器人');

    expect(rowLabels()).toEqual(['Alice 助手']);
    expect(screen.getByText('Bot')).toHaveClass('bot-badge');
  });

  it('「群聊」页签只出群，不混好友', () => {
    renderResults({ query: 'alice', friends, groups });
    clickTab('群聊');

    expect(rowLabels()).toEqual(['Alice 的群']);
  });

  it('点本地会话行 → onSelectConversation 带对的类型与数据', () => {
    const props = renderResults({ query: 'alice', friends, groups });

    clickTab('用户');
    clickRow('Alice');
    expect(props.onSelectConversation).toHaveBeenLastCalledWith('friend', friends[0]);

    clickTab('机器人');
    clickRow('Alice 助手');
    expect(props.onSelectConversation).toHaveBeenLastCalledWith('friend', friends[1]);

    clickTab('群聊');
    clickRow('Alice 的群');
    expect(props.onSelectConversation).toHaveBeenLastCalledWith('group', groups[0]);
  });
});

describe('GlobalMessageSearchResults · 每个页签都有自己的空态', () => {
  beforeEach(() => {
    cleanup();
    mockUseGlobalMessageSearch.mockReset();
    mockUseDiscoverySearch.mockReset();
    setLocalHits([]);
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: false,
      error: null,
    });
  });

  it.each([
    ['消息', '未找到包含「x」的消息'],
    ['视频', '未找到包含「x」的视频'],
    ['图片', '未找到包含「x」的图片'],
    ['用户', '未找到包含「x」的用户'],
    ['群聊', '未找到包含「x」的群聊'],
    ['机器人', '未找到包含「x」的机器人'],
  ])('%s 页签空态文案带自己的分类名', (label, text) => {
    renderResults();
    clickTab(label);
    const body = screen.getByText(text);
    expect(body).toBeInTheDocument();
    // 空态挂在结果区里，页签栏不受影响（仍可切走）
    expect(screen.getAllByRole('tab')).toHaveLength(6);
  });

  it('发现区仍在加载时，实体页签不提前报空（否则会一闪而过地说"没有"）', () => {
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: true,
      error: null,
    });
    renderResults();
    clickTab('用户');

    expect(screen.queryByText('未找到包含「x」的用户')).toBeNull();
    expect(screen.getByText(/搜索用户中/)).toBeInTheDocument();
  });

  it('发现区出错时，实体页签显示失败提示而不是空态', () => {
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: false,
      error: 'boom',
    });
    renderResults();
    clickTab('群聊');

    expect(screen.getByText(/发现搜索失败/)).toBeInTheDocument();
    expect(screen.queryByText('未找到包含「x」的群聊')).toBeNull();
  });
});

describe('GlobalMessageSearchResults · 发现区不随页签重查', () => {
  beforeEach(() => {
    cleanup();
    mockUseGlobalMessageSearch.mockReset();
    mockUseDiscoverySearch.mockReset();
    setLocalHits([]);
    mockUseDiscoverySearch.mockReturnValue({
      people: [],
      groups: [],
      bots: [],
      loading: false,
      error: null,
    });
  });

  it('在用户 / 群聊 / 机器人之间切换，发现 hook 拿到的入参始终只是 query', () => {
    renderResults();
    clickTab('用户');
    clickTab('群聊');
    clickTab('机器人');

    const args = new Set(mockUseDiscoverySearch.mock.calls.map((c) => JSON.stringify(c)));
    expect(args).toEqual(new Set([JSON.stringify(['x'])]));
  });
});

describe('GlobalMessageSearchResults · 与发现区共存', () => {
  beforeEach(() => {
    cleanup();
    mockUseGlobalMessageSearch.mockReset();
    mockUseDiscoverySearch.mockReset();
    setLocalHits([]);
  });

  it('用户页签：本地「会话」段与服务端「发现」段并存，互不吞并', () => {
    mockUseDiscoverySearch.mockReturnValue({
      people: [{ userId: 'u9', nickname: 'AliceRemote', avatarUrl: null, isFriend: false }],
      groups: [],
      bots: [],
      loading: false,
      error: null,
    });
    renderResults({ query: 'alice', friends: [buildFriend('u-1', 'Alice')] });
    clickTab('用户');

    const localHeader = screen.getByText('会话');
    const discHeader = screen.getByText('发现');
    expect(within(localHeader).getByText('1')).toBeInTheDocument();
    expect(within(discHeader).getByText('1')).toBeInTheDocument();
    // 本地行在前、发现行在后，两段各一行（用 rowLabels 而非 getByText：见其注释）
    expect(rowLabels()).toEqual(['Alice', 'AliceRemote']);
  });
});
