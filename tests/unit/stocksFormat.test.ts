/**
 * 股票格式化纯函数单元测试（src/stocks/format.ts）
 */

import { describe, it, expect } from 'vitest';
import {
  priceDirection,
  directionClass,
  formatChangePct,
  formatSigned,
  formatPrice,
  formatPercent,
  formatAmount,
  formatDataTime,
  formatPublished,
} from '../../src/stocks/format';

describe('股票格式化 (stocks/format)', () => {
  describe('priceDirection', () => {
    it('正数为 up', () => { expect(priceDirection(1.2)).toBe('up'); });
    it('负数为 down', () => { expect(priceDirection(-0.5)).toBe('down'); });
    it('0 为 flat', () => { expect(priceDirection(0)).toBe('flat'); });
    it('NaN 为 flat', () => { expect(priceDirection(Number.NaN)).toBe('flat'); });
  });

  describe('directionClass', () => {
    it('映射到 stock-dir-- 修饰', () => {
      expect(directionClass('up')).toBe('stock-dir--up');
      expect(directionClass('down')).toBe('stock-dir--down');
      expect(directionClass('flat')).toBe('stock-dir--flat');
    });
  });

  describe('formatChangePct', () => {
    it('正数带 + 号两位小数', () => { expect(formatChangePct(3.2)).toBe('+3.20%'); });
    it('负数保留负号', () => { expect(formatChangePct(-1.5)).toBe('-1.50%'); });
    it('0 不带符号', () => { expect(formatChangePct(0)).toBe('0.00%'); });
    it('非有限值给占位', () => { expect(formatChangePct(Number.NaN)).toBe('—'); });
  });

  describe('formatSigned', () => {
    it('正数带 +', () => { expect(formatSigned(2)).toBe('+2.00'); });
    it('负数保留负号', () => { expect(formatSigned(-2)).toBe('-2.00'); });
    it('非有限值给占位', () => { expect(formatSigned(Infinity)).toBe('—'); });
  });

  describe('formatPrice', () => {
    it('固定两位小数无符号', () => { expect(formatPrice(12.3)).toBe('12.30'); });
    it('非有限值给占位', () => { expect(formatPrice(Number.NaN)).toBe('—'); });
  });

  describe('formatPercent（无符号，命中率用）', () => {
    it('正数不带 + 号', () => { expect(formatPercent(65)).toBe('65.00%'); });
    it('0 显示 0.00%', () => { expect(formatPercent(0)).toBe('0.00%'); });
    it('非有限值给占位', () => { expect(formatPercent(Number.NaN)).toBe('—'); });
  });

  describe('formatAmount', () => {
    it('亿级', () => { expect(formatAmount(2.5e8)).toBe('2.50亿'); });
    it('万级', () => { expect(formatAmount(3.4e4)).toBe('3.40万'); });
    it('小额取整', () => { expect(formatAmount(1234)).toBe('1234'); });
    it('null 给占位', () => { expect(formatAmount(null)).toBe('—'); });
    it('undefined 给占位', () => { expect(formatAmount(undefined)).toBe('—'); });
  });

  describe('formatDataTime', () => {
    it('空值给"时点未知"', () => { expect(formatDataTime(null)).toBe('时点未知'); });
    it('非法串给"时点未知"', () => { expect(formatDataTime('not-a-date')).toBe('时点未知'); });
    it('合法 ISO 返回本地时间串', () => {
      expect(formatDataTime('2026-07-04T10:00:00Z')).not.toBe('时点未知');
    });
  });

  describe('formatPublished', () => {
    it('null 给"无日期"（不用当前时间冒充）', () => { expect(formatPublished(null)).toBe('无日期'); });
    it('非法串给"无日期"', () => { expect(formatPublished('xxx')).toBe('无日期'); });
    it('合法日期返回日期串', () => {
      expect(formatPublished('2026-07-04T10:00:00Z')).not.toBe('无日期');
    });
  });
});
