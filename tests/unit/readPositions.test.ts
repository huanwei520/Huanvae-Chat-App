/**
 * 读位内存模块单元测试（L1：纯内存模块，零 mock）
 *
 * 覆盖 src/contexts/readPositions.ts：
 * - seed 灌入 + 单调合并（写穿期间已推进的值不被快照回退）
 * - noteMessageSeq / noteRead 的单调语义（显式 seq 只推进 last_read_seq，不碰 last_seq）
 * - reset 清空（登出/账号切换）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isReadPositionsLoaded,
  seedReadPositions,
  noteMessageSeq,
  noteRead,
  getReadPosition,
  getReadPositionsSnapshot,
  resetReadPositions,
} from '../../src/contexts/readPositions';

describe('readPositions - 读位内存模块', () => {
  beforeEach(() => {
    resetReadPositions();
  });

  it('初始未载入；seed 后 loaded=true 且可查快照', () => {
    expect(isReadPositionsLoaded()).toBe(false);
    seedReadPositions([{ id: 'c1', last_seq: 5, last_read_seq: 3 }]);
    expect(isReadPositionsLoaded()).toBe(true);
    expect(getReadPosition('c1')).toEqual({ last_seq: 5, last_read_seq: 3 });
    expect(getReadPositionsSnapshot()).toEqual([{ id: 'c1', last_seq: 5, last_read_seq: 3 }]);
  });

  it('seed 单调合并：不回退写穿期间已推进的值', () => {
    noteMessageSeq('c1', 10);
    noteRead('c1', 8);
    // 之后到达的陈旧 db 快照（5/3）不能把 10/8 拉回去
    seedReadPositions([{ id: 'c1', last_seq: 5, last_read_seq: 3 }]);
    expect(getReadPosition('c1')).toEqual({ last_seq: 10, last_read_seq: 8 });
    // 反向：快照更高时取快照值
    seedReadPositions([{ id: 'c1', last_seq: 12, last_read_seq: 11 }]);
    expect(getReadPosition('c1')).toEqual({ last_seq: 12, last_read_seq: 11 });
  });

  it('noteMessageSeq 单调抬 last_seq；seq<=0 忽略', () => {
    noteMessageSeq('c1', 5);
    noteMessageSeq('c1', 3); // 乱序旧消息不回退
    expect(getReadPosition('c1')).toEqual({ last_seq: 5, last_read_seq: 0 });
    noteMessageSeq('c2', 0);
    expect(getReadPosition('c2')).toBeUndefined();
  });

  it('noteRead 无 seq：推进到本地已收最新（last_read_seq = last_seq）', () => {
    noteMessageSeq('c1', 7);
    noteRead('c1');
    expect(getReadPosition('c1')).toEqual({ last_seq: 7, last_read_seq: 7 });
  });

  it('noteRead 带 seq：只推进 last_read_seq 到显式读位，不碰 last_seq（别端读位 < 本地最新时不越权标读）', () => {
    noteMessageSeq('c1', 8);
    noteRead('c1', 6); // 别端只读到 6，本地有 8
    expect(getReadPosition('c1')).toEqual({ last_seq: 8, last_read_seq: 6 });
    noteRead('c1', 4); // 乱序旧读位不回退
    expect(getReadPosition('c1')).toEqual({ last_seq: 8, last_read_seq: 6 });
  });

  it('noteRead 对未知会话：带 seq 时建条目（last_seq=0 → 不会被判已读）；无 seq 时无操作', () => {
    noteRead('cx');
    expect(getReadPosition('cx')).toBeUndefined();
    noteRead('cy', 9);
    expect(getReadPosition('cy')).toEqual({ last_seq: 0, last_read_seq: 9 });
  });

  it('reset 清空全部条目并回到未载入', () => {
    seedReadPositions([{ id: 'c1', last_seq: 5, last_read_seq: 5 }]);
    resetReadPositions();
    expect(isReadPositionsLoaded()).toBe(false);
    expect(getReadPosition('c1')).toBeUndefined();
    expect(getReadPositionsSnapshot()).toEqual([]);
  });
});
