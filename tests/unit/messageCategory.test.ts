/**
 * 会话内搜索：消息分类 ↔ content_type 映射测试
 *
 * 被测对象是「业务分类 → SQL 过滤条件」这层映射，它决定四个页签各自能看到什么。
 * 关键不变量：
 * - 图片 / 视频 / 文件走白名单（枚举 content_type）
 * - 文字走**黑名单**（= 非文件类）——服务端未来新增的未知类型必须仍落进文字，
 *   否则该消息在四个页签里全都看不到（只有「全部」能看到），等于凭空消失
 */

import { describe, it, expect } from 'vitest';
import {
  FILE_CONTENT_TYPES,
  MESSAGE_CATEGORY_TABS,
  categoryToSearchFilter,
  contentTypeBadge,
  contentTypeToCategory,
} from '../../src/components/search/messageCategory';

describe('messageCategory', () => {
  describe('categoryToSearchFilter', () => {
    it('全部：不下发任何 content_type 过滤', () => {
      expect(categoryToSearchFilter('all')).toEqual({});
    });

    it('文字：用 exclude 排除全部文件类，不用 include 白名单', () => {
      const filter = categoryToSearchFilter('text');
      expect(filter.include_content_types).toBeUndefined();
      expect(filter.exclude_content_types).toEqual(['image', 'video', 'file', 'audio']);
    });

    it('图片 / 视频：各自精确的单值白名单', () => {
      expect(categoryToSearchFilter('image')).toEqual({ include_content_types: ['image'] });
      expect(categoryToSearchFilter('video')).toEqual({ include_content_types: ['video'] });
    });

    it('文件：文件类去掉单独成页签的图片 / 视频', () => {
      const filter = categoryToSearchFilter('file');
      expect(filter.include_content_types).toEqual(['file', 'audio']);
      expect(filter.include_content_types).not.toContain('image');
      expect(filter.include_content_types).not.toContain('video');
    });

    it('四个具体分类彼此不重叠：任一 content_type 只落进一个分类', () => {
      const samples = ['text', 'image', 'video', 'file', 'audio', 'card', 'meeting_invite', 'system'];
      for (const contentType of samples) {
        const matched = (['text', 'image', 'video', 'file'] as const).filter((category) => {
          const filter = categoryToSearchFilter(category);
          if (filter.include_content_types) {
            return filter.include_content_types.includes(contentType);
          }
          return !filter.exclude_content_types?.includes(contentType);
        });
        expect(matched, `${contentType} 应恰好归属一个分类，实际 ${matched.join('/')}`).toHaveLength(1);
      }
    });

    it('服务端新增的未知 content_type 落进「文字」而非消失', () => {
      const unknown = 'brand_new_type';
      expect(FILE_CONTENT_TYPES as readonly string[]).not.toContain(unknown);
      // 文字页签用 exclude → 未知类型不在排除表里 → 仍能被搜到
      expect(categoryToSearchFilter('text').exclude_content_types).not.toContain(unknown);
      expect(contentTypeToCategory(unknown)).toBe('text');
    });
  });

  describe('contentTypeToCategory / contentTypeBadge', () => {
    it('按 content_type 归类', () => {
      expect(contentTypeToCategory('image')).toBe('image');
      expect(contentTypeToCategory('video')).toBe('video');
      expect(contentTypeToCategory('file')).toBe('file');
      expect(contentTypeToCategory('audio')).toBe('file');
      expect(contentTypeToCategory('text')).toBe('text');
      expect(contentTypeToCategory('card')).toBe('text');
      expect(contentTypeToCategory('meeting_invite')).toBe('text');
      expect(contentTypeToCategory('system')).toBe('text');
    });

    it('文字类不加徽标，其余给中文徽标', () => {
      expect(contentTypeBadge('text')).toBeNull();
      expect(contentTypeBadge('card')).toBeNull();
      expect(contentTypeBadge('image')).toBe('图片');
      expect(contentTypeBadge('video')).toBe('视频');
      expect(contentTypeBadge('file')).toBe('文件');
      expect(contentTypeBadge('audio')).toBe('文件');
    });
  });

  it('页签定义覆盖全部五个分类且顺序固定', () => {
    expect(MESSAGE_CATEGORY_TABS.map((t) => t.key)).toEqual([
      'all',
      'text',
      'image',
      'video',
      'file',
    ]);
    expect(MESSAGE_CATEGORY_TABS.map((t) => t.label)).toEqual([
      '全部',
      '文字',
      '图片',
      '视频',
      '文件',
    ]);
  });
});
