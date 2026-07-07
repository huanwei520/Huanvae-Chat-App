/**
 * 股票分类纯函数测试 — isIndexSymbol / isSnapshotMissing
 *
 * 覆盖 W20 两 gap 的判定核心：
 *   - isIndexSymbol：指数（^ 前缀）→ 详情隐藏情报/财报（gap #2）。
 *   - isSnapshotMissing：404「快照不存在」→ 优雅灰字空态，真错误仍红字（gap #1）。
 */

import { describe, it, expect } from 'vitest';
import { isIndexSymbol, isSnapshotMissing } from '../../src/stocks/classify';

describe('isIndexSymbol', () => {
  it('^ 前缀标的判为指数（^IXIC/^NDX/^GSPC/^DJI）', () => {
    expect(isIndexSymbol('^IXIC')).toBe(true);
    expect(isIndexSymbol('^NDX')).toBe(true);
    expect(isIndexSymbol('^GSPC')).toBe(true);
    expect(isIndexSymbol('^DJI')).toBe(true);
  });

  it('美股个股 / A 股 / ETF 代码不判为指数', () => {
    expect(isIndexSymbol('AAPL')).toBe(false);
    expect(isIndexSymbol('600519')).toBe(false);
    expect(isIndexSymbol('161226')).toBe(false);
    expect(isIndexSymbol('')).toBe(false);
  });
});

describe('isSnapshotMissing', () => {
  it('后端 404「快照不存在」文案判为快照缺失（走优雅空态）', () => {
    expect(isSnapshotMissing('K线快照不存在')).toBe(true);
    expect(isSnapshotMissing('情报快照不存在')).toBe(true);
    expect(isSnapshotMissing('财报快照不存在')).toBe(true);
  });

  it('英文 not found / 404 文案兼容判为快照缺失', () => {
    expect(isSnapshotMissing('snapshot not found')).toBe(true);
    expect(isSnapshotMissing('Not Found')).toBe(true);
    expect(isSnapshotMissing('HTTP 404')).toBe(true);
  });

  it('网络 / 500 等真错误不判为快照缺失（仍红字报错）', () => {
    expect(isSnapshotMissing('HTTP 500')).toBe(false);
    expect(isSnapshotMissing('网络请求失败')).toBe(false);
    expect(isSnapshotMissing('会话已过期，请重新登录')).toBe(false);
  });

  it('空错误（null/undefined/空串）判为非缺失', () => {
    expect(isSnapshotMissing(null)).toBe(false);
    expect(isSnapshotMissing(undefined)).toBe(false);
    expect(isSnapshotMissing('')).toBe(false);
  });
});
