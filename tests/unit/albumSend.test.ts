/**
 * 相册发送编排测试（src/chat/shared/albumSend.ts）
 *
 * 重点全在「后端会 400 / 用户会被误导」的那几条上：
 * 1. 配文**只能**挂 index=0（其余位次带 caption 后端直接 400）
 * 2. 位次 0..count-1、count 就是张数 —— 错一位整组就散
 * 3. 串行推进（并发会让组内 seq 乱序，接收端相册被拆开）
 * 4. 传一半失败：**失败即停 + 如实上报已成功数**，不回滚、不假装整组成功
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ALBUM_MAX_ITEMS,
  ALBUM_MIN_ITEMS,
  describePartialFailure,
  planAlbumUpload,
  runAlbumUpload,
  type AlbumUploadPlan,
} from '../../src/chat/shared/albumSend';

const files = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);

describe('planAlbumUpload — 位次与配文归属', () => {
  it('位次 0..count-1，count 等于张数', () => {
    const plans = planAlbumUpload(files(3), 'g1');
    expect(plans.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(plans.every((p) => p.count === 3)).toBe(true);
    expect(plans.every((p) => p.groupId === 'g1')).toBe(true);
  });

  it('配文只挂 index=0，其余位次必须不带（后端对其余位次带 caption 直接 400）', () => {
    const plans = planAlbumUpload(files(3), 'g1', '整组配文');
    expect(plans[0].caption).toBe('整组配文');
    expect(plans[1].caption).toBeUndefined();
    expect(plans[2].caption).toBeUndefined();
  });

  it('配文只有空白时视为无配文（不提交一串空格）', () => {
    const plans = planAlbumUpload(files(2), 'g1', '   ');
    expect(plans[0].caption).toBeUndefined();
  });

  it('配文两端空白被裁掉', () => {
    const plans = planAlbumUpload(files(2), 'g1', '  有内容  ');
    expect(plans[0].caption).toBe('有内容');
  });

  it('张数越界抛错（调用方应在选择阶段就卡住，这里只是编程错误的护栏）', () => {
    expect(() => planAlbumUpload(files(1), 'g1')).toThrow();
    expect(() => planAlbumUpload(files(ALBUM_MAX_ITEMS + 1), 'g1')).toThrow();
    expect(() => planAlbumUpload(files(ALBUM_MIN_ITEMS), 'g1')).not.toThrow();
    expect(() => planAlbumUpload(files(ALBUM_MAX_ITEMS), 'g1')).not.toThrow();
  });
});

describe('runAlbumUpload — 串行与全成功', () => {
  it('全部成功：complete=true，succeeded=total，无失败位次', async () => {
    const plans = planAlbumUpload(files(3), 'g1');
    const result = await runAlbumUpload(plans, async () => {});

    expect(result.complete).toBe(true);
    expect(result.succeeded).toBe(3);
    expect(result.total).toBe(3);
    expect(result.failedAtIndex).toBeNull();
    expect(result.groupId).toBe('g1');
  });

  it('串行推进：上一项结束后才开始下一项（并发会让组内 seq 乱序）', async () => {
    const plans = planAlbumUpload(files(3), 'g1');
    let inFlight = 0;
    let maxInFlight = 0;
    const order: number[] = [];

    await runAlbumUpload(plans, async (p: AlbumUploadPlan<string>) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      order.push(p.index);
      inFlight -= 1;
    });

    expect(maxInFlight).toBe(1);
    expect(order).toEqual([0, 1, 2]);
  });
});

describe('runAlbumUpload — 传一半失败（本模块的核心决策）', () => {
  it('失败即停：失败之后的项不再尝试', async () => {
    const plans = planAlbumUpload(files(4), 'g1');
    const attempted: number[] = [];

    const result = await runAlbumUpload(plans, async (p) => {
      attempted.push(p.index);
      if (p.index === 1) { throw new Error('网络断了'); }
    });

    // 只尝试了 0 和 1，2/3 未尝试
    expect(attempted).toEqual([0, 1]);
    expect(result.failedAtIndex).toBe(1);
    expect(result.complete).toBe(false);
  });

  it('如实上报已成功数：不回滚已发出的项，也不把整组算作失败', async () => {
    const plans = planAlbumUpload(files(4), 'g1');
    const result = await runAlbumUpload(plans, async (p) => {
      if (p.index === 2) { throw new Error('boom'); }
    });

    expect(result.succeeded).toBe(2); // 0、1 已经发出去了，对方能看到
    expect(result.total).toBe(4);
    expect(result.outcomes.filter((o) => o.ok).map((o) => o.index)).toEqual([0, 1]);
    expect(result.outcomes.find((o) => !o.ok)?.error).toBe('boom');
  });

  it('第一项就失败：succeeded=0，且后续一项都不发（不留残组）', async () => {
    const plans = planAlbumUpload(files(3), 'g1');
    const uploadOne = vi.fn(async () => { throw new Error('x'); });
    const result = await runAlbumUpload(plans, uploadOne);

    expect(uploadOne).toHaveBeenCalledTimes(1);
    expect(result.succeeded).toBe(0);
    expect(result.failedAtIndex).toBe(0);
  });
});

describe('describePartialFailure — 文案不能误导', () => {
  it('整组成功时无提示', async () => {
    const result = await runAlbumUpload(planAlbumUpload(files(2), 'g1'), async () => {});
    expect(describePartialFailure(result)).toBe('');
  });

  it('传一半时明说「已发出 M/N」且点明对方已能看到（否则用户会重发整组造成重复）', async () => {
    const result = await runAlbumUpload(planAlbumUpload(files(4), 'g1'), async (p) => {
      if (p.index === 2) { throw new Error('boom'); }
    });

    const text = describePartialFailure(result);
    expect(text).toContain('2/4');
    expect(text).toContain('对方已能看到');
    // 不能只说「发送失败」——那会让用户以为对方什么都没收到
    expect(text).not.toMatch(/^相册发送失败$/);
  });
});
