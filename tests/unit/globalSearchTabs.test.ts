/**
 * globalSearchTabs —— 全局搜索六分类页签的纯函数模块
 *
 * 覆盖三件产品口径（都是"写错了没人会发现"的那种，故必须机器守门）：
 *
 * 1. **六个页签的 key、顺序、文案逐字**。顺序与文案是需求原话（消息 · 视频 · 图片 ·
 *    用户 · 群聊 · 机器人），有人手滑改名 / 调序 / 加减一个都要红。
 * 2. **tabToSearchFilter 的三个消息类页签给对 include / exclude**。写反（把 exclude
 *    写成 include）在 UI 上表现为"消息页签里只剩图片视频"，静默且刺眼；实体页签必须
 *    返回 null（它们根本不查消息表，返回 {} 会变成"不限类型全查一遍"的无效 DB 调用）。
 * 3. **「消息」用黑名单而不是白名单**：file / audio 在六个分类里没有自己的页签，
 *    必须落进「消息」。正向断言 exclude 只有 image/video，反向断言它不是白名单。
 */

import { describe, it, expect } from 'vitest';
import {
  GLOBAL_SEARCH_TABS,
  GLOBAL_SEARCH_TAB_ORDER,
  GLOBAL_SEARCH_TAB_LABEL,
  DEFAULT_GLOBAL_SEARCH_TAB,
  isMessageTab,
  tabToSearchFilter,
  tabEmptyText,
  type GlobalSearchTab,
} from '../../src/components/search/globalSearchTabs';

describe('globalSearchTabs · 六个页签的 key / 顺序 / 文案', () => {
  it('顺序逐字：消息 → 视频 → 图片 → 用户 → 群聊 → 机器人', () => {
    expect(GLOBAL_SEARCH_TABS.map((t) => t.key)).toEqual([
      'message',
      'video',
      'image',
      'user',
      'group',
      'bot',
    ]);
    expect(GLOBAL_SEARCH_TABS.map((t) => t.label)).toEqual([
      '消息',
      '视频',
      '图片',
      '用户',
      '群聊',
      '机器人',
    ]);
  });

  it('不多不少恰好六个，且 order / label / TABS 三处一致', () => {
    expect(GLOBAL_SEARCH_TABS).toHaveLength(6);
    expect(GLOBAL_SEARCH_TAB_ORDER).toHaveLength(6);
    expect(Object.keys(GLOBAL_SEARCH_TAB_LABEL)).toHaveLength(6);
    expect(GLOBAL_SEARCH_TABS.map((t) => t.key)).toEqual([...GLOBAL_SEARCH_TAB_ORDER]);
  });

  it('默认落在第一个页签「消息」', () => {
    expect(DEFAULT_GLOBAL_SEARCH_TAB).toBe('message');
    expect(GLOBAL_SEARCH_TAB_ORDER[0]).toBe(DEFAULT_GLOBAL_SEARCH_TAB);
  });
});

describe('globalSearchTabs · isMessageTab 区分两族取数通路', () => {
  it('消息 / 视频 / 图片 走本地消息表；用户 / 群聊 / 机器人 不走', () => {
    expect(isMessageTab('message')).toBe(true);
    expect(isMessageTab('video')).toBe(true);
    expect(isMessageTab('image')).toBe(true);
    expect(isMessageTab('user')).toBe(false);
    expect(isMessageTab('group')).toBe(false);
    expect(isMessageTab('bot')).toBe(false);
  });
});

describe('globalSearchTabs · tabToSearchFilter', () => {
  it('「消息」= 黑名单，只排掉单独成页签的 image / video（file / audio 仍落进消息）', () => {
    const filter = tabToSearchFilter('message');
    expect(filter).toEqual({ exclude_content_types: ['image', 'video'] });
    // 反向：不能写成白名单 —— 那样 file / audio 会从六个分类里凭空消失
    expect(filter?.include_content_types).toBeUndefined();
    expect(filter?.exclude_content_types).not.toContain('file');
    expect(filter?.exclude_content_types).not.toContain('audio');
  });

  it('「视频」/「图片」= 白名单，各只留自己那一类', () => {
    expect(tabToSearchFilter('video')).toEqual({ include_content_types: ['video'] });
    expect(tabToSearchFilter('image')).toEqual({ include_content_types: ['image'] });
    // 反向：白名单页签不能带 exclude（两者同时出现语义会打架）
    expect(tabToSearchFilter('video')?.exclude_content_types).toBeUndefined();
    expect(tabToSearchFilter('image')?.exclude_content_types).toBeUndefined();
  });

  it('实体页签返回 null（不是 {}）—— {} 会被当成"不限类型"真发一次 DB 查询', () => {
    expect(tabToSearchFilter('user')).toBeNull();
    expect(tabToSearchFilter('group')).toBeNull();
    expect(tabToSearchFilter('bot')).toBeNull();
  });

  it('三个消息类页签的 filter 互不相同（防止有人把三支写成同一个）', () => {
    const seen = (['message', 'video', 'image'] as const).map((t) =>
      JSON.stringify(tabToSearchFilter(t)),
    );
    expect(new Set(seen).size).toBe(3);
  });
});

describe('globalSearchTabs · tabEmptyText 每个页签都有空态文案', () => {
  it('六个页签各自带自己的分类名，不是同一句通用话', () => {
    const texts = GLOBAL_SEARCH_TAB_ORDER.map((t: GlobalSearchTab) => tabEmptyText(t, 'abc'));
    expect(texts).toEqual([
      '未找到包含「abc」的消息',
      '未找到包含「abc」的视频',
      '未找到包含「abc」的图片',
      '未找到包含「abc」的用户',
      '未找到包含「abc」的群聊',
      '未找到包含「abc」的机器人',
    ]);
    // 六句互不相同 ⇒ 用户能从空态本身看出自己在哪个分类
    expect(new Set(texts).size).toBe(6);
  });
});
