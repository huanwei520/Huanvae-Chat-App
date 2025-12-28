/**
 * 图片尺寸缓存服务测试
 *
 * 测试图片尺寸的获取、保存和计算功能
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getImageDimensionsSync,
  calculateDisplaySize,
  clearMemoryCache,
} from '../../src/services/imageDimensions';

describe('imageDimensions 服务', () => {
  beforeEach(() => {
    // 每次测试前清空内存缓存
    clearMemoryCache();
  });

  describe('getImageDimensionsSync', () => {
    it('未缓存时返回 null', () => {
      const result = getImageDimensionsSync('non-existent-key');
      expect(result).toBeNull();
    });
  });

  describe('calculateDisplaySize', () => {
    it('小图片保持原始尺寸', () => {
      const result = calculateDisplaySize(100, 100);
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
    });

    it('宽图片按宽度缩放', () => {
      const result = calculateDisplaySize(560, 300);
      expect(result.width).toBe(280);
      expect(result.height).toBe(150);
    });

    it('高图片按高度缩放', () => {
      const result = calculateDisplaySize(200, 600);
      expect(result.width).toBe(100);
      expect(result.height).toBe(300);
    });

    it('大图片同时超出时正确缩放', () => {
      const result = calculateDisplaySize(1000, 1000);
      // 先按宽度缩放到 280，高度变为 280
      // 280 < 300，所以不需要再按高度缩放
      expect(result.width).toBe(280);
      expect(result.height).toBe(280);
    });

    it('无效尺寸返回默认值', () => {
      const result = calculateDisplaySize(0, 0);
      expect(result.width).toBe(280);
      expect(result.height).toBe(300);
    });

    it('负数尺寸返回默认值', () => {
      const result = calculateDisplaySize(-100, -100);
      expect(result.width).toBe(280);
      expect(result.height).toBe(300);
    });

    it('自定义最大尺寸', () => {
      const result = calculateDisplaySize(500, 500, 100, 100);
      expect(result.width).toBe(100);
      expect(result.height).toBe(100);
    });

    it('横向图片正确缩放', () => {
      // 1920x1080 (16:9)
      const result = calculateDisplaySize(1920, 1080);
      // 按宽度缩放到 280，高度 = 280 * (1080/1920) = 157.5
      expect(result.width).toBe(280);
      expect(result.height).toBe(158); // 四舍五入
    });

    it('纵向图片正确缩放', () => {
      // 1080x1920 (9:16)
      const result = calculateDisplaySize(1080, 1920);
      // 按宽度缩放到 280，高度 = 280 * (1920/1080) = 497.78
      // 超过最大高度 300，按高度缩放
      // 宽度 = 300 * (1080/1920) = 168.75
      expect(result.width).toBe(169); // 四舍五入
      expect(result.height).toBe(300);
    });
  });
});

